import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  UsersRound,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch } from '../../api';

type AdminTab = 'dashboard' | 'mechanics' | 'assignments' | 'completions' | 'reports';
type Availability = 'Available' | 'Busy' | 'Off Duty' | 'On Leave';

interface Mechanic {
  id: string;
  mechanic_number: string;
  full_name: string;
  email: string;
  phone: string;
  address: string | null;
  gender: string | null;
  specialization: string;
  experience_years: number;
  qualifications: string | null;
  employment_date: string;
  employment_status: 'Active' | 'Inactive';
  availability_status: Availability;
  effective_availability: Availability | 'Inactive';
  active_job_count: number;
  total_assigned_jobs: number;
  completed_jobs: number;
  profile_image: string | null;
  created_at: string;
}

interface WorkloadItem {
  id: string;
  mechanic_number: string;
  full_name: string;
  specialization: string;
  availability_status: string;
  active_jobs: number;
  total_assigned_jobs: number;
  completed_jobs: number;
}

interface DashboardData {
  summary: {
    total_mechanics: number;
    active_mechanics: number;
    available_mechanics: number;
    busy_mechanics: number;
    off_duty_mechanics: number;
    on_leave_mechanics: number;
    total_assigned_jobs: number;
    total_jobs: number;
    in_progress_jobs: number;
    pending_jobs: number;
    completed_jobs: number;
    pending_verifications: number;
  };
  workload: WorkloadItem[];
  recent_activities: ActivityRow[];
  recent_mechanics: Mechanic[];
}

interface ActivityRow {
  id: string;
  activity_type: string | null;
  work_status: string | null;
  work_performed: string | null;
  problems_identified: string | null;
  created_at: string;
  mechanic_name: string;
  repair_job_code: string;
  registration_number: string;
  mechanic_number: string | null;
}

interface AssignableJob {
  id: string;
  repair_job_code: string;
  registration_number: string;
  make: string;
  model: string;
  customer_name: string;
  service_type: string;
  reported_problem: string | null;
  repair_priority: string;
  repair_status: string;
  assigned_technician: string | null;
  current_mechanic_name: string | null;
  created_at: string;
}

interface AssignmentRecord {
  id: string;
  job_id: string;
  mechanic_user_id: string;
  mechanic_name: string;
  mechanic_number: string | null;
  specialization: string | null;
  repair_job_code: string;
  registration_number: string;
  repair_status: string;
  assigned_at: string;
  unassigned_at: string | null;
  assignment_status: 'active' | 'cancelled';
  notes: string | null;
  customer_name: string;
}

interface CompletionRecord {
  id: string;
  repair_job_code: string;
  registration_number: string;
  service_type: string;
  mechanic_name: string | null;
  mechanic_number: string | null;
  work_performed: string;
  identified_problems: string;
  completion_notes: string | null;
  submitted_at: string;
  verification_status: 'pending' | 'verified' | 'rejected';
  verified_by_name: string | null;
  verified_at: string | null;
  verification_note: string | null;
}

interface Recommendation {
  mechanic_id: string;
  full_name: string;
  mechanic_number: string;
  specialization: string;
  availability_status: string;
  active_job_count: number;
  score: number;
  reasons: string[];
  can_assign_without_override: boolean;
}

interface MechanicProfile {
  record: Mechanic;
  assigned_vehicles: {
    job_id: string;
    job_no: string;
    registration_number: string;
    make: string;
    model: string;
    repair_status: string;
  }[];
  active_jobs: { id: string; repair_job_code: string; repair_status: string }[];
  repair_history: { id: string; repair_job_code: string; repair_status: string }[];
  work_logs: ActivityRow[];
  performance: {
    total_jobs_assigned: number;
    verified_completions: number;
    active_jobs: number;
    in_progress_jobs: number;
    pending_jobs: number;
    average_completion_days: number | null;
  };
}

interface ReportData {
  summary: {
    total_jobs_assigned: number;
    total_jobs_completed: number;
    total_jobs_in_progress: number;
    pending_jobs: number;
    average_completion_days: number | null;
  };
  per_mechanic: {
    mechanic_name: string;
    mechanic_number: string | null;
    specialization: string | null;
    jobs_assigned: number;
    completed: number;
    in_progress: number;
    pending: number;
    average_completion_days: number | null;
  }[];
  workload_distribution: Record<string, number>;
  trends: { month: string; completed_jobs: number }[];
}

