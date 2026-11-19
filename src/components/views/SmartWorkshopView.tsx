import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CarFront,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Eye,
  Layers3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Stethoscope,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch } from '../../api';
import {
  INSPECTION_CONDITIONS,
  SMART_WORKSHOP_CONFIG,
  componentForFault,
  deriveComponentStatuses,
  type ComponentKey,
  type ComponentStatus,
  type InspectionCondition,
  type SmartWorkshopConfig,
  type WorkshopStatus,
} from '@/shared/smartWorkshop';
import type { CameraPreset, ViewerMode, ViewStyle } from '../smartWorkshop/viewerConfig';

const VehicleViewer = lazy(() => import('../smartWorkshop/VehicleViewer'));

interface VehicleOption {
  id: string;
  registration_number: string;
  make: string;
  model: string;
  model_year?: number;
}

interface VehicleSummary {
  id: string;
  customer_id: string;
  vehicle_code?: string | null;
  registration_number: string;
  make: string;
  model: string;
  model_year: number;
  mileage: number;
  vin?: string | null;
  engine_number?: string | null;
  customer_name?: string | null;
}

interface FaultCandidate {
  fault_category: string;
  confidence: number;
  dtc_reference: string;
  possible_causes?: string[];
  inspection_procedures: string[];
  affected_component?: ComponentKey | null;
}

interface Diagnosis {
  id: string;
  job_id: string | null;
  reported_symptoms?: string;
  predicted_fault: string;
  confidence: number;
  predictions?: FaultCandidate[];
  affected_component: string | null;
  possible_causes?: string[];
  recommendations?: string[];
  model_version?: string | null;
  review_status: 'pending' | 'confirmed' | 'corrected' | 'dismissed';
  confirmed_fault: string | null;
  mechanic_notes?: string | null;
  created_by_name?: string;
  created_at: string;
  reviewed_at?: string | null;
}

interface Inspection {
  id: string;
  component_name: ComponentKey;
  condition_status: InspectionCondition;
  inspection_notes: string | null;
  inspection_date: string;
  inspected_by_name: string;
  job_id: string | null;
}

interface RepairOption {
  id: string;
  repair_job_code: string;
  service_type: string;
  repair_status: string;
  issue_description?: string | null;
  created_at?: string;
}

interface WorkshopData {
  vehicle: VehicleSummary;
  config: SmartWorkshopConfig;
  conditions: { value: InspectionCondition; label: string; status: WorkshopStatus }[];
  statuses: Record<ComponentKey, ComponentStatus>;
  inspections: Inspection[];
  diagnoses: Diagnosis[];
  repairs: RepairOption[];
}

interface ApiResult<T> {
  records?: T[];
  record?: T;
  vehicle?: VehicleSummary;
  diagnosis?: Diagnosis;
  user?: { role?: string };
  error?: string;
  message?: string;
}

interface Props {
  onViewRepair: (repairId: string) => void;
}

