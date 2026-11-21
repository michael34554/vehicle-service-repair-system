import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  LoaderCircle,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Truck,
  X,
} from 'lucide-react';
import { apiFetch } from '../../api';

type InventoryTab = 'overview' | 'parts' | 'suppliers' | 'movement' | 'reports';
type ReportType = 'inventory' | 'low_stock' | 'out_of_stock' | 'stock_movement';
type TransactionType = 'purchase' | 'repair_issue' | 'damage' | 'return' | 'adjustment';

interface Part {
  id: string;
  part_number: string;
  name: string;
  category: string;
  description: string | null;
  quantity: number;
  minimum_stock: number;
  purchase_price_cents: number;
  selling_price_cents: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_name_legacy?: string | null;
}

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

interface Movement {
  id: string;
  transaction_type: TransactionType;
  quantity_delta: number;
  transaction_at: string;
  responsible_name: string;
  part_name: string;
  part_number: string;
  repair_job_code: string | null;
  registration_number: string | null;
  note?: string | null;
}

interface InventoryResult<T> {
  records?: T[];
  record?: T;
  total?: number;
  categories?: string[];
  summary?: {
    total_parts: number;
    total_stock: number;
    low_stock_items: number;
    out_of_stock_items: number;
    parts_used: number;
  };
  recent?: Movement[];
  error?: string;
  message?: string;
}

interface PartForm {
  part_number: string;
  name: string;
  category: string;
  description: string;
  purchase_price: string;
  selling_price: string;
  minimum_stock: string;
  initial_stock: string;
  supplier_id: string;
}

interface SupplierForm {
  name: string;
  phone: string;
  email: string;
  address: string;
}

const EMPTY_PART: PartForm = {
  part_number: '', name: '', category: 'General', description: '', purchase_price: '',
  selling_price: '', minimum_stock: '0', initial_stock: '0', supplier_id: '',
};
const EMPTY_SUPPLIER: SupplierForm = { name: '', phone: '', email: '', address: '' };
const PAGE_SIZE = 100;

