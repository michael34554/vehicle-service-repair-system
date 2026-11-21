import { randomBytes, randomUUID } from 'node:crypto';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { db } from './db';
import { sendMechanicReport, type ReportColumn } from './mechanicReports';

/**
 * Mechanic Management API.
 *
 * This module extends the existing NEXTGEN server instead of creating a second backend.
 * It reuses the existing JWT middleware, CSRF protection, repair status workflow,
 * assignment history, activity logs, and stock transaction mechanism via `deps`.
 */

type Role = 'owner' | 'manager' | 'advisor' | 'technician';

interface MechanicAuth {
  id: string;
  name: string;
  email: string;
  role: Role;
  workshop_id: string;
  workshop_name: string;
  session_id: string;
  jti: string;
  csrf: string;
}

interface JobLike {
  id: string;
  workshop_id: string;
  vehicle_id: string;
  job_no: string;
  repair_status: string;
  repair_priority: string;
  service_type: string;
  issue_description: string | null;
  assigned_technician: string | null;
  registration_number: string;
  make: string;
  model: string;
  customer_name: string;
  created_at: string;
}

interface ActivityInput {
  workshopId: string;
  jobId: string;
  fields: Record<string, string | null>;
  activityType?: string | null;
  workStatus?: string | null;
  auth: MechanicAuth;
  createdAt: string;
}

export interface MechanicDeps {
  app: Express;
  db: typeof db;
  HttpError: new (status: number, message: string) => Error;
  requireAuth: RequestHandler;
  asyncRoute: (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) => RequestHandler;
  requireObject: (value: unknown) => Record<string, unknown>;
  requiredText: (value: unknown, label: string, minLength: number, maxLength: number) => string;
  normalizedEmail: (value: unknown) => string;
  derivePassword: (password: string, salt: Buffer) => Promise<Buffer>;
  validDate: (value: unknown, label: string, nullable?: boolean) => string | null;
  assignRepairMechanic: (jobId: string, workshopId: string, mechanicUserId: string | null, auth: MechanicAuth, assignedAt: string) => Promise<void>;
  changeRepairStatus: (job: JobLike, status: string, note: string | null, auth: MechanicAuth, at: string) => Promise<void>;
  insertRepairActivity: (input: ActivityInput) => Promise<Record<string, unknown>>;
  issueRepairPart: (job: JobLike, body: Record<string, unknown>, auth: MechanicAuth) => Promise<Record<string, unknown>[]>;
  repairJob: (id: string, workshopId: string, technician?: MechanicAuth) => Promise<JobLike | undefined>;
  repairSelect: string;
  isRepairStatus: (value: unknown) => value is string;
  statusTransitions: Record<string, readonly string[]>;
  technicianStatuses: ReadonlySet<string>;
}

const SPECIALIZATIONS = [
  'Engine Repair',
  'Transmission Repair',
  'Electrical Systems',
  'Brake Systems',
  'Suspension and Steering',
  'Air Conditioning',
  'General Vehicle Maintenance',
  'Diagnostics',
  'Other',
] as const;

const EMPLOYMENT_STATUSES = ['Active', 'Inactive'] as const;
const AVAILABILITY_STATUSES = ['Available', 'Busy', 'Off Duty', 'On Leave'] as const;
const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'] as const;
const TERMINAL_JOB_STATUSES = ['Ready for Collection', 'Collected', 'Completed'];

const SPECIALIZATION_MATCH: Record<string, readonly string[]> = {
  'Engine Repair': ['Engine Repair'],
  'Transmission Repair': ['Transmission Repair'],
  'Electrical Systems': ['Electrical Repair'],
  'Brake Systems': ['Brake System Repair'],
  'Suspension and Steering': ['Suspension Repair'],
  'Air Conditioning': ['General Servicing', 'Other'],
  'General Vehicle Maintenance': ['General Servicing'],
  Diagnostics: ['General Servicing', 'Electrical Repair', 'Other'],
  Other: [],
};

// Effective availability is derived from real assignment records so it cannot drift
// away from the mechanic's actual workload. The stored column is the managed override.
const ACTIVE_JOB_COUNT_SQL = `(SELECT COUNT(*) FROM jobs active_job
  WHERE active_job.workshop_id = m.workshop_id
    AND active_job.assigned_technician = m.user_id
    AND COALESCE(active_job.repair_status, active_job.status) NOT IN ('Ready for Collection', 'Collected', 'Completed'))`;

const MECHANIC_SELECT = `
  SELECT m.*, u.role AS user_role,
    CASE
      WHEN m.employment_status != 'Active' THEN 'Inactive'
      WHEN m.availability_status IN ('Off Duty', 'On Leave') THEN m.availability_status
      WHEN ${ACTIVE_JOB_COUNT_SQL} > 0 THEN 'Busy'
      ELSE m.availability_status
    END AS effective_availability,
    ${ACTIVE_JOB_COUNT_SQL} AS active_job_count,
    (SELECT COUNT(*) FROM repair_mechanic_assignments assignment_row
      WHERE assignment_row.workshop_id = m.workshop_id
        AND assignment_row.mechanic_user_id = m.user_id) AS total_assigned_jobs,
    (SELECT COUNT(*) FROM repair_completions completion_row
      WHERE completion_row.workshop_id = m.workshop_id
        AND completion_row.mechanic_user_id = m.user_id
        AND completion_row.verification_status = 'verified') AS completed_jobs
  FROM mechanics m
  JOIN users u ON u.id = m.user_id AND u.workshop_id = m.workshop_id
`;

type MechanicRow = Record<string, unknown> & {
  id: string;
  workshop_id: string;
  user_id: string;
  mechanic_number: string;
  full_name: string;
  email: string;
  phone: string;
  specialization: string;
  employment_status: string;
  availability_status: string;
  effective_availability: string;
  active_job_count: number;
  user_role: string;
};

