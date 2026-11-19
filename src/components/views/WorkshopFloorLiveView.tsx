import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Search,
  Signal,
  SignalHigh,
  SignalLow,
  UserRound,
  Wrench,
  X,
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

type ConnectionState = 'online' | 'reconnecting' | 'offline';

interface FloorJob {
  id: string;
  repair_job_code: string;
  tracking_number: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  registration_number: string;
  make: string;
  model: string;
  assigned_technician: string | null;
  assigned_mechanic_id: string | null;
  assigned_mechanic_name: string | null;
  service_type: string;
  reported_problem: string;
  repair_priority: 'Low' | 'Normal' | 'High' | 'Urgent';
  bay: string | null;
  repair_status: RepairStatus;
  date_received: string;
  expected_completion_date: string | null;
  previous_status: RepairStatus | null;
  last_status_changed_at: string | null;
  latest_activity_note: string | null;
  last_activity_at: string | null;
}

interface FloorSummary {
  total_vehicles_in_workshop: number;
  newly_received: number;
  awaiting_inspection: number;
  awaiting_customer_approval: number;
  approved: number;
  repairs_in_progress: number;
  awaiting_spare_parts: number;
  completed_repairs: number;
  ready_for_collection: number;
}

interface FloorMechanic {
  mechanic_id: string | null;
  mechanic_name: string;
  assigned_jobs: number;
  current_workload: number;
  active_repairs: number;
  completed_jobs: number;
  workload_status: 'Busy' | 'No active assignment';
}

interface FloorAlert {
  id: string;
  type: 'urgent' | 'overdue' | 'awaiting_approval' | 'awaiting_parts' | 'ready_for_collection' | 'unassigned';
  repair_job_id: string;
  repair_job_code: string;
  customer_name: string;
  registration_number: string;
  message: string;
}

interface FloorActivity {
  id: string;
  repair_job_code: string;
  customer_name: string;
  registration_number: string;
  event_type: 'status' | 'activity';
  summary: string | null;
  actor_name: string;
  occurred_at: string;
}

interface FloorRegistration {
  id: string;
  record_type: 'customer' | 'vehicle';
  customer_id: string;
  customer_name: string;
  customer_code: string | null;
  vehicle_id: string | null;
  vehicle_code: string | null;
  registration_number: string | null;
  make: string | null;
  model: string | null;
  created_at: string;
}

interface FloorBay {
  name: string;
  occupants: {
    id: string;
    repair_job_code: string;
    registration_number: string;
    make: string;
    model: string;
    repair_status: RepairStatus;
    assigned_mechanic_name: string | null;
  }[];
}

interface FloorData {
  summary: FloorSummary;
  jobs: FloorJob[];
  mechanics: FloorMechanic[];
  alerts: FloorAlert[];
  activities: FloorActivity[];
  registrations: FloorRegistration[];
  bays: FloorBay[];
  updated_at: string;
}

interface ApiError {
  error?: string;
  message?: string;
}

interface Props {
  onViewRepair: (repairId: string) => void;
  onAlertsCountChange: (count: number) => void;
}

const REFRESH_INTERVAL_MS = 10_000;

