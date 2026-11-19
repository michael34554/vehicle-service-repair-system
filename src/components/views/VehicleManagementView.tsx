import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  LoaderCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { apiFetch } from '../../api';

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
  customer_id: string;
  registration_number: string;
  make: string;
  model: string;
  manufacturing_year: number;
  colour: string | null;
  chassis_number: string | null;
  engine_number: string | null;
  mileage: number;
  created_at: string;
  owner_customer_code: string;
  owner_name: string;
  owner_phone: string;
  owner_email: string | null;
}

interface VehicleForm {
  registration_number: string;
  make: string;
  model: string;
  manufacturing_year: string;
  colour: string;
  chassis_number: string;
  engine_number: string;
  mileage: string;
}

interface ApiResponse<T> {
  records?: T[];
  record?: T;
  total?: number;
  registeredTotal?: number;
  message?: string;
  error?: string;
}

const EMPTY_FORM: VehicleForm = {
  registration_number: '',
  make: '',
  model: '',
  manufacturing_year: String(new Date().getFullYear()),
  colour: '',
  chassis_number: '',
  engine_number: '',
  mileage: '',
};
const PAGE_SIZE = 10;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Unknown'
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function apiError<T>(result: ApiResponse<T>, fallback: string): string {
  return result.message ?? result.error ?? fallback;
}

