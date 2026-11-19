import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  AtSign,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  LoaderCircle,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { apiFetch } from '../../api';

interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  address: string | null;
  gender: string | null;
  created_at: string;
}

interface CustomerForm {
  full_name: string;
  phone_number: string;
  email: string;
  address: string;
  gender: string;
}

interface CustomerResponse {
  records?: Customer[];
  record?: Customer;
  matches?: Customer[];
  total?: number;
  registeredTotal?: number;
  message?: string;
  error?: string;
}

const EMPTY_FORM: CustomerForm = {
  full_name: '',
  phone_number: '',
  email: '',
  address: '',
  gender: '',
};
const PAGE_SIZE = 10;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Unknown'
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function errorMessage(payload: CustomerResponse, fallback: string): string {
  return payload.message ?? payload.error ?? fallback;
}

export const CustomerManagementView: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [registeredTotal, setRegisteredTotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'full_name' | 'phone_number' | 'email' | 'created_at'>('created_at');
  const [ascending, setAscending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [duplicates, setDuplicates] = useState<Customer[]>([]);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort,
        order: ascending ? 'asc' : 'desc',
      });
      if (search.trim()) params.set('q', search.trim());
      apiFetch(`/api/customers?${params}`)
        .then(async (response) => {
          const result = await response.json() as CustomerResponse;
          if (!response.ok) throw new Error(errorMessage(result, 'Could not load customer records.'));
          if (!active) return;
          setCustomers(result.records ?? []);
          setTotal(result.total ?? 0);
          setRegisteredTotal(result.registeredTotal ?? 0);
        })
        .catch((error: unknown) => {
          if (active) setPageError(error instanceof Error ? error.message : 'Could not load customer records.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, search.trim() ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [offset, search, sort, ascending, success]);

  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleRange = useMemo(() => ({
    first: total === 0 ? 0 : offset + 1,
    last: Math.min(offset + PAGE_SIZE, total),
  }), [offset, total]);

  const openNewCustomer = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setDuplicates([]);
    setFormOpen(true);
  };

  const openEditCustomer = (customer: Customer) => {
    setEditing(customer);
    setForm({
      full_name: customer.full_name,
      phone_number: customer.phone_number,
      email: customer.email ?? '',
      address: customer.address ?? '',
      gender: customer.gender ?? '',
    });
    setFormError('');
    setDuplicates([]);
    setFormOpen(true);
  };

  const toggleSort = (field: typeof sort) => {
    if (sort === field) setAscending((value) => !value);
    else {
      setSort(field);
      setAscending(true);
    }
    setOffset(0);
  };

  const saveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    setDuplicates([]);
    try {
      const response = await apiFetch(
        editing ? `/api/customers/${encodeURIComponent(editing.id)}` : '/api/customers',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            email: form.email.trim() || null,
            address: form.address.trim() || null,
            gender: form.gender || null,
          }),
        }
      );
      const result = await response.json() as CustomerResponse;
      if (response.status === 409 && result.error === 'duplicate_customer') {
        setDuplicates(result.matches ?? []);
        setFormError(errorMessage(result, 'A customer with this phone number or email already exists.'));
        return;
      }
      if (!response.ok) throw new Error(errorMessage(result, 'Could not save this customer.'));
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setSuccess(editing ? 'Customer details updated.' : 'Customer registered successfully.');
      setOffset(0);
      window.setTimeout(() => setSuccess(''), 3500);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save this customer.');
    } finally {
      setSaving(false);
    }
  };

  const loadCustomerDetails = async (customer: Customer) => {
    try {
      const response = await apiFetch(`/api/customers/${encodeURIComponent(customer.id)}`);
      const result = await response.json() as CustomerResponse;
      if (!response.ok || !result.record) {
        throw new Error(errorMessage(result, 'Could not load this customer profile.'));
      }
      setSelected(result.record);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not load this customer profile.');
    }
  };

  const sortIcon = (field: typeof sort) => sort !== field
    ? <ArrowUpDown className="h-3.5 w-3.5" />
    : ascending ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;

  return (
    <section className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">
            NEXTGEN / Records
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Customer Management</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Find returning customers, manage contact details, and keep workshop records accurate.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewCustomer}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" /> Add New Customer
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Registered Customers</p>
              <p className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{registeredTotal.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <UsersRound className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Customer Records</p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Search by customer code, name, phone number, or email. Phone and email duplicates are checked before saving.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 sm:p-5">
          <div>
            <h2 className="font-semibold text-slate-950 dark:text-white">Customer Records</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {search.trim() ? `${total} matching record${total === 1 ? '' : 's'}` : 'Search existing records before creating a new profile.'}
            </p>
          </div>
          <label className="relative block w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
              placeholder="Search ID, name, phone, or email"
              aria-label="Search customers"
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
            />
          </label>
        </div>

        {pageError && (
          <div role="alert" className="m-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {pageError}
          </div>
        )}
        {success && (
          <div role="status" className="m-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <Check className="h-4 w-4" /> {success}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-5 py-3">Customer ID</th>
                <th scope="col" className="px-5 py-3">
                  <button type="button" onClick={() => toggleSort('full_name')} className="inline-flex items-center gap-1.5 hover:text-blue-600">
                    Full Name {sortIcon('full_name')}
                  </button>
                </th>
                <th scope="col" className="px-5 py-3">
                  <button type="button" onClick={() => toggleSort('phone_number')} className="inline-flex items-center gap-1.5 hover:text-blue-600">
                    Phone Number {sortIcon('phone_number')}
                  </button>
                </th>
                <th scope="col" className="px-5 py-3">
                  <button type="button" onClick={() => toggleSort('email')} className="inline-flex items-center gap-1.5 hover:text-blue-600">
                    Email Address {sortIcon('email')}
                  </button>
                </th>
                <th scope="col" className="px-5 py-3">Address</th>
                <th scope="col" className="px-5 py-3">
                  <button type="button" onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1.5 hover:text-blue-600">
                    Registered {sortIcon('created_at')}
                  </button>
                </th>
                <th scope="col" className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading customer records…</span>
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center">
                    <UsersRound className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-700" />
                    <p className="mt-3 font-semibold text-slate-800 dark:text-slate-200">
                      {search.trim() ? 'No matching customers found' : 'No customers registered yet'}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {search.trim() ? 'Try another customer ID, name, phone number, or email.' : 'Add a customer profile to start building your workshop records.'}
                    </p>
                    {!search.trim() && (
                      <button type="button" onClick={openNewCustomer} className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400">
                        Register first customer
                      </button>
                    )}
                  </td>
                </tr>
              ) : customers.map((customer) => (
                <tr key={customer.id} className="transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-blue-700 dark:text-blue-300">
                    {customer.customer_code}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900 dark:text-slate-100">{customer.full_name}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600 dark:text-slate-300">{customer.phone_number}</td>
                  <td className="max-w-[200px] truncate px-5 py-4 text-slate-600 dark:text-slate-300">{customer.email || '—'}</td>
                  <td className="max-w-[200px] truncate px-5 py-4 text-slate-600 dark:text-slate-300">{customer.address || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600 dark:text-slate-300">{formatDate(customer.created_at)}</td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void loadCustomerDetails(customer)}
                        aria-label={`View ${customer.full_name}`}
                        title="View details"
                        className="rounded-md p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditCustomer(customer)}
                        aria-label={`Edit ${customer.full_name}`}
                        title="Edit customer"
                        className="rounded-md p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>Showing {visibleRange.first}–{visibleRange.last} of {total}</span>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span>Page {pageNumber} of {pageCount}</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                disabled={offset === 0 || loading}
                aria-label="Previous page"
                className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total || loading}
                aria-label="Next page"
                className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </footer>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setFormOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="customer-form-title" className="my-auto w-full max-w-2xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-800 sm:p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  {editing ? `Customer ${editing.customer_code}` : 'Customer records'}
                </p>
                <h2 id="customer-form-title" className="mt-1 text-xl font-bold text-slate-950 dark:text-white">
                  {editing ? 'Edit Customer' : 'Register New Customer'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {editing ? 'Update contact details. Customer ID and registration date stay unchanged.' : 'Customer ID and registration date are generated automatically.'}
                </p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Close form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </header>
            <form onSubmit={saveCustomer} className="space-y-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Full Name <span className="text-rose-500">*</span>
                  <input
                    required minLength={2} maxLength={120} autoComplete="name"
                    value={form.full_name}
                    onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                    placeholder="Customer full name"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Phone Number <span className="text-rose-500">*</span>
                  <input
                    required type="tel" inputMode="tel" autoComplete="tel" maxLength={40}
                    value={form.phone_number}
                    onChange={(event) => setForm({ ...form, phone_number: event.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                    placeholder="+1 555 010 2040"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Email Address
                  <input
                    type="email" autoComplete="email" maxLength={254}
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                    placeholder="name@example.com"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Gender <span className="font-normal text-slate-400">(optional)</span>
                  <select
                    value={form.gender}
                    onChange={(event) => setForm({ ...form, gender: event.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                  >
                    <option value="">Prefer not to specify</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="non_binary">Non-binary</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 sm:col-span-2">
                  Physical Address <span className="font-normal text-slate-400">(optional)</span>
                  <textarea
                    rows={2} maxLength={500} autoComplete="street-address"
                    value={form.address}
                    onChange={(event) => setForm({ ...form, address: event.target.value })}
                    className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                    placeholder="Street, city, region"
                  />
                </label>
              </div>
              {!editing && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-950">
                  We check phone number and email for existing profiles before creating a record. Names alone are never used to merge customers.
                </p>
              )}
              {formError && (
                <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{formError}</p>
                  {duplicates.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide">Existing matching records</p>
                      {duplicates.map((customer) => (
                        <div key={customer.id} className="flex flex-col gap-2 rounded-md bg-white/70 p-2 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-900/70">
                          <span className="text-sm">
                            <strong>{customer.full_name}</strong> · {customer.customer_code} · {customer.phone_number}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setFormOpen(false);
                              void loadCustomerDetails(customer);
                            }}
                            className="shrink-0 text-left text-xs font-bold text-blue-700 hover:underline dark:text-blue-300 sm:text-right"
                          >
                            Retrieve existing customer
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-slate-800">
                <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70">
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Register Customer'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="customer-profile-title" className="my-auto w-full max-w-xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-800 sm:p-6">
              <div>
                <p className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{selected.customer_code}</p>
                <h2 id="customer-profile-title" className="mt-1 text-xl font-bold text-slate-950 dark:text-white">{selected.full_name}</h2>
                <p className="mt-1 text-sm text-slate-500">Customer profile</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close profile" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
              <ProfileItem icon={<Phone className="h-4 w-4" />} label="Phone Number" value={selected.phone_number} />
              <ProfileItem icon={<AtSign className="h-4 w-4" />} label="Email Address" value={selected.email || 'Not provided'} />
              <ProfileItem icon={<MapPin className="h-4 w-4" />} label="Physical Address" value={selected.address || 'Not provided'} />
              <ProfileItem icon={<UserRound className="h-4 w-4" />} label="Gender" value={selected.gender?.replaceAll('_', ' ') || 'Not provided'} />
              <ProfileItem icon={<CalendarDays className="h-4 w-4" />} label="Date Registered" value={formatDate(selected.created_at)} />
            </div>
            <div className="mx-5 mb-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950 sm:mx-6 sm:mb-6">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Vehicle & service history</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                This profile is ready to connect to registered vehicles, service and repair history, and payments. Those related records are not included in this module.
              </p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  openEditCustomer(selected);
                  setSelected(null);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Pencil className="h-4 w-4" /> Edit Customer
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
};

const ProfileItem: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="min-w-0">
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{icon}{label}</p>
    <p className="mt-1 break-words text-sm font-medium capitalize text-slate-800 dark:text-slate-200">{value}</p>
  </div>
);
