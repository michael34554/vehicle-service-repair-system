import { useCallback, useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Database, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../api';
import { MECHANICAL_SYSTEMS, SMART_WORKSHOP_CONFIG } from '@/shared/smartWorkshop';

interface LookupRecord {
  id: string;
  name?: string;
  label?: string;
  manufacturer_name?: string;
  asset_key?: string;
  model_path?: string;
  license?: string;
  is_generic?: number | boolean;
  is_exact_match?: number | boolean;
}

interface CatalogResponse {
  records?: LookupRecord[];
  message?: string;
  error?: string;
}

type FormState = Record<string, string>;

const EMPTY_MANUFACTURER: FormState = { name: '', country: '' };
const EMPTY_MODEL: FormState = { manufacturer_id: '', name: '', body_style: '', year_from: '', year_to: '', asset_key: 'generic-licensed-vehicle' };
const EMPTY_ASSET: FormState = { asset_key: '', label: '', model_path: '', license: '', license_url: '', source: '', notes: '' };
const EMPTY_SPEC: FormState = { model_id: '', engine_type: '', engine_capacity_cc: '', fuel_type: '', transmission_type: '', drive_type: '', data_source: '', verification_status: 'sourced', verified_by_name: '' };
const EMPTY_FAULT: FormState = {
  fault_name: '', description: '', system_key: '', component_key: '', symptoms: '', possible_causes: '',
  diagnostic_procedures: '', dtc_codes: '', provenance: 'synthetic', dataset_source: '', severity: '',
  manufacturer_id: '', model_id: '', recommended_inspection: '', corrective_action: '',
};

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function optional(value: string): string | undefined {
  return value.trim() ? value.trim() : undefined;
}

export function CatalogueAdminPanel({ onChanged }: { onChanged?: () => void }) {
  const [manufacturers, setManufacturers] = useState<LookupRecord[]>([]);
  const [assets, setAssets] = useState<LookupRecord[]>([]);
  const [models, setModels] = useState<LookupRecord[]>([]);
  const [manufacturerForm, setManufacturerForm] = useState<FormState>(EMPTY_MANUFACTURER);
  const [modelForm, setModelForm] = useState<FormState>(EMPTY_MODEL);
  const [assetForm, setAssetForm] = useState<FormState>(EMPTY_ASSET);
  const [specForm, setSpecForm] = useState<FormState>(EMPTY_SPEC);
  const [faultForm, setFaultForm] = useState<FormState>(EMPTY_FAULT);
  const [assetIsGeneric, setAssetIsGeneric] = useState(true);
  const [assetIsExact, setAssetIsExact] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshLookups = useCallback(async () => {
    const [manufacturerResponse, assetResponse] = await Promise.all([
      apiFetch('/api/smart-workshop/manufacturers'),
      apiFetch('/api/smart-workshop/3d-assets'),
    ]);
    const manufacturerResult = await manufacturerResponse.json() as CatalogResponse;
    const assetResult = await assetResponse.json() as CatalogResponse;
    if (!manufacturerResponse.ok) throw new Error(manufacturerResult.message ?? manufacturerResult.error ?? 'Could not load manufacturers.');
    if (!assetResponse.ok) throw new Error(assetResult.message ?? assetResult.error ?? 'Could not load 3D assets.');
    const makerRecords = manufacturerResult.records ?? [];
    setManufacturers(makerRecords);
    setAssets(assetResult.records ?? []);
    setModelForm((current) => ({ ...current, manufacturer_id: current.manufacturer_id || makerRecords[0]?.id || '', asset_key: current.asset_key || 'generic-licensed-vehicle' }));
    const modelResponses = await Promise.all(makerRecords.map((maker) => apiFetch(`/api/smart-workshop/manufacturers/${encodeURIComponent(maker.id)}/models`)));
    const modelResults = await Promise.all(modelResponses.map((response) => response.json() as Promise<CatalogResponse>));
    setModels(modelResults.flatMap((result) => result.records ?? []));
  }, []);

  useEffect(() => {
    let active = true;
    refreshLookups()
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load catalogue lookups.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshLookups]);

  const submit = async (event: FormEvent, endpoint: string, body: Record<string, unknown>, message: string, reset: () => void) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json() as CatalogResponse;
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not save the catalogue record.');
      setNotice(message);
      reset();
      await refreshLookups();
      onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save the catalogue record.');
    } finally {
      setBusy(false);
    }
  };

  const input = (value: string, onChange: (next: string) => void, placeholder: string, type = 'text') => (
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type}
      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
  );
  const select = (value: string, onChange: (next: string) => void, options: { value: string; label: string }[], placeholder: string) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
  const textarea = (value: string, onChange: (next: string) => void, placeholder: string) => (
    <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={3}
      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
  );
  const setField = (setter: Dispatch<SetStateAction<FormState>>, field: string) => (value: string) => setter((current) => ({ ...current, [field]: value }));

  const modelOptions = models.map((model) => ({ value: model.id, label: `${model.manufacturer_name ?? 'Manufacturer'} ${model.name ?? ''}`.trim() }));
  const assetOptions = assets.map((asset) => ({ value: asset.asset_key ?? '', label: asset.label ?? asset.asset_key ?? 'Unnamed asset' }));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><Database className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Catalogue administration</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            Extend the shared manufacturer, model, 3D asset, specification and fault knowledge base used by the Smart Workshop. Changes are global reference data, not workshop vehicle records.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Administrator</span>
      </div>

      {loading && <p className="mt-4 inline-flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading catalogue…</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form onSubmit={(event) => void submit(event, '/api/smart-workshop/manufacturers', manufacturerForm, 'Manufacturer added.', () => setManufacturerForm(EMPTY_MANUFACTURER))} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add manufacturer</h3>
          {input(manufacturerForm.name, setField(setManufacturerForm, 'name'), 'Manufacturer name')}
          {input(manufacturerForm.country, setField(setManufacturerForm, 'country'), 'Country (optional)')}
          <SubmitButton busy={busy} label="Add manufacturer" />
        </form>

        <form onSubmit={(event) => void submit(event, '/api/smart-workshop/3d-assets', {
          ...assetForm, is_generic: assetIsGeneric, is_exact_match: assetIsExact,
        }, '3D asset registered.', () => { setAssetForm(EMPTY_ASSET); setAssetIsGeneric(true); setAssetIsExact(false); })} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Register 3D asset</h3>
          {input(assetForm.asset_key, setField(setAssetForm, 'asset_key'), 'Asset key')}
          {input(assetForm.label, setField(setAssetForm, 'label'), 'Display label')}
          {input(assetForm.model_path, setField(setAssetForm, 'model_path'), '/assets/models/vehicle.glb')}
          <div className="grid grid-cols-2 gap-2">
            {input(assetForm.license, setField(setAssetForm, 'license'), 'License')}
            {input(assetForm.license_url, setField(setAssetForm, 'license_url'), 'License URL (optional)')}
          </div>
          {input(assetForm.source, setField(setAssetForm, 'source'), 'Source and attribution')}
          <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={assetIsGeneric} onChange={(event) => setAssetIsGeneric(event.target.checked)} className="accent-blue-600" /> Representative / generic asset
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={assetIsExact} onChange={(event) => { setAssetIsExact(event.target.checked); if (event.target.checked) setAssetIsGeneric(false); }} className="accent-blue-600" /> Exact model match
          </label>
          <SubmitButton busy={busy} label="Register asset" />
        </form>

        <form onSubmit={(event) => void submit(event, `/api/smart-workshop/manufacturers/${encodeURIComponent(modelForm.manufacturer_id)}/models`, modelForm, 'Model added.', () => setModelForm({ ...EMPTY_MODEL, manufacturer_id: modelForm.manufacturer_id }))} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add model</h3>
          {select(modelForm.manufacturer_id, setField(setModelForm, 'manufacturer_id'), manufacturers.map((maker) => ({ value: maker.id, label: maker.name ?? maker.id })), 'Select manufacturer')}
          {input(modelForm.name, setField(setModelForm, 'name'), 'Model name')}
          {input(modelForm.body_style, setField(setModelForm, 'body_style'), 'Body style (optional)')}
          <div className="grid grid-cols-2 gap-2">
            {input(modelForm.year_from, setField(setModelForm, 'year_from'), 'Year from', 'number')}
            {input(modelForm.year_to, setField(setModelForm, 'year_to'), 'Year to', 'number')}
          </div>
          {select(modelForm.asset_key, setField(setModelForm, 'asset_key'), assetOptions, 'Select 3D asset')}
          <SubmitButton busy={busy} label="Add model" />
        </form>

        <form onSubmit={(event) => void submit(event, `/api/smart-workshop/models/${encodeURIComponent(specForm.model_id)}/specifications`, specForm, 'Specification added.', () => setSpecForm({ ...EMPTY_SPEC, model_id: specForm.model_id }))} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add specification</h3>
          {select(specForm.model_id, setField(setSpecForm, 'model_id'), modelOptions, 'Select model')}
          <div className="grid grid-cols-2 gap-2">
            {input(specForm.engine_type, setField(setSpecForm, 'engine_type'), 'Engine type')}
            {input(specForm.engine_capacity_cc, setField(setSpecForm, 'engine_capacity_cc'), 'Capacity (cc)', 'number')}
            {input(specForm.fuel_type, setField(setSpecForm, 'fuel_type'), 'Fuel type')}
            {input(specForm.transmission_type, setField(setSpecForm, 'transmission_type'), 'Transmission')}
            {input(specForm.drive_type, setField(setSpecForm, 'drive_type'), 'Drive type')}
            {select(specForm.verification_status, setField(setSpecForm, 'verification_status'), [
              { value: 'not_recorded', label: 'Not recorded' }, { value: 'sourced', label: 'Sourced' }, { value: 'verified', label: 'Verified' },
            ], 'Verification status')}
          </div>
          {input(specForm.data_source, setField(setSpecForm, 'data_source'), 'Data source / reference')}
          {input(specForm.verified_by_name, setField(setSpecForm, 'verified_by_name'), 'Verified by (optional)')}
          <SubmitButton busy={busy} label="Add specification" />
        </form>

        <form onSubmit={(event) => void submit(event, '/api/smart-workshop/faults', {
          ...faultForm,
          symptoms: lines(faultForm.symptoms),
          possible_causes: lines(faultForm.possible_causes),
          diagnostic_procedures: lines(faultForm.diagnostic_procedures),
          dtc_codes: lines(faultForm.dtc_codes),
          manufacturer_id: optional(faultForm.manufacturer_id),
          model_id: optional(faultForm.model_id),
          severity: optional(faultForm.severity),
          recommended_inspection: optional(faultForm.recommended_inspection),
          corrective_action: optional(faultForm.corrective_action),
        }, 'Fault record added.', () => setFaultForm(EMPTY_FAULT))} className="space-y-2 rounded-xl border border-slate-200 p-4 lg:col-span-2 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add fault knowledge record</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {input(faultForm.fault_name, setField(setFaultForm, 'fault_name'), 'Fault name')}
            {select(faultForm.system_key, setField(setFaultForm, 'system_key'), MECHANICAL_SYSTEMS.map((system) => ({ value: system.key, label: system.label })), 'Select system')}
            {select(faultForm.component_key, setField(setFaultForm, 'component_key'), SMART_WORKSHOP_CONFIG.components.map((component) => ({ value: component.key, label: component.label })), 'Exact component (optional)')}
            {select(faultForm.provenance, setField(setFaultForm, 'provenance'), [
              { value: 'synthetic', label: 'Synthetic / illustrative' }, { value: 'sourced', label: 'Sourced reference' }, { value: 'verified', label: 'Verified workshop data' },
            ], 'Provenance')}
            {select(faultForm.manufacturer_id, setField(setFaultForm, 'manufacturer_id'), manufacturers.map((maker) => ({ value: maker.id, label: maker.name ?? maker.id })), 'Manufacturer (optional)')}
            {select(faultForm.model_id, setField(setFaultForm, 'model_id'), modelOptions, 'Model (optional)')}
            {input(faultForm.dtc_codes, setField(setFaultForm, 'dtc_codes'), 'DTC codes, one per line')}
            {input(faultForm.severity, setField(setFaultForm, 'severity'), 'Severity (optional)')}
          </div>
          {textarea(faultForm.description, setField(setFaultForm, 'description'), 'Description')}
          <div className="grid gap-2 md:grid-cols-3">
            {textarea(faultForm.symptoms, setField(setFaultForm, 'symptoms'), 'Symptoms, one per line')}
            {textarea(faultForm.possible_causes, setField(setFaultForm, 'possible_causes'), 'Possible causes, one per line')}
            {textarea(faultForm.diagnostic_procedures, setField(setFaultForm, 'diagnostic_procedures'), 'Diagnostic procedures, one per line')}
          </div>
          {input(faultForm.dataset_source, setField(setFaultForm, 'dataset_source'), 'Dataset source / reference')}
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Provenance is stored with every record. Do not mark synthetic or unverified information as verified workshop data.</p>
          <SubmitButton busy={busy} label="Add fault record" />
        </form>
      </div>
    </section>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button type="submit" disabled={busy}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
      {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {label}
    </button>
  );
}
