import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
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
type RepairPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

interface RepairJob {
  id: string;
  repair_job_code: string;
  tracking_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  vehicle_id: string;
  vehicle_code: string | null;
  registration_number: string;
  make: string;
  model: string;
  manufacturing_year: number;
  service_type: string;
  reported_problem: string;
  inspection_notes: string | null;
  repair_status: RepairStatus;
  repair_priority: RepairPriority;
  bay: string | null;
  assigned_technician: string | null;
  assigned_mechanic_id: string | null;
  assigned_mechanic_name: string | null;
  estimated_labour_cost_cents: number;
  estimated_parts_cost_cents: number;
  estimated_total_cost_cents: number;
  expected_completion_date: string | null;
  additional_notes: string | null;
  date_received: string;
}

interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone_number: string;
  email: string | null;
}

interface Vehicle {
  id: string;
  vehicle_code: string;
  registration_number: string;
  make: string;
  model: string;
  manufacturing_year: number;
}

interface Mechanic {
  id: string;
  name: string;
}

interface RepairHistory {
  statusHistory: {
    id: string;
    previous_status: RepairStatus | null;
    new_status: RepairStatus;
    note: string | null;
    changed_by_name: string;
    changed_at: string;
  }[];
  activities: {
    id: string;
    work_performed: string | null;
    inspection_findings: string | null;
    problems_identified: string | null;
    recommendations: string | null;
    additional_work_required: string | null;
    internal_notes: string | null;
    created_by_name: string;
    created_at: string;
  }[];
  assignments: {
    id: string;
    mechanic_name: string;
    assigned_by_name: string;
    assigned_at: string;
    unassigned_at: string | null;
  }[];
}

interface RepairPart {
  id: string;
  part_id: string;
  part_name: string;
  part_number: string;
  quantity: number;
  unit_price_cents: number;
}

interface InventoryPartOption {
  id: string;
  name: string;
  part_number: string;
  quantity: number;
}

interface RepairSummary {
  total_repair_jobs: number;
  newly_received: number;
  awaiting_inspection: number;
  in_progress: number;
  awaiting_spare_parts: number;
  completed_repairs: number;
  ready_for_collection: number;
}

interface RepairResponse<T> {
  records?: T[];
  record?: T;
  total?: number;
  summary?: RepairSummary;
  statusHistory?: RepairHistory['statusHistory'];
  activities?: RepairHistory['activities'];
  assignments?: RepairHistory['assignments'];
  error?: string;
  message?: string;
}

interface RepairForm {
  service_type: string;
  reported_problem: string;
  repair_priority: RepairPriority;
  expected_completion_date: string;
  estimated_labour_cost: string;
  estimated_parts_cost: string;
  inspection_notes: string;
  additional_notes: string;
  assigned_mechanic_id: string;
  bay: string;
}

const STATUSES: RepairStatus[] = [
  'Received',
  'Awaiting Inspection',
  'Under Inspection',
  'Awaiting Customer Approval',
  'Approved',
  'In Progress',
  'Awaiting Spare Parts',
  'Repair Completed',
  'Ready for Collection',
  'Collected',
];
const PRIORITIES: RepairPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
const SERVICE_TYPES = [
  'General Servicing',
  'Engine Repair',
  'Brake System Repair',
  'Suspension Repair',
  'Electrical Repair',
  'Transmission Repair',
  'Tyre and Wheel Service',
  'Other',
];
const NEXT_STATUSES: Record<RepairStatus, RepairStatus[]> = {
  Received: ['Awaiting Inspection'],
  'Awaiting Inspection': ['Under Inspection', 'Awaiting Customer Approval', 'Approved'],
  'Under Inspection': ['Awaiting Customer Approval', 'Approved'],
  'Awaiting Customer Approval': ['Approved'],
  Approved: ['In Progress'],
  'In Progress': ['Awaiting Spare Parts', 'Repair Completed'],
  'Awaiting Spare Parts': ['In Progress', 'Repair Completed'],
  'Repair Completed': ['Ready for Collection', 'In Progress'],
  'Ready for Collection': ['Collected', 'In Progress'],
  Collected: [],
};
const TECHNICIAN_STATUSES = new Set<RepairStatus>([
  'Under Inspection',
  'In Progress',
  'Awaiting Spare Parts',
  'Repair Completed',
]);
const PAGE_SIZE = 10;