interface ApiResult<T> {
  records?: T[];
  record?: T;
  total?: number;
  summary?: DashboardData['summary'];
  recommendations?: Recommendation[];
  filters?: unknown;
  error?: string;
  message?: string;
}

interface Props {
  onViewRepair: (repairId: string) => void;
  onNotify: (type: 'success' | 'warning' | 'info', title: string, detail?: string) => void;
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
];
const AVAILABILITY: Availability[] = ['Available', 'Busy', 'Off Duty', 'On Leave'];
const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

const EMPTY_REGISTRATION = {
  full_name: '',
  email: '',
  phone: '',
  password: '',
  address: '',
  gender: '',
  specialization: SPECIALIZATIONS[0],
  experience_years: '0',
  qualifications: '',
  employment_date: new Date().toISOString().slice(0, 10),
  availability_status: 'Available' as Availability,
};

const EMPTY_EDIT = {
  full_name: '',
  email: '',
  phone: '',
  address: '',
  gender: '',
  specialization: SPECIALIZATIONS[0],
  experience_years: '0',
  qualifications: '',
  employment_date: '',
};

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await apiFetch(url, init);
  const result = await response.json().catch(() => ({})) as ApiResult<T>;
  if (!response.ok) throw new Error(result.error ?? `Request failed with status ${response.status}.`);
  return result;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusClass(status: string): string {
  if (status === 'Available' || status === 'verified' || status === 'Active') {
    return 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800';
  }
  if (status === 'Busy' || status === 'pending' || status === 'In Progress') {
    return 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800';
  }
  if (status === 'Off Duty' || status === 'On Leave' || status === 'Inactive' || status === 'rejected') {
    return 'bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700';
  }
  return 'bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800';
}