const WORKFLOW: { id: string; statuses: RepairStatus[]; label: string; tone: string; dot: string }[] = [
  { id: 'waiting-inspection', statuses: ['Received', 'Awaiting Inspection'], label: 'Waiting for Inspection', tone: 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300', dot: 'bg-orange-500' },
  { id: 'under-inspection', statuses: ['Under Inspection', 'Awaiting Customer Approval'], label: 'Under Inspection', tone: 'border-yellow-400 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-300', dot: 'bg-yellow-500' },
  { id: 'in-progress', statuses: ['Approved', 'In Progress'], label: 'In Progress', tone: 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300', dot: 'bg-violet-500' },
  { id: 'waiting-parts', statuses: ['Awaiting Spare Parts'], label: 'Waiting for Spare Parts', tone: 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300', dot: 'bg-amber-500' },
  { id: 'completed', statuses: ['Repair Completed', 'Ready for Collection'], label: 'Completed', tone: 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
];

const REPAIR_STATUSES: RepairStatus[] = [
  'Received',
  'Awaiting Inspection',
  'Under Inspection',
  'Awaiting Customer Approval',
  'Approved',
  'In Progress',
  'Awaiting Spare Parts',
  'Repair Completed',
  'Ready for Collection',
];

const CONNECTION: Record<ConnectionState, { label: string; style: string; Icon: typeof Signal }> = {
  online: {
    label: 'ONLINE · auto-refresh',
    style: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
    Icon: SignalHigh,
  },
  reconnecting: {
    label: 'RECONNECTING',
    style: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    Icon: Signal,
  },
  offline: {
    label: 'OFFLINE',
    style: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    Icon: SignalLow,
  },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Not set'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'No update recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'No update recorded'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusStyle(status: RepairStatus): string {
  const item = WORKFLOW.find((stage) => stage.statuses.includes(status));
  return item?.tone ?? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function alertStyle(type: FloorAlert['type']): string {
  if (type === 'urgent' || type === 'overdue') {
    return 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/35 dark:text-red-300';
  }
  if (type === 'awaiting_parts' || type === 'awaiting_approval' || type === 'unassigned') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-300';
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300';
}

function apiError(result: ApiError, fallback: string): string {
  return result.message ?? result.error ?? fallback;
}

export const WorkshopFloorLiveView: React.FC<Props> = ({ onViewRepair, onAlertsCountChange }) => {
  const [data, setData] = useState<FloorData | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('reconnecting');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [mechanicFilter, setMechanicFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const requestInFlight = useRef(false);
  const hasData = useRef(false);

  const refresh = useCallback(async (background = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (!background) setRefreshing(true);
    if (!hasData.current) setLoading(true);
    try {
      let response: Response;
      try {
        response = await apiFetch('/api/workshop/floor');
      } catch (requestError) {
        setConnection('offline');
        setError(requestError instanceof Error
          ? `Workshop server could not be reached: ${requestError.message}`
          : 'Workshop server could not be reached.');
        return;
      }

      setConnection('online');
      let result: FloorData & ApiError;
      try {
        result = await response.json() as FloorData & ApiError;
      } catch {
        setError(`Workshop server responded with HTTP ${response.status}, but returned invalid JSON.`);
        return;
      }
      if (!response.ok) {
        setError(apiError(result, `Workshop data request failed with HTTP ${response.status}.`));
        return;
      }
      const updatedAt = new Date(result.updated_at);
      if (Number.isNaN(updatedAt.valueOf())) {
        setError('Workshop server is online, but returned an invalid data update time.');
        return;
      }
      setData(result);
      hasData.current = true;
      setError('');
      setLastUpdated(updatedAt);
      onAlertsCountChange(result.alerts.length);
    } catch (loadError) {
      setConnection('online');
      setError(loadError instanceof Error ? loadError.message : 'Could not load the workshop floor.');
      if (!hasData.current) onAlertsCountChange(0);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [onAlertsCountChange]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), REFRESH_INTERVAL_MS);
    const onOffline = () => setConnection('offline');
    const onOnline = () => {
      setConnection('reconnecting');
      void refresh(true);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (data?.jobs ?? []).filter((job) => {
      if (statusFilter && job.repair_status !== statusFilter) return false;
      if (mechanicFilter && (job.assigned_mechanic_id ?? job.assigned_technician ?? '') !== mechanicFilter) return false;
      if (priorityFilter && job.repair_priority !== priorityFilter) return false;
      if (serviceFilter && job.service_type !== serviceFilter) return false;
      if (!normalizedQuery) return true;
      return [
        job.repair_job_code,
        job.tracking_number,
        job.customer_name,
        job.customer_phone,
        job.registration_number,
        job.make,
        job.model,
        job.assigned_mechanic_name,
        job.assigned_technician,
        job.service_type,
        job.reported_problem,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [data?.jobs, mechanicFilter, priorityFilter, query, serviceFilter, statusFilter]);

  const stages = useMemo(() => WORKFLOW.map((stage) => ({
    ...stage,
    jobs: filteredJobs.filter((job) => stage.statuses.includes(job.repair_status)),
  })), [filteredJobs]);

  const summary = data?.summary;
  const summaryCards = [
    { label: 'Vehicles in workshop', value: summary?.total_vehicles_in_workshop ?? 0, icon: CarFront, style: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
    { label: 'Newly received', value: summary?.newly_received ?? 0, icon: Clock3, style: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
    { label: 'Awaiting inspection', value: summary?.awaiting_inspection ?? 0, icon: Search, style: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300' },
    { label: 'Being repaired', value: summary?.repairs_in_progress ?? 0, icon: Wrench, style: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
    { label: 'Awaiting spare parts', value: summary?.awaiting_spare_parts ?? 0, icon: AlertTriangle, style: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
    { label: 'Completed repairs', value: summary?.completed_repairs ?? 0, icon: CheckCircle2, style: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
    { label: 'Ready for collection', value: summary?.ready_for_collection ?? 0, icon: ArrowUpRight, style: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  ];

  const mechanicOptions = data?.mechanics ?? [];
  const bays = data?.bays ?? [];
  const occupiedBayCount = bays.filter((bay) => bay.occupants.length > 0).length;
  const serviceOptions = [...new Set((data?.jobs ?? []).map((job) => job.service_type))].sort();
  const connectionDetails = CONNECTION[connection];
  const ConnectionIcon = connectionDetails.Icon;

  return (
    <section className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide text-blue-600 dark:text-blue-400">
            <Activity className="h-4 w-4" />
            WORKSHOP OPERATIONS
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">Workshop Floor Live</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Monitor current vehicle intake, repair progress, mechanic workload, and workshop alerts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${connectionDetails.style}`}>
            <ConnectionIcon className={`h-4 w-4 ${connection === 'reconnecting' ? 'animate-pulse' : ''}`} />
            {connectionDetails.label}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Data updated {lastUpdated ? formatDateTime(lastUpdated.toISOString()) : 'not yet'}
          </span>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" aria-label="Refresh workshop floor">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex items-center gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}{data && ' Showing the latest successfully loaded workshop data.'}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4 shrink-0" /></button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {summaryCards.map(({ label, value, icon: Icon, style }) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{loading && !data ? '—' : value}</p>
              </div>
              <span className={`rounded-xl p-2.5 ${style}`}><Icon className="h-4 w-4" /></span>
            </div>
          </article>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Workshop bays</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Bay names are read from existing repair jobs. Assign a bay in Service &amp; Repair Management to track it here.</p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {[
            { label: 'Known bays', value: bays.length },
            { label: 'Occupied bays', value: occupiedBayCount },
            { label: 'Available bays', value: bays.length - occupiedBayCount },
          ].map(({ label, value }) => (
            <article key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{loading && !data ? '—' : value}</p>
            </article>
          ))}
        </div>
        {bays.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-slate-500 dark:text-slate-400">No bay names have been recorded yet, so availability cannot be calculated.</p>
        ) : (
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
            {bays.map((bay) => (
              <article key={bay.name} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{bay.name}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${bay.occupants.length ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                    {bay.occupants.length ? 'Occupied' : 'Available'}
                  </span>
                </div>
                {bay.occupants.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No active repair is assigned.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {bay.occupants.map((occupant) => (
                      <li key={occupant.id} className="text-xs text-slate-600 dark:text-slate-300">
                        <button type="button" onClick={() => onViewRepair(occupant.id)} className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
                          {occupant.registration_number} · {occupant.make} {occupant.model}
                        </button>
                        <p className="mt-0.5">{occupant.repair_job_code} · {occupant.repair_status} · {occupant.assigned_mechanic_name ?? 'Unassigned mechanic'}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 dark:border-slate-800 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Live workshop vehicle board</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{filteredJobs.length} active repair jobs · Collected vehicles remain in repair history, not on this board.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap">
            <label className="relative sm:col-span-2 xl:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, plate, job, mechanic…" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="">All repair statuses</option>
              {REPAIR_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select aria-label="Filter by mechanic" value={mechanicFilter} onChange={(event) => setMechanicFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="">All mechanics</option>
              {mechanicOptions.map((mechanic) => <option key={mechanic.mechanic_id ?? mechanic.mechanic_name} value={mechanic.mechanic_id ?? mechanic.mechanic_name}>{mechanic.mechanic_name}</option>)}
            </select>
            <select aria-label="Filter by priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="">All priorities</option>
              <option>Urgent</option><option>High</option><option>Normal</option><option>Low</option>
            </select>
            <select aria-label="Filter by service type" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="">All services</option>
              {serviceOptions.map((service) => <option key={service}>{service}</option>)}
            </select>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex min-h-56 items-center justify-center text-sm text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />Loading live workshop records…</div>
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-5">
            {stages.map((stage) => (
              <section key={stage.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/70">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stage.dot}`} />
                    <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{stage.label}</h3>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${stage.tone}`}>{stage.jobs.length}</span>
                </header>
                <div className="space-y-3 p-3">
                  {stage.jobs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400 dark:border-slate-800">No jobs in this stage</p>
                  ) : stage.jobs.map((job) => (
                    <article key={job.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{job.repair_job_code}</p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">{job.tracking_number}</p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold ${job.repair_priority === 'Urgent' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : job.repair_priority === 'High' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{job.repair_priority}</span>
                      </div>
                      <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyle(job.repair_status)}`}>{job.repair_status}</span>
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                          <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0"><p className="truncate font-semibold">{job.customer_name}</p>{job.customer_phone && <p className="mt-0.5 text-[11px] text-slate-500">{job.customer_phone}</p>}</div>
                        </div>
                        <div className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                          <CarFront className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0"><p className="truncate font-semibold">{job.registration_number}</p><p className="mt-0.5 text-[11px] text-slate-500">{job.make} {job.model}</p></div>
                        </div>
                        <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
                          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <p className="min-w-0 truncate">{job.assigned_mechanic_name ?? job.assigned_technician ?? 'Unassigned'}</p>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">Bay: <strong className="font-semibold text-slate-800 dark:text-slate-200">{job.bay ?? 'Not assigned'}</strong></p>
                        <p className="font-medium text-slate-700 dark:text-slate-200">{job.service_type}</p>
                        <p className="line-clamp-2 text-slate-500 dark:text-slate-400" title={job.reported_problem}>{job.reported_problem}</p>
                        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-500 dark:border-slate-800">
                          <span>Received<br /><strong className="mt-0.5 inline-block font-semibold text-slate-700 dark:text-slate-300">{formatDate(job.date_received)}</strong></span>
                          <span>Expected<br /><strong className="mt-0.5 inline-block font-semibold text-slate-700 dark:text-slate-300">{formatDate(job.expected_completion_date)}</strong></span>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                          <p>Previous: <strong className="font-semibold text-slate-700 dark:text-slate-300">{job.previous_status ?? 'Initial status'}</strong></p>
                          <p className="mt-1">Updated: {formatDateTime(job.last_status_changed_at ?? job.last_activity_at ?? job.date_received)}</p>
                          {job.latest_activity_note && <p className="mt-1 line-clamp-2" title={job.latest_activity_note}>Latest note: {job.latest_activity_note}</p>}
                        </div>
                      </div>
                      <button type="button" onClick={() => onViewRepair(job.id)} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950">
                        View repair details <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div><h2 className="text-base font-semibold text-slate-900 dark:text-white">Mechanic monitoring</h2><p className="mt-1 text-xs text-slate-500">Workload calculated from current repair assignments; availability is not manually recorded.</p></div>
            <Wrench className="h-5 w-5 text-blue-500" />
          </div>
          {(data?.mechanics.length ?? 0) === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No mechanic assignments are recorded on active workshop jobs.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950/60"><tr><th className="px-4 py-3 font-semibold">Mechanic</th><th className="px-4 py-3 font-semibold">Assigned jobs</th><th className="px-4 py-3 font-semibold">Workload</th><th className="px-4 py-3 font-semibold">Active repairs</th><th className="px-4 py-3 font-semibold">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data?.mechanics.map((mechanic) => (
                    <tr key={mechanic.mechanic_id ?? mechanic.mechanic_name}>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{mechanic.mechanic_name}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{mechanic.assigned_jobs}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{mechanic.current_workload}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{mechanic.active_repairs}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${mechanic.workload_status === 'Busy' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{mechanic.workload_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div><h2 className="text-base font-semibold text-slate-900 dark:text-white">Workshop alerts</h2><p className="mt-1 text-xs text-slate-500">Generated from current repair priority, status, assignment, and due date.</p></div>
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>
          {(data?.alerts.length ?? 0) === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No current workshop alerts.</div>
          ) : (
            <ul className="max-h-[26rem] space-y-2 overflow-y-auto p-4">
              {data?.alerts.map((alert) => (
                <li key={alert.id}>
                  <button type="button" onClick={() => onViewRepair(alert.repair_job_id)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:brightness-[0.98] ${alertStyle(alert.type)}`}>
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-bold">{alert.message}</span><span className="mt-1 block truncate text-[11px] opacity-80">{alert.repair_job_code} · {alert.customer_name} · {alert.registration_number}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div><h2 className="text-base font-semibold text-slate-900 dark:text-white">Recent workshop activity</h2><p className="mt-1 text-xs text-slate-500">Latest status changes and repair activity recorded by your team.</p></div>
          <CalendarClock className="h-5 w-5 text-blue-500" />
        </div>
        {(data?.activities.length ?? 0) === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">No repair activity has been recorded yet.</div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {data?.activities.map((activity) => (
              <article key={`${activity.event_type}:${activity.id}`} className="flex gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <span className={`mt-0.5 rounded-lg p-2 ${activity.event_type === 'status' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300'}`}>
                  {activity.event_type === 'status' ? <Activity className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{activity.summary ?? 'Repair activity recorded'}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">{activity.repair_job_code} · {activity.customer_name} · {activity.registration_number}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{activity.actor_name} · {formatDateTime(activity.occurred_at)}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Recent customer & vehicle registrations</h2>
            <p className="mt-1 text-xs text-slate-500">New records appear here automatically after registration.</p>
          </div>
          <CarFront className="h-5 w-5 text-blue-500" />
        </div>
        {(data?.registrations.length ?? 0) === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {loading ? 'Loading recent registrations…' : 'No customer or vehicle registrations to show.'}
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {data?.registrations.map((registration) => (
              <article key={registration.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <span className={`mt-0.5 rounded-lg p-2 ${registration.record_type === 'customer' ? 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'}`}>
                  {registration.record_type === 'customer'
                    ? <UserRound className="h-4 w-4" />
                    : <CarFront className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {registration.record_type === 'customer'
                      ? registration.customer_name
                      : `${registration.make ?? ''} ${registration.model ?? ''}`.trim()}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                    {registration.record_type === 'customer'
                      ? `Customer${registration.customer_code ? ` · ${registration.customer_code}` : ''}`
                      : `${registration.registration_number ?? 'Vehicle'} · ${registration.customer_name}`}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {registration.record_type === 'customer' ? 'Customer registered' : 'Vehicle registered'} · {formatDateTime(registration.created_at)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
};