function errorMessage(result: InventoryResult<unknown>, fallback: string): string {
  return result.message ?? result.error ?? fallback;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown' : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function stockStatus(part: Part): { label: string; className: string } {
  if (part.quantity === 0) return { label: 'Out of stock', className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' };
  if (part.quantity <= part.minimum_stock) return { label: 'Low stock', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' };
  return { label: 'In stock', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' };
}

const TRANSACTION_LABELS: Record<TransactionType, string> = {
  purchase: 'Stock received', repair_issue: 'Repair issue', damage: 'Damaged', return: 'Returned', adjustment: 'Adjustment',
};

export const InventoryManagementView: React.FC = () => {
  const [tab, setTab] = useState<InventoryTab>('overview');
  const [parts, setParts] = useState<Part[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [summary, setSummary] = useState<InventoryResult<Part>['summary']>();
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const [totalParts, setTotalParts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [partOpen, setPartOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [detail, setDetail] = useState<Part | null>(null);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [partForm, setPartForm] = useState<PartForm>(EMPTY_PART);
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(EMPTY_SUPPLIER);
  const [movementForm, setMovementForm] = useState({ part_id: '', transaction_type: 'purchase' as Exclude<TransactionType, 'repair_issue'>, quantity: '1', note: '', transaction_at: '' });
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState('');
  const canManage = ['owner', 'manager', 'advisor'].includes(role);
  const [reportType, setReportType] = useState<ReportType>('inventory');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<InventoryResult<T>> => {
    const response = await apiFetch(url, init);
    if (response.status === 204) return {} as InventoryResult<T>;
    const result = await response.json() as InventoryResult<T>;
    if (!response.ok) throw new Error(errorMessage(result, 'The inventory request could not be completed.'));
    return result;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (query.trim()) params.set('q', query.trim());
    if (stockFilter) params.set('stock', stockFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    try {
      const [dashboard, partResult, supplierResult, movementResult] = await Promise.all([
        request<Part>('/api/inventory/dashboard'),
        request<Part>(`/api/parts?${params}`),
        request<Supplier>('/api/suppliers'),
        request<Movement>('/api/inventory/transactions?limit=50'),
      ]);
      setSummary(dashboard.summary);
      setMovements(movementResult.records ?? []);
      setParts(partResult.records ?? []);
      setTotalParts(partResult.total ?? 0);
      setCategories(partResult.categories ?? []);
      setSuppliers(supplierResult.records ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inventory.');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, page, query, request, stockFilter]);

  useEffect(() => {
    setPage(0);
  }, [categoryFilter, query, stockFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), query.trim() ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [loadData, query]);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(async (response) => {
        const result = await response.json() as { user?: { role?: string } };
        if (response.ok) setRole(result.user?.role ?? '');
      })
      .catch(() => setRole(''));
  }, []);

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(''), 4000);
  };

  const openNewPart = () => {
    setEditingPart(null);
    setPartForm(EMPTY_PART);
    setPartOpen(true);
  };

  const openEditPart = (part: Part) => {
    setEditingPart(part);
    setPartForm({
      part_number: part.part_number, name: part.name, category: part.category,
      description: part.description ?? '', purchase_price: (part.purchase_price_cents / 100).toFixed(2),
      selling_price: (part.selling_price_cents / 100).toFixed(2),
      minimum_stock: String(part.minimum_stock), initial_stock: '0', supplier_id: part.supplier_id ?? '',
    });
    setPartOpen(true);
  };

  const submitPart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const purchaseCents = Math.round(Number(partForm.purchase_price || 0) * 100);
    const sellingCents = Math.round(Number(partForm.selling_price || 0) * 100);
    if (![purchaseCents, sellingCents].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      setError('Enter valid non-negative prices.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request<Part>(editingPart ? `/api/parts/${editingPart.id}` : '/api/parts', {
        method: editingPart ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          part_number: partForm.part_number, name: partForm.name, category: partForm.category,
          description: partForm.description || null, purchase_price_cents: purchaseCents,
          selling_price_cents: sellingCents, minimum_stock: Number(partForm.minimum_stock),
          initial_stock: Number(partForm.initial_stock), supplier_id: partForm.supplier_id || null,
        }),
      });
      setPartOpen(false);
      showSuccess(editingPart ? 'Part details updated.' : 'Part added to inventory.');
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this part.');
    } finally { setBusy(false); }
  };

  const submitSupplier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request<Supplier>(editingSupplier ? `/api/suppliers/${editingSupplier.id}` : '/api/suppliers', {
        method: editingSupplier ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supplierForm),
      });
      setSupplierOpen(false);
      setEditingSupplier(null);
      showSuccess(editingSupplier ? 'Supplier updated.' : 'Supplier registered.');
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this supplier.');
    } finally { setBusy(false); }
  };

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const quantity = Number(movementForm.quantity);
      await request<Movement>('/api/inventory/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          part_id: movementForm.part_id, transaction_type: movementForm.transaction_type,
          quantity, note: movementForm.note || null, transaction_at: movementForm.transaction_at || undefined,
        }),
      });
      setMovementOpen(false);
      setMovementForm({ part_id: '', transaction_type: 'purchase', quantity: '1', note: '', transaction_at: '' });
      showSuccess('Stock movement recorded.');
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not record this stock movement.');
    } finally { setBusy(false); }
  };

  const removePart = async (part: Part) => {
    if (!window.confirm(`Delete ${part.name}? Parts with stock or repair history cannot be deleted.`)) return;
    setError('');
    try {
      await request(`/api/parts/${part.id}`, { method: 'DELETE' });
      showSuccess('Part deleted.');
      await loadData();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this part.'); }
  };

  const removeSupplier = async (supplier: Supplier) => {
    if (!window.confirm(`Delete supplier ${supplier.name}? Associated parts will remain in inventory.`)) return;
    setError('');
    try {
      await request(`/api/suppliers/${supplier.id}`, { method: 'DELETE' });
      showSuccess('Supplier deleted.');
      await loadData();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this supplier.'); }
  };

  const startSupplierEdit = (supplier?: Supplier) => {
    setEditingSupplier(supplier ?? null);
    setSupplierForm(supplier ? {
      name: supplier.name, phone: supplier.phone ?? '', email: supplier.email ?? '', address: supplier.address ?? '',
    } : EMPTY_SUPPLIER);
    setSupplierOpen(true);
  };

  const downloadReport = async (format: 'pdf' | 'xlsx') => {
    setReportBusy(true);
    setError('');
    const params = new URLSearchParams({ format });
    if (reportType === 'stock_movement') {
      if (reportFrom) params.set('from', reportFrom);
      if (reportTo) params.set('to', reportTo);
    }
    try {
      const response = await apiFetch(`/api/inventory/reports/${reportType}?${params}`);
      if (!response.ok) {
        const result = await response.json() as InventoryResult<unknown>;
        throw new Error(errorMessage(result, 'Could not generate this report.'));
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
        ?? `NEXTGEN_${reportType}.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showSuccess(`${filename} downloaded successfully.`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Could not generate this report.');
    } finally { setReportBusy(false); }
  };

  const tabs: { key: InventoryTab; label: string }[] = [
    { key: 'overview', label: 'Overview' }, { key: 'parts', label: 'Parts' },
    { key: 'suppliers', label: 'Suppliers' }, { key: 'movement', label: 'Stock movement' },
    { key: 'reports', label: 'Reports' },
  ];

  return (
    <section className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400"><Boxes className="h-4 w-4" /> WORKSHOP OPERATIONS</div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Spare Parts &amp; Inventory</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage stock, suppliers, and parts movement across repairs.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <button type="button" onClick={() => { setMovementForm((value) => ({ ...value, part_id: parts[0]?.id ?? '' })); setMovementOpen(true); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:text-slate-200"><ArrowUpRight className="h-4 w-4" />Record movement</button>}
          {canManage && <button type="button" onClick={openNewPart} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="h-4 w-4" />Add part</button>}
        </div>
      </header>

      {success && <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{success}<button type="button" onClick={() => setSuccess('')} aria-label="Dismiss"><X className="h-4 w-4" /></button></div>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss"><X className="h-4 w-4 shrink-0" /></button></div>}

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" aria-label="Inventory sections">
        {tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${tab === item.key ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}>{item.label}</button>)}
      </nav>

      {loading ? <div className="grid min-h-64 place-items-center text-slate-500"><span className="inline-flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" />Loading inventory…</span></div> : <>
        {tab === 'overview' && <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Spare parts', value: summary?.total_parts ?? 0, icon: Boxes, tone: 'text-blue-700 bg-blue-50 dark:bg-blue-950/40' },
              { label: 'Units on hand', value: summary?.total_stock ?? 0, icon: PackagePlus, tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40' },
              { label: 'Low stock', value: summary?.low_stock_items ?? 0, icon: AlertTriangle, tone: 'text-amber-800 bg-amber-50 dark:bg-amber-950/40' },
              { label: 'Out of stock', value: summary?.out_of_stock_items ?? 0, icon: ClipboardList, tone: 'text-red-700 bg-red-50 dark:bg-red-950/40' },
              { label: 'Units used in repairs', value: summary?.parts_used ?? 0, icon: ArrowDownLeft, tone: 'text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40' },
            ].map(({ label, value, icon: Icon, tone }) => <article key={label} className="flex items-center justify-between border-b border-slate-200 py-4 dark:border-slate-800"><div><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p></div><span className={`rounded-lg p-2.5 ${tone}`}><Icon className="h-5 w-5" /></span></article>)}
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800"><div><h2 className="font-semibold text-slate-900 dark:text-white">Stock alerts</h2><p className="text-xs text-slate-500">Parts at or below minimum stock</p></div><button type="button" onClick={() => { setStockFilter('low'); setTab('parts'); }} className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">View low stock</button></div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">{parts.filter((part) => part.quantity > 0 && part.quantity <= part.minimum_stock).slice(0, 6).map((part) => <button key={part.id} type="button" onClick={() => setDetail(part)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{part.name}</span><span className="text-xs text-slate-500">{part.part_number} · Minimum {part.minimum_stock}</span></span><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${stockStatus(part).className}`}>{part.quantity} left</span></button>)}{parts.filter((part) => part.quantity > 0 && part.quantity <= part.minimum_stock).length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">No low-stock parts.</p>}</div>
            </section>
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800"><h2 className="font-semibold text-slate-900 dark:text-white">Recent stock transactions</h2><p className="text-xs text-slate-500">Latest inventory activity</p></div>
              <MovementRows records={movements.slice(0, 6)} />
            </section>
          </div>
        </>}

        {tab === 'parts' && <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="font-semibold text-slate-900 dark:text-white">Parts catalogue</h2><p className="text-sm text-slate-500">{totalParts} matching records · showing {parts.length} on this page</p></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or part number" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white sm:w-64" /></label>
              <select aria-label="Filter stock level" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">All stock levels</option><option value="available">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>
              <select aria-label="Filter category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
            </div>
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950/70 dark:text-slate-400"><tr>{['Part', 'Category', 'Supplier', 'Stock', 'Purchase', 'Selling', 'Status', ''].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{parts.length === 0 ? <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No parts match these filters.</td></tr> : parts.map((part) => <tr key={part.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"><td className="px-4 py-3"><button type="button" onClick={() => setDetail(part)} className="text-left font-semibold text-slate-900 hover:text-blue-700 dark:text-white dark:hover:text-blue-300">{part.name}</button><p className="mt-0.5 text-xs text-slate-500">{part.part_number}</p></td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{part.category}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{part.supplier_name ?? part.supplier_name_legacy ?? '—'}</td><td className="px-4 py-3"><span className="font-semibold tabular-nums text-slate-900 dark:text-white">{part.quantity}</span><span className="ml-1 text-xs text-slate-500">/ {part.minimum_stock} min</span></td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatMoney(part.purchase_price_cents)}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatMoney(part.selling_price_cents)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stockStatus(part).className}`}>{stockStatus(part).label}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => setDetail(part)} title="View part" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ClipboardList className="h-4 w-4" /></button>{canManage && <><button type="button" onClick={() => openEditPart(part)} title="Edit part" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => void removePart(part)} title="Delete part" className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/50"><X className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody></table></div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">
            <span>Page {page + 1} of {Math.max(1, Math.ceil(totalParts / PAGE_SIZE))}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
              <button type="button" disabled={(page + 1) * PAGE_SIZE >= totalParts || loading} onClick={() => setPage((current) => current + 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700">Next <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </section>}

        {tab === 'suppliers' && <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800"><div><h2 className="font-semibold text-slate-900 dark:text-white">Suppliers</h2><p className="text-sm text-slate-500">{suppliers.length} registered suppliers</p></div>{canManage && <button type="button" onClick={() => startSupplierEdit()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="h-4 w-4" />Add supplier</button>}</div>
          <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">{suppliers.map((supplier) => <article key={supplier.id} className="border-b border-slate-100 p-4 dark:border-slate-800"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Truck className="h-4 w-4" /></span><div className="min-w-0"><h3 className="truncate font-semibold text-slate-900 dark:text-white">{supplier.name}</h3><p className="mt-1 truncate text-sm text-slate-500">{supplier.phone ?? 'No phone'}{supplier.email ? ` · ${supplier.email}` : ''}</p></div></div>{canManage && <div className="flex"><button type="button" title="Edit supplier" onClick={() => startSupplierEdit(supplier)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button><button type="button" title="Delete supplier" onClick={() => void removeSupplier(supplier)} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/50"><X className="h-4 w-4" /></button></div>}</div>{supplier.address && <p className="mt-3 text-sm text-slate-500">{supplier.address}</p>}</article>)}{suppliers.length === 0 && <p className="col-span-full px-4 py-12 text-center text-sm text-slate-500">No suppliers registered.</p>}</div>
        </section>}

        {tab === 'movement' && <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800"><div><h2 className="font-semibold text-slate-900 dark:text-white">Stock movement history</h2><p className="text-sm text-slate-500">Auditable changes recorded by workshop staff</p></div>{canManage && <button type="button" onClick={() => setMovementOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="h-4 w-4" />Record movement</button>}</div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950/70 dark:text-slate-400"><tr>{['Date', 'Part', 'Type', 'Quantity', 'Repair / vehicle', 'Recorded by'].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{movements.map((item) => <tr key={item.id}><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(item.transaction_at)}</td><td className="px-4 py-3"><span className="font-medium text-slate-900 dark:text-white">{item.part_name}</span><span className="block text-xs text-slate-500">{item.part_number}</span></td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{TRANSACTION_LABELS[item.transaction_type]}</td><td className={`px-4 py-3 font-semibold tabular-nums ${item.quantity_delta < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{item.quantity_delta > 0 ? '+' : ''}{item.quantity_delta}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.repair_job_code ?? '—'}{item.registration_number ? ` · ${item.registration_number}` : ''}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.responsible_name}</td></tr>)}{movements.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">No stock movements recorded.</td></tr>}</tbody></table></div></section>}

        {tab === 'reports' && <section className="max-w-4xl rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="mb-6"><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Inventory reports</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Download current workshop data as a formatted PDF or Excel workbook.</p></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Report"><select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}><option value="inventory">Inventory report</option><option value="low_stock">Low stock report</option><option value="out_of_stock">Out-of-stock report</option><option value="stock_movement">Stock movement report</option></select></Field>
            {reportType === 'stock_movement' ? <>
              <Field label="From date"><input type="date" value={reportFrom} max={reportTo || undefined} onChange={(event) => setReportFrom(event.target.value)} /></Field>
              <Field label="To date"><input type="date" value={reportTo} min={reportFrom || undefined} onChange={(event) => setReportTo(event.target.value)} /></Field>
            </> : <div className="flex items-end text-sm text-slate-500">Report uses the latest inventory records.</div>}
          </div>
          <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 dark:border-slate-800 sm:flex-row sm:items-center">
            <button type="button" disabled={reportBusy} onClick={() => void downloadReport('pdf')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"><Download className="h-4 w-4" />{reportBusy ? 'Generating…' : 'Download PDF'}</button>
            <button type="button" disabled={reportBusy} onClick={() => void downloadReport('xlsx')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-700 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-950/30"><Download className="h-4 w-4" />{reportBusy ? 'Generating…' : 'Download Excel'}</button>
            <p className="text-xs text-slate-500">Files include NEXTGEN branding and the generation date.</p>
          </div>
        </section>}
      </>}

      {canManage && partOpen && <Modal title={editingPart ? `Edit ${editingPart.name}` : 'Add spare part'} onClose={() => setPartOpen(false)}><form onSubmit={submitPart} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Part name"><input required maxLength={160} value={partForm.name} onChange={(event) => setPartForm({ ...partForm, name: event.target.value })} /></Field><Field label="Part number"><input required maxLength={80} value={partForm.part_number} onChange={(event) => setPartForm({ ...partForm, part_number: event.target.value })} /></Field><Field label="Category"><input required maxLength={80} value={partForm.category} onChange={(event) => setPartForm({ ...partForm, category: event.target.value })} /></Field><Field label="Supplier"><select value={partForm.supplier_id} onChange={(event) => setPartForm({ ...partForm, supplier_id: event.target.value })}><option value="">No supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><Field label="Purchase price"><input type="number" min="0" step="0.01" value={partForm.purchase_price} onChange={(event) => setPartForm({ ...partForm, purchase_price: event.target.value })} /></Field><Field label="Selling price"><input type="number" min="0" step="0.01" value={partForm.selling_price} onChange={(event) => setPartForm({ ...partForm, selling_price: event.target.value })} /></Field><Field label="Minimum stock"><input type="number" required min="0" step="1" value={partForm.minimum_stock} onChange={(event) => setPartForm({ ...partForm, minimum_stock: event.target.value })} /></Field>{!editingPart && <Field label="Opening stock"><input type="number" min="0" step="1" value={partForm.initial_stock} onChange={(event) => setPartForm({ ...partForm, initial_stock: event.target.value })} /></Field>}</div><Field label="Description"><textarea rows={3} maxLength={2000} value={partForm.description} onChange={(event) => setPartForm({ ...partForm, description: event.target.value })} /></Field><ModalActions busy={busy} submitLabel={editingPart ? 'Save changes' : 'Add part'} onCancel={() => setPartOpen(false)} /></form></Modal>}

      {canManage && supplierOpen && <Modal title={editingSupplier ? 'Edit supplier' : 'Add supplier'} onClose={() => setSupplierOpen(false)}><form onSubmit={submitSupplier} className="space-y-4"><Field label="Supplier name"><input required maxLength={160} value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Contact number"><input maxLength={40} value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} /></Field><Field label="Email"><input type="email" maxLength={254} value={supplierForm.email} onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })} /></Field></div><Field label="Address"><textarea rows={2} maxLength={500} value={supplierForm.address} onChange={(event) => setSupplierForm({ ...supplierForm, address: event.target.value })} /></Field><ModalActions busy={busy} submitLabel={editingSupplier ? 'Save supplier' : 'Register supplier'} onCancel={() => setSupplierOpen(false)} /></form></Modal>}

      {canManage && movementOpen && <Modal title="Record stock movement" onClose={() => setMovementOpen(false)}><form onSubmit={submitMovement} className="space-y-4"><Field label="Part"><select required value={movementForm.part_id} onChange={(event) => setMovementForm({ ...movementForm, part_id: event.target.value })}><option value="">Select part</option>{parts.map((part) => <option key={part.id} value={part.id}>{part.name} · {part.part_number} · {part.quantity} on hand</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Movement type"><select value={movementForm.transaction_type} onChange={(event) => setMovementForm({ ...movementForm, transaction_type: event.target.value as typeof movementForm.transaction_type })}><option value="purchase">Stock received</option><option value="damage">Damaged stock</option><option value="return">Stock returned</option><option value="adjustment">Adjustment (signed quantity)</option></select></Field><Field label="Quantity"><input type="number" required min={movementForm.transaction_type === 'adjustment' ? '-1000000' : '1'} max="1000000" step="1" value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} /></Field></div><Field label="Transaction date"><input type="datetime-local" value={movementForm.transaction_at} onChange={(event) => setMovementForm({ ...movementForm, transaction_at: event.target.value })} /></Field><Field label="Note"><textarea rows={2} maxLength={500} value={movementForm.note} onChange={(event) => setMovementForm({ ...movementForm, note: event.target.value })} /></Field><ModalActions busy={busy} submitLabel="Save movement" onCancel={() => setMovementOpen(false)} /></form></Modal>}

      {detail && <Modal title={detail.name} onClose={() => setDetail(null)}><dl className="grid gap-4 sm:grid-cols-2">{[['Part number', detail.part_number], ['Category', detail.category], ['Supplier', detail.supplier_name ?? detail.supplier_name_legacy ?? '—'], ['Available stock', `${detail.quantity} units`], ['Minimum stock', `${detail.minimum_stock} units`], ['Purchase price', formatMoney(detail.purchase_price_cents)], ['Selling price', formatMoney(detail.selling_price_cents)], ['Status', stockStatus(detail).label]].map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{value}</dd></div>)}</dl>{detail.description && <p className="mt-5 whitespace-pre-wrap border-t border-slate-200 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">{detail.description}</p>}{canManage && <div className="mt-5 flex justify-end"><button type="button" onClick={() => { setDetail(null); openEditPart(detail); }} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"><Pencil className="h-4 w-4" />Edit part</button></div>}</Modal>}
    </section>
  );
};

function MovementRows({ records }: { records: Movement[] }) {
  return <div className="divide-y divide-slate-100 dark:divide-slate-800">{records.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className={`rounded-md p-2 ${item.quantity_delta < 0 ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{item.quantity_delta < 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.part_name}</p><p className="truncate text-xs text-slate-500">{TRANSACTION_LABELS[item.transaction_type]} · {formatDate(item.transaction_at)}</p></div></div><span className={`shrink-0 text-sm font-bold tabular-nums ${item.quantity_delta < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{item.quantity_delta > 0 ? '+' : ''}{item.quantity_delta}</span></div>)}{records.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">No stock movements recorded.</p>}</div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-label={title}><div className="mb-5 flex items-start justify-between"><h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button></div>{children}</section></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const controlClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white';
  return <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">{label}{React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ className?: string }>, { className: controlClass }) : children}</label>;
}

function ModalActions({ busy, submitLabel, onCancel }: { busy: boolean; submitLabel: string; onCancel: () => void }) {
  return <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800"><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">Cancel</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{submitLabel}</button></div>;
}