const CAMERA_OPTIONS: { key: CameraPreset; label: string }[] = [
  { key: 'perspective', label: '3/4 view' },
  { key: 'front', label: 'Front' },
  { key: 'rear', label: 'Rear' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
  { key: 'roof', label: 'Roof' },
  { key: 'wheels', label: 'Wheels' },
];

const STATUS_STYLE: Record<WorkshopStatus, string> = {
  green: 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800',
  orange: 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800',
  red: 'bg-red-100 text-red-800 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-800',
  grey: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
};

const STATUS_DOT: Record<WorkshopStatus, string> = {
  green: 'bg-emerald-500',
  orange: 'bg-amber-500',
  red: 'bg-red-500',
  grey: 'bg-slate-400',
};

const SYMPTOM_SUGGESTIONS = [
  'Engine shakes at idle and misfires under acceleration',
  'Coolant temperature rises slowly and cabin heat is weak',
  'Battery warning appears and cranking is slow',
  'Check engine light with a catalyst efficiency code',
  'Fuel odor near the vehicle with an EVAP leak code',
  'Idle hunts with a lean air-fuel mixture code',
];

function errorMessage(result: ApiResult<unknown>, fallback: string): string {
  return result.message ?? result.error ?? fallback;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(status: WorkshopStatus): string {
  return {
    green: 'No fault found',
    orange: 'Check recommended',
    red: 'Fault indicated',
    grey: 'Not inspected',
  }[status];
}

export const SmartWorkshopView: React.FC<Props> = ({ onViewRepair }) => {
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [data, setData] = useState<WorkshopData | null>(null);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<ViewerMode>('exterior');
  const [style, setStyle] = useState<ViewStyle>('normal');
  const [preset, setPreset] = useState<CameraPreset>('perspective');
  const [resetToken, setResetToken] = useState(0);
  const [selected, setSelected] = useState<ComponentKey | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [relatedJobId, setRelatedJobId] = useState('');
  const [activeDiagnosis, setActiveDiagnosis] = useState<Diagnosis | null>(null);
  const [confirmedFault, setConfirmedFault] = useState('');
  const [customFault, setCustomFault] = useState('');
  const [mechanicNotes, setMechanicNotes] = useState('');
  const [inspectionComponent, setInspectionComponent] = useState<ComponentKey>('engine');
  const [inspectionCondition, setInspectionCondition] = useState<InspectionCondition>('no_fault_found');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inspectionJobId, setInspectionJobId] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = ['owner', 'manager', 'advisor'].includes(role);
  const statuses = data?.statuses ?? deriveComponentStatuses(
    SMART_WORKSHOP_CONFIG.components.map((entry) => entry.key), [], []);
  const selectedComponent = SMART_WORKSHOP_CONFIG.components.find((entry) => entry.key === selected) ?? null;
  const selectedStatus: ComponentStatus | null = selected ? statuses[selected] ?? null : null;

  const loadVehicles = useCallback(async () => {
    const response = await apiFetch('/api/vehicles?limit=100&sort=created_at&order=desc');
    const result = await response.json() as ApiResult<VehicleOption>;
    if (!response.ok) throw new Error(errorMessage(result, 'Could not load vehicles.'));
    const records = result.records ?? [];
    setVehicles(records);
    setVehicleId((current) => current && records.some((entry) => entry.id === current) ? current : records[0]?.id ?? '');
    return records;
  }, []);

  const refresh = useCallback(async (showSpinner: boolean) => {
    if (!vehicleId) {
      setData(null);
      setLoading(false);
      return;
    }
    if (showSpinner) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/smart-workshop/vehicles/${encodeURIComponent(vehicleId)}`);
      const result = await response.json() as (WorkshopData & ApiResult<never>);
      if (!response.ok) throw new Error(errorMessage(result, 'Could not load Smart Workshop data.'));
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Smart Workshop data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadVehicles(), apiFetch('/api/auth/me')])
      .then(async ([, userResponse]) => {
        const result = await userResponse.json() as ApiResult<never>;
        if (active && userResponse.ok) setRole(result.user?.role ?? '');
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not initialize the Smart Workshop.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadVehicles]);

  useEffect(() => {
    setActiveDiagnosis(null);
    setSelected(null);
    setRelatedJobId('');
    setInspectionJobId('');
    void refresh(false);
  }, [vehicleId, refresh]);

  const chooseComponent = useCallback((key: ComponentKey | null) => {
    setSelected(key);
    if (key) setInspectionComponent(key);
  }, []);

  const runDiagnosis = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    if (symptoms.trim().length < 10) {
      setError('Enter at least 10 characters describing the reported symptoms.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/diagnoses/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          symptoms: symptoms.trim(),
          include_context: includeContext,
          ...(relatedJobId ? { job_id: relatedJobId } : {}),
        }),
      });
      const result = await response.json() as ApiResult<Diagnosis>;
      if (!response.ok || !result.diagnosis) throw new Error(errorMessage(result, 'Could not run the analysis.'));
      setActiveDiagnosis(result.diagnosis);
      setConfirmedFault(result.diagnosis.predicted_fault);
      setCustomFault('');
      setMechanicNotes('');
      const component = result.diagnosis.affected_component;
      if (component) chooseComponent(component as ComponentKey);
      setNotice('Model suggestions saved. Review and verify them before any repair decision.');
      await refresh(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not run the analysis.');
    } finally {
      setBusy(false);
    }
  };

  const saveReview = async (reviewStatus: 'confirmed' | 'corrected' | 'dismissed') => {
    if (!activeDiagnosis) return;
    const verifiedFault = confirmedFault === 'Other mechanic finding' ? customFault.trim() : confirmedFault;
    if (reviewStatus !== 'dismissed' && verifiedFault.length < 2) {
      setError('Enter the fault found during inspection before saving this review.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/diagnoses/${encodeURIComponent(activeDiagnosis.id)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          review_status: reviewStatus,
          confirmed_fault: reviewStatus === 'dismissed' ? null : verifiedFault,
          mechanic_notes: mechanicNotes.trim() || null,
          ...(relatedJobId ? { job_id: relatedJobId } : {}),
        }),
      });
      const result = await response.json() as ApiResult<never> & { diagnosis?: Diagnosis };
      if (!response.ok) throw new Error(errorMessage(result, 'Could not save the mechanic review.'));
      setActiveDiagnosis({
        ...activeDiagnosis,
        review_status: reviewStatus,
        confirmed_fault: reviewStatus === 'dismissed' ? null : verifiedFault,
        mechanic_notes: mechanicNotes.trim() || null,
        reviewed_at: new Date().toISOString(),
      });
      setNotice(reviewStatus === 'dismissed' ? 'Suggestion dismissed and recorded.' : 'Mechanic review saved.');
      await refresh(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save the mechanic review.');
    } finally {
      setBusy(false);
    }
  };

  const createRepair = async () => {
    if (!activeDiagnosis || !data?.vehicle || !activeDiagnosis.confirmed_fault || activeDiagnosis.job_id) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: data.vehicle.customer_id,
          vehicle_id: data.vehicle.id,
          diagnosis_id: activeDiagnosis.id,
          service_type: 'Diagnostic Inspection',
          reported_problem: activeDiagnosis.reported_symptoms ?? 'AI-assisted inspection',
          inspection_notes: `Mechanic verified: ${activeDiagnosis.confirmed_fault}. ${activeDiagnosis.mechanic_notes ?? ''}`.trim(),
          additional_notes: 'Created from a mechanic-reviewed AI suggestion. Verify findings with the vehicle service procedure.',
        }),
      });
      const result = await response.json() as ApiResult<{ id?: string; repair_job_code?: string }>;
      if (!response.ok) throw new Error(errorMessage(result, 'Could not create the repair job.'));
      setNotice(`Repair job ${result.record?.repair_job_code ?? ''} created and linked.`);
      await refresh(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create the repair job.');
    } finally {
      setBusy(false);
    }
  };

  const saveInspection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vehicleId) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/component-inspections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component_name: inspectionComponent,
          condition_status: inspectionCondition,
          inspection_notes: inspectionNotes.trim() || null,
          inspection_date: inspectionDate,
          ...(inspectionJobId ? { job_id: inspectionJobId } : {}),
        }),
      });
      const result = await response.json() as ApiResult<Inspection>;
      if (!response.ok) throw new Error(errorMessage(result, 'Could not save the inspection.'));
      setInspectionNotes('');
      setNotice('Inspection finding saved; the 3D status has been updated.');
      setSelected(inspectionComponent);
      await refresh(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save the inspection.');
    } finally {
      setBusy(false);
    }
  };

  const componentRepairs = useMemo(() => {
    if (!selected || !data) return [];
    const component = SMART_WORKSHOP_CONFIG.components.find((entry) => entry.key === selected);
    if (!component) return [];
    return data.repairs.filter((repair) => {
      const text = `${repair.service_type ?? ''} ${repair.issue_description ?? ''}`.toLowerCase();
      return component.label.toLowerCase().split(/[\s/]+/).some((token) => token.length > 3 && text.includes(token));
    });
  }, [data, selected]);

  const componentDiagnoses = useMemo(() => {
    if (!selected || !data) return [];
    return data.diagnoses.filter((entry) => {
      const faultComponent = componentForFault(entry.confirmed_fault ?? entry.predicted_fault);
      return entry.affected_component === selected || faultComponent === selected;
    });
  }, [data, selected]);

  const counts = useMemo(() => {
    const values = Object.values(statuses);
    return {
      green: values.filter((entry) => entry.status === 'green').length,
      orange: values.filter((entry) => entry.status === 'orange').length,
      red: values.filter((entry) => entry.status === 'red').length,
      grey: values.filter((entry) => entry.status === 'grey').length,
    };
  }, [statuses]);

  return (
    <section className="mx-auto w-full max-w-[1600px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">Workshop intelligence</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <Box className="h-6 w-6 text-blue-600 dark:text-blue-400" /> AI Smart Workshop
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Interactive 3D inspection linked to this vehicle's records. AI output is a suggestion that a qualified mechanic must verify.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Select vehicle"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            className="min-w-64 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            {vehicles.length === 0 && <option value="">No vehicles registered</option>}
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.registration_number} · {vehicle.make} {vehicle.model}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={!vehicleId || refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div role="alert" className="flex items-start gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          <strong>Professional verification required.</strong> AI predictions are uncalibrated model scores and are not diagnoses or failure probabilities.
          The 3D body is a licensed generic illustration; internal components are a procedural inspection assembly, not an exact replica of this vehicle.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading && !data ? (
        <div className="grid min-h-96 place-items-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading Smart Workshop…</div>
        </div>
      ) : !vehicleId || !data ? (
        <div className="grid min-h-96 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
          <div>
            <CarFront className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-900 dark:text-white">No vehicle selected</p>
            <p className="mt-1 text-sm text-slate-500">Register a vehicle in Vehicle Management to start a 3D inspection.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Vehicle</p>
              <p className="mt-1 truncate text-lg font-bold text-slate-900 dark:text-white">{data.vehicle.registration_number}</p>
              <p className="truncate text-xs text-slate-500">{data.vehicle.make} {data.vehicle.model} · {data.vehicle.model_year}</p>
            </div>
            {(['green', 'orange', 'red', 'grey'] as WorkshopStatus[]).map((status) => (
              <div key={status} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{statusLabel(status)}</p>
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{counts[status]}</p>
                <p className="text-xs text-slate-500">of {SMART_WORKSHOP_CONFIG.components.length} components</p>
              </div>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.9fr)]">
            <div className="space-y-5">
              <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                      {(['exterior', 'internal'] as ViewerMode[]).map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setMode(item)}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${mode === item ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'}`}
                        >
                          {item} view
                        </button>
                      ))}
                    </div>
                    <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                      {(['normal', 'transparent', 'exploded'] as ViewStyle[]).map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setStyle(item)}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${style === item ? 'bg-slate-700 text-white shadow dark:bg-slate-600' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'}`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Camera preset"
                      value={preset}
                      onChange={(event) => setPreset(event.target.value as CameraPreset)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {CAMERA_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => { setPreset('perspective'); setResetToken((value) => value + 1); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset camera
                    </button>
                  </div>
                </div>
                <div className="h-[480px] p-3">
                  <Suspense fallback={<div className="grid h-full place-items-center rounded-xl bg-slate-950 text-sm text-slate-300"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> Loading interactive 3D…</div>}>
                    <VehicleViewer
                      statuses={statuses}
                      selected={selected}
                      mode={mode}
                      style={style}
                      preset={preset}
                      resetToken={resetToken}
                      onSelect={chooseComponent}
                    />
                  </Suspense>
                </div>
                <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5"><Crosshair className="h-3.5 w-3.5" /> Click a highlighted component to inspect it</span>
                  {(['green', 'orange', 'red', 'grey'] as WorkshopStatus[]).map((status) => (
                    <span key={status} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} /> {statusLabel(status)}</span>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300"><Sparkles className="h-5 w-5" /></span>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">AI fault analysis</h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Runs the existing trained classifier and saves every suggestion for review.</p>
                  </div>
                </div>
                <form onSubmit={runDiagnosis} className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="smart-symptoms" className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reported symptoms</label>
                    <textarea
                      id="smart-symptoms"
                      value={symptoms}
                      onChange={(event) => setSymptoms(event.target.value)}
                      maxLength={2000}
                      rows={3}
                      placeholder="Describe the symptom, warning light, DTC code and when it occurs…"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {SYMPTOM_SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setSymptoms((current) => current ? `${current}; ${suggestion}` : suggestion)}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          + {suggestion.length > 34 ? `${suggestion.slice(0, 34)}…` : suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} className="accent-blue-600" />
                      Include DTC codes found in repair notes
                    </label>
                    <select
                      aria-label="Related repair job"
                      value={relatedJobId}
                      onChange={(event) => setRelatedJobId(event.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      <option value="">No related repair job</option>
                      {(data.repairs ?? []).map((repair) => (
                        <option key={repair.id} value={repair.id}>{repair.repair_job_code} · {repair.service_type}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={busy || symptoms.trim().length < 10}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />} Run fault analysis
                  </button>
                </form>

                {activeDiagnosis && (
                  <div className="mt-5 space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">Model suggestions</p>
                        <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{activeDiagnosis.predicted_fault}</h3>
                        <p className="text-xs text-slate-500">
                          {(activeDiagnosis.confidence * 100).toFixed(1)}% model score ·
                          Component: {activeDiagnosis.affected_component
                            ? SMART_WORKSHOP_CONFIG.components.find((entry) => entry.key === activeDiagnosis.affected_component)?.label
                            : 'not mapped'}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[activeDiagnosis.review_status === 'pending' ? 'orange' : activeDiagnosis.review_status === 'dismissed' ? 'grey' : 'green']}`}>
                        {activeDiagnosis.review_status}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {(activeDiagnosis.predictions ?? []).map((candidate, index) => (
                        <button
                          key={`${candidate.fault_category}-${index}`}
                          type="button"
                          onClick={() => candidate.affected_component && chooseComponent(candidate.affected_component)}
                          className={`w-full rounded-xl border p-3 text-left transition hover:border-blue-400 ${index === 0 ? 'border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-800'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{candidate.fault_category}</p>
                            <span className="shrink-0 text-xs font-bold tabular-nums text-blue-600 dark:text-blue-300">{(candidate.confidence * 100).toFixed(1)}%</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{candidate.dtc_reference} · score only, not a failure probability</p>
                          {index === 0 && (
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div>
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Possible causes</p>
                                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-300">
                                  {(candidate.possible_causes ?? []).map((cause) => <li key={cause}>{cause}</li>)}
                                </ul>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Inspection / action</p>
                                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-300">
                                  {candidate.inspection_procedures.map((step) => <li key={step}>{step}</li>)}
                                </ul>
                              </div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                    {activeDiagnosis.model_version && (
                      <p className="text-[11px] text-slate-400">Model version: <span className="font-mono">{activeDiagnosis.model_version}</span></p>
                    )}

                    {activeDiagnosis.review_status === 'pending' && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                        <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"><Stethoscope className="h-4 w-4" /> Mechanic verification</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <select
                            aria-label="Verified fault"
                            value={confirmedFault}
                            onChange={(event) => setConfirmedFault(event.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          >
                            {(activeDiagnosis.predictions ?? []).map((candidate) => <option key={candidate.fault_category} value={candidate.fault_category}>{candidate.fault_category}</option>)}
                            <option value="Other mechanic finding">Other mechanic finding</option>
                          </select>
                          {confirmedFault === 'Other mechanic finding' && (
                            <input
                              aria-label="Mechanic finding"
                              value={customFault}
                              onChange={(event) => setCustomFault(event.target.value)}
                              maxLength={160}
                              placeholder="Enter verified fault"
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          )}
                        </div>
                        <textarea
                          aria-label="Inspection evidence"
                          value={mechanicNotes}
                          onChange={(event) => setMechanicNotes(event.target.value)}
                          rows={2}
                          maxLength={4000}
                          placeholder="Inspection evidence and verification notes…"
                          className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveReview(confirmedFault === activeDiagnosis.predicted_fault ? 'confirmed' : 'corrected')}
                            disabled={busy}
                            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-4 w-4" /> Save mechanic review
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveReview('dismissed')}
                            disabled={busy}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <X className="h-4 w-4" /> Dismiss suggestion
                          </button>
                        </div>
                      </div>
                    )}

                    {canManage && ['confirmed', 'corrected'].includes(activeDiagnosis.review_status) && !activeDiagnosis.job_id && (
                      <button
                        type="button"
                        onClick={() => void createRepair()}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Wrench className="h-4 w-4" /> Create linked repair job
                      </button>
                    )}
                    {activeDiagnosis.job_id && (
                      <button
                        type="button"
                        onClick={() => onViewRepair(activeDiagnosis.job_id as string)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                      >
                        View linked repair job <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </article>
            </div>

            <div className="space-y-5">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start gap-3">
                  <span className={`rounded-xl p-2.5 ${selectedStatus ? STATUS_STYLE[selectedStatus.status] : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                    <Eye className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">Component inspector</p>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedComponent?.label ?? 'No component selected'}</h2>
                  </div>
                </div>
                {selectedComponent && selectedStatus ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-slate-500">Current condition</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[selectedStatus.status]}`}>
                          {statusLabel(selectedStatus.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{selectedStatus.reason}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{selectedComponent.description}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Recommended inspection points</p>
                      <ul className="mt-2 space-y-1.5">
                        {selectedComponent.inspectionFocus.map((item) => (
                          <li key={item} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" /> {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Latest inspection</p>
                      {selectedStatus.latestInspection ? (
                        <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950/60">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{formatDate(selectedStatus.latestInspection.inspection_date)}</p>
                          <p className="mt-1 text-slate-600 dark:text-slate-300">{selectedStatus.latestInspection.inspection_notes || 'No notes recorded.'}</p>
                          <p className="mt-1 text-slate-500">By {selectedStatus.latestInspection.inspected_by_name ?? 'unknown'}</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No mechanic inspection recorded for this component.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Related repair history</p>
                      {componentRepairs.length === 0 && <p className="mt-2 text-xs text-slate-500">No matching repair job found in the ten most recent jobs.</p>}
                      <div className="mt-2 space-y-2">
                        {componentRepairs.map((repair) => (
                          <button key={repair.id} type="button" onClick={() => onViewRepair(repair.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-left text-xs hover:border-blue-300 dark:border-slate-800">
                            <span><span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{repair.repair_job_code}</span><br /><span className="text-slate-500">{repair.service_type} · {repair.repair_status}</span></span>
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">AI predictions for this component</p>
                      {componentDiagnoses.length === 0 && <p className="mt-2 text-xs text-slate-500">No saved prediction mapped to this component.</p>}
                      <div className="mt-2 space-y-2">
                        {componentDiagnoses.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => { setActiveDiagnosis(entry); setConfirmedFault(entry.confirmed_fault ?? entry.predicted_fault); setMechanicNotes(entry.mechanic_notes ?? ''); }}
                            className="w-full rounded-lg border border-slate-200 p-2.5 text-left text-xs hover:border-blue-300 dark:border-slate-800"
                          >
                            <p className="font-semibold text-slate-800 dark:text-slate-100">{entry.confirmed_fault ?? entry.predicted_fault}</p>
                            <p className="mt-1 text-slate-500">{formatDate(entry.created_at)} · {(entry.confidence * 100).toFixed(1)}% score · {entry.review_status}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 grid place-items-center rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
                    <div>
                      <ScanSearch className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Select a component</p>
                      <p className="mt-1 text-xs text-slate-500">Click a wheel, brake, steering node, or any internal assembly part.</p>
                    </div>
                  </div>
                )}
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Layers3 className="h-4 w-4 text-blue-600" /> Record inspection finding</h2>
                <p className="mt-1 text-xs text-slate-500">A GREEN status requires this explicit "no fault found" record; missing data stays GREY.</p>
                <form onSubmit={saveInspection} className="mt-4 space-y-3">
                  <select
                    aria-label="Inspection component"
                    value={inspectionComponent}
                    onChange={(event) => { setInspectionComponent(event.target.value as ComponentKey); setSelected(event.target.value as ComponentKey); }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {SMART_WORKSHOP_CONFIG.components.map((component) => <option key={component.key} value={component.key}>{component.label}</option>)}
                  </select>
                  <select
                    aria-label="Inspection condition"
                    value={inspectionCondition}
                    onChange={(event) => setInspectionCondition(event.target.value as InspectionCondition)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {INSPECTION_CONDITIONS.map((condition) => <option key={condition.value} value={condition.value}>{condition.label}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      aria-label="Inspection date"
                      value={inspectionDate}
                      onChange={(event) => setInspectionDate(event.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <select
                      aria-label="Inspection repair job"
                      value={inspectionJobId}
                      onChange={(event) => setInspectionJobId(event.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      <option value="">No linked job</option>
                      {(data.repairs ?? []).map((repair) => <option key={repair.id} value={repair.id}>{repair.repair_job_code}</option>)}
                    </select>
                  </div>
                  <textarea
                    aria-label="Inspection notes"
                    value={inspectionNotes}
                    onChange={(event) => setInspectionNotes(event.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="Measured values, evidence and next action…"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={busy || !vehicleId}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Save inspection finding
                  </button>
                </form>
              </article>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
