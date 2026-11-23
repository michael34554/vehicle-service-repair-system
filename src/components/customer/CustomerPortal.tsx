import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CarFront,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gauge,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MapPin,
  Package,
  Phone,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { apiFetch } from '../../api';
import { REPAIR_TRACKING_STAGES } from '../../../shared/customerPortal';

type PortalSection = 'dashboard' | 'vehicles' | 'repairs' | 'history' | 'billing' | 'notifications' | 'profile';

interface Profile {
  id: string;
  username: string;
  customer_code?: string | null;
  full_name: string;
  email: string | null;
  account_email?: string | null;
  phone: string | null;
  address: string | null;
  gender?: string | null;
  created_at?: string;
  updated_at?: string;
  account_created_at?: string;
}

interface Vehicle {
  id: string;
  plate: string;
  vin: string | null;
  engine_number: string | null;
  make: string;
  model: string;
  model_year: number;
  color: string | null;
  mileage: number;
  engine_type: string | null;
  engine_capacity_cc: number | null;
  fuel_type: string | null;
  transmission_type: string | null;
  drive_type: string | null;
  catalogue_model_name: string | null;
  body_style: string | null;
  specification_note: string | null;
  created_at: string;
}

interface Job {
  id: string;
  job_no: string;
  service_type: string;
  issue_description: string | null;
  repair_status: string | null;
  repair_priority: string | null;
  stage: string;
  stage_index: number;
  promised_at: string | null;
  created_at: string;
  updated_at: string;
  registration_number: string;
  make: string;
  model: string;
  assigned_mechanic_name: string | null;
  assigned_mechanic_specialization?: string | null;
}

interface StatusTimelineEntry {
  kind: 'status' | 'work';
  title: string;
  detail: string | null;
  actor: string | null;
  at: string;
}

interface JobPart {
  id: string;
  part_name: string;
  part_number: string;
  quantity: number;
  unit_price_cents: number;
}

interface JobNotification {
  id: string;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
}

interface JobDetail {
  job: Job & {
    vehicle_id: string;
    status: string;
    final_amount_cents: number | null;
    estimated_total_cost_cents: number;
    estimated_labour_cost_cents: number;
    estimated_parts_cost_cents: number;
    parts_charges_cents: number;
  };
  timeline: StatusTimelineEntry[];
  parts: JobPart[];
  notifications: JobNotification[];
}

interface Notification {
  id: string;
  job_id: string | null;
  type: string;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
  read_at?: string | null;
}

interface ServiceRecord {
  id: string;
  job_no: string;
  service_type: string;
  issue_description: string | null;
  repair_status: string | null;
  stage: string;
  service_date: string;
  completed_at: string;
  registration_number: string;
  make: string;
  model: string;
  model_year: number;
  assigned_mechanic_name: string | null;
  work_performed: string | null;
  parts_summary: string | null;
  parts_charges_cents: number;
  final_amount_cents: number | null;
  estimated_total_cost_cents: number;
}

interface PaymentRecord {
  id: string;
  invoice_number: string;
  job_id: string | null;
  job_no: string;
  amount_cents: number;
  payment_method: string;
  status: string;
  paid_at: string | null;
  created_at: string;
}

interface Invoice {
  invoice_number: string | null;
  job_id: string;
  job_no: string;
  service_type: string;
  registration_number: string;
  make: string;
  model: string;
  total_amount_cents: number;
  total_source: string;
  service_charges_cents: number;
  spare_parts_charges_cents: number;
  amount_paid_cents: number;
  outstanding_cents: number;
  payment_status: string;
  latest_paid_at: string | null;
}

interface DashboardData {
  profile: Profile;
  summary: {
    total_vehicles: number;
    active_jobs: number;
    completed_repairs: number;
    pending_payment_cents: number;
  };
  recent_notifications: Notification[];
  recent_jobs: Job[];
}

interface BillingData {
  invoices: Invoice[];
  payments: PaymentRecord[];
}

const NAV_ITEMS: { key: PortalSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'vehicles', label: 'My Vehicles', icon: CarFront },
  { key: 'repairs', label: 'Track Repairs', icon: Wrench },
  { key: 'history', label: 'Service History', icon: History },
  { key: 'billing', label: 'Invoices & Payments', icon: ReceiptText },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'profile', label: 'My Profile', icon: UserRound },
];