export const VehicleManagementView: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [registeredTotal, setRegisteredTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'registration_number' | 'make' | 'model' | 'manufacturing_year' | 'owner_name' | 'created_at'>('created_at');
  const [ascending, setAscending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerMatches, setCustomerMatches] = useState<Customer[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerPickerError, setCustomerPickerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [duplicate, setDuplicate] = useState<Vehicle | null>(null);
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
      apiFetch(`/api/vehicles?${params}`)
        .then(async (response) => {
          const result = await response.json() as ApiResponse<Vehicle>;
          if (!response.ok) throw new Error(apiError(result, 'Could not load vehicle records.'));
          if (!active) return;
          setVehicles(result.records ?? []);
          setTotal(result.total ?? 0);
          setRegisteredTotal(result.registeredTotal ?? 0);
        })
        .catch((error: unknown) => {
          if (active) setPageError(error instanceof Error ? error.message : 'Could not load vehicle records.');
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

  useEffect(() => {
    if (!formOpen || editing || customerQuery.trim().length < 2) {
      setCustomerMatches([]);
      setCustomerLoading(false);
      return;
    }
    let active = true;
    setCustomerLoading(true);
    setCustomerMatches([]);
    setCustomerPickerError('');
    const timer = window.setTimeout(() => {
      apiFetch(`/api/customers/search?q=${encodeURIComponent(customerQuery.trim())}`)
        .then(async (response) => {
          const result = await response.json() as ApiResponse<Customer>;
          if (!response.ok) throw new Error(apiError(result, 'Could not search registered customers.'));
          if (active) setCustomerMatches(result.records ?? []);
        })
        .catch((error: unknown) => {
          if (active) setCustomerPickerError(error instanceof Error ? error.message : 'Could not search registered customers.');
        })
        .finally(() => {
          if (active) setCustomerLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerQuery, formOpen, editing]);

  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const range = useMemo(() => ({
    first: total === 0 ? 0 : offset + 1,
    last: Math.min(offset + PAGE_SIZE, total),
  }), [offset, total]);

  const openNewVehicle = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSelectedCustomer(null);
    setCustomerQuery('');
    setCustomerMatches([]);
    setFormError('');
    setDuplicate(null);
    setFormOpen(true);
  };

  const openEditVehicle = (vehicle: Vehicle) => {
    setEditing(vehicle);
    setForm({
      registration_number: vehicle.registration_number,
      make: vehicle.make,
      model: vehicle.model,
      manufacturing_year: String(vehicle.manufacturing_year),
      colour: vehicle.colour ?? '',
      chassis_number: vehicle.chassis_number ?? '',
      engine_number: vehicle.engine_number ?? '',
      mileage: String(vehicle.mileage),
    });
    setSelectedCustomer(null);
    setCustomerQuery('');
    setCustomerMatches([]);
    setFormError('');
    setDuplicate(null);
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

  const saveVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing && !selectedCustomer) {
      setFormError('Select an existing customer before registering a vehicle.');
      return;
    }
    setSaving(true);
    setFormError('');
    setDuplicate(null);
    try {
      const body = {
        ...form,
        manufacturing_year: Number(form.manufacturing_year),
        mileage: form.mileage.trim() ? Number(form.mileage) : 0,
        colour: form.colour.trim() || null,
        chassis_number: form.chassis_number.trim() || null,
        engine_number: form.engine_number.trim() || null,
        ...(editing ? {} : { customer_id: selectedCustomer?.id }),
      };
      const response = await apiFetch(
        editing ? `/api/vehicles/${encodeURIComponent(editing.id)}` : '/api/vehicles',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const result = await response.json() as ApiResponse<Vehicle>;
      if (response.status === 409 && result.error === 'duplicate_vehicle') {
        setDuplicate(result.record ?? null);
        setFormError(apiError(result, 'A vehicle with this registration number already exists.'));
        return;
      }
      if (!response.ok) throw new Error(apiError(result, 'Could not save this vehicle.'));
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setSuccess(editing ? 'Vehicle information updated.' : 'Vehicle registered successfully.');
      setOffset(0);
      window.setTimeout(() => setSuccess(''), 3500);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save this vehicle.');
    } finally {
      setSaving(false);
    }
  };

  const loadVehicleDetails = async (vehicle: Vehicle) => {
    try {
      const response = await apiFetch(`/api/vehicles/${encodeURIComponent(vehicle.id)}`);
      const result = await response.json() as ApiResponse<Vehicle>;
      if (!response.ok || !result.record) throw new Error(apiError(result, 'Could not load the vehicle profile.'));
      setSelected(result.record);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not load the vehicle profile.');
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
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Vehicle Management</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Register vehicles to existing customers and keep ownership and vehicle details up to date.
          </p>
        </div>
        <button type="button" onClick={openNewVehicle} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
          <Plus className="h-4 w-4" /> Add New Vehicle
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Registered Vehicles</p>
              <p className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{registeredTotal.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <CarFront className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Customer ownership</p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Each vehicle is linked to an existing customer record. A customer can have multiple vehicles.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 sm:p-5">
          <div>
            <h2 className="font-semibold text-slate-950 dark:text-white">Vehicle Records</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Search registration, vehicle ID, make, model, customer name, or customer phone.
            </p>
          </div>
          <label className="relative block w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search" value={search} aria-label="Search vehicles"
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
              placeholder="Search vehicle or owner"
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
                <th scope="col" className="px-5 py-3">Vehicle ID</th>
                <th scope="col" className="px-5 py-3">
                  <SortButton label="Registration" field="registration_number" onSort={toggleSort} icon={sortIcon} />
                </th>
                <th scope="col" className="px-5 py-3">
                  <SortButton label="Make / Model" field="make" onSort={toggleSort} icon={sortIcon} />
                </th>
                <th scope="col" className="px-5 py-3">
                  <SortButton label="Year" field="manufacturing_year" onSort={toggleSort} icon={sortIcon} />
                </th>
                <th scope="col" className="px-5 py-3">
                  <SortButton label="Owner" field="owner_name" onSort={toggleSort} icon={sortIcon} />
                </th>
                <th scope="col" className="px-5 py-3">Owner Phone</th>
                <th scope="col" className="px-5 py-3">
                  <SortButton label="Registered" field="created_at" onSort={toggleSort} icon={sortIcon} />
                </th>
                <th scope="col" className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-14 text-center text-slate-500"><span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading vehicle records…</span></td></tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-14 text-center">
                    <CarFront className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-700" />
                    <p className="mt-3 font-semibold text-slate-800 dark:text-slate-200">{search.trim() ? 'No matching vehicles found' : 'No vehicles registered yet'}</p>
                    <p className="mt-1 text-sm text-slate-500">{search.trim() ? 'Try another registration number, make, model, or customer.' : 'Register a vehicle and link it to an existing customer.'}</p>
                    {!search.trim() && <button type="button" onClick={openNewVehicle} className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400">Register first vehicle</button>}
                  </td>
                </tr>
              ) : vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-blue-700 dark:text-blue-300">{vehicle.vehicle_code}</td>
                  <td className="whitespace-nowrap px-5 py-4 font-mono font-semibold text-slate-900 dark:text-slate-100">{vehicle.registration_number}</td>
                  <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-800 dark:text-slate-200">{vehicle.make} {vehicle.model}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600 dark:text-slate-300">{vehicle.manufacturing_year}</td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <button type="button" onClick={() => void loadVehicleDetails(vehicle)} className="text-left font-medium text-blue-700 hover:underline dark:text-blue-300">{vehicle.owner_name}</button>
                    <span className="block font-mono text-[10px] text-slate-400">{vehicle.owner_customer_code}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600 dark:text-slate-300">{vehicle.owner_phone}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600 dark:text-slate-300">{formatDate(vehicle.created_at)}</td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => void loadVehicleDetails(vehicle)} aria-label={`View ${vehicle.registration_number}`} title="View details" className="rounded-md p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"><Eye className="h-4 w-4" /></button>
                      <button type="button" onClick={() => openEditVehicle(vehicle)} aria-label={`Edit ${vehicle.registration_number}`} title="Edit vehicle" className="rounded-md p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"><Pencil className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>Showing {range.first}–{range.last} of {total}</span>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span>Page {pageNumber} of {pageCount}</span>
            <div className="flex gap-1">
              <button type="button" aria-label="Previous page" onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} disabled={offset === 0 || loading} className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Next page" onClick={() => setOffset((value) => value + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total || loading} className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </footer>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setFormOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="vehicle-form-title" className="my-auto w-full max-w-3xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-800 sm:p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">{editing ? `Vehicle ${editing.vehicle_code}` : 'Vehicle records'}</p>
                <h2 id="vehicle-form-title" className="mt-1 text-xl font-bold text-slate-950 dark:text-white">{editing ? 'Edit Vehicle' : 'Register New Vehicle'}</h2>
                <p className="mt-1 text-sm text-slate-500">{editing ? 'Vehicle ID, registered owner, and registration date remain unchanged.' : 'Select a registered customer, then enter the vehicle details.'}</p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Close form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </header>
            <form onSubmit={saveVehicle} className="space-y-5 p-5 sm:p-6">
              {!editing && (
                <div className="relative">
                  <label htmlFor="vehicle-customer-search" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Existing Customer <span className="text-rose-500">*</span></label>
                  {selectedCustomer ? (
                    <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{selectedCustomer.full_name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{selectedCustomer.customer_code} · {selectedCustomer.phone_number}</p>
                      </div>
                      <button type="button" onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerQuery('');
                      }} className="ml-3 shrink-0 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300">Change</button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          id="vehicle-customer-search" type="search" autoComplete="off" value={customerQuery}
                          onChange={(event) => setCustomerQuery(event.target.value)}
                          placeholder="Search customer name, phone, or customer ID"
                          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                        />
                        {customerLoading ? <LoaderCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
                      </div>
                      {customerQuery.trim().length > 0 && customerQuery.trim().length < 2 && <p className="mt-1 text-xs text-slate-500">Enter at least 2 characters to search.</p>}
                      {customerPickerError && <p role="alert" className="mt-2 text-xs text-rose-600">{customerPickerError}</p>}
                      {!customerLoading && customerQuery.trim().length >= 2 && customerMatches.length === 0 && !customerPickerError && (
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                          No customer found. Register the customer in Customer Management first.
                        </div>
                      )}
                      {customerMatches.length > 0 && (
                        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                          {customerMatches.map((customer) => (
                            <li key={customer.id}>
                              <button type="button" onClick={() => {
                                setSelectedCustomer(customer);
                                setCustomerMatches([]);
                                setCustomerQuery('');
                              }} className="w-full px-3 py-2.5 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40">
                                <span className="block text-sm font-semibold text-slate-900 dark:text-white">{customer.full_name}</span>
                                <span className="mt-0.5 block text-xs text-slate-500">{customer.customer_code} · {customer.phone_number}{customer.email ? ` · ${customer.email}` : ''}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {!selectedCustomer && !customerQuery.trim() && (
                    <p className="mt-1.5 text-xs text-slate-500">Customers must already be registered. No customer records are created here.</p>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <FormInput label="Registration Number" required value={form.registration_number} maxLength={24} placeholder="e.g. CA 7XKP921" onChange={(value) => setForm({ ...form, registration_number: value.toUpperCase() })} />
                <FormInput label="Make" required value={form.make} maxLength={80} placeholder="Toyota" onChange={(value) => setForm({ ...form, make: value })} />
                <FormInput label="Model" required value={form.model} maxLength={100} placeholder="Corolla" onChange={(value) => setForm({ ...form, model: value })} />
                <FormInput label="Manufacturing Year" required type="number" min={1886} max={new Date().getFullYear() + 1} value={form.manufacturing_year} onChange={(value) => setForm({ ...form, manufacturing_year: value })} />
                <FormInput label="Colour" value={form.colour} maxLength={50} placeholder="Silver" onChange={(value) => setForm({ ...form, colour: value })} />
                <FormInput label="Current Mileage" type="number" min={0} max={2000000} value={form.mileage} placeholder="0" onChange={(value) => setForm({ ...form, mileage: value })} />
                <FormInput label="Chassis Number" value={form.chassis_number} maxLength={50} placeholder="Optional" onChange={(value) => setForm({ ...form, chassis_number: value })} />
                <FormInput label="Engine Number" value={form.engine_number} maxLength={80} placeholder="Optional" onChange={(value) => setForm({ ...form, engine_number: value })} />
              </div>

              {formError && (
                <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{formError}</p>
                  {duplicate && (
                    <button type="button" onClick={() => {
                      setFormOpen(false);
                      void loadVehicleDetails(duplicate);
                    }} className="ml-6 mt-2 text-left text-xs font-bold text-blue-700 hover:underline dark:text-blue-300">
                      View existing {duplicate.registration_number} · {duplicate.make} {duplicate.model} ({duplicate.owner_name})
                    </button>
                  )}
                </div>
              )}
              <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-slate-800">
                <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
                <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70">
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Register Vehicle'}
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
          <section role="dialog" aria-modal="true" aria-labelledby="vehicle-profile-title" className="my-auto w-full max-w-2xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-800 sm:p-6">
              <div>
                <p className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{selected.vehicle_code}</p>
                <h2 id="vehicle-profile-title" className="mt-1 text-xl font-bold text-slate-950 dark:text-white">{selected.registration_number}</h2>
                <p className="mt-1 text-sm text-slate-500">{selected.manufacturing_year} {selected.make} {selected.model}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close vehicle profile" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
              <Detail icon={<CarFront className="h-4 w-4" />} label="Registration Number" value={selected.registration_number} />
              <Detail icon={<CarFront className="h-4 w-4" />} label="Vehicle" value={`${selected.manufacturing_year} ${selected.make} ${selected.model}`} />
              <Detail icon={<CarFront className="h-4 w-4" />} label="Colour" value={selected.colour || 'Not provided'} />
              <Detail icon={<CarFront className="h-4 w-4" />} label="Chassis Number" value={selected.chassis_number || 'Not provided'} />
              <Detail icon={<CarFront className="h-4 w-4" />} label="Engine Number" value={selected.engine_number || 'Not provided'} />
              <Detail icon={<CarFront className="h-4 w-4" />} label="Current Mileage" value={selected.mileage.toLocaleString()} />
              <Detail icon={<CalendarDays className="h-4 w-4" />} label="Date Registered" value={formatDate(selected.created_at)} />
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><UserRound className="h-4 w-4" />Registered Owner</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{selected.owner_name}</p>
                <p className="mt-0.5 font-mono text-xs text-slate-500">{selected.owner_customer_code}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><Phone className="h-3.5 w-3.5" />{selected.owner_phone}</p>
                {selected.owner_email && <p className="mt-1 break-all text-xs text-slate-600 dark:text-slate-300">{selected.owner_email}</p>}
              </div>
            </div>
            <div className="mx-5 mb-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950 sm:mx-6 sm:mb-6">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Service and repair history</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Vehicle records are already linked to individual repair jobs. Mechanic assignments, repair status, service history, parts used, and payments will appear here as those modules are implemented.
              </p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Close</button>
              <button type="button" onClick={() => {
                openEditVehicle(selected);
                setSelected(null);
              }} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Pencil className="h-4 w-4" /> Edit Vehicle</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
};

const FormInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: string;
}> = ({ label, value, onChange, required, type = 'text', min, max, maxLength, placeholder }) => (
  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
    {label} {required && <span className="text-rose-500">*</span>}
    <input
      required={required}
      type={type}
      min={min}
      max={max}
      maxLength={maxLength}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
    />
  </label>
);

const Detail: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="min-w-0">
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{icon}{label}</p>
    <p className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-200">{value}</p>
  </div>
);

const SortButton: React.FC<{
  label: string;
  field: 'registration_number' | 'make' | 'model' | 'manufacturing_year' | 'owner_name' | 'created_at';
  onSort: (field: 'registration_number' | 'make' | 'model' | 'manufacturing_year' | 'owner_name' | 'created_at') => void;
  icon: (field: 'registration_number' | 'make' | 'model' | 'manufacturing_year' | 'owner_name' | 'created_at') => React.ReactNode;
}> = ({ label, field, onSort, icon }) => (
  <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1.5 hover:text-blue-600">
    {label} {icon(field)}
  </button>
);
