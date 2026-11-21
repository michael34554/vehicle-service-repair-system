import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CarFront,
  CheckCircle2,
  ClipboardList,
  Clock3,
  LoaderCircle,
  PackagePlus,
  RefreshCw,
  Send,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { apiFetch } from '../../api';

type RepairStatus =
  | 'Received'
  | 'Awaiting Inspection'
  | 'Under Inspection'
  | 'Awaiting Customer Approval'
  | 'Approved'
  | 'In Progress'
  | 'Awaiting Spare Parts'
  | 'Repair Completed'
  | 'Ready for Collection'
  | 'Collected';

interface AssignedVehicle {
  job_id: string;
  job_no: string;
  registration_number: string;
  make: string;
  model: string;
  customer_name: string;
  repair_status: RepairStatus;
}

interface WorkActivity {
  id: string;
  activity_type: string | null;
  work_status: string | null;
  work_performed: string | null;
  problems_identified: string | null;
  inspection_findings: string | null;
  recommendations: string | null;
  additional_work_required: string | null;
  internal_notes: string | null;
  created_by_name: string;
  created_at: string;
}

interface JobPart {
  id: string;
  part_id: string;
  quantity: number;
  part_name: string;
  part_number: string;
  unit_price_cents: number;
}

interface AvailablePart {
  id: string;
  part_number: string;
  name: string;
  category: string;
  quantity: number;
  selling_price_cents: number;
}

interface Diagnosis {
  id: string;
  predicted_fault: string;
  confirmed_fault: string | null;
  review_status: string;
  affected_component: string | null;
  mechanic_notes: string | null;
  created_at: string;
}

interface StatusHistory {
  id: string;
  previous_status: RepairStatus | null;
  new_status: RepairStatus;
  note: string | null;
  changed_by_name: string;
  changed_at: string;
}

interface JobDetail {
  record: {
    id: string;
    repair_job_code: string;
    registration_number: string;
    make: string;
    model: string;
    customer_name: string;
    service_type: string;
    reported_problem: string | null;
    repair_status: RepairStatus;
    repair_priority: string;
    bay: string | null;
    expected_completion_date: string | null;
  };
  history: StatusHistory[];
  activities: WorkActivity[];
  parts: JobPart[];
  diagnoses: Diagnosis[];
  completion: { verification_status: string; verification_note: string | null } | null;
}

interface SummaryData {
  profile: { full_name: string; mechanic_number: string; specialization: string; availability_status: string } | null;
  summary: {
    total_assigned_jobs: number;
    pending_jobs: number;
    in_progress_jobs: number;
    completed_jobs: number;
    awaiting_verification: number;
  };
  assigned_vehicles: AssignedVehicle[];
  recent_activities: WorkActivity[];
}

interface ApiResult<T> {
  records?: T[];
  record?: T;
  profile?: SummaryData['profile'];
  summary?: SummaryData['summary'];
  assigned_vehicles?: AssignedVehicle[];
  recent_activities?: WorkActivity[];
  history?: StatusHistory[];
  activities?: WorkActivity[];
  parts?: JobPart[];
  diagnoses?: Diagnosis[];
  completion?: JobDetail['completion'];
  error?: string;
  message?: string;
}

interface Props {
  onViewRepair: (repairId: string) => void;
  onNotify: (type: 'success' | 'warning' | 'info', title: string, detail?: string) => void;
}

const PROGRESS_STATUSES: RepairStatus[] = ['Under Inspection', 'In Progress', 'Awaiting Spare Parts', 'Repair Completed'];
const STARTABLE_STATUSES: RepairStatus[] = ['Awaiting Inspection', 'Approved', 'Awaiting Spare Parts'];
const EMPTY_ACTIVITY = {
  work_performed: '',
  identified_problems: '',
  inspection_findings: '',
  recommendations: '',
  additional_work_required: '',
  internal_notes: '',
};
const EMPTY_COMPLETION = { work_performed: '', identified_problems: '', completion_notes: '' };

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
  if (['Ready for Collection', 'Collected', 'Repair Completed'].includes(status)) {
    return 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800';
  }
  if (['In Progress', 'Under Inspection', 'Awaiting Spare Parts'].includes(status)) {
    return 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800';
  }
  if (status === 'Available') {
    return 'bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800';
  }
  return 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700';
}