async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return await response.json() as T;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return await response.json() as T;
}

function notRecorded(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return 'Not recorded';
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusClass(status: string | null | undefined): string {
  if (status === 'Ready for Collection' || status === 'Collected') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
  if (status === 'Awaiting Customer Approval' || status === 'Awaiting Spare Parts') return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
  if (status === 'In Progress' || status === 'Under Inspection') return 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}

function Card({ title, subtitle, children, className = '' }: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[#e2e9f2] bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      {(title || subtitle) && (
        <header className="mb-4">
          {title && <h2 className="text-lg font-bold text-[#101c30] dark:text-white">{title}</h2>}
          {subtitle && <p className="mt-1 text-sm text-[#66758b] dark:text-slate-400">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl py-10 text-sm font-semibold text-[#66758b] dark:text-slate-400">
      <LoaderCircle className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-[#d8e2ee] px-5 py-10 text-center dark:border-slate-700">
      <Icon className="h-7 w-7 text-[#39a8ff]" />
      <p className="mt-3 text-sm font-bold text-[#101c30] dark:text-white">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-[#66758b] dark:text-slate-400">{detail}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass(status)}`}>
      {notRecorded(status)}
    </span>
  );
}

function StageProgress({ stageIndex }: { stageIndex: number }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <ol className="flex min-w-max items-start gap-0">
        {REPAIR_TRACKING_STAGES.map((stage, index) => {
          const complete = stageIndex >= 0 && index < stageIndex;
          const current = index === stageIndex;
          return (
            <li key={stage.status} className="flex w-[118px] shrink-0 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span className={`h-1 flex-1 ${index === 0 ? 'bg-transparent' : complete || current ? 'bg-[#39a8ff]' : 'bg-[#dce5ef] dark:bg-slate-700'}`} />
                <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold ${current
                  ? 'border-[#1479e8] bg-[#1479e8] text-white'
                  : complete
                    ? 'border-[#39a8ff] bg-[#39a8ff]/15 text-[#1479e8]'
                    : 'border-[#dce5ef] bg-white text-[#8b99ac] dark:border-slate-700 dark:bg-slate-900'}`}>
                  {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className={`h-1 flex-1 ${index === REPAIR_TRACKING_STAGES.length - 1 ? 'bg-transparent' : complete ? 'bg-[#39a8ff]' : 'bg-[#dce5ef] dark:bg-slate-700'}`} />
              </div>
              <span className={`mt-2 text-[10px] font-bold leading-4 ${current ? 'text-[#1479e8]' : complete ? 'text-[#26374e] dark:text-slate-200' : 'text-[#8b99ac]'}`}>
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const CustomerPortal: React.FC<{ onLogout: () => Promise<void> }> = ({ onLogout }) => {
  const [activeSection, setActiveSection] = useState<PortalSection>('dashboard');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [serviceHistory, setServiceHistory] = useState<ServiceRecord[]>([]);
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [historyVehicleId, setHistoryVehicleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [profileDraft, setProfileDraft] = useState({ phone: '', address: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const loadNotifications = useCallback(async () => {
    const data = await getJson<{ notifications: Notification[]; unread_count: number }>('/api/customer/notifications');
    setNotifications(data.notifications);
    setUnreadCount(data.unread_count);
  }, []);

  const loadProfile = useCallback(async () => {
    const data = await getJson<{ profile: Profile }>('/api/customer/profile');
    setProfile(data.profile);
    setProfileDraft({
      phone: data.profile.phone ?? '',
      address: data.profile.address ?? '',
    });
  }, []);

  const loadSection = useCallback(async (section: PortalSection, showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      if (section === 'dashboard') {
        const [overview, vehicleData] = await Promise.all([
          getJson<DashboardData>('/api/customer/dashboard'),
          getJson<{ vehicles: Vehicle[] }>('/api/customer/vehicles'),
        ]);
        setDashboard(overview);
        setProfile(overview.profile);
        setVehicles(vehicleData.vehicles);
        setNotifications(overview.recent_notifications);
        setJobs(overview.recent_jobs);
      } else if (section === 'vehicles') {
        const data = await getJson<{ vehicles: Vehicle[] }>('/api/customer/vehicles');
        setVehicles(data.vehicles);
      } else if (section === 'repairs') {
        const data = await getJson<{ jobs: Job[] }>('/api/customer/jobs');
        setJobs(data.jobs);
        setSelectedJobId((current) => current && data.jobs.some((job) => job.id === current)
          ? current
          : data.jobs[0]?.id ?? null);
      } else if (section === 'history') {
        const data = await getJson<{ records: ServiceRecord[] }>('/api/customer/service-history');
        setServiceHistory(data.records);
      } else if (section === 'billing') {
        setBilling(await getJson<BillingData>('/api/customer/billing'));
      } else if (section === 'notifications') {
        await loadNotifications();
      } else if (section === 'profile') {
        await loadProfile();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load customer data.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [loadNotifications, loadProfile]);

  useEffect(() => {
    void loadSection(activeSection);
    void loadNotifications();
  }, [activeSection, loadSection, loadNotifications]);

  useEffect(() => {
    if (!['dashboard', 'repairs', 'notifications'].includes(activeSection)) return;
    const timer = window.setInterval(() => {
      void loadSection(activeSection, false);
      if (activeSection !== 'dashboard') void loadNotifications();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [activeSection, loadSection, loadNotifications]);

  useEffect(() => {
    if (!selectedJobId) {
      setJobDetail(null);
      return;
    }
    let active = true;
    getJson<JobDetail>(`/api/customer/jobs/${selectedJobId}`)
      .then((data) => { if (active) setJobDetail(data); })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load repair details.');
      });
    return () => { active = false; };
  }, [selectedJobId]);

  const filteredHistory = useMemo(
    () => historyVehicleId ? serviceHistory.filter((record) => record.registration_number === historyVehicleId) : serviceHistory,
    [historyVehicleId, serviceHistory]
  );

  const handleMarkRead = async (id: string) => {
    try {
      await patchJson(`/api/customer/notifications/${id}/read`, {});
      await loadNotifications();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update notification.');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await patchJson('/api/customer/notifications/read-all', {});
      await loadNotifications();
      setNotice('All notifications were marked as read.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update notifications.');
    }
  };

  const handleProfileSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    setError('');
    setNotice('');
    try {
      await patchJson('/api/customer/profile', {
        phone: profileDraft.phone,
        address: profileDraft.address,
      });
      await loadProfile();
      setNotice('Your contact details were updated.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#1479e8]">Customer portal</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#101c30] dark:text-white">
          Welcome back, {profile?.full_name ?? 'customer'}
        </h1>
        <p className="mt-2 text-sm text-[#66758b] dark:text-slate-400">
          A live view of your vehicles, repair progress, workshop updates and recorded payments.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Registered vehicles', value: dashboard?.summary.total_vehicles ?? 0, icon: CarFront },
          { label: 'Active repair jobs', value: dashboard?.summary.active_jobs ?? 0, icon: Wrench },
          { label: 'Completed repairs', value: dashboard?.summary.completed_repairs ?? 0, icon: CheckCircle2 },
          { label: 'Pending payments', value: formatAmount(dashboard?.summary.pending_payment_cents ?? 0), icon: ReceiptText },
        ].map((card) => (
          <Card key={card.label} className="!p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#8493a8]">{card.label}</p>
                <p className="mt-2 text-2xl font-extrabold text-[#101c30] dark:text-white">{card.value}</p>
              </div>
              <span className="rounded-xl bg-[#39a8ff]/10 p-2.5 text-[#1479e8]"><card.icon className="h-5 w-5" /></span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Card title="Recent repair activity" subtitle="Updates from the existing workshop repair records.">
          {dashboard?.recent_jobs.length ? (
            <div className="space-y-2">
              {dashboard.recent_jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => { setActiveSection('repairs'); setSelectedJobId(job.id); }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#e6edf6] px-4 py-3 text-left transition hover:border-[#39a8ff] dark:border-slate-700"
                >
                  <span>
                    <span className="block text-sm font-bold text-[#101c30] dark:text-white">{job.registration_number} · {job.service_type}</span>
                    <span className="mt-1 block text-xs text-[#66758b] dark:text-slate-400">Job {job.job_no} · Received {formatDate(job.created_at)}</span>
                  </span>
                  <span className="flex items-center gap-2"><StatusPill status={job.repair_status} /><ChevronRight className="h-4 w-4 text-[#8493a8]" /></span>
                </button>
              ))}
            </div>
          ) : <EmptyState icon={Wrench} title="No repair jobs yet" detail="Repair jobs recorded by the workshop will appear here." />}
        </Card>

        <Card title="Recent notifications" subtitle="Latest customer repair updates.">
          {dashboard?.recent_notifications.length ? (
            <ul className="space-y-3">
              {dashboard.recent_notifications.map((notification) => (
                <li key={notification.id} className="rounded-xl border border-[#e6edf6] p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-[#101c30] dark:text-white">{notification.title}</p>
                    {!notification.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-[#1479e8]" />}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#66758b] dark:text-slate-400">{notification.message}</p>
                  <p className="mt-2 text-[11px] text-[#8b99ac]">{formatDate(notification.created_at)}</p>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Bell} title="No notifications yet" detail="Workshop status updates will appear here as they are recorded." />}
        </Card>
      </div>
    </div>
  );

  const renderVehicles = () => (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold text-[#101c30] dark:text-white">My Vehicles</h1>
        <p className="mt-2 text-sm text-[#66758b] dark:text-slate-400">Records linked to your customer profile in the workshop database.</p>
      </div>
      {vehicles.length ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {vehicles.map((vehicle) => (
            <Card key={vehicle.id} title={`${vehicle.make} ${vehicle.model}`} subtitle={`${vehicle.model_year} · ${notRecorded(vehicle.body_style)}`}>
              <div className="mb-4 flex items-center justify-between rounded-xl bg-[#f4f8fd] px-4 py-3 dark:bg-slate-800">
                <span className="text-lg font-extrabold tracking-wide text-[#101c30] dark:text-white">{vehicle.plate}</span>
                <CarFront className="h-5 w-5 text-[#1479e8]" />
              </div>
              <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ['VIN / chassis', vehicle.vin],
                  ['Engine number', vehicle.engine_number],
                  ['Colour', vehicle.color],
                  ['Mileage', vehicle.mileage === null ? null : `${vehicle.mileage.toLocaleString()} km`],
                  ['Engine', vehicle.engine_type],
                  ['Capacity', vehicle.engine_capacity_cc ? `${vehicle.engine_capacity_cc.toLocaleString()} cc` : null],
                  ['Fuel', vehicle.fuel_type],
                  ['Transmission', vehicle.transmission_type],
                  ['Drive type', vehicle.drive_type],
                  ['Registered', vehicle.created_at],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#8493a8]">{label}</dt>
                    <dd className="mt-0.5 font-semibold text-[#24344b] dark:text-slate-200">{notRecorded(value)}</dd>
                  </div>
                ))}
              </dl>
              {vehicle.specification_note && (
                <p className="mt-4 rounded-xl bg-[#f8fbff] p-3 text-xs leading-5 text-[#66758b] dark:bg-slate-800 dark:text-slate-400">
                  {vehicle.specification_note}
                </p>
              )}
            </Card>
          ))}
        </div>
      ) : <Card><EmptyState icon={CarFront} title="No vehicles registered" detail="When the workshop registers a vehicle under your profile, it will appear here." /></Card>}
    </div>
  );

  const renderRepairs = () => (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-[#101c30] dark:text-white">Track Repairs</h1>
          <p className="mt-2 text-sm text-[#66758b] dark:text-slate-400">Live repair stages taken from the workshop’s existing status records. Refreshes every 20 seconds.</p>
        </div>
        <button type="button" onClick={() => void loadSection('repairs')} className="inline-flex items-center gap-2 rounded-xl border border-[#dce5ef] bg-white px-4 py-2 text-sm font-bold text-[#26374e] dark:border-slate-700 dark:bg-slate-900 dark:text-white">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {jobs.length ? (
        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <Card className="!p-3">
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${selectedJobId === job.id
                    ? 'border-[#39a8ff] bg-[#f0f8ff] dark:bg-sky-500/10'
                    : 'border-transparent hover:border-[#dce5ef] dark:hover:border-slate-700'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-[#101c30] dark:text-white">{job.registration_number}</span>
                    <StatusPill status={job.repair_status} />
                  </div>
                  <p className="mt-1 text-xs font-semibold text-[#26374e] dark:text-slate-300">{job.service_type}</p>
                  <p className="mt-1 text-[11px] text-[#8493a8]">Job {job.job_no} · {formatDate(job.created_at)}</p>
                </button>
              ))}
            </div>
          </Card>

          {jobDetail ? (
            <div className="space-y-5">
              <Card title={`Job ${jobDetail.job.job_no} · ${jobDetail.job.registration_number}`} subtitle={`${jobDetail.job.make} ${jobDetail.job.model} · ${jobDetail.job.service_type}`}>
                <StageProgress stageIndex={jobDetail.job.stage_index} />
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Current status', jobDetail.job.stage],
                    ['Reported problem', jobDetail.job.issue_description],
                    ['Assigned mechanic', jobDetail.job.assigned_mechanic_name],
                    ['Priority', jobDetail.job.repair_priority],
                    ['Date received', jobDetail.job.created_at],
                    ['Expected completion', jobDetail.job.promised_at],
                    ['Parts recorded', formatAmount(jobDetail.job.parts_charges_cents)],
                    ['Recorded total', jobDetail.job.final_amount_cents === null ? 'Not recorded' : formatAmount(jobDetail.job.final_amount_cents)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-[#f8fbff] p-3 dark:bg-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#8493a8]">{label}</p>
                      <p className="mt-1 text-sm font-semibold leading-5 text-[#24344b] dark:text-slate-200">{notRecorded(value)}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card title="Repair timeline" subtitle="Status changes and customer-safe workshop updates.">
                  {jobDetail.timeline.length ? (
                    <ol className="space-y-4 border-l-2 border-[#cfe4fa] pl-4">
                      {jobDetail.timeline.map((entry, index) => (
                        <li key={`${entry.kind}-${entry.at}-${index}`} className="relative">
                          <span className="absolute -left-[6px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[#39a8ff]" />
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-[#101c30] dark:text-white">{entry.title}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-300">{entry.kind}</span>
                          </div>
                          <p className="mt-1 text-xs text-[#8493a8]">{formatDate(entry.at)}{entry.actor ? ` · ${entry.actor}` : ''}</p>
                          {entry.detail && <p className="mt-2 text-sm leading-6 text-[#52627a] dark:text-slate-300">{entry.detail}</p>}
                        </li>
                      ))}
                    </ol>
                  ) : <EmptyState icon={Clock3} title="No updates recorded" detail="Status changes will appear here when the workshop updates this job." />}
                </Card>

                <Card title="Parts used" subtitle="Only parts actually issued against this repair job.">
                  {jobDetail.parts.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-[11px] uppercase text-[#8493a8]"><tr><th className="py-2">Part</th><th>Qty</th><th>Unit amount</th></tr></thead>
                        <tbody className="divide-y divide-[#edf2f8] dark:divide-slate-700">
                          {jobDetail.parts.map((part) => (
                            <tr key={part.id}>
                              <td className="py-2 font-semibold text-[#24344b] dark:text-slate-200">{part.part_name}<span className="block text-[11px] text-[#8493a8]">{part.part_number}</span></td>
                              <td>{part.quantity}</td>
                              <td>{formatAmount(part.unit_price_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <EmptyState icon={Package} title="No parts issued" detail="Issued spare parts will appear here when recorded by the workshop." />}
                </Card>
              </div>
            </div>
          ) : <Card><LoadingBlock label="Loading repair details…" /></Card>}
        </div>
      ) : <Card><EmptyState icon={Wrench} title="No repair jobs" detail="Active and completed repair jobs linked to your vehicles will appear here." /></Card>}
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-[#101c30] dark:text-white">Service History</h1>
          <p className="mt-2 text-sm text-[#66758b] dark:text-slate-400">Completed and collected repair records from your registered vehicles.</p>
        </div>
        <label className="text-xs font-bold text-[#52627a] dark:text-slate-300">
          Vehicle
          <select value={historyVehicleId} onChange={(event) => setHistoryVehicleId(event.target.value)} className="mt-1 block rounded-xl border border-[#dce5ef] bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
            <option value="">All vehicles</option>
            {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.plate}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>)}
          </select>
        </label>
      </div>

      {filteredHistory.length ? (
        <div className="space-y-4">
          {filteredHistory.map((record) => (
            <Card key={record.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-extrabold text-[#101c30] dark:text-white">{record.service_type}</p>
                  <p className="mt-1 text-xs text-[#8493a8]">Job {record.job_no} · {record.registration_number} · {record.make} {record.model}</p>
                </div>
                <StatusPill status={record.repair_status} />
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Service date', record.service_date],
                  ['Completed', record.completed_at],
                  ['Mechanic', record.assigned_mechanic_name],
                  ['Reported fault', record.issue_description],
                  ['Work performed', record.work_performed],
                  ['Parts used', record.parts_summary],
                  ['Parts amount', formatAmount(record.parts_charges_cents)],
                  ['Final / estimated total', record.final_amount_cents === null ? formatAmount(record.estimated_total_cost_cents) : formatAmount(record.final_amount_cents)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-[#f8fbff] p-3 dark:bg-slate-800">
                    <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#8493a8]">{label}</p>
                    <p className="mt-1 text-sm font-semibold leading-5 text-[#24344b] dark:text-slate-200">{notRecorded(value)}</p>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : <Card><EmptyState icon={History} title="No completed service records" detail="Completed repairs will be listed here once the workshop records a final repair status." /></Card>}
    </div>
  );

  const renderBilling = () => (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold text-[#101c30] dark:text-white">Invoices & Payments</h1>
        <p className="mt-2 text-sm text-[#66758b] dark:text-slate-400">
          Only recorded payment rows and amounts already stored on repair jobs are shown. Amounts are displayed in workshop currency units.
        </p>
      </div>

      {billing?.invoices.length ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {billing.invoices.map((invoice) => (
            <Card
              key={invoice.job_id}
              title={invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : `Job ${invoice.job_no} charges`}
              subtitle={`Job ${invoice.job_no} · ${invoice.registration_number}`}
            >
              <div className="mb-4 flex items-center justify-between">
                <StatusPill status={invoice.payment_status} />
                <span className="text-xs text-[#8493a8]">{invoice.total_source}</span>
              </div>
              <dl className="space-y-2 text-sm">
                {[
                  ['Service charges', invoice.service_charges_cents],
                  ['Spare parts charges', invoice.spare_parts_charges_cents],
                  ['Total amount', invoice.total_amount_cents],
                  ['Amount paid', invoice.amount_paid_cents],
                  ['Outstanding balance', invoice.outstanding_cents],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-[#f0f4f9] pb-2 dark:border-slate-800">
                    <dt className="text-[#66758b] dark:text-slate-400">{label}</dt>
                    <dd className="font-extrabold text-[#101c30] dark:text-white">{formatAmount(value as number)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>
      ) : <Card><EmptyState icon={ReceiptText} title="No recorded invoices" detail="Invoices appear here only when a payment record has been entered against one of your repair jobs." /></Card>}

      <Card title="Payment history" subtitle="Actual payment records only.">
        {billing?.payments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase text-[#8493a8]"><tr><th className="py-2">Invoice</th><th>Job</th><th>Method</th><th>Status</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-[#edf2f8] dark:divide-slate-700">
                {billing.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-2 font-semibold">{payment.invoice_number}</td>
                    <td>{payment.job_no || 'Not recorded'}</td>
                    <td>{payment.payment_method}</td>
                    <td><StatusPill status={payment.status} /></td>
                    <td>{formatDate(payment.paid_at ?? payment.created_at)}</td>
                    <td className="text-right font-bold">{formatAmount(payment.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={ReceiptText} title="No payment records" detail="Payments entered by the workshop will appear here." />}
      </Card>
    </div>
  );

  const renderNotifications = () => (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-[#101c30] dark:text-white">Notifications</h1>
          <p className="mt-2 text-sm text-[#66758b] dark:text-slate-400">{unreadCount} unread repair update{unreadCount === 1 ? '' : 's'}.</p>
        </div>
        <button type="button" onClick={() => void handleMarkAllRead()} disabled={unreadCount === 0} className="rounded-xl bg-[#1479e8] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          Mark all as read
        </button>
      </div>

      {notifications.length ? (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <Card key={notification.id} className={notification.is_read ? '' : 'border-l-4 border-l-[#39a8ff]'}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-extrabold text-[#101c30] dark:text-white">{notification.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[#52627a] dark:text-slate-300">{notification.message}</p>
                  <p className="mt-2 text-xs text-[#8493a8]">{formatDate(notification.created_at)}</p>
                </div>
                {!notification.is_read && (
                  <button type="button" onClick={() => void handleMarkRead(notification.id)} className="rounded-lg border border-[#dce5ef] px-3 py-1.5 text-xs font-bold text-[#1479e8] dark:border-slate-700">
                    Mark as read
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : <Card><EmptyState icon={Bell} title="No notifications" detail="Repair status updates generated by the workshop will appear here." /></Card>}
    </div>
  );

  const renderProfile = () => (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <Card title="Account details" subtitle="Identity is supplied by your workshop record and cannot be changed here.">
        <dl className="space-y-4 text-sm">
          {[
            ['Username', profile?.username],
            ['Full name', profile?.full_name],
            ['Email', profile?.email ?? profile?.account_email],
            ['Phone', profile?.phone],
            ['Address', profile?.address],
            ['Customer since', profile?.created_at],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#8493a8]">{label}</dt>
              <dd className="mt-1 font-semibold text-[#24344b] dark:text-slate-200">{notRecorded(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#f0f8ff] p-3 text-xs leading-5 text-[#52627a] dark:bg-slate-800 dark:text-slate-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1479e8]" />
          You can only view and edit your own customer record. Email and username changes require workshop administration.
        </div>
      </Card>

      <Card title="Edit contact details" subtitle="Only phone number and address may be changed from the customer portal.">
        <form onSubmit={handleProfileSave} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#26374e] dark:text-slate-200">Phone number</span>
            <span className="relative block">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8493a8]" />
              <input value={profileDraft.phone} onChange={(event) => setProfileDraft((draft) => ({ ...draft, phone: event.target.value }))} className="w-full rounded-xl border border-[#dce5ef] bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-[#2794f4] dark:border-slate-700 dark:bg-slate-900 dark:text-white" placeholder="Registered phone number" />
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#26374e] dark:text-slate-200">Address</span>
            <span className="relative block">
              <MapPin className="absolute left-3 top-3 h-4 w-4 text-[#8493a8]" />
              <textarea value={profileDraft.address} onChange={(event) => setProfileDraft((draft) => ({ ...draft, address: event.target.value }))} rows={4} className="w-full rounded-xl border border-[#dce5ef] bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-[#2794f4] dark:border-slate-700 dark:bg-slate-900 dark:text-white" placeholder="Address recorded with the workshop" />
            </span>
          </label>
          <button type="submit" disabled={savingProfile} className="inline-flex items-center gap-2 rounded-xl bg-[#0b1c34] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#132b4b] disabled:opacity-60">
            {savingProfile ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save changes
          </button>
        </form>
      </Card>
    </div>
  );

  const sectionContent: Record<PortalSection, () => React.ReactElement> = {
    dashboard: renderDashboard,
    vehicles: renderVehicles,
    repairs: renderRepairs,
    history: renderHistory,
    billing: renderBilling,
    notifications: renderNotifications,
    profile: renderProfile,
  };

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-[#111827] dark:bg-slate-950 dark:text-slate-100">
      <header className="bg-[#081426] text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#39a8ff] text-[#081426]"><Gauge className="h-5 w-5" /></span>
            <div>
              <p className="text-lg font-extrabold tracking-[0.1em]">NEXTGEN</p>
              <p className="text-[11px] font-semibold text-[#9fb6d2]">Customer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-right text-xs text-[#aebed3] sm:block">
              Signed in as<br /><strong className="text-white">{profile?.full_name ?? 'Customer'}</strong>
            </span>
            <button type="button" onClick={() => void onLogout()} className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </div>
        <nav aria-label="Customer portal" className="mx-auto max-w-7xl overflow-x-auto px-2 pb-2 sm:px-4">
          <ul className="flex min-w-max gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={`flex items-center gap-2 rounded-t-xl px-3 py-2.5 text-xs font-bold transition ${activeSection === item.key
                    ? 'bg-white text-[#0b1c34] dark:bg-slate-900 dark:text-white'
                    : 'text-[#aebed3] hover:bg-white/5 hover:text-white'}`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                  {item.key === 'notifications' && unreadCount > 0 && (
                    <span className="rounded-full bg-[#1479e8] px-1.5 py-0.5 text-[10px] text-white">{unreadCount}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</div>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
        {loading ? <Card><LoadingBlock /></Card> : sectionContent[activeSection]()}
      </div>

      <footer className="border-t border-[#e1e8f1] bg-white px-4 py-5 text-center text-xs font-medium text-[#8493a8] dark:border-slate-800 dark:bg-slate-900">
        <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Secure customer access · Driving Excellence Through Smart Vehicle Care.</span>
      </footer>
    </main>
  );
};