const EMPTY_FORM: RepairForm = {
  service_type: SERVICE_TYPES[0],
  reported_problem: '',
  repair_priority: 'Normal',
  expected_completion_date: '',
  estimated_labour_cost: '',
  estimated_parts_cost: '',
  inspection_notes: '',
  additional_notes: '',
  assigned_mechanic_id: '',
  bay: '',
};

function getError<T>(result: RepairResponse<T>, fallback: string): string {
  return result.message ?? result.error ?? fallback;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Not set'
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value / 100);
}

function toInputDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function statusStyle(status: RepairStatus): string {
  if (status === 'Collected' || status === 'Ready for Collection') {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900';
  }
  if (status === 'In Progress') {
    return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900';
  }
  if (status === 'Awaiting Spare Parts' || status === 'Awaiting Customer Approval') {
    return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900';
  }
  return 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700';
}

function toCents(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) return Number.NaN;
  return Math.round(parsed * 100);
}

interface ServiceRepairManagementViewProps {
  initialJobId?: string | null;
  onInitialJobHandled?: () => void;
  openCreate?: boolean;
  onOpenCreateHandled?: () => void;
}

export const ServiceRepairManagementView: React.FC<ServiceRepairManagementViewProps> = ({
  initialJobId,
  onInitialJobHandled,
  openCreate,
  onOpenCreateHandled,
}) => {
  const [records, setRecords] = useState<RepairJob[]>([]);
  const [summary, setSummary] = useState<RepairSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sort, setSort] = useState('date_received');
  const [ascending, setAscending] = useState(false);
  const [role, setRole] = useState('');
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RepairJob | null>(null);
  const [form, setForm] = useState<RepairForm>(EMPTY_FORM);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<RepairJob | null>(null);
  const [history, setHistory] = useState<RepairHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activityText, setActivityText] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [issuedParts, setIssuedParts] = useState<RepairPart[]>([]);
  const [inventoryParts, setInventoryParts] = useState<InventoryPartOption[]>([]);
  const [selectedPartId, setSelectedPartId] = useState('');
  const [partQuantity, setPartQuantity] = useState('1');
  const [partsBusy, setPartsBusy] = useState(false);

  const canManage = ['owner', 'manager', 'advisor'].includes(role);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectableStatuses = selected
    ? NEXT_STATUSES[selected.repair_status].filter((status) => canManage || TECHNICIAN_STATUSES.has(status))
    : [];

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sort,
        order: ascending ? 'asc' : 'desc',
      });
      if (query.trim()) params.set('q', query.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      const response = await apiFetch(`/api/repairs?${params}`);
      const result = await response.json() as RepairResponse<RepairJob> & { summary?: RepairSummary };
      if (!response.ok) throw new Error(getError(result, 'Could not load repair jobs.'));
      setRecords(result.records ?? []);
      setTotal(result.total ?? 0);
      setSummary(result.summary ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load repair jobs.');
    } finally {
      setLoading(false);
    }
  }, [ascending, page, priorityFilter, query, sort, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(), query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadRecords, query]);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(async (response) => {
        const result = await response.json() as { user?: { role?: string } };
        if (response.ok) setRole(result.user?.role ?? '');
      })
      .catch(() => setRole(''));
  }, []);

  useEffect(() => {
    if (!role || role === 'technician') return;
    apiFetch('/api/repairs/mechanics')
      .then(async (response) => {
        const result = await response.json() as RepairResponse<Mechanic>;
        if (!response.ok) throw new Error(getError(result, 'Could not load mechanic accounts.'));
        setMechanics(result.records ?? []);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load mechanic accounts.');
      });
  }, [role]);

  useEffect(() => {
    if (!formOpen || editing || customerQuery.trim().length < 2) {
      setCustomers([]);
      return;
    }
    let active = true;
    setPickerLoading(true);
    const timer = window.setTimeout(() => {
      apiFetch(`/api/customers/search?q=${encodeURIComponent(customerQuery.trim())}`)
        .then(async (response) => {
          const result = await response.json() as RepairResponse<Customer>;
          if (!response.ok) throw new Error(getError(result, 'Could not search customers.'));
          if (active) setCustomers(result.records ?? []);
        })
        .catch((loadError: unknown) => {
          if (active) setFormError(loadError instanceof Error ? loadError.message : 'Could not search customers.');
        })
        .finally(() => {
          if (active) setPickerLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerQuery, editing, formOpen]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCustomerQuery('');
    setSelectedCustomer(null);
    setVehicles([]);
    setVehicleId('');
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (record: RepairJob) => {
    setEditing(record);
    setForm({
      service_type: record.service_type,
      reported_problem: record.reported_problem,
      repair_priority: record.repair_priority,
      expected_completion_date: toInputDate(record.expected_completion_date),
      estimated_labour_cost: (record.estimated_labour_cost_cents / 100).toFixed(2),
      estimated_parts_cost: (record.estimated_parts_cost_cents / 100).toFixed(2),
      inspection_notes: record.inspection_notes ?? '',
      additional_notes: record.additional_notes ?? '',
      assigned_mechanic_id: record.assigned_mechanic_id ?? '',
      bay: record.bay ?? '',
    });
    setFormError('');
    setFormOpen(true);
  };

  const chooseCustomer = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerQuery(customer.full_name);
    setCustomers([]);
    setVehicleId('');
    setPickerLoading(true);
    setFormError('');
    try {
      const response = await apiFetch(`/api/customers/${encodeURIComponent(customer.id)}/vehicles`);
      const result = await response.json() as RepairResponse<Vehicle>;
      if (!response.ok) throw new Error(getError(result, 'Could not load this customer’s vehicles.'));
      setVehicles(result.records ?? []);
    } catch (loadError) {
      setFormError(loadError instanceof Error ? loadError.message : 'Could not load this customer’s vehicles.');
    } finally {
      setPickerLoading(false);
    }
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const labourCents = toCents(form.estimated_labour_cost);
    const partsCents = toCents(form.estimated_parts_cost);
    if (Number.isNaN(labourCents) || Number.isNaN(partsCents)) {
      setFormError('Estimated amounts must be valid non-negative amounts no greater than $1,000,000.');
      setSaving(false);
      return;
    }
    const payload: Record<string, unknown> = {
      service_type: form.service_type,
      reported_problem: form.reported_problem,
      repair_priority: form.repair_priority,
      expected_completion_date: form.expected_completion_date || null,
      estimated_labour_cost_cents: labourCents ?? 0,
      estimated_parts_cost_cents: partsCents ?? 0,
      inspection_notes: form.inspection_notes || null,
      additional_notes: form.additional_notes || null,
      assigned_mechanic_id: form.assigned_mechanic_id || null,
      bay: form.bay.trim() || null,
    };
    if (!editing) {
      if (!selectedCustomer) {
        setFormError('Select an existing customer before creating a repair job.');
        setSaving(false);
        return;
      }
      if (!vehicleId) {
        setFormError('Select the vehicle being repaired.');
        setSaving(false);
        return;
      }
      payload.customer_id = selectedCustomer.id;
      payload.vehicle_id = vehicleId;
    }
    try {
      const response = await apiFetch(editing ? `/api/repairs/${editing.id}` : '/api/repairs', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as RepairResponse<RepairJob>;
      if (!response.ok) throw new Error(getError(result, 'Could not save this repair job.'));
      setFormOpen(false);
      setSuccess(editing ? 'Repair job updated.' : `Repair job ${result.record?.repair_job_code ?? ''} created.`);
      await loadRecords();
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Could not save this repair job.');
    } finally {
      setSaving(false);
    }
  };

  const openDetails = useCallback(async (record: RepairJob) => {
    setSelected(record);
    setHistory(null);
    setIssuedParts([]);
    setActivityText('');
    setStatusNote('');
    setHistoryLoading(true);
    try {
      const [jobResponse, historyResponse, partsResponse, inventoryResponse] = await Promise.all([
        apiFetch(`/api/repairs/${record.id}`),
        apiFetch(`/api/repairs/${record.id}/history`),
        apiFetch(`/api/repairs/${record.id}/parts`),
        apiFetch('/api/parts?limit=200'),
      ]);
      const [jobResult, historyResult, partsResult, inventoryResult] = await Promise.all([
        jobResponse.json() as Promise<RepairResponse<RepairJob>>,
        historyResponse.json() as Promise<RepairResponse<RepairJob>>,
        partsResponse.json() as Promise<RepairResponse<RepairPart>>,
        inventoryResponse.json() as Promise<RepairResponse<InventoryPartOption>>,
      ]);
      if (!jobResponse.ok) throw new Error(getError(jobResult, 'Could not load repair details.'));
      if (!historyResponse.ok) throw new Error(getError(historyResult, 'Could not load repair history.'));
      if (!partsResponse.ok) throw new Error(getError(partsResult, 'Could not load parts used for this repair.'));
      if (!inventoryResponse.ok) throw new Error(getError(inventoryResult, 'Could not load available inventory.'));
      if (jobResult.record) setSelected(jobResult.record);
      setIssuedParts(partsResult.records ?? []);
      setInventoryParts(inventoryResult.records ?? []);
      setHistory({
        statusHistory: historyResult.statusHistory ?? [],
        activities: historyResult.activities ?? [],
        assignments: historyResult.assignments ?? [],
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load repair details.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const issueRepairPart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !selectedPartId) return;
    setPartsBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/repairs/${selected.id}/parts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ part_id: selectedPartId, quantity: Number(partQuantity) }),
      });
      const result = await response.json() as RepairResponse<RepairPart>;
      if (!response.ok) throw new Error(getError(result, 'Could not issue this part.'));
      setIssuedParts(result.records ?? []);
      setInventoryParts((parts) => parts.map((part) => part.id === selectedPartId
        ? { ...part, quantity: part.quantity - Number(partQuantity) }
        : part));
      setSelectedPartId('');
      setPartQuantity('1');
      setSuccess('Part issued to this repair and stock updated.');
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'Could not issue this part.');
    } finally {
      setPartsBusy(false);
    }
  };

  useEffect(() => {
    if (!initialJobId) return;
    let active = true;
    apiFetch(`/api/repairs/${encodeURIComponent(initialJobId)}`)
      .then(async (response) => {
        const result = await response.json() as RepairResponse<RepairJob>;
        if (!response.ok) throw new Error(getError(result, 'Could not load repair details.'));
        if (active && result.record) await openDetails(result.record);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load repair details.');
        }
      })
      .finally(() => {
        if (active) onInitialJobHandled?.();
      });
    return () => {
      active = false;
    };
  }, [initialJobId, onInitialJobHandled, openDetails]);

  useEffect(() => {
    if (!openCreate) return;
    openNew();
    onOpenCreateHandled?.();
  }, [openCreate, onOpenCreateHandled]);

  const updateStatus = async (nextStatus: RepairStatus) => {
    if (!selected) return;
    setStatusBusy(true);
    try {
      const response = await apiFetch(`/api/repairs/${selected.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, note: statusNote || undefined }),
      });
      const result = await response.json() as RepairResponse<RepairJob>;
      if (!response.ok) throw new Error(getError(result, 'Could not update repair status.'));
      if (result.record) setSelected(result.record);
      setStatusNote('');
      setSuccess(`Status changed to ${nextStatus}.`);
      await Promise.all([loadRecords(), reloadHistory(selected.id)]);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not update repair status.');
    } finally {
      setStatusBusy(false);
    }
  };

  const reloadHistory = async (id: string) => {
    const response = await apiFetch(`/api/repairs/${id}/history`);
    const result = await response.json() as RepairResponse<RepairJob>;
    if (!response.ok) throw new Error(getError(result, 'Could not refresh repair history.'));
    setHistory({
      statusHistory: result.statusHistory ?? [],
      activities: result.activities ?? [],
      assignments: result.assignments ?? [],
    });
  };

  const addActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !activityText.trim()) return;
    setActivityBusy(true);
    try {
      const response = await apiFetch(`/api/repairs/${selected.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_performed: activityText.trim() }),
      });
      const result = await response.json() as RepairResponse<RepairJob>;
      if (!response.ok) throw new Error(getError(result, 'Could not add repair activity.'));
      setActivityText('');
      await reloadHistory(selected.id);
      setSuccess('Repair activity recorded.');
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : 'Could not add repair activity.');
    } finally {
      setActivityBusy(false);
    }
  };

  const statusCounts = useMemo(() => [
    { label: 'Total repair jobs', value: summary?.total_repair_jobs ?? 0, icon: ClipboardList, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50' },
    { label: 'Newly received', value: summary?.newly_received ?? 0, icon: Clock3, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50' },
    { label: 'In progress', value: summary?.in_progress ?? 0, icon: Wrench, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50' },
    { label: 'Ready for collection', value: summary?.ready_for_collection ?? 0, icon: Check, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50' },
  ], [summary]);

  const toggleSort = (field: string) => {
    if (sort === field) setAscending((value) => !value);
    else {
      setSort(field);
      setAscending(false);
    }
  };

  return (
    <section className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400">
            <Wrench className="h-4 w-4" />
            WORKSHOP OPERATIONS
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Service &amp; Repair Management
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Track service jobs, mechanic assignments, repair progress, and workshop history.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New repair job
          </button>
        )}
      </header>

      {success && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess('')} aria-label="Dismiss success message"><X className="h-4 w-4" /></button>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4 shrink-0" /></button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statusCounts.map(({ label, value, icon: Icon, color }) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
              </div>
              <span className={`rounded-xl p-3 ${color}`}><Icon className="h-5 w-5" /></span>
            </div>
          </article>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Repair job records</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{total} records in this view</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(0); }}
                placeholder="Search job, customer, plate…"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>
            <select
              aria-label="Filter by repair status"
              value={statusFilter}
              onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select
              aria-label="Filter by priority"
              value={priorityFilter}
              onChange={(event) => { setPriorityFilter(event.target.value); setPage(0); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">
              <tr>
                {[
                  ['repair_job_code', 'Job / Received'],
                  ['customer_name', 'Customer / Vehicle'],
                  ['service_type', 'Service'],
                  ['assigned_mechanic', 'Mechanic'],
                  ['repair_priority', 'Priority'],
                  ['repair_status', 'Status'],
                  ['expected_completion_date', 'Expected'],
                ].map(([field, label]) => (
                  <th key={field} className="px-4 py-3 font-semibold">
                    <button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1.5 hover:text-blue-600">
                      {label}
                      {sort === field ? (ascending ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-500"><span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" />Loading repair jobs…</span></td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center text-slate-500 dark:text-slate-400">
                    <ClipboardList className="mb-3 h-9 w-9 text-slate-300 dark:text-slate-600" />
                    <p className="font-semibold text-slate-700 dark:text-slate-200">{query || statusFilter || priorityFilter ? 'No matching repair jobs' : 'No repair jobs yet'}</p>
                    <p className="mt-1 text-sm">{query || statusFilter || priorityFilter ? 'Try another search or clear the selected filters.' : 'Create the first repair job to begin tracking workshop work.'}</p>
                    {!query && !statusFilter && !priorityFilter && canManage && (
                      <button type="button" onClick={openNew} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="h-4 w-4" />Create repair job</button>
                    )}
                  </div>
                </td></tr>
              ) : records.map((record) => (
                <tr key={record.id} className="transition hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-4">
                    <button type="button" onClick={() => void openDetails(record)} className="font-semibold text-blue-700 hover:underline dark:text-blue-300">{record.repair_job_code}</button>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(record.date_received)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{record.customer_name}</p>
                    <p className="mt-1 text-xs text-slate-500">{record.registration_number} · {record.manufacturing_year} {record.make} {record.model}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-slate-700 dark:text-slate-200">{record.service_type}</p>
                    <p className="mt-1 max-w-[220px] truncate text-xs text-slate-500">{record.reported_problem}</p>
                  </td>
                  <td className="px-4 py-4 text-slate-600 dark:text-slate-300">{record.assigned_mechanic_name ?? 'Unassigned'}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${record.repair_priority === 'Urgent' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : record.repair_priority === 'High' ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{record.repair_priority}</span>
                  </td>
                  <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyle(record.repair_status)}`}>{record.repair_status}</span></td>
                  <td className="px-4 py-4 text-slate-600 dark:text-slate-300">{formatDate(record.expected_completion_date)}</td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => void openDetails(record)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:text-slate-200" aria-label={`View ${record.repair_job_code}`}>Details</button>
                      {canManage && <button type="button" onClick={() => openEdit(record)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:text-slate-300" aria-label={`Edit ${record.repair_job_code}`}><Pencil className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>{total === 0 ? 'Showing 0 records' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40 dark:border-slate-700" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <span className="tabular-nums">Page {page + 1} of {totalPages}</span>
            <button type="button" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40 dark:border-slate-700" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false); }}>
          <form onSubmit={submitForm} className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900" aria-label={editing ? 'Edit repair job' : 'Create repair job'}>
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
              <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">{editing ? `Edit ${editing.repair_job_code}` : 'Create repair job'}</h2><p className="mt-1 text-sm text-slate-500">Service details, estimates, and assignment.</p></div>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close form"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-5 p-5">
              {formError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{formError}</p>}
              {!editing && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="relative">
                    <label htmlFor="repair-customer" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Customer <span className="text-red-500">*</span></label>
                    <input id="repair-customer" value={customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); setSelectedCustomer(null); setVehicles([]); setVehicleId(''); }} placeholder="Search name, phone, or email" autoComplete="off" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" required />
                    {customers.length > 0 && (
                      <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        {customers.map((customer) => <button key={customer.id} type="button" onClick={() => void chooseCustomer(customer)} className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-blue-50 dark:border-slate-800 dark:hover:bg-slate-800"><UserRound className="mt-0.5 h-4 w-4 text-blue-500" /><span><span className="block text-sm font-medium text-slate-800 dark:text-white">{customer.full_name}</span><span className="text-xs text-slate-500">{customer.phone_number}{customer.email ? ` · ${customer.email}` : ''}</span></span></button>)}
                      </div>
                    )}
                    {selectedCustomer && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Customer selected: {selectedCustomer.customer_code}</p>}
                  </div>
                  <div>
                    <label htmlFor="repair-vehicle" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Vehicle <span className="text-red-500">*</span></label>
                    <select id="repair-vehicle" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} disabled={!selectedCustomer || pickerLoading} required className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:disabled:bg-slate-800">
                      <option value="">{pickerLoading ? 'Loading customer vehicles…' : selectedCustomer ? 'Select vehicle' : 'Select a customer first'}</option>
                      {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration_number} · {vehicle.manufacturing_year} {vehicle.make} {vehicle.model}</option>)}
                    </select>
                    {selectedCustomer && vehicles.length === 0 && !pickerLoading && <p className="mt-1 text-xs text-amber-700">This customer has no registered vehicles yet. Add one in Vehicle Management first.</p>}
                  </div>
                </div>
              )}
              {editing && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">{editing.customer_name} · {editing.registration_number} · {editing.make} {editing.model}</div>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="repair-service" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Service type <span className="text-red-500">*</span></label>
                  <select id="repair-service" value={form.service_type} onChange={(event) => setForm({ ...form, service_type: event.target.value })} required className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">{SERVICE_TYPES.map((service) => <option key={service}>{service}</option>)}</select>
                </div>
                <div>
                  <label htmlFor="repair-priority" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Priority</label>
                  <select id="repair-priority" value={form.repair_priority} onChange={(event) => setForm({ ...form, repair_priority: event.target.value as RepairPriority })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select>
                </div>
              </div>
              <div>
                <label htmlFor="repair-problem" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Reported problem <span className="text-red-500">*</span></label>
                <textarea id="repair-problem" value={form.reported_problem} onChange={(event) => setForm({ ...form, reported_problem: event.target.value })} rows={3} maxLength={4000} required placeholder="Describe the customer's reported issue" className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="repair-mechanic" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Assign mechanic</label>
                  <select id="repair-mechanic" value={form.assigned_mechanic_id} onChange={(event) => setForm({ ...form, assigned_mechanic_id: event.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">Unassigned</option>{mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select>
                </div>
                <div>
                  <label htmlFor="repair-date" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Expected completion</label>
                  <input id="repair-date" type="date" value={form.expected_completion_date} onChange={(event) => setForm({ ...form, expected_completion_date: event.target.value })} min={new Date().toISOString().slice(0, 10)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </div>
                <div>
                  <label htmlFor="repair-bay" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Workshop bay</label>
                  <input id="repair-bay" type="text" maxLength={80} value={form.bay} onChange={(event) => setForm({ ...form, bay: event.target.value })} placeholder="e.g. Bay 1" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  <p className="mt-1 text-xs text-slate-500">Use an existing bay name or add a new one.</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Estimated labour cost
                  <span className="relative mt-1.5 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span><input type="number" min="0" max="1000000" step="0.01" value={form.estimated_labour_cost} onChange={(event) => setForm({ ...form, estimated_labour_cost: event.target.value })} className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-7 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></span>
                </label>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Estimated parts cost
                  <span className="relative mt-1.5 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span><input type="number" min="0" max="1000000" step="0.01" value={form.estimated_parts_cost} onChange={(event) => setForm({ ...form, estimated_parts_cost: event.target.value })} className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-7 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></span>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Inspection notes
                  <textarea rows={2} maxLength={4000} value={form.inspection_notes} onChange={(event) => setForm({ ...form, inspection_notes: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Additional internal notes
                  <textarea rows={2} maxLength={4000} value={form.additional_notes} onChange={(event) => setForm({ ...form, additional_notes: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{editing ? 'Save changes' : 'Create repair job'}</button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-label={`Repair job ${selected.repair_job_code}`}>
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-900 dark:text-white">{selected.repair_job_code}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyle(selected.repair_status)}`}>{selected.repair_status}</span></div><p className="mt-1 text-sm text-slate-500">Tracking number: {selected.tracking_number}</p></div>
              <div className="flex gap-2">
                {canManage && <button type="button" onClick={() => { setSelected(null); openEdit(selected); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-blue-300 dark:border-slate-700 dark:text-slate-200"><Pencil className="h-4 w-4" />Edit</button>}
                <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close details"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="grid gap-6 p-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</p><p className="mt-2 font-semibold text-slate-900 dark:text-white">{selected.customer_name}</p><p className="mt-1 text-sm text-slate-500">{selected.customer_phone ?? 'No phone'}{selected.customer_email ? ` · ${selected.customer_email}` : ''}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle</p><p className="mt-2 font-semibold text-slate-900 dark:text-white">{selected.registration_number}</p><p className="mt-1 text-sm text-slate-500">{selected.manufacturing_year} {selected.make} {selected.model}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</p><p className="mt-2 font-semibold text-slate-900 dark:text-white">{selected.service_type}</p><p className="mt-1 text-sm text-slate-500">Priority: {selected.repair_priority}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned mechanic</p><p className="mt-2 font-semibold text-slate-900 dark:text-white">{selected.assigned_mechanic_name ?? 'Unassigned'}</p><p className="mt-1 text-sm text-slate-500">Received {formatDate(selected.date_received)}</p></div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Reported problem</h3>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 p-3 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:text-slate-300">{selected.reported_problem}</p>
                </div>
                <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Parts used</h3><p className="mt-1 text-xs text-slate-500">Issuing a part deducts available stock immediately.</p></div>
                    <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{issuedParts.reduce((total, part) => total + part.quantity, 0)} units</span>
                  </div>
                  {issuedParts.length > 0 && <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{issuedParts.map((part) => <div key={part.id} className="flex items-center justify-between gap-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{part.part_name}</p><p className="text-xs text-slate-500">{part.part_number} · {formatMoney(part.unit_price_cents)} each</p></div><span className="shrink-0 text-sm font-semibold text-slate-800 dark:text-slate-200">× {part.quantity}</span></div>)}</div>}
                  {issuedParts.length === 0 && <p className="mt-3 text-sm text-slate-500">No parts issued to this repair yet.</p>}
                  {(canManage || role === 'technician') && <form onSubmit={issueRepairPart} className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row">
                    <select aria-label="Part to issue" value={selectedPartId} onChange={(event) => setSelectedPartId(event.target.value)} required className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">Select available part</option>{inventoryParts.filter((part) => part.quantity > 0).map((part) => <option key={part.id} value={part.id}>{part.name} · {part.part_number} · {part.quantity} available</option>)}</select>
                    <input aria-label="Part quantity" type="number" min="1" max="1000000" step="1" value={partQuantity} onChange={(event) => setPartQuantity(event.target.value)} required className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white sm:w-24" />
                    <button type="submit" disabled={partsBusy || !selectedPartId} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{partsBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Issue part</button>
                  </form>}
                </section>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs text-slate-500">Labour estimate</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatMoney(selected.estimated_labour_cost_cents)}</p></div>
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs text-slate-500">Parts estimate</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatMoney(selected.estimated_parts_cost_cents)}</p></div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900 dark:bg-blue-950/30"><p className="text-xs text-blue-700 dark:text-blue-300">Total estimate</p><p className="mt-1 font-bold text-blue-800 dark:text-blue-200">{formatMoney(selected.estimated_total_cost_cents)}</p></div>
                </div>
                {(selected.inspection_notes || selected.additional_notes) && <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Workshop notes</h3>{selected.inspection_notes && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300"><strong>Inspection:</strong> {selected.inspection_notes}</p>}{selected.additional_notes && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300"><strong>Additional:</strong> {selected.additional_notes}</p>}</div>}
                {(canManage || role === 'technician') && (
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Update repair status</h3>
                    {selectableStatuses.length ? (
                      <div className="mt-3 space-y-3">
                        <input value={statusNote} onChange={(event) => setStatusNote(event.target.value)} maxLength={2000} placeholder="Optional status update note" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                        <div className="flex flex-wrap gap-2">{selectableStatuses.map((nextStatus) => <button key={nextStatus} type="button" disabled={statusBusy} onClick={() => void updateStatus(nextStatus)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{statusBusy ? 'Updating…' : `Move to ${nextStatus}`}</button>)}</div>
                      </div>
                    ) : <p className="mt-2 text-sm text-slate-500">{NEXT_STATUSES[selected.repair_status].length ? 'No status transitions are available for this role.' : 'This repair job is in its final status.'}</p>}
                  </div>
                )}
              </div>
              <div className="space-y-5">
                <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Repair activity</h3>
                  {role === 'technician' || canManage ? (
                    <form onSubmit={addActivity} className="mt-3 space-y-2">
                      <textarea value={activityText} onChange={(event) => setActivityText(event.target.value)} maxLength={4000} rows={3} placeholder="Record work performed or findings" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      <button type="submit" disabled={activityBusy || !activityText.trim()} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-blue-600">{activityBusy ? 'Saving…' : 'Add activity'}</button>
                    </form>
                  ) : null}
                  {historyLoading ? <p className="mt-4 inline-flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading history…</p> : (
                    <div className="mt-4 space-y-4">
                      {(history?.activities ?? []).length === 0 ? <p className="text-sm text-slate-500">No repair activities recorded.</p> : history?.activities.map((activity) => <article key={activity.id} className="border-l-2 border-blue-300 pl-3 dark:border-blue-800"><p className="text-sm text-slate-800 dark:text-slate-200">{activity.work_performed ?? activity.inspection_findings ?? activity.internal_notes}</p><p className="mt-1 text-xs text-slate-500">{activity.created_by_name} · {formatDate(activity.created_at)}</p></article>)}
                    </div>
                  )}
                </section>
                <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Status history</h3>
                  <div className="mt-3 space-y-4">
                    {(history?.statusHistory ?? []).length === 0 && !historyLoading ? <p className="text-sm text-slate-500">No status updates recorded.</p> : history?.statusHistory.map((entry) => <article key={entry.id} className="relative border-l border-slate-200 pl-4 dark:border-slate-700"><span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-blue-500" /><p className="text-sm font-medium text-slate-800 dark:text-slate-200">{entry.previous_status ? `${entry.previous_status} → ` : ''}{entry.new_status}</p><p className="mt-1 text-xs text-slate-500">{entry.changed_by_name} · {formatDate(entry.changed_at)}</p>{entry.note && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{entry.note}</p>}</article>)}
                  </div>
                </section>
                {(history?.assignments ?? []).length > 0 && (
                  <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Mechanic assignment history</h3>
                    <div className="mt-3 space-y-3">{history?.assignments.map((entry) => <p key={entry.id} className="text-sm text-slate-700 dark:text-slate-300"><span className="font-medium">{entry.mechanic_name}</span><span className="block text-xs text-slate-500">Assigned by {entry.assigned_by_name} · {formatDate(entry.assigned_at)}{entry.unassigned_at ? ` · reassigned ${formatDate(entry.unassigned_at)}` : ''}</span></p>)}</div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