function StatCard({ label, value, icon: Icon, hint }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        <div className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export const MechanicManagementView: React.FC<Props> = ({ onViewRepair, onNotify }) => {
  const [tab, setTab] = useState<AdminTab>('dashboard');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [jobs, setJobs] = useState<AssignableJob[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [completions, setCompletions] = useState<CompletionRecord[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [query, setQuery] = useState('');
  const [jobQuery, setJobQuery] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [registration, setRegistration] = useState(EMPTY_REGISTRATION);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<MechanicProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedMechanicId, setSelectedMechanicId] = useState('');
  const [assignmentNote, setAssignmentNote] = useState('');
  const [override, setOverride] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [reportFilters, setReportFilters] = useState({ mechanic_id: '', date_from: '', date_to: '', status: '', specialization: '' });

  const notifyError = useCallback((error: unknown, title: string) => {
    onNotify('warning', title, error instanceof Error ? error.message : 'Please try again.');
  }, [onNotify]);

  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  const openProfile = useCallback((mechanic: { id: string }) => {
    setProfile(null);
    setProfileId(mechanic.id);
    setEditing(false);
    setEditForm(EMPTY_EDIT);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    const suffix = `?q=${encodeURIComponent(query)}`;
    const load = async () => {
      if (tab === 'dashboard') {
        const result = await request<never>('/api/mechanics/dashboard');
        if (active) setDashboard(result as unknown as DashboardData);
      } else if (tab === 'mechanics') {
        const result = await request<Mechanic>(`/api/mechanics${suffix}&limit=100`);
        if (active) setMechanics(result.records ?? []);
      } else if (tab === 'assignments') {
        const [jobResult, assignmentResult, mechanicResult] = await Promise.all([
          request<AssignableJob>(`/api/mechanics/assignable-jobs?q=${encodeURIComponent(jobQuery)}`),
          request<AssignmentRecord>('/api/mechanics/assignments?limit=100'),
          request<Mechanic>('/api/mechanics?limit=100'),
        ]);
        if (active) {
          setJobs(jobResult.records ?? []);
          setAssignments(assignmentResult.records ?? []);
          setMechanics(mechanicResult.records ?? []);
        }
      } else if (tab === 'completions') {
        const result = await request<CompletionRecord>('/api/mechanics/completions?limit=100');
        if (active) setCompletions(result.records ?? []);
      } else {
        const params = new URLSearchParams();
        Object.entries(reportFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
        const [result, mechanicResult] = await Promise.all([
          request<never>(`/api/mechanics/reports/data?${params.toString()}`),
          request<Mechanic>('/api/mechanics?limit=100'),
        ]);
        if (active) {
          setReport(result as unknown as ReportData);
          setMechanics(mechanicResult.records ?? []);
        }
      }
    };
    load().catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : 'Please try again.';
      setLoadError(message);
      onNotify('warning', 'Could not load mechanic data', message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [tab, refresh, query, jobQuery, reportFilters, notifyError, onNotify]);

  useEffect(() => {
    if (!profileId) {
      setProfile(null);
      return;
    }
    let active = true;
    request<never>(`/api/mechanics/${profileId}`)
      .then((result) => { if (active) setProfile(result as unknown as MechanicProfile); })
      .catch((error: unknown) => notifyError(error, 'Could not load mechanic profile'));
    return () => { active = false; };
  }, [profileId, refresh, notifyError]);

  useEffect(() => {
    if (!profile) {
      setEditForm(EMPTY_EDIT);
      return;
    }
    setEditForm({
      full_name: profile.record.full_name,
      email: profile.record.email,
      phone: profile.record.phone,
      address: profile.record.address ?? '',
      gender: profile.record.gender ?? '',
      specialization: profile.record.specialization,
      experience_years: String(profile.record.experience_years),
      qualifications: profile.record.qualifications ?? '',
      employment_date: String(profile.record.employment_date).slice(0, 10),
    });
  }, [profile]);

  useEffect(() => {
    if (!selectedJobId) {
      setRecommendations([]);
      return;
    }
    let active = true;
    request<never>(`/api/mechanics/recommendations?job_id=${encodeURIComponent(selectedJobId)}`)
      .then((result) => { if (active) setRecommendations((result as unknown as { recommendations: Recommendation[] }).recommendations ?? []); })
      .catch(() => { if (active) setRecommendations([]); });
    return () => { active = false; };
  }, [selectedJobId]);

  const registerMechanic = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await request('/api/mechanics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...registration,
          experience_years: Number(registration.experience_years),
          gender: registration.gender || null,
          address: registration.address || null,
          qualifications: registration.qualifications || null,
        }),
      });
      onNotify('success', 'Mechanic registered', `${registration.full_name} can now sign in to the mechanic workspace.`);
      setShowRegister(false);
      setRegistration(EMPTY_REGISTRATION);
      reload();
    } catch (error) {
      notifyError(error, 'Registration failed');
    }
  };

  const saveMechanic = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileId) return;
    try {
      await request(`/api/mechanics/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          experience_years: Number(editForm.experience_years),
          gender: editForm.gender || null,
          address: editForm.address || null,
          qualifications: editForm.qualifications || null,
        }),
      });
      onNotify('success', 'Mechanic updated', `${editForm.full_name}'s profile has been saved.`);
      setEditing(false);
      reload();
    } catch (error) {
      notifyError(error, 'Could not update mechanic');
    }
  };

  const updateAvailability = async (mechanic: Mechanic, availability: Availability) => {
    try {
      await request(`/api/mechanics/${mechanic.id}/availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability_status: availability }),
      });
      onNotify('success', 'Availability updated', `${mechanic.full_name} is now ${availability}.`);
      reload();
    } catch (error) {
      notifyError(error, 'Availability update failed');
    }
  };

  const toggleEmployment = async (mechanic: Mechanic) => {
    const next = mechanic.employment_status === 'Active' ? 'Inactive' : 'Active';
    try {
      await request(`/api/mechanics/${mechanic.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employment_status: next }),
      });
      onNotify('success', 'Mechanic status updated', `${mechanic.full_name} is now ${next}.`);
      reload();
    } catch (error) {
      notifyError(error, 'Status update failed');
    }
  };

  const assignJob = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJobId || !selectedMechanicId) return;
    try {
      await request('/api/mechanics/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: selectedJobId,
          mechanic_id: selectedMechanicId,
          note: assignmentNote || null,
          override_availability: override,
        }),
      });
      onNotify('success', 'Job assigned', 'The mechanic can now see this repair in their workspace.');
      setSelectedJobId('');
      setSelectedMechanicId('');
      setAssignmentNote('');
      setOverride(false);
      reload();
    } catch (error) {
      notifyError(error, 'Assignment failed');
    }
  };

  const cancelAssignment = async (assignment: AssignmentRecord) => {
    try {
      await request(`/api/mechanics/assignments/${assignment.id}`, { method: 'DELETE' });
      onNotify('success', 'Assignment removed', 'The assignment history has been preserved.');
      reload();
    } catch (error) {
      notifyError(error, 'Could not remove assignment');
    }
  };

  const verifyCompletion = async (completion: CompletionRecord, verification: 'verified' | 'rejected') => {
    try {
      await request(`/api/mechanics/completions/${completion.id}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verification_status: verification }),
      });
      onNotify('success', verification === 'verified' ? 'Repair verified' : 'Repair returned', completion.repair_job_code);
      reload();
    } catch (error) {
      notifyError(error, 'Verification failed');
    }
  };

  const reportQuery = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(reportFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }, [reportFilters]);

  const tabs: { key: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { key: 'mechanics', label: 'Mechanics', icon: UsersRound },
    { key: 'assignments', label: 'Job Assignments', icon: ClipboardList },
    { key: 'completions', label: 'Verifications', icon: ShieldCheck },
    { key: 'reports', label: 'Performance Reports', icon: Activity },
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <Wrench className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Mechanic Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Registration, assignments, availability, work logs and verified performance from live workshop records.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reload} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setShowRegister(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Register mechanic
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <span><strong>Could not load mechanic data.</strong> {loadError}</span>
          <button onClick={reload} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-900/40">Retry</button>
        </div>
      )}

      {loading && !dashboard && !mechanics.length && !report && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <LoaderCircle className="h-5 w-5 animate-spin" /> Loading live records…
        </div>
      )}

      {tab === 'dashboard' && dashboard && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <StatCard label="Mechanics" value={dashboard.summary.total_mechanics} icon={UsersRound} hint={`${dashboard.summary.active_mechanics} active`} />
            <StatCard label="Available" value={dashboard.summary.available_mechanics} icon={CheckCircle2} />
            <StatCard label="Busy" value={dashboard.summary.busy_mechanics} icon={Clock3} />
            <StatCard label="Assigned jobs" value={dashboard.summary.total_assigned_jobs} icon={ClipboardList} hint={`of ${dashboard.summary.total_jobs} jobs`} />
            <StatCard label="Completed" value={dashboard.summary.completed_jobs} icon={ShieldCheck} />
            <StatCard label="Awaiting verification" value={dashboard.summary.pending_verifications} icon={AlertTriangle} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Live mechanic workload</h3>
              <div className="space-y-3">
                {dashboard.workload.map((mechanic) => (
                  <button key={mechanic.id} onClick={() => openProfile(mechanic)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                        {mechanic.full_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{mechanic.full_name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{mechanic.specialization} · {mechanic.mechanic_number}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusClass(mechanic.availability_status)}`}>{mechanic.availability_status}</span>
                      <p className="mt-1 text-xs text-slate-500">{mechanic.active_jobs} active · {mechanic.completed_jobs} verified</p>
                    </div>
                  </button>
                ))}
                {!dashboard.workload.length && <p className="py-8 text-center text-sm text-slate-500">No mechanics registered yet.</p>}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Recent work activity</h3>
              <div className="space-y-3">
                {dashboard.recent_activities.map((activity) => (
                  <div key={activity.id} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{activity.repair_job_code} · {activity.registration_number}</p>
                      <span className="text-xs text-slate-400">{formatDate(activity.created_at)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{activity.mechanic_name} · {activity.work_status ?? activity.activity_type ?? 'Work log'}</p>
                    {activity.work_performed && <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{activity.work_performed}</p>}
                  </div>
                ))}
                {!dashboard.recent_activities.length && <p className="py-8 text-center text-sm text-slate-500">No work logs recorded yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'mechanics' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, number, email or specialization" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </div>
            <span className="text-xs text-slate-500">{mechanics.length} mechanic(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <tr><th className="py-2">Mechanic</th><th>Specialization</th><th>Availability</th><th>Workload</th><th>Status</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {mechanics.map((mechanic) => (
                  <tr key={mechanic.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{mechanic.full_name}</p>
                      <p className="text-xs text-slate-500">{mechanic.mechanic_number} · {mechanic.email}</p>
                    </td>
                    <td className="text-slate-600 dark:text-slate-300">{mechanic.specialization}</td>
                    <td>
                      <select
                        value={mechanic.availability_status}
                        disabled={mechanic.employment_status !== 'Active'}
                        onChange={(event) => void updateAvailability(mechanic, event.target.value as Availability)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        {AVAILABILITY.map((status) => <option key={status}>{status}</option>)}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">Effective: {mechanic.effective_availability}</p>
                    </td>
                    <td className="text-slate-600 dark:text-slate-300">{mechanic.active_job_count} active · {mechanic.total_assigned_jobs} total</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusClass(mechanic.employment_status)}`}>{mechanic.employment_status}</span>
                    </td>
                    <td className="text-right">
                      <div className="inline-flex gap-1">
                        <button title="View profile" onClick={() => openProfile(mechanic)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Eye className="h-4 w-4" /></button>
                        <button title={mechanic.employment_status === 'Active' ? 'Deactivate' : 'Reactivate'} onClick={() => void toggleEmployment(mechanic)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                          <UserCog className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!mechanics.length && <p className="py-12 text-center text-sm text-slate-500">No mechanics match this search.</p>}
          </div>
        </div>
      )}

      {tab === 'assignments' && (
        <div className="grid gap-5 lg:grid-cols-5">
          <form onSubmit={assignJob} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Assign a repair job</h3>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Find repair job</label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} placeholder="Job number, registration or customer" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Repair job</label>
              <select required value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value="">Select a job…</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.repair_job_code} · {job.registration_number} · {job.service_type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Mechanic</label>
              <select required value={selectedMechanicId} onChange={(event) => setSelectedMechanicId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value="">Select a mechanic…</option>
                {mechanics.filter((mechanic) => mechanic.employment_status === 'Active').map((mechanic) => (
                  <option key={mechanic.id} value={mechanic.id}>{mechanic.full_name} · {mechanic.effective_availability}</option>
                ))}
              </select>
            </div>
            {recommendations.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Suggested mechanics for this job</p>
                <div className="space-y-1.5">
                  {recommendations.slice(0, 3).map((recommendation) => (
                    <button key={recommendation.mechanic_id} type="button" onClick={() => setSelectedMechanicId(recommendation.mechanic_id)} className="block w-full rounded-md border border-slate-200 bg-white p-2 text-left text-xs hover:border-blue-400 dark:border-slate-800 dark:bg-slate-900">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{recommendation.full_name}</span>
                      <span className="ml-2 text-slate-500">score {recommendation.score} · {recommendation.reasons.join(', ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Assignment note</label>
              <textarea value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} className="mt-0.5" />
              Explicitly override Off Duty / On Leave restriction
            </label>
            <button type="submit" className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Assign mechanic</button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-3">
            <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Assignment history</h3>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <tr><th className="py-2">Repair job</th><th>Mechanic</th><th>Assigned</th><th>Status</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="py-2">
                      <button onClick={() => onViewRepair(assignment.job_id)} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">{assignment.repair_job_code}</button>
                      <p className="text-slate-500">{assignment.registration_number} · {assignment.customer_name}</p>
                    </td>
                    <td className="text-slate-600 dark:text-slate-300">{assignment.mechanic_name}<p className="text-slate-500">{assignment.mechanic_number}</p></td>
                    <td className="text-slate-500">{formatDate(assignment.assigned_at)}</td>
                    <td><span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${statusClass(assignment.assignment_status)}`}>{assignment.assignment_status}</span></td>
                    <td className="text-right">
                      {!assignment.unassigned_at && (
                        <button onClick={() => void cancelAssignment(assignment)} className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30" title="Cancel assignment"><X className="h-4 w-4" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!assignments.length && <p className="py-12 text-center text-sm text-slate-500">No assignments recorded yet.</p>}
          </div>
        </div>
      )}

      {tab === 'completions' && (
        <div className="space-y-3">
          {completions.map((completion) => (
            <div key={completion.id} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{completion.repair_job_code} · {completion.registration_number}</h3>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusClass(completion.verification_status)}`}>{completion.verification_status}</span>
                  </div>
                  <p className="text-xs text-slate-500">{completion.mechanic_name ?? 'Unknown mechanic'} · {completion.service_type} · submitted {formatDate(completion.submitted_at)}</p>
                </div>
                {completion.verification_status === 'pending' && (
                  <div className="flex gap-2">
                    <button onClick={() => void verifyCompletion(completion, 'rejected')} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30">Return to work</button>
                    <button onClick={() => void verifyCompletion(completion, 'verified')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Verify completion</button>
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><p className="text-xs font-semibold text-slate-500">Work performed</p><p className="mt-1 text-slate-700 dark:text-slate-200">{completion.work_performed}</p></div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><p className="text-xs font-semibold text-slate-500">Identified problems</p><p className="mt-1 text-slate-700 dark:text-slate-200">{completion.identified_problems}</p></div>
              </div>
              {completion.verification_note && <p className="mt-2 text-xs text-slate-500">Verification note: {completion.verification_note}</p>}
            </div>
          ))}
          {!completions.length && <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No completion submissions found.</p>}
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div><label className="text-xs font-medium text-slate-600 dark:text-slate-300">From</label><input type="date" value={reportFilters.date_from} onChange={(event) => setReportFilters((value) => ({ ...value, date_from: event.target.value }))} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>
            <div><label className="text-xs font-medium text-slate-600 dark:text-slate-300">To</label><input type="date" value={reportFilters.date_to} onChange={(event) => setReportFilters((value) => ({ ...value, date_to: event.target.value }))} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>
            <div><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Mechanic</label><select value={reportFilters.mechanic_id} onChange={(event) => setReportFilters((value) => ({ ...value, mechanic_id: event.target.value }))} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">All mechanics</option>{mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.full_name}</option>)}</select></div>
            <div><label className="text-xs font-medium text-slate-600 dark:text-slate-300">Specialization</label><select value={reportFilters.specialization} onChange={(event) => setReportFilters((value) => ({ ...value, specialization: event.target.value }))} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">All</option>{SPECIALIZATIONS.map((item) => <option key={item}>{item}</option>)}</select></div>
            <div className="ml-auto flex gap-2">
              {(['performance', 'workload', 'completions'] as const).map((type) => (
                <a key={type} href={`/api/mechanics/reports/${type}?format=pdf&${reportQuery}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium capitalize text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Download className="h-3 w-3" /> {type}
                </a>
              ))}
            </div>
          </div>
          {report && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard label="Jobs assigned" value={report.summary.total_jobs_assigned} icon={ClipboardList} />
                <StatCard label="Verified completions" value={report.summary.total_jobs_completed} icon={CheckCircle2} />
                <StatCard label="In progress" value={report.summary.total_jobs_in_progress} icon={Wrench} />
                <StatCard label="Pending" value={report.summary.pending_jobs} icon={Clock3} />
                <StatCard label="Avg completion days" value={report.summary.average_completion_days ?? '—'} icon={CalendarDays} />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Performance by mechanic</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800"><tr><th className="py-2">Mechanic</th><th>Assigned</th><th>Completed</th><th>Active</th><th>Avg days</th></tr></thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {report.per_mechanic.map((entry) => (
                          <tr key={entry.mechanic_number ?? entry.mechanic_name}><td className="py-2 font-medium text-slate-800 dark:text-slate-100">{entry.mechanic_name}<p className="text-slate-500">{entry.specialization}</p></td><td>{entry.jobs_assigned}</td><td>{entry.completed}</td><td>{entry.in_progress}</td><td>{entry.average_completion_days ?? '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Workload distribution</h3>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(report.workload_distribution).map(([status, count]) => <span key={status} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">{status}: <strong>{count}</strong></span>)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Monthly verified completions</h3>
                    <div className="space-y-2">
                      {report.trends.map((trend) => <div key={trend.month} className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300"><span>{trend.month}</span><strong>{trend.completed_jobs}</strong></div>)}
                      {!report.trends.length && <p className="text-xs text-slate-500">No verified completions in this period.</p>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {showRegister && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={registerMechanic} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Register mechanic</h3>
              <button type="button" onClick={() => setShowRegister(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['full_name', 'Full name', 'text', true],
                ['email', 'Email address', 'email', true],
                ['phone', 'Phone number', 'tel', true],
                ['password', 'Initial password', 'password', true],
                ['address', 'Address', 'text', false],
                ['qualifications', 'Qualifications', 'text', false],
              ] as const).map(([field, label, type, required]) => (
                <label key={field} className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {label}
                  <input required={required} type={type} value={registration[field]} onChange={(event) => setRegistration((value) => ({ ...value, [field]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
              ))}
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Specialization
                <select value={registration.specialization} onChange={(event) => setRegistration((value) => ({ ...value, specialization: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">{SPECIALIZATIONS.map((item) => <option key={item}>{item}</option>)}</select>
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Gender
                <select value={registration.gender} onChange={(event) => setRegistration((value) => ({ ...value, gender: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">Not specified</option>{GENDERS.map((item) => <option key={item}>{item}</option>)}</select>
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Experience (years)
                <input type="number" min="0" max="60" value={registration.experience_years} onChange={(event) => setRegistration((value) => ({ ...value, experience_years: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Employment date
                <input type="date" required value={registration.employment_date} onChange={(event) => setRegistration((value) => ({ ...value, employment_date: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Initial availability
                <select value={registration.availability_status} onChange={(event) => setRegistration((value) => ({ ...value, availability_status: event.target.value as Availability }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">{AVAILABILITY.map((item) => <option key={item}>{item}</option>)}</select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowRegister(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancel</button>
              <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Register mechanic</button>
            </div>
          </form>
        </div>
      )}

      {profileId && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/60">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Mechanic profile</h3>
              <button onClick={() => setProfileId(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            {profile && (
              <div className="space-y-5">
                <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">{profile.record.full_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{profile.record.full_name}</p>
                    <p className="text-sm text-slate-500">{profile.record.mechanic_number} · {profile.record.specialization}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusClass(profile.record.employment_status)}`}>{profile.record.employment_status}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusClass(profile.record.effective_availability)}`}>{profile.record.effective_availability}</span>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard label="Assigned" value={profile.performance.total_jobs_assigned} icon={ClipboardList} />
                  <StatCard label="Verified" value={profile.performance.verified_completions} icon={ShieldCheck} />
                  <StatCard label="Avg days" value={profile.performance.average_completion_days ?? '—'} icon={CalendarDays} />
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Assigned vehicles</h4>
                  <div className="space-y-2">
                    {profile.assigned_vehicles.map((vehicle) => (
                      <button key={vehicle.job_id} onClick={() => onViewRepair(vehicle.job_id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                        <span><strong className="text-slate-800 dark:text-slate-100">{vehicle.registration_number}</strong><span className="ml-2 text-slate-500">{vehicle.make} {vehicle.model} · {vehicle.job_no}</span></span>
                        <span className="text-xs text-slate-500">{vehicle.repair_status}</span>
                      </button>
                    ))}
                    {!profile.assigned_vehicles.length && <p className="text-sm text-slate-500">No vehicles currently assigned.</p>}
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Work logs</h4>
                  <div className="space-y-2">
                    {profile.work_logs.map((log) => (
                      <div key={log.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                        <p className="text-xs text-slate-500">{log.repair_job_code} · {log.registration_number} · {formatDate(log.created_at)}</p>
                        <p className="mt-1 text-slate-700 dark:text-slate-200">{log.work_performed ?? log.problems_identified ?? log.activity_type}</p>
                      </div>
                    ))}
                    {!profile.work_logs.length && <p className="text-sm text-slate-500">No work logs recorded yet.</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    <Pencil className="h-4 w-4" /> {editing ? 'Close editor' : 'Edit details'}
                  </button>
                  <button onClick={() => void toggleEmployment(profile.record)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    <UserCog className="h-4 w-4" /> {profile.record.employment_status === 'Active' ? 'Deactivate mechanic account' : 'Reactivate mechanic account'}
                  </button>
                </div>
                {editing && (
                  <form onSubmit={saveMechanic} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Edit mechanic details</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        ['full_name', 'Full name', 'text', true],
                        ['email', 'Email address', 'email', true],
                        ['phone', 'Phone number', 'tel', true],
                        ['address', 'Address', 'text', false],
                        ['qualifications', 'Qualifications', 'text', false],
                        ['employment_date', 'Employment date', 'date', true],
                      ] as const).map(([field, label, type, required]) => (
                        <label key={field} className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          {label}
                          <input required={required} type={type} value={editForm[field]} onChange={(event) => setEditForm((value) => ({ ...value, [field]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                        </label>
                      ))}
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Specialization
                        <select value={editForm.specialization} onChange={(event) => setEditForm((value) => ({ ...value, specialization: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">{SPECIALIZATIONS.map((item) => <option key={item}>{item}</option>)}</select>
                      </label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Gender
                        <select value={editForm.gender} onChange={(event) => setEditForm((value) => ({ ...value, gender: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">Not specified</option>{GENDERS.map((item) => <option key={item}>{item}</option>)}</select>
                      </label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Experience (years)
                        <input type="number" min="0" max="60" value={editForm.experience_years} onChange={(event) => setEditForm((value) => ({ ...value, experience_years: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancel</button>
                      <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save changes</button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