export function registerMechanicRoutes(deps: MechanicDeps): void {
  const { app, db, requireAuth, asyncRoute } = deps;
  function fail(status: number, message: string): never {
    throw new deps.HttpError(status, message);
  }

  const optionalText = (value: unknown, label: string, maxLength: number): string | null => {
    if (value === undefined || value === null || value === '') return null;
    return deps.requiredText(value, label, 1, maxLength);
  };

  const enumValue = <T extends readonly string[]>(value: unknown, values: T, label: string, fallback?: T[number]): T[number] => {
    if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
    if (typeof value !== 'string' || !values.includes(value as T[number])) {
      fail(400, `${label} has an unsupported value.`);
    }
    return value as T[number];
  };

  const intValue = (value: unknown, label: string, min: number, max: number, fallback?: number): number => {
    if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      fail(400, `${label} must be a whole number between ${min} and ${max}.`);
    }
    return value;
  };

  const boolValue = (value: unknown, label: string, fallback = false): boolean => {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') fail(400, `${label} must be true or false.`);
    return value;
  };

  const imageValue = (value: unknown): string | null => {
    const image = optionalText(value, 'Profile photograph', 500);
    if (image && !/^(https?:\/\/|\/)/i.test(image)) {
      fail(400, 'Profile photograph must be an http(s) URL or a path beginning with /.');
    }
    return image;
  };

  const requireAdmin = (auth: MechanicAuth): void => {
    if (auth.role !== 'owner' && auth.role !== 'manager') fail(403, 'role_forbidden');
  };

  const requireStaff = (auth: MechanicAuth): void => {
    if (auth.role !== 'owner' && auth.role !== 'manager' && auth.role !== 'advisor') fail(403, 'role_forbidden');
  };

  const requireTechnician = (auth: MechanicAuth): void => {
    if (auth.role !== 'technician') fail(403, 'role_forbidden');
  };

  const getMechanic = async (id: string, workshopId: string): Promise<MechanicRow | undefined> =>
    await db.first(`${MECHANIC_SELECT} WHERE m.id = ? AND m.workshop_id = ?`, id, workshopId) as MechanicRow | undefined;

  const getMechanicByUserId = async (userId: string, workshopId: string): Promise<MechanicRow | undefined> =>
    await db.first(`${MECHANIC_SELECT} WHERE m.user_id = ? AND m.workshop_id = ?`, userId, workshopId) as MechanicRow | undefined;

  const revokeUserSessions = async (userId: string, workshopId: string): Promise<void> => {
    const now = new Date().toISOString();
    await db.execute('UPDATE jwt_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ? AND workshop_id = ? AND revoked_at IS NULL', now, userId, workshopId);
    await db.execute(`UPDATE jwt_tokens SET revoked_at = COALESCE(revoked_at, ?)
      WHERE session_id IN (SELECT id FROM jwt_sessions WHERE user_id = ? AND workshop_id = ?)
        AND revoked_at IS NULL`, now, userId, workshopId);
  };

  const nextMechanicNumber = async (workshopId: string): Promise<string> => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = `MECH-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const existing = await db.first('SELECT 1 FROM mechanics WHERE workshop_id = ? AND mechanic_number = ?', workshopId, candidate);
      if (!existing) return candidate;
    }
    fail(500, 'Could not generate a unique mechanic number. Try again.');
  };

  const parsePagination = (request: Request, defaultLimit = 25, maxLimit = 100) => {
    const limit = request.query.limit === undefined ? defaultLimit : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit || !Number.isInteger(offset) || offset < 0) {
      fail(400, `Pagination requires a limit from 1 to ${maxLimit} and a non-negative offset.`);
    }
    return { limit, offset };
  };

  const queryText = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > 200) fail(400, 'Search terms must be text of at most 200 characters.');
    return value.trim();
  };

  const completionDurationDays = (createdAt: unknown, finishedAt: unknown): number | null => {
    if (typeof createdAt !== 'string' || typeof finishedAt !== 'string') return null;
    const start = Date.parse(createdAt);
    const end = Date.parse(finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.round(((end - start) / 86_400_000) * 100) / 100;
  };

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  app.get('/api/mechanics/dashboard', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const mechanics = await db.query(`${MECHANIC_SELECT} WHERE m.workshop_id = ? ORDER BY m.full_name`, auth.workshop_id) as MechanicRow[];
    const jobCounts = await db.first(`
      SELECT
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN assigned_technician IS NOT NULL THEN 1 ELSE 0 END) AS assigned_jobs,
        SUM(CASE WHEN COALESCE(repair_status, status) IN ('In Progress', 'Awaiting Spare Parts') THEN 1 ELSE 0 END) AS in_progress_jobs,
        SUM(CASE WHEN COALESCE(repair_status, status) IN ('Received', 'Awaiting Inspection', 'Under Inspection', 'Awaiting Customer Approval', 'Approved') THEN 1 ELSE 0 END) AS pending_jobs
      FROM jobs WHERE workshop_id = ?
    `, auth.workshop_id) as Record<string, number>;
    const completionCounts = await db.first(`
      SELECT
        COUNT(*) AS total_submissions,
        SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_completions,
        SUM(CASE WHEN verification_status = 'pending' THEN 1 ELSE 0 END) AS pending_verifications
      FROM repair_completions WHERE workshop_id = ?
    `, auth.workshop_id) as Record<string, number>;
    const recentActivities = await db.query(`
      SELECT activity.id, activity.activity_type, activity.work_status, activity.work_performed,
        activity.inspection_findings, activity.problems_identified, activity.created_at,
        activity.created_by_name AS mechanic_name, j.job_no AS repair_job_code,
        v.plate AS registration_number, m.mechanic_number
      FROM repair_activity_logs activity
      JOIN jobs j ON j.id = activity.job_id AND j.workshop_id = activity.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      LEFT JOIN mechanics m ON m.user_id = activity.created_by_user_id AND m.workshop_id = activity.workshop_id
      WHERE activity.workshop_id = ?
      ORDER BY activity.created_at DESC LIMIT 8
    `, auth.workshop_id);
    response.json({
      summary: {
        total_mechanics: mechanics.length,
        active_mechanics: mechanics.filter((mechanic) => mechanic.employment_status === 'Active').length,
        available_mechanics: mechanics.filter((mechanic) => mechanic.effective_availability === 'Available').length,
        busy_mechanics: mechanics.filter((mechanic) => mechanic.effective_availability === 'Busy').length,
        off_duty_mechanics: mechanics.filter((mechanic) => mechanic.effective_availability === 'Off Duty').length,
        on_leave_mechanics: mechanics.filter((mechanic) => mechanic.effective_availability === 'On Leave').length,
        total_assigned_jobs: Number(jobCounts.assigned_jobs ?? 0),
        total_jobs: Number(jobCounts.total_jobs ?? 0),
        in_progress_jobs: Number(jobCounts.in_progress_jobs ?? 0),
        pending_jobs: Number(jobCounts.pending_jobs ?? 0),
        completed_jobs: Number(completionCounts.verified_completions ?? 0),
        pending_verifications: Number(completionCounts.pending_verifications ?? 0),
      },
      workload: mechanics.map((mechanic) => ({
        id: mechanic.id,
        mechanic_number: mechanic.mechanic_number,
        full_name: mechanic.full_name,
        specialization: mechanic.specialization,
        availability_status: mechanic.effective_availability,
        active_jobs: Number(mechanic.active_job_count ?? 0),
        total_assigned_jobs: Number(mechanic.total_assigned_jobs ?? 0),
        completed_jobs: Number(mechanic.completed_jobs ?? 0),
      })),
      recent_activities: recentActivities,
      recent_mechanics: mechanics.slice().sort((left, right) =>
        String(right.created_at).localeCompare(String(left.created_at))).slice(0, 5),
    });
  }));

  // ---------------------------------------------------------------------------
  // Mechanic directory
  // ---------------------------------------------------------------------------

  app.get('/api/mechanics', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const { limit, offset } = parsePagination(request);
    const q = queryText(request.query.q);
    const employment = queryText(request.query.employment_status);
    const availability = queryText(request.query.availability_status);
    const specialization = queryText(request.query.specialization);
    if (employment && !(EMPLOYMENT_STATUSES as readonly string[]).includes(employment)) fail(400, 'Employment status filter is invalid.');
    if (availability && !(AVAILABILITY_STATUSES as readonly string[]).includes(availability)) fail(400, 'Availability filter is invalid.');
    if (specialization && !(SPECIALIZATIONS as readonly string[]).includes(specialization)) fail(400, 'Specialization filter is invalid.');

    const conditions = ['x.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (q) {
      const like = `%${q}%`;
      conditions.push(`(x.full_name LIKE ? OR x.mechanic_number LIKE ? OR x.email LIKE ?
        OR x.phone LIKE ? OR x.specialization LIKE ?)`);
      bindings.push(like, like, like, like, like);
    }
    if (employment) { conditions.push('x.employment_status = ?'); bindings.push(employment); }
    if (availability) { conditions.push('x.effective_availability = ?'); bindings.push(availability); }
    if (specialization) { conditions.push('x.specialization = ?'); bindings.push(specialization); }

    const sortMap: Record<string, string> = {
      full_name: 'x.full_name',
      mechanic_number: 'x.mechanic_number',
      specialization: 'x.specialization',
      experience_years: 'x.experience_years',
      created_at: 'x.created_at',
      availability_status: 'x.effective_availability',
      active_jobs: 'x.active_job_count',
    };
    const sortKey = typeof request.query.sort === 'string' && request.query.sort ? request.query.sort : 'full_name';
    if (!Object.hasOwn(sortMap, sortKey)) fail(400, 'Sort option is invalid.');
    const order = typeof request.query.order === 'string' ? request.query.order.toLowerCase() : 'asc';
    if (!['asc', 'desc'].includes(order)) fail(400, 'Sort order must be asc or desc.');
    const where = conditions.join(' AND ');
    const total = (await db.first(`SELECT COUNT(*) AS total FROM (${MECHANIC_SELECT} WHERE m.workshop_id = ?) x WHERE ${where}`, auth.workshop_id, ...bindings) as { total: number }).total;
    const records = await db.query(`SELECT * FROM (${MECHANIC_SELECT} WHERE m.workshop_id = ?) x WHERE ${where}
      ORDER BY ${sortMap[sortKey]} ${order.toUpperCase()}, x.full_name ASC LIMIT ? OFFSET ?`,
      auth.workshop_id, ...bindings, limit, offset);
    response.json({ records, total, limit, offset });
  }));

  app.get('/api/mechanics/recommendations', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const jobId = queryText(request.query.job_id);
    if (!jobId) fail(400, 'Select a repair job to find suggested mechanics.');
    const job = await deps.repairJob(jobId, auth.workshop_id);
    if (!job) fail(404, 'Repair job not found.');
    const mechanics = await db.query(`${MECHANIC_SELECT}
      WHERE m.workshop_id = ? AND m.employment_status = 'Active' AND u.role = 'technician'`, auth.workshop_id) as MechanicRow[];
    const recommendations = mechanics.map((mechanic) => {
      const reasons: string[] = [];
      let score = 0;
      if ((SPECIALIZATION_MATCH[mechanic.specialization] ?? []).includes(job.service_type)) {
        score += 50;
        reasons.push(`Specialization matches ${job.service_type}`);
      }
      if (mechanic.effective_availability === 'Available') {
        score += 30;
        reasons.push('Currently available');
      } else if (mechanic.effective_availability === 'Busy') {
        score += 10;
        reasons.push(`Busy with ${mechanic.active_job_count} active job(s)`);
      } else {
        score -= 100;
        reasons.push(`${mechanic.effective_availability} - assignment requires an override`);
      }
      score += Math.max(0, 20 - Number(mechanic.active_job_count ?? 0) * 5);
      return {
        mechanic_id: mechanic.id,
        mechanic_number: mechanic.mechanic_number,
        full_name: mechanic.full_name,
        specialization: mechanic.specialization,
        user_id: mechanic.user_id,
        availability_status: mechanic.effective_availability,
        active_job_count: Number(mechanic.active_job_count ?? 0),
        experience_years: mechanic.experience_years,
        score,
        reasons,
        can_assign_without_override: mechanic.effective_availability !== 'Off Duty' && mechanic.effective_availability !== 'On Leave',
      };
    }).sort((left, right) => right.score - left.score || left.active_job_count - right.active_job_count);
    response.json({ job_id: job.id, service_type: job.service_type, recommendations });
  }));

  app.get('/api/mechanics/:id', requireAuth, asyncRoute(async (request, response, next) => {
    const reserved = ['dashboard', 'recommendations', 'assignments', 'assignable-jobs', 'jobs', 'me', 'completions', 'reports'];
    if (reserved.includes(request.params.id)) {
      next();
      return;
    }
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const mechanic = await getMechanic(request.params.id, auth.workshop_id);
    if (!mechanic) fail(404, 'Mechanic not found.');
    const assignedJobs = await db.query(`
      ${deps.repairSelect}
      WHERE j.workshop_id = ? AND j.assigned_technician = ?
      ORDER BY j.created_at DESC
    `, auth.workshop_id, mechanic.user_id);
    const activeJobs = assignedJobs.filter((job) => !TERMINAL_JOB_STATUSES.includes(String((job as JobLike).repair_status)));
    const assignedVehicles = assignedJobs.map((job) => {
      const row = job as JobLike;
      return {
        job_id: row.id,
        job_no: row.job_no,
        registration_number: row.registration_number,
        make: row.make,
        model: row.model,
        customer_name: row.customer_name,
        repair_status: row.repair_status,
        created_at: row.created_at,
      };
    });
    const workLogs = await db.query(`
      SELECT activity.id, activity.activity_type, activity.work_status, activity.work_performed,
        activity.problems_identified, activity.inspection_findings, activity.created_at,
        j.job_no AS repair_job_code
      FROM repair_activity_logs activity
      JOIN jobs j ON j.id = activity.job_id AND j.workshop_id = activity.workshop_id
      WHERE activity.workshop_id = ? AND activity.created_by_user_id = ?
      ORDER BY activity.created_at DESC LIMIT 20
    `, auth.workshop_id, mechanic.user_id);
    const durations = await db.query(`
      SELECT j.created_at, rc.verified_at FROM repair_completions rc
      JOIN jobs j ON j.id = rc.job_id AND j.workshop_id = rc.workshop_id
      WHERE rc.workshop_id = ? AND rc.mechanic_user_id = ? AND rc.verification_status = 'verified'
    `, auth.workshop_id, mechanic.user_id);
    const completedDurations = durations
      .map((row) => completionDurationDays((row as Record<string, unknown>).created_at, (row as Record<string, unknown>).verified_at))
      .filter((value): value is number => value !== null);
    const averageCompletionDays = completedDurations.length
      ? Math.round((completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length) * 100) / 100
      : null;
    response.json({
      record: mechanic,
      assigned_vehicles: assignedVehicles,
      active_jobs: activeJobs,
      completed_jobs: assignedJobs.filter((job) => TERMINAL_JOB_STATUSES.includes(String((job as JobLike).repair_status))),
      repair_history: assignedJobs,
      work_logs: workLogs,
      performance: {
        total_jobs_assigned: Number(mechanic.total_assigned_jobs ?? 0),
        verified_completions: Number(mechanic.completed_jobs ?? 0),
        active_jobs: activeJobs.length,
        in_progress_jobs: activeJobs.filter((job) => (job as JobLike).repair_status === 'In Progress').length,
        pending_jobs: activeJobs.filter((job) => ['Received', 'Awaiting Inspection', 'Under Inspection', 'Awaiting Customer Approval', 'Approved'].includes(String((job as JobLike).repair_status))).length,
        average_completion_days: averageCompletionDays,
      },
    });
  }));

  app.post('/api/mechanics', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireAdmin(auth);
    const body = deps.requireObject(request.body);
    const fullName = deps.requiredText(body.full_name, 'Full name', 2, 120);
    const email = deps.normalizedEmail(body.email);
    const phone = deps.requiredText(body.phone, 'Phone number', 5, 40);
    const linkUserId = optionalText(body.user_id, 'Existing technician account', 36);
    const password = linkUserId ? '' : deps.requiredText(body.password, 'Initial password', 8, 128);
    const address = optionalText(body.address, 'Address', 500);
    const gender = body.gender === undefined || body.gender === null || body.gender === ''
      ? null
      : enumValue(body.gender, GENDERS, 'Gender');
    const specialization = enumValue(body.specialization, SPECIALIZATIONS, 'Specialization');
    const experienceYears = intValue(body.experience_years, 'Years of experience', 0, 60, 0);
    const qualifications = optionalText(body.qualifications, 'Qualifications', 2000);
    const employmentDate = deps.validDate(body.employment_date, 'Employment date');
    if (!employmentDate) fail(400, 'Employment date is required.');
    const employmentStatus = enumValue(body.employment_status, EMPLOYMENT_STATUSES, 'Employment status', 'Active');
    const availabilityStatus = enumValue(body.availability_status, AVAILABILITY_STATUSES, 'Availability status', 'Available');
    const profileImage = imageValue(body.profile_image);
    if (Object.keys(body).some((field) => ![
      'full_name', 'email', 'phone', 'password', 'address', 'gender', 'specialization',
      'experience_years', 'qualifications', 'employment_date', 'employment_status',
      'availability_status', 'profile_image', 'user_id',
    ].includes(field))) fail(400, 'The request contains unsupported mechanic fields.');

    const created = await db.transaction(async () => {
      let userId = linkUserId;
      if (userId) {
        const existingUser = await db.first(`SELECT id, role FROM users WHERE id = ? AND workshop_id = ?`, userId, auth.workshop_id) as { id: string; role: string } | undefined;
        if (!existingUser || existingUser.role !== 'technician') fail(400, 'Select an existing technician account in this workshop.');
        if (await db.first('SELECT 1 FROM mechanics WHERE workshop_id = ? AND user_id = ?', auth.workshop_id, userId)) {
          fail(409, 'That technician account already has a mechanic profile.');
        }
      } else {
        const emailOwner = await db.first('SELECT id FROM users WHERE email = ?', email);
        if (emailOwner) fail(409, 'An account with that email already exists.');
        userId = randomUUID();
        const salt = randomBytes(16);
        const passwordHash = await deps.derivePassword(password, salt);
        await db.execute(`
          INSERT INTO users (id, workshop_id, name, email, password_hash, password_salt, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'technician', ?)
        `, userId, auth.workshop_id, fullName, email, passwordHash.toString('hex'), salt.toString('hex'), new Date().toISOString());
      }
      const duplicateProfile = await db.first('SELECT id FROM mechanics WHERE workshop_id = ? AND email = ?', auth.workshop_id, email);
      if (duplicateProfile) fail(409, 'A mechanic with that email address already exists.');
      const mechanicNumber = await nextMechanicNumber(auth.workshop_id);
      const now = new Date().toISOString();
      const mechanicId = randomUUID();
      await db.execute(`
        INSERT INTO mechanics (
          id, workshop_id, user_id, mechanic_number, full_name, email, phone, address,
          gender, specialization, experience_years, qualifications, employment_date,
          employment_status, availability_status, profile_image, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, mechanicId, auth.workshop_id, userId, mechanicNumber, fullName, email, phone, address,
        gender, specialization, experienceYears, qualifications, employmentDate,
        employmentStatus, employmentStatus === 'Active' ? availabilityStatus : 'Off Duty',
        profileImage, now, now);
      return await getMechanic(mechanicId, auth.workshop_id);
    });
    response.status(201).json({ record: created });
  }));

  app.put('/api/mechanics/:id', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireAdmin(auth);
    const existing = await getMechanic(request.params.id, auth.workshop_id);
    if (!existing) fail(404, 'Mechanic not found.');
    const body = deps.requireObject(request.body);
    const allowed = [
      'full_name', 'email', 'phone', 'address', 'gender', 'specialization',
      'experience_years', 'qualifications', 'employment_date', 'profile_image',
    ];
    if (Object.keys(body).length === 0 || Object.keys(body).some((field) => !allowed.includes(field))) {
      fail(400, 'Provide permitted mechanic details to update.');
    }
    const updates: Record<string, string | number | null> = {};
    if (body.full_name !== undefined) updates.full_name = deps.requiredText(body.full_name, 'Full name', 2, 120);
    if (body.email !== undefined) updates.email = deps.normalizedEmail(body.email);
    if (body.phone !== undefined) updates.phone = deps.requiredText(body.phone, 'Phone number', 5, 40);
    if (body.address !== undefined) updates.address = optionalText(body.address, 'Address', 500);
    if (body.gender !== undefined) updates.gender = body.gender === null || body.gender === '' ? null : enumValue(body.gender, GENDERS, 'Gender');
    if (body.specialization !== undefined) updates.specialization = enumValue(body.specialization, SPECIALIZATIONS, 'Specialization');
    if (body.experience_years !== undefined) updates.experience_years = intValue(body.experience_years, 'Years of experience', 0, 60);
    if (body.qualifications !== undefined) updates.qualifications = optionalText(body.qualifications, 'Qualifications', 2000);
    if (body.employment_date !== undefined) {
      const date = deps.validDate(body.employment_date, 'Employment date');
      if (!date) fail(400, 'Employment date is required.');
      updates.employment_date = date;
    }
    if (body.profile_image !== undefined) updates.profile_image = imageValue(body.profile_image);

    await db.transaction(async () => {
      if (typeof updates.email === 'string') {
        const conflict = await db.first('SELECT id FROM mechanics WHERE workshop_id = ? AND email = ? AND id != ?', auth.workshop_id, updates.email, existing.id);
        if (conflict) fail(409, 'Another mechanic already uses that email address.');
        const accountConflict = await db.first('SELECT id FROM users WHERE email = ? AND id != ?', updates.email, existing.user_id);
        if (accountConflict) fail(409, 'Another account already uses that email address.');
        await db.execute('UPDATE users SET email = ? WHERE id = ? AND workshop_id = ?', updates.email, existing.user_id, auth.workshop_id);
      }
      if (typeof updates.full_name === 'string') {
        await db.execute('UPDATE users SET name = ? WHERE id = ? AND workshop_id = ?', updates.full_name, existing.user_id, auth.workshop_id);
      }
      const columns = Object.keys(updates);
      const assignments = columns.map((column) => `${column} = ?`);
      const values = columns.map((column) => updates[column]);
      await db.execute(`UPDATE mechanics SET ${assignments.join(', ')}, updated_at = ? WHERE id = ? AND workshop_id = ?`,
        ...values, new Date().toISOString(), existing.id, auth.workshop_id);
    });
    response.json({ record: await getMechanic(existing.id, auth.workshop_id) });
  }));

  app.patch('/api/mechanics/:id/status', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireAdmin(auth);
    const mechanic = await getMechanic(request.params.id, auth.workshop_id);
    if (!mechanic) fail(404, 'Mechanic not found.');
    const body = deps.requireObject(request.body);
    const nextStatus = enumValue(body.employment_status, EMPLOYMENT_STATUSES, 'Employment status');
    await db.transaction(async () => {
      await db.execute(`UPDATE mechanics SET employment_status = ?, availability_status = ?, updated_at = ?
        WHERE id = ? AND workshop_id = ?`,
      nextStatus, nextStatus === 'Active' ? 'Available' : 'Off Duty',
      new Date().toISOString(), mechanic.id, auth.workshop_id);
      if (nextStatus !== 'Active') await revokeUserSessions(String(mechanic.user_id), auth.workshop_id);
    });
    response.json({ record: await getMechanic(mechanic.id, auth.workshop_id) });
  }));

  app.patch('/api/mechanics/:id/availability', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const mechanic = await getMechanic(request.params.id, auth.workshop_id);
    if (!mechanic) fail(404, 'Mechanic not found.');
    if (mechanic.employment_status !== 'Active') fail(409, 'A deactivated mechanic cannot change availability.');
    const body = deps.requireObject(request.body);
    const availability = enumValue(body.availability_status, AVAILABILITY_STATUSES, 'Availability status');
    await db.execute('UPDATE mechanics SET availability_status = ?, updated_at = ? WHERE id = ? AND workshop_id = ?',
      availability, new Date().toISOString(), mechanic.id, auth.workshop_id);
    response.json({ record: await getMechanic(mechanic.id, auth.workshop_id) });
  }));

  app.post('/api/mechanics/:id/password', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireAdmin(auth);
    const mechanic = await getMechanic(request.params.id, auth.workshop_id);
    if (!mechanic) fail(404, 'Mechanic not found.');
    const body = deps.requireObject(request.body);
    const password = deps.requiredText(body.new_password, 'New password', 8, 128);
    const salt = randomBytes(16);
    const passwordHash = await deps.derivePassword(password, salt);
    await db.transaction(async () => {
      await db.execute('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ? AND workshop_id = ?',
        passwordHash.toString('hex'), salt.toString('hex'), mechanic.user_id, auth.workshop_id);
      await revokeUserSessions(String(mechanic.user_id), auth.workshop_id);
    });
    response.json({ message: 'Mechanic password updated. The mechanic must sign in again.' });
  }));

  app.get('/api/mechanics/:id/assignments', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const mechanic = await getMechanic(request.params.id, auth.workshop_id);
    if (!mechanic) fail(404, 'Mechanic not found.');
    const records = await db.query(`
      SELECT a.id, a.assigned_at, a.unassigned_at, a.assignment_status, a.notes,
        a.assigned_by_name, j.id AS job_id, j.job_no AS repair_job_code,
        COALESCE(j.repair_status, j.status) AS repair_status, j.service_type, j.repair_priority,
        v.plate AS registration_number, v.make, v.model, c.display_name AS customer_name
      FROM repair_mechanic_assignments a
      JOIN jobs j ON j.id = a.job_id AND j.workshop_id = a.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      WHERE a.workshop_id = ? AND a.mechanic_user_id = ?
      ORDER BY a.assigned_at DESC
    `, auth.workshop_id, mechanic.user_id);
    response.json({ records, total: records.length });
  }));

  app.get('/api/mechanics/:id/worklogs', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const mechanic = await getMechanic(request.params.id, auth.workshop_id);
    if (!mechanic) fail(404, 'Mechanic not found.');
    const records = await db.query(`
      SELECT activity.*, j.job_no AS repair_job_code, v.plate AS registration_number
      FROM repair_activity_logs activity
      JOIN jobs j ON j.id = activity.job_id AND j.workshop_id = activity.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      WHERE activity.workshop_id = ? AND activity.created_by_user_id = ?
      ORDER BY activity.created_at DESC LIMIT 200
    `, auth.workshop_id, mechanic.user_id);
    response.json({ records, total: records.length });
  }));

  // ---------------------------------------------------------------------------
  // Assignment management
  // ---------------------------------------------------------------------------

  app.get('/api/mechanics/assignable-jobs', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const q = queryText(request.query.q);
    const status = queryText(request.query.status);
    const conditions = ['j.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (q) {
      const like = `%${q}%`;
      conditions.push(`(j.job_no LIKE ? OR j.tracking_number LIKE ? OR v.plate LIKE ?
        OR v.make LIKE ? OR v.model LIKE ? OR c.display_name LIKE ? OR j.service_type LIKE ?)`);
      bindings.push(like, like, like, like, like, like, like);
    }
    if (status && deps.isRepairStatus(status)) {
      conditions.push('COALESCE(j.repair_status, j.status) = ?');
      bindings.push(status);
    }
    const records = await db.query(`
      SELECT j.id, j.job_no AS repair_job_code, j.tracking_number, j.service_type,
        j.issue_description AS reported_problem, j.repair_priority,
        COALESCE(j.repair_status, j.status) AS repair_status, j.created_at, j.promised_at,
        j.assigned_technician, v.plate AS registration_number, v.make, v.model,
        c.display_name AS customer_name, c.phone AS customer_phone,
        u.name AS current_mechanic_name, m.mechanic_number AS current_mechanic_number
      FROM jobs j
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      LEFT JOIN users u ON u.id = j.assigned_technician AND u.workshop_id = j.workshop_id
      LEFT JOIN mechanics m ON m.user_id = u.id AND m.workshop_id = j.workshop_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY FIELD(COALESCE(j.repair_priority, j.priority), 'Urgent', 'High', 'Normal', 'Low'), j.created_at DESC
      LIMIT 100
    `, ...bindings);
    response.json({ records, total: records.length });
  }));

  app.get('/api/mechanics/assignments', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const { limit, offset } = parsePagination(request);
    const jobId = queryText(request.query.job_id);
    const mechanicId = queryText(request.query.mechanic_id);
    const status = queryText(request.query.assignment_status);
    const conditions = ['a.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (jobId) { conditions.push('a.job_id = ?'); bindings.push(jobId); }
    if (mechanicId) { conditions.push('(a.mechanic_user_id = ? OR m.id = ?)'); bindings.push(mechanicId, mechanicId); }
    if (status && ['active', 'cancelled'].includes(status)) { conditions.push('a.assignment_status = ?'); bindings.push(status); }
    const where = conditions.join(' AND ');
    const total = (await db.first(`SELECT COUNT(*) AS total FROM repair_mechanic_assignments a
      LEFT JOIN mechanics m ON m.user_id = a.mechanic_user_id AND m.workshop_id = a.workshop_id
      WHERE ${where}`, ...bindings) as { total: number }).total;
    const records = await db.query(`
      SELECT a.id, a.mechanic_user_id, a.mechanic_name, a.assigned_by_name, a.assigned_at,
        a.unassigned_at, a.assignment_status, a.notes,
        m.id AS mechanic_id, m.mechanic_number, m.specialization,
        j.id AS job_id, j.job_no AS repair_job_code,
        COALESCE(j.repair_status, j.status) AS repair_status, j.repair_priority,
        v.plate AS registration_number, c.display_name AS customer_name
      FROM repair_mechanic_assignments a
      LEFT JOIN mechanics m ON m.user_id = a.mechanic_user_id AND m.workshop_id = a.workshop_id
      JOIN jobs j ON j.id = a.job_id AND j.workshop_id = a.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      WHERE ${where} ORDER BY a.assigned_at DESC LIMIT ? OFFSET ?
    `, ...bindings, limit, offset);
    response.json({ records, total, limit, offset });
  }));

  app.get('/api/mechanics/jobs/:id/assignments', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const job = await deps.repairJob(request.params.id, auth.workshop_id);
    if (!job) fail(404, 'Repair job not found.');
    const records = await db.query(`
      SELECT a.*, m.id AS mechanic_id, m.mechanic_number, m.specialization
      FROM repair_mechanic_assignments a
      LEFT JOIN mechanics m ON m.user_id = a.mechanic_user_id AND m.workshop_id = a.workshop_id
      WHERE a.workshop_id = ? AND a.job_id = ? ORDER BY a.assigned_at ASC
    `, auth.workshop_id, job.id);
    response.json({ records, total: records.length });
  }));

  app.post('/api/mechanics/assignments', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const body = deps.requireObject(request.body);
    if (Object.keys(body).some((field) => !['job_id', 'mechanic_id', 'note', 'override_availability'].includes(field))) {
      fail(400, 'The assignment contains unsupported fields.');
    }
    const jobId = deps.requiredText(body.job_id, 'Repair job', 1, 36);
    const mechanicId = deps.requiredText(body.mechanic_id, 'Mechanic', 1, 36);
    const note = optionalText(body.note, 'Assignment note', 1000);
    const override = boolValue(body.override_availability, 'Override availability');
    const job = await deps.repairJob(jobId, auth.workshop_id);
    if (!job) fail(404, 'Repair job not found.');
    const mechanic = await getMechanic(mechanicId, auth.workshop_id);
    if (!mechanic) fail(404, 'Mechanic not found.');
    if (mechanic.employment_status !== 'Active' || mechanic.user_role !== 'technician') {
      fail(409, 'A deactivated mechanic or a non-technician account cannot receive assignments.');
    }
    if (!override && ['Off Duty', 'On Leave'].includes(mechanic.effective_availability)) {
      fail(409, `${mechanic.full_name} is ${mechanic.effective_availability}. Enable the availability override to assign this job.`);
    }
    const current = await db.first(`SELECT id FROM repair_mechanic_assignments
      WHERE workshop_id = ? AND job_id = ? AND mechanic_user_id = ? AND unassigned_at IS NULL`,
    auth.workshop_id, job.id, mechanic.user_id);
    if (current) fail(409, 'This mechanic is already assigned to that repair job.');

    const assignedAt = new Date().toISOString();
    await db.transaction(async () => {
      await deps.assignRepairMechanic(job.id, auth.workshop_id, String(mechanic.user_id), auth, assignedAt);
      await db.execute(`UPDATE repair_mechanic_assignments
        SET assignment_status = 'active', notes = ?
        WHERE workshop_id = ? AND job_id = ? AND mechanic_user_id = ? AND unassigned_at IS NULL`,
      note, auth.workshop_id, job.id, mechanic.user_id);
    });
    response.status(201).json({
      record: await deps.repairJob(job.id, auth.workshop_id),
      mechanic: await getMechanic(mechanic.id, auth.workshop_id),
      warning: mechanic.effective_availability === 'Busy'
        ? 'This mechanic already has active work. Review the workload shown before assigning.'
        : null,
    });
  }));

  app.delete('/api/mechanics/assignments/:id', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const assignment = await db.first(`SELECT * FROM repair_mechanic_assignments
      WHERE id = ? AND workshop_id = ? AND unassigned_at IS NULL`, request.params.id, auth.workshop_id) as Record<string, unknown> | undefined;
    if (!assignment) fail(404, 'Active assignment not found.');
    const now = new Date().toISOString();
    await db.transaction(async () => {
      await db.execute(`UPDATE repair_mechanic_assignments
        SET unassigned_at = ?, assignment_status = 'cancelled' WHERE id = ? AND workshop_id = ?`,
      now, String(assignment.id), auth.workshop_id);
      await db.execute(`UPDATE jobs SET assigned_technician = NULL, updated_at = ?
        WHERE id = ? AND workshop_id = ? AND assigned_technician = ?`,
      now, String(assignment.job_id), auth.workshop_id, String(assignment.mechanic_user_id));
    });
    response.json({ message: 'Assignment removed. The assignment history has been preserved.' });
  }));

  // ---------------------------------------------------------------------------
  // Mechanic workspace (technician role, own jobs only)
  // ---------------------------------------------------------------------------

  const myJobs = async (auth: MechanicAuth): Promise<JobLike[]> => await db.query(`
    ${deps.repairSelect}
    WHERE j.workshop_id = ? AND j.assigned_technician IN (?, ?)
    ORDER BY j.created_at DESC
  `, auth.workshop_id, auth.name, auth.id) as JobLike[];

  const myJob = async (id: string, auth: MechanicAuth): Promise<JobLike> => {
    const job = await deps.repairJob(id, auth.workshop_id, auth);
    if (!job) fail(404, 'Repair job not found or not assigned to you.');
    return job;
  };

  app.get('/api/mechanics/me/summary', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const jobs = await myJobs(auth);
    const profile = await getMechanicByUserId(auth.id, auth.workshop_id);
    const recentActivities = await db.query(`
      SELECT activity.id, activity.activity_type, activity.work_status, activity.work_performed,
        activity.problems_identified, activity.created_at, j.job_no AS repair_job_code,
        v.plate AS registration_number
      FROM repair_activity_logs activity
      JOIN jobs j ON j.id = activity.job_id AND j.workshop_id = activity.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      WHERE activity.workshop_id = ? AND activity.created_by_user_id = ?
      ORDER BY activity.created_at DESC LIMIT 8
    `, auth.workshop_id, auth.id);
    response.json({
      profile: profile ?? null,
      summary: {
        total_assigned_jobs: jobs.length,
        pending_jobs: jobs.filter((job) => ['Received', 'Awaiting Inspection', 'Under Inspection', 'Awaiting Customer Approval', 'Approved'].includes(job.repair_status)).length,
        in_progress_jobs: jobs.filter((job) => ['In Progress', 'Awaiting Spare Parts'].includes(job.repair_status)).length,
        completed_jobs: jobs.filter((job) => TERMINAL_JOB_STATUSES.includes(job.repair_status)).length,
        awaiting_verification: jobs.filter((job) => job.repair_status === 'Repair Completed').length,
      },
      assigned_vehicles: jobs.map((job) => ({
        job_id: job.id,
        job_no: job.job_no,
        registration_number: job.registration_number,
        make: job.make,
        model: job.model,
        customer_name: job.customer_name,
        repair_status: job.repair_status,
      })),
      recent_activities: recentActivities,
    });
  }));

  app.get('/api/mechanics/me/jobs', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const jobs = await myJobs(auth);
    const status = queryText(request.query.status);
    const records = status ? jobs.filter((job) => job.repair_status === status) : jobs;
    response.json({ records, total: records.length });
  }));

  app.get('/api/mechanics/me/jobs/:id', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const job = await myJob(request.params.id, auth);
    const history = await db.query(`
      SELECT id, previous_status, new_status, note, changed_by_name, changed_at
      FROM repair_status_history WHERE workshop_id = ? AND job_id = ? ORDER BY changed_at ASC
    `, auth.workshop_id, job.id);
    const activities = await db.query(`
      SELECT id, activity_type, work_status, work_performed, inspection_findings,
        problems_identified, recommendations, additional_work_required, internal_notes,
        created_by_name, created_at
      FROM repair_activity_logs WHERE workshop_id = ? AND job_id = ? ORDER BY created_at DESC
    `, auth.workshop_id, job.id);
    const parts = await db.query(`
      SELECT jp.id, jp.part_id, jp.quantity, jp.unit_price_cents, p.name AS part_name, p.sku AS part_number
      FROM job_parts jp JOIN parts p ON p.id = jp.part_id AND p.workshop_id = jp.workshop_id
      WHERE jp.workshop_id = ? AND jp.job_id = ? ORDER BY p.name
    `, auth.workshop_id, job.id);
    const diagnoses = await db.query(`
      SELECT id, predicted_fault, confirmed_fault, review_status, affected_component,
        mechanic_notes, created_at
      FROM ai_diagnoses WHERE workshop_id = ? AND job_id = ? ORDER BY created_at DESC
    `, auth.workshop_id, job.id);
    const completion = await db.first(`SELECT * FROM repair_completions WHERE workshop_id = ? AND job_id = ?`, auth.workshop_id, job.id);
    response.json({ record: job, history, activities, parts, diagnoses, completion: completion ?? null });
  }));

  app.post('/api/mechanics/me/jobs/:id/start', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const job = await myJob(request.params.id, auth);
    let target: string | null = null;
    if (job.repair_status === 'Awaiting Inspection') target = 'Under Inspection';
    else if (['Approved', 'Awaiting Spare Parts'].includes(job.repair_status)) target = 'In Progress';
    else if (!['Under Inspection', 'In Progress'].includes(job.repair_status)) {
      fail(409, `The repair job must be awaiting inspection or approved before work can start. Current status: ${job.repair_status}.`);
    }
    const now = new Date().toISOString();
    if (target) {
      await db.transaction(async () => {
        await deps.changeRepairStatus(job, target as string, 'Repair work started by mechanic', auth, now);
        await deps.insertRepairActivity({
          workshopId: auth.workshop_id, jobId: job.id, auth, createdAt: now,
          activityType: 'start', workStatus: target as string,
          fields: { work_performed: 'Repair work started', inspection_findings: null, problems_identified: null,
            recommendations: null, additional_work_required: null, internal_notes: null },
        });
      });
    }
    response.json({ record: await deps.repairJob(job.id, auth.workshop_id, auth) });
  }));

  app.post('/api/mechanics/me/jobs/:id/progress', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const job = await myJob(request.params.id, auth);
    const body = deps.requireObject(request.body);
    if (Object.keys(body).some((field) => !['status', 'note'].includes(field))) fail(400, 'Only status and note can be updated here.');
    const nextStatus = body.status;
    if (!deps.isRepairStatus(nextStatus) || !deps.technicianStatuses.has(nextStatus)) {
      fail(400, 'Mechanics cannot set that repair status.');
    }
    const note = optionalText(body.note, 'Progress note', 2000);
    const now = new Date().toISOString();
    await db.transaction(async () => {
      await deps.changeRepairStatus(job, nextStatus as string, note, auth, now);
      if (note) {
        await deps.insertRepairActivity({
          workshopId: auth.workshop_id, jobId: job.id, auth, createdAt: now,
          activityType: 'progress', workStatus: nextStatus as string,
          fields: { work_performed: note, inspection_findings: null, problems_identified: null,
            recommendations: null, additional_work_required: null, internal_notes: null },
        });
      }
    });
    response.json({ record: await deps.repairJob(job.id, auth.workshop_id, auth) });
  }));

  app.post('/api/mechanics/me/jobs/:id/activities', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const job = await myJob(request.params.id, auth);
    const body = deps.requireObject(request.body);
    const allowed = ['work_performed', 'identified_problems', 'inspection_findings',
      'recommendations', 'additional_work_required', 'internal_notes', 'activity_type', 'work_status'];
    if (Object.keys(body).some((field) => !allowed.includes(field))) fail(400, 'The activity contains unsupported fields.');
    const fields = {
      work_performed: optionalText(body.work_performed, 'Work performed', 4000),
      problems_identified: optionalText(body.identified_problems, 'Identified problems', 4000),
      inspection_findings: optionalText(body.inspection_findings, 'Inspection findings', 4000),
      recommendations: optionalText(body.recommendations, 'Recommendations', 4000),
      additional_work_required: optionalText(body.additional_work_required, 'Additional work required', 4000),
      internal_notes: optionalText(body.internal_notes, 'Internal notes', 4000),
    };
    if (Object.values(fields).every((value) => value === null)) fail(400, 'Enter at least one repair activity detail.');
    const activityType = optionalText(body.activity_type, 'Activity type', 40);
    if (activityType && !['start', 'progress', 'inspection', 'diagnosis', 'note', 'part_request', 'completion'].includes(activityType)) {
      fail(400, 'Activity type is invalid.');
    }
    const record = await deps.insertRepairActivity({
      workshopId: auth.workshop_id, jobId: job.id, auth,
      createdAt: new Date().toISOString(),
      activityType, workStatus: optionalText(body.work_status, 'Work status', 64), fields,
    });
    response.status(201).json({ record });
  }));

  app.get('/api/mechanics/me/jobs/:id/parts', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const job = await myJob(request.params.id, auth);
    const records = await db.query(`
      SELECT jp.id, jp.part_id, jp.quantity, jp.unit_price_cents, p.name AS part_name, p.sku AS part_number
      FROM job_parts jp JOIN parts p ON p.id = jp.part_id AND p.workshop_id = jp.workshop_id
      WHERE jp.workshop_id = ? AND jp.job_id = ? ORDER BY p.name
    `, auth.workshop_id, job.id);
    response.json({ records });
  }));

  app.post('/api/mechanics/me/jobs/:id/parts', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const job = await myJob(request.params.id, auth);
    const records = await deps.issueRepairPart(job, deps.requireObject(request.body), auth);
    response.status(201).json({ records });
  }));

  app.get('/api/mechanics/me/jobs/:id/available-parts', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    await myJob(request.params.id, auth);
    const q = queryText(request.query.q);
    const conditions = ['p.workshop_id = ?', 'p.quantity > 0'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (q) {
      conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)');
      const like = `%${q}%`;
      bindings.push(like, like, like);
    }
    const records = await db.query(`
      SELECT p.id, p.sku AS part_number, p.name, p.category, p.quantity, p.selling_price_cents
      FROM parts p WHERE ${conditions.join(' AND ')} ORDER BY p.name LIMIT 100
    `, ...bindings);
    response.json({ records });
  }));

  app.post('/api/mechanics/me/jobs/:id/complete', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const job = await myJob(request.params.id, auth);
    const body = deps.requireObject(request.body);
    if (Object.keys(body).some((field) => !['work_performed', 'identified_problems', 'completion_notes'].includes(field))) {
      fail(400, 'The completion submission contains unsupported fields.');
    }
    const workPerformed = deps.requiredText(body.work_performed, 'Work performed', 3, 4000);
    const identifiedProblems = deps.requiredText(body.identified_problems, 'Identified problems', 3, 4000);
    const completionNotes = optionalText(body.completion_notes, 'Completion notes', 4000);
    if (!deps.statusTransitions[job.repair_status]?.includes('Repair Completed')) {
      fail(409, `A job at ${job.repair_status} cannot be submitted for completion verification. Move it to In Progress first.`);
    }
    const now = new Date().toISOString();
    const completionId = randomUUID();
    await db.transaction(async () => {
      await db.execute(`
        INSERT INTO repair_completions (
          id, workshop_id, job_id, mechanic_user_id, work_performed, identified_problems,
          completion_notes, submitted_at, verification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON DUPLICATE KEY UPDATE
          mechanic_user_id = VALUES(mechanic_user_id), work_performed = VALUES(work_performed),
          identified_problems = VALUES(identified_problems), completion_notes = VALUES(completion_notes),
          submitted_at = VALUES(submitted_at), verification_status = 'pending',
          verified_by_user_id = NULL, verified_by_name = NULL, verified_at = NULL,
          verification_note = NULL, updated_at = VALUES(updated_at)
      `, completionId, auth.workshop_id, job.id, auth.id, workPerformed, identifiedProblems,
        completionNotes, now, now, now);
      await deps.insertRepairActivity({
        workshopId: auth.workshop_id, jobId: job.id, auth, createdAt: now,
        activityType: 'completion', workStatus: 'Repair Completed',
        fields: { work_performed: workPerformed, problems_identified: identifiedProblems,
          inspection_findings: null, recommendations: null, additional_work_required: null,
          internal_notes: completionNotes },
      });
      await deps.changeRepairStatus(job, 'Repair Completed', 'Submitted for completion verification', auth, now);
    });
    response.status(201).json({
      completion: await db.first('SELECT * FROM repair_completions WHERE workshop_id = ? AND job_id = ?', auth.workshop_id, job.id),
      record: await deps.repairJob(job.id, auth.workshop_id, auth),
    });
  }));

  app.get('/api/mechanics/me/activities', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireTechnician(auth);
    const records = await db.query(`
      SELECT activity.*, j.job_no AS repair_job_code, v.plate AS registration_number
      FROM repair_activity_logs activity
      JOIN jobs j ON j.id = activity.job_id AND j.workshop_id = activity.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      WHERE activity.workshop_id = ? AND j.assigned_technician IN (?, ?)
      ORDER BY activity.created_at DESC LIMIT 100
    `, auth.workshop_id, auth.name, auth.id);
    response.json({ records, total: records.length });
  }));

  // ---------------------------------------------------------------------------
  // Completion verification (administrator)
  // ---------------------------------------------------------------------------

  app.get('/api/mechanics/completions', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const { limit, offset } = parsePagination(request);
    const verification = queryText(request.query.verification_status);
    const mechanicId = queryText(request.query.mechanic_id);
    const conditions = ['rc.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (verification && ['pending', 'verified', 'rejected'].includes(verification)) {
      conditions.push('rc.verification_status = ?');
      bindings.push(verification);
    }
    if (mechanicId) { conditions.push('(rc.mechanic_user_id = ? OR m.id = ?)'); bindings.push(mechanicId, mechanicId); }
    const where = conditions.join(' AND ');
    const total = (await db.first(`SELECT COUNT(*) AS total FROM repair_completions rc
      LEFT JOIN mechanics m ON m.user_id = rc.mechanic_user_id AND m.workshop_id = rc.workshop_id
      WHERE ${where}`, ...bindings) as { total: number }).total;
    const records = await db.query(`
      SELECT rc.*, m.mechanic_number, m.full_name AS mechanic_name, m.specialization,
        j.job_no AS repair_job_code, j.service_type, COALESCE(j.repair_status, j.status) AS repair_status,
        v.plate AS registration_number, v.make, v.model, c.display_name AS customer_name
      FROM repair_completions rc
      LEFT JOIN mechanics m ON m.user_id = rc.mechanic_user_id AND m.workshop_id = rc.workshop_id
      JOIN jobs j ON j.id = rc.job_id AND j.workshop_id = rc.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      WHERE ${where} ORDER BY rc.submitted_at DESC LIMIT ? OFFSET ?
    `, ...bindings, limit, offset);
    response.json({ records, total, limit, offset });
  }));

  app.patch('/api/mechanics/completions/:id/verify', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const completion = await db.first('SELECT * FROM repair_completions WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id) as Record<string, unknown> | undefined;
    if (!completion) fail(404, 'Completion submission not found.');
    const body = deps.requireObject(request.body);
    const verification = enumValue(body.verification_status, ['verified', 'rejected'] as const, 'Verification status');
    const note = optionalText(body.note, 'Verification note', 2000);
    const job = await deps.repairJob(String(completion.job_id), auth.workshop_id);
    const now = new Date().toISOString();
    const target = verification === 'verified' ? 'Ready for Collection' : 'In Progress';
    await db.transaction(async () => {
      await db.execute(`
        UPDATE repair_completions SET verification_status = ?, verified_by_user_id = ?,
          verified_by_name = ?, verified_at = ?, verification_note = ?, updated_at = ?
        WHERE id = ? AND workshop_id = ?
      `, verification, auth.id, auth.name, now, note, now, String(completion.id), auth.workshop_id);
      if (job && deps.statusTransitions[job.repair_status]?.includes(target)) {
        await deps.changeRepairStatus(job, target, note ?? `Completion ${verification} by ${auth.name}`, auth, now);
      }
    });
    response.json({ record: await db.first('SELECT * FROM repair_completions WHERE id = ?', String(completion.id)) });
  }));

  // ---------------------------------------------------------------------------
  // Performance reports
  // ---------------------------------------------------------------------------

  const reportData = async (request: Request, auth: MechanicAuth) => {
    const conditions = ['a.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    const mechanicId = queryText(request.query.mechanic_id);
    const dateFrom = request.query.date_from === undefined ? null : deps.validDate(request.query.date_from, 'Start date');
    const dateTo = request.query.date_to === undefined ? null : deps.validDate(request.query.date_to, 'End date');
    if (dateFrom && dateTo && dateFrom > dateTo) fail(400, 'Start date must be on or before end date.');
    if (dateFrom) { conditions.push('a.assigned_at >= ?'); bindings.push(`${dateFrom}T00:00:00.000Z`); }
    if (dateTo) { conditions.push('a.assigned_at <= ?'); bindings.push(`${dateTo}T23:59:59.999Z`); }
    const status = queryText(request.query.status);
    if (status) {
      if (!deps.isRepairStatus(status)) fail(400, 'Repair status filter is invalid.');
      conditions.push('COALESCE(j.repair_status, j.status) = ?');
      bindings.push(status);
    }
    const specialization = queryText(request.query.specialization);
    if (specialization) {
      if (!(SPECIALIZATIONS as readonly string[]).includes(specialization)) fail(400, 'Specialization filter is invalid.');
      conditions.push('m.specialization = ?');
      bindings.push(specialization);
    }
    if (mechanicId) {
      conditions.push('(a.mechanic_user_id = ? OR m.id = ?)');
      bindings.push(mechanicId, mechanicId);
    }
    const rows = await db.query(`
      SELECT a.id AS assignment_id, a.assigned_at, a.unassigned_at, a.mechanic_user_id,
        m.id AS mechanic_id, m.mechanic_number, m.full_name AS mechanic_name, m.specialization,
        j.id AS job_id, j.job_no AS repair_job_code, j.service_type, j.repair_priority,
        COALESCE(j.repair_status, j.status) AS repair_status, j.created_at AS job_created_at,
        v.plate AS registration_number,
        rc.id AS completion_id, rc.submitted_at, rc.verified_at, rc.verification_status
      FROM repair_mechanic_assignments a
      JOIN jobs j ON j.id = a.job_id AND j.workshop_id = a.workshop_id
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      LEFT JOIN mechanics m ON m.user_id = a.mechanic_user_id AND m.workshop_id = a.workshop_id
      LEFT JOIN repair_completions rc ON rc.job_id = a.job_id AND rc.workshop_id = a.workshop_id
      WHERE ${conditions.join(' AND ')} ORDER BY a.assigned_at DESC
    `, ...bindings) as Record<string, unknown>[];

    const byMechanic = new Map<string, Record<string, unknown>>();
    const workloadCounts: Record<string, number> = {};
    const completionHistory: Record<string, unknown>[] = [];
    const workloadHistory: Record<string, unknown>[] = [];
    const trendCounts: Record<string, number> = {};
    const durations: number[] = [];
    const durationByMechanic = new Map<string, number[]>();
    for (const row of rows) {
      const key = String(row.mechanic_user_id);
      const entry = byMechanic.get(key) ?? {
        mechanic_id: row.mechanic_id ?? null,
        mechanic_number: row.mechanic_number ?? null,
        mechanic_name: row.mechanic_name ?? row.mechanic_user_id,
        specialization: row.specialization ?? null,
        jobs_assigned: 0, completed: 0, in_progress: 0, pending: 0, awaiting_parts: 0,
      };
      entry.jobs_assigned = Number(entry.jobs_assigned) + 1;
      const status = String(row.repair_status);
      workloadCounts[status] = (workloadCounts[status] ?? 0) + 1;
      if (status === 'In Progress') entry.in_progress = Number(entry.in_progress) + 1;
      else if (status === 'Awaiting Spare Parts') entry.awaiting_parts = Number(entry.awaiting_parts) + 1;
      else if (['Received', 'Awaiting Inspection', 'Under Inspection', 'Awaiting Customer Approval', 'Approved'].includes(status)) entry.pending = Number(entry.pending) + 1;
      byMechanic.set(key, entry);
      workloadHistory.push({
        repair_job_code: row.repair_job_code,
        registration_number: row.registration_number,
        service_type: row.service_type,
        repair_status: row.repair_status,
        repair_priority: row.repair_priority,
        assigned_at: row.assigned_at,
      });

      if (row.verification_status === 'verified') {
        entry.completed = Number(entry.completed) + 1;
        completionHistory.push({
          mechanic_name: entry.mechanic_name,
          repair_job_code: row.repair_job_code,
          registration_number: row.registration_number,
          service_type: row.service_type,
          submitted_at: row.submitted_at,
          verified_at: row.verified_at,
        });
        const duration = completionDurationDays(row.job_created_at, row.verified_at);
        if (duration !== null) {
          durations.push(duration);
          const mechanicDurations = durationByMechanic.get(key) ?? [];
          mechanicDurations.push(duration);
          durationByMechanic.set(key, mechanicDurations);
        }
        if (typeof row.verified_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.verified_at)) {
          const month = row.verified_at.slice(0, 7);
          trendCounts[month] = (trendCounts[month] ?? 0) + 1;
        }
      }
    }
    const perMechanic = Array.from(byMechanic.entries()).map(([key, entry]) => {
      const durationsForMechanic = durationByMechanic.get(key) ?? [];
      return { ...entry, average_completion_days: durationsForMechanic.length
        ? Math.round((durationsForMechanic.reduce((sum, value) => sum + value, 0) / durationsForMechanic.length) * 100) / 100
        : null };
    });
    return {
      filters: { mechanic_id: mechanicId, date_from: dateFrom, date_to: dateTo, status, specialization },
      summary: {
        total_jobs_assigned: rows.length,
        total_jobs_completed: completionHistory.length,
        total_jobs_in_progress: Object.entries(workloadCounts).reduce((sum, [key, value]) => sum + (key === 'In Progress' ? value : 0), 0),
        pending_jobs: Object.entries(workloadCounts).reduce((sum, [key, value]) => sum + (
          ['Received', 'Awaiting Inspection', 'Under Inspection', 'Awaiting Customer Approval', 'Approved'].includes(key) ? value : 0), 0),
        average_completion_days: durations.length
          ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 100) / 100
          : null,
      },
      per_mechanic: perMechanic,
      workload_distribution: workloadCounts,
      workload_history: workloadHistory,
      completion_history: completionHistory,
      trends: Object.entries(trendCounts).map(([month, count]) => ({ month, completed_jobs: count }))
        .sort((left, right) => left.month.localeCompare(right.month)),
    };
  };

  app.get('/api/mechanics/reports/data', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    response.json(await reportData(request, auth));
  }));

  app.get('/api/mechanics/reports/:reportType', requireAuth, asyncRoute(async (request, response) => {
    const auth = response.locals.auth as MechanicAuth;
    requireStaff(auth);
    const reportType = request.params.reportType;
    const data = await reportData(request, auth);
    const generatedAt = new Date().toISOString();
    const rangeLabel = data.filters.date_from || data.filters.date_to
      ? `Assigned from ${data.filters.date_from || 'All time'} to ${data.filters.date_to || 'Present'}`
      : 'All recorded mechanic assignments';
    const definitions: Record<string, { title: string; filename: string; columns: ReportColumn[]; records: Record<string, string | number | null>[] }> = {
      performance: {
        title: 'Mechanic Performance Report',
        filename: 'Mechanic_Performance_Report',
        columns: [
          { header: 'Mechanic', key: 'mechanic_name', width: 26 },
          { header: 'ID number', key: 'mechanic_number', width: 20 },
          { header: 'Specialization', key: 'specialization', width: 25 },
          { header: 'Jobs assigned', key: 'jobs_assigned', width: 14 },
          { header: 'Jobs completed', key: 'completed', width: 14 },
          { header: 'In progress', key: 'in_progress', width: 14 },
          { header: 'Pending', key: 'pending', width: 12 },
          { header: 'Avg days to complete', key: 'average_completion_days', width: 18 },
        ],
        records: data.per_mechanic as Record<string, string | number | null>[],
      },
      workload: {
        title: 'Mechanic Workload Report',
        filename: 'Mechanic_Workload_Report',
        columns: [
          { header: 'Repair job', key: 'repair_job_code', width: 20 },
          { header: 'Registration', key: 'registration_number', width: 16 },
          { header: 'Service', key: 'service_type', width: 24 },
          { header: 'Status', key: 'repair_status', width: 24 },
          { header: 'Priority', key: 'repair_priority', width: 12 },
          { header: 'Assigned on', key: 'assigned_at', width: 26 },
        ],
        records: data.workload_history as Record<string, string | number | null>[],
      },
      completions: {
        title: 'Mechanic Completion History Report',
        filename: 'Mechanic_Completion_History',
        columns: [
          { header: 'Mechanic', key: 'mechanic_name', width: 26 },
          { header: 'Repair job', key: 'repair_job_code', width: 20 },
          { header: 'Registration', key: 'registration_number', width: 16 },
          { header: 'Service', key: 'service_type', width: 24 },
          { header: 'Submitted', key: 'submitted_at', width: 26 },
          { header: 'Verified', key: 'verified_at', width: 26 },
        ],
        records: data.completion_history as Record<string, string | number | null>[],
      },
    };
    if (!Object.hasOwn(definitions, reportType)) fail(400, 'Unsupported mechanic report.');
    const definition = definitions[reportType];
    sendMechanicReport(response, {
      title: definition.title,
      filename: definition.filename,
      rangeLabel,
      columns: definition.columns,
      records: definition.records,
      generatedAt,
    });
  }));
}