export const MechanicWorkspaceView: React.FC<Props> = ({ onViewRepair, onNotify }) => {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [detailTab, setDetailTab] = useState<'work' | 'parts' | 'history'>('work');
  const [progressStatus, setProgressStatus] = useState<RepairStatus>('In Progress');
  const [progressNote, setProgressNote] = useState('');
  const [activity, setActivity] = useState(EMPTY_ACTIVITY);
  const [availableParts, setAvailableParts] = useState<AvailablePart[]>([]);
  const [partForm, setPartForm] = useState({ part_id: '', quantity: '1', note: '' });
  const [completion, setCompletion] = useState(EMPTY_COMPLETION);
  const [search, setSearch] = useState('');

  const notifyError = useCallback((error: unknown, title: string) => {
    onNotify('warning', title, error instanceof Error ? error.message : 'Please try again.');
  }, [onNotify]);

  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    request<never>('/api/mechanics/me/summary')
      .then((result) => {
        if (!active) return;
        const data = result as unknown as SummaryData;
        setSummary(data);
        setSelectedJobId((current) => {
          if (current && data.assigned_vehicles?.some((vehicle) => vehicle.job_id === current)) return current;
          return data.assigned_vehicles?.[0]?.job_id ?? '';
        });
      })
      .catch((error: unknown) => notifyError(error, 'Could not load your assigned work'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, notifyError]);

  useEffect(() => {
    if (!selectedJobId) {
      setDetail(null);
      return;
    }
    let active = true;
    request<never>(`/api/mechanics/me/jobs/${selectedJobId}`)
      .then((result) => {
        if (!active) return;
        const data = result as unknown as JobDetail;
        setDetail(data);
        setProgressStatus(PROGRESS_STATUSES.includes(data.record.repair_status) ? data.record.repair_status : 'In Progress');
        setActivity(EMPTY_ACTIVITY);
        setCompletion(EMPTY_COMPLETION);
      })
      .catch((error: unknown) => notifyError(error, 'Could not load repair details'));
    return () => { active = false; };
  }, [selectedJobId, refresh, notifyError]);

  useEffect(() => {
    if (detailTab !== 'parts' || !selectedJobId) return;
    let active = true;
    request<AvailablePart>(`/api/mechanics/me/jobs/${selectedJobId}/available-parts`)
      .then((result) => { if (active) setAvailableParts(result.records ?? []); })
      .catch((error: unknown) => notifyError(error, 'Could not load parts'));
    return () => { active = false; };
  }, [detailTab, selectedJobId, refresh, notifyError]);

  const filteredVehicles = useMemo(() => {
    const term = search.trim().toLowerCase();
    const vehicles = summary?.assigned_vehicles ?? [];
    if (!term) return vehicles;
    return vehicles.filter((vehicle) => [vehicle.job_no, vehicle.registration_number, vehicle.make, vehicle.model, vehicle.customer_name]
      .some((value) => value.toLowerCase().includes(term)));
  }, [summary, search]);

  const postAction = async (url: string, body: object, successTitle: string) => {
    try {
      await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onNotify('success', successTitle);
      reload();
    } catch (error) {
      notifyError(error, successTitle);
    }
  };

  const startRepair = async () => {
    await postAction(`/api/mechanics/me/jobs/${selectedJobId}/start`, {}, 'Repair started');
  };

  const updateProgress = async (event: FormEvent) => {
    event.preventDefault();
    await postAction(`/api/mechanics/me/jobs/${selectedJobId}/progress`, { status: progressStatus, note: progressNote || null }, 'Progress updated');
    setProgressNote('');
  };

  const logActivity = async (event: FormEvent) => {
    event.preventDefault();
    const payload = Object.fromEntries(Object.entries(activity).map(([key, value]) => [key, value || null]));
    await postAction(`/api/mechanics/me/jobs/${selectedJobId}/activities`, payload, 'Work log saved');
    setActivity(EMPTY_ACTIVITY);
  };

  const issuePart = async (event: FormEvent) => {
    event.preventDefault();
    await postAction(`/api/mechanics/me/jobs/${selectedJobId}/parts`, {
      part_id: partForm.part_id,
      quantity: Number(partForm.quantity),
      note: partForm.note || null,
    }, 'Part issued to repair');
    setPartForm({ part_id: '', quantity: '1', note: '' });
  };

  const submitCompletion = async (event: FormEvent) => {
    event.preventDefault();
    await postAction(`/api/mechanics/me/jobs/${selectedJobId}/complete`, completion, 'Submitted for verification');
    setCompletion(EMPTY_COMPLETION);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <Wrench className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Mechanic Workspace
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {summary?.profile
              ? `${summary.profile.full_name} · ${summary.profile.mechanic_number} · ${summary.profile.specialization} · ${summary.profile.availability_status}`
              : 'Your assigned repair jobs, work logs, parts and completion submissions.'}
          </p>
        </div>
        <button onClick={reload} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ['Assigned jobs', summary?.summary.total_assigned_jobs ?? 0, ClipboardList],
          ['Pending inspection', summary?.summary.pending_jobs ?? 0, Clock3],
          ['In progress', summary?.summary.in_progress_jobs ?? 0, Wrench],
          ['Awaiting verification', summary?.summary.awaiting_verification ?? 0, CheckCircle2],
        ] as const).map(([label, value, Icon]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
              <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Assigned vehicles</h3>
          <div className="relative mb-3">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your jobs" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          </div>
          <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
            {filteredVehicles.map((vehicle) => (
              <button
                key={vehicle.job_id}
                onClick={() => { setSelectedJobId(vehicle.job_id); setDetailTab('work'); }}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selectedJobId === vehicle.job_id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><CarFront className="h-4 w-4" /> {vehicle.registration_number}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusClass(vehicle.repair_status)}`}>{vehicle.repair_status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{vehicle.make} {vehicle.model} · {vehicle.job_no}</p>
                <p className="text-xs text-slate-500">{vehicle.customer_name}</p>
              </button>
            ))}
            {!filteredVehicles.length && <p className="py-10 text-center text-sm text-slate-500">No assigned repair jobs found.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-3">
          {!detail && (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-slate-500">
              <ClipboardList className="h-8 w-8" />
              <p className="text-sm">Select a repair job to start work.</p>
            </div>
          )}
          {detail && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{detail.record.repair_job_code}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusClass(detail.record.repair_status)}`}>{detail.record.repair_status}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{detail.record.repair_priority}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {detail.record.registration_number} · {detail.record.make} {detail.record.model} · {detail.record.customer_name}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{detail.record.service_type} · {detail.record.reported_problem ?? 'No reported problem recorded'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {STARTABLE_STATUSES.includes(detail.record.repair_status) && (
                    <button onClick={() => void startRepair()} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Wrench className="h-4 w-4" /> Start repair</button>
                  )}
                  <button onClick={() => onViewRepair(detail.record.id)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">Open in Service & Repair</button>
                </div>
              </div>

              {detail.completion && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  Completion submission: <strong className="capitalize">{detail.completion.verification_status}</strong>
                  {detail.completion.verification_note ? ` · ${detail.completion.verification_note}` : ''}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {([
                  ['work', 'Work log & updates', Activity],
                  ['parts', 'Parts used', PackagePlus],
                  ['history', 'History & AI', Sparkles],
                ] as const).map(([key, label, Icon]) => (
                  <button key={key} onClick={() => setDetailTab(key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${detailTab === key ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>

              {detailTab === 'work' && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <form onSubmit={updateProgress} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Update repair progress</h4>
                    <select value={progressStatus} onChange={(event) => setProgressStatus(event.target.value as RepairStatus)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                      {PROGRESS_STATUSES.map((status) => <option key={status}>{status}</option>)}
                    </select>
                    <textarea value={progressNote} onChange={(event) => setProgressNote(event.target.value)} rows={2} placeholder="Progress note (optional)" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">Save progress</button>
                  </form>

                  <form onSubmit={logActivity} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Record work details</h4>
                    {([
                      ['work_performed', 'Work performed'],
                      ['identified_problems', 'Identified problems'],
                      ['inspection_findings', 'Inspection findings'],
                      ['recommendations', 'Recommendations'],
                      ['additional_work_required', 'Additional work required'],
                      ['internal_notes', 'Internal notes'],
                    ] as const).map(([field, label]) => (
                      <label key={field} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        {label}
                        <textarea value={activity[field]} onChange={(event) => setActivity((value) => ({ ...value, [field]: event.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      </label>
                    ))}
                    <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Send className="h-4 w-4" /> Save work log</button>
                  </form>

                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 xl:col-span-2">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Recent work logs</h4>
                    <div className="space-y-2">
                      {detail.activities.map((log) => (
                        <div key={log.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-950">
                          <div className="flex justify-between gap-2 text-xs text-slate-500"><span>{log.created_by_name} · {log.work_status ?? log.activity_type ?? 'Work log'}</span><span>{formatDate(log.created_at)}</span></div>
                          {log.work_performed && <p className="mt-1 text-slate-700 dark:text-slate-200">{log.work_performed}</p>}
                          {log.problems_identified && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Problem: {log.problems_identified}</p>}
                        </div>
                      ))}
                      {!detail.activities.length && <p className="text-sm text-slate-500">No work logs yet.</p>}
                    </div>
                  </div>

                  <form onSubmit={submitCompletion} className="space-y-3 rounded-xl border border-emerald-200 p-4 dark:border-emerald-900 xl:col-span-2">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Submit for verification</h4>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Work performed<textarea required value={completion.work_performed} onChange={(event) => setCompletion((value) => ({ ...value, work_performed: event.target.value }))} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Identified problems<textarea required value={completion.identified_problems} onChange={(event) => setCompletion((value) => ({ ...value, identified_problems: event.target.value }))} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Completion notes<textarea value={completion.completion_notes} onChange={(event) => setCompletion((value) => ({ ...value, completion_notes: event.target.value }))} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
                    </div>
                    <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" /> Submit repair for verification</button>
                  </form>
                </div>
              )}

              {detailTab === 'parts' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <form onSubmit={issuePart} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Issue part from inventory</h4>
                    <select required value={partForm.part_id} onChange={(event) => setPartForm((value) => ({ ...value, part_id: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                      <option value="">Select an in-stock part…</option>
                      {availableParts.map((part) => <option key={part.id} value={part.id}>{part.name} · {part.part_number} · {part.quantity} in stock</option>)}
                    </select>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Quantity<input required type="number" min="1" value={partForm.quantity} onChange={(event) => setPartForm((value) => ({ ...value, quantity: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Note<input value={partForm.note} onChange={(event) => setPartForm((value) => ({ ...value, note: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
                    <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><PackagePlus className="h-4 w-4" /> Issue part</button>
                    <p className="text-xs text-slate-500">Parts are deducted from the main inventory through the existing stock transaction mechanism.</p>
                  </form>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Parts on this repair</h4>
                    <div className="space-y-2">
                      {detail.parts.map((part) => (
                        <div key={part.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-950">
                          <span><strong className="text-slate-800 dark:text-slate-100">{part.part_name}</strong><span className="ml-2 text-xs text-slate-500">{part.part_number}</span></span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">× {part.quantity}</span>
                        </div>
                      ))}
                      {!detail.parts.length && <p className="text-sm text-slate-500">No parts issued to this repair yet.</p>}
                    </div>
                  </div>
                </div>
              )}

              {detailTab === 'history' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Repair status history</h4>
                    <ol className="space-y-3">
                      {detail.history.map((item) => (
                        <li key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-950">
                          <p className="font-medium text-slate-800 dark:text-slate-100">{item.previous_status ?? 'Created'} → {item.new_status}</p>
                          <p className="text-xs text-slate-500">{item.changed_by_name} · {formatDate(item.changed_at)}</p>
                          {item.note && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{item.note}</p>}
                        </li>
                      ))}
                      {!detail.history.length && <p className="text-sm text-slate-500">No status changes recorded yet.</p>}
                    </ol>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Sparkles className="h-4 w-4 text-violet-500" /> AI diagnosis records</h4>
                    <div className="space-y-2">
                      {detail.diagnoses.map((diagnosis) => (
                        <div key={diagnosis.id} className="rounded-lg bg-violet-50 p-3 text-sm dark:bg-violet-950/30">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{diagnosis.predicted_fault}</p>
                          <p className="text-xs text-slate-500">{diagnosis.affected_component ?? 'Component not specified'} · {diagnosis.review_status} · {formatDate(diagnosis.created_at)}</p>
                          {diagnosis.mechanic_notes && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{diagnosis.mechanic_notes}</p>}
                        </div>
                      ))}
                      {!detail.diagnoses.length && <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> No AI diagnosis has been recorded for this repair yet. Use AI Fault Diagnosis or Smart Workshop to add one.</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {loading && !summary && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading your workspace…</div>
      )}
    </section>
  );
};
