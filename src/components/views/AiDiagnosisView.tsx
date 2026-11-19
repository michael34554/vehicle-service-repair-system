import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Check, FilePlus2, LoaderCircle, Stethoscope, Wrench, X } from 'lucide-react';
import { apiFetch } from '../../api';

interface Vehicle {
  id: string;
  customer_id: string;
  registration_number: string;
  make: string;
  model: string;
  manufacturing_year: number;
  owner_name: string;
}

interface FaultCandidate {
  fault_category: string;
  confidence: number;
  dtc_reference: string;
  inspection_procedures: string[];
}

interface Diagnosis {
  id: string;
  vehicle_id: string;
  customer_id: string;
  job_id: string | null;
  reported_symptoms: string;
  predicted_fault: string;
  confidence: number;
  predictions: FaultCandidate[];
  review_status: 'pending' | 'confirmed' | 'corrected' | 'dismissed';
  confirmed_fault: string | null;
  mechanic_notes: string | null;
  created_by_name: string;
  created_at: string;
  reviewed_at: string | null;
  warning?: string;
}

interface RepairOption {
  id: string;
  repair_job_code: string;
  service_type: string;
  repair_status: string;
}

interface ApiResult<T> {
  records?: T[];
  diagnosis?: Diagnosis;
  record?: { id?: string; repair_job_code?: string };
  user?: { role?: string };
  error?: string;
  message?: string;
}

const SYMPTOM_OPTIONS = [
  'Rough or uneven idle',
  'Engine misfire or vibration',
  'Hesitation or loss of power',
  'Slow engine warm-up or weak cabin heat',
  'Fuel odor or failed emissions test',
  'Battery warning or slow cranking',
  'Check engine light',
  'Poor fuel economy',
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function errorMessage(result: ApiResult<unknown>, fallback: string): string {
  return result.message ?? result.error ?? fallback;
}

export const AiDiagnosisView: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [role, setRole] = useState('');
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [additionalSymptoms, setAdditionalSymptoms] = useState('');
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [repairs, setRepairs] = useState<RepairOption[]>([]);
  const [relatedJobId, setRelatedJobId] = useState('');
  const [activeDiagnosis, setActiveDiagnosis] = useState<Diagnosis | null>(null);
  const [confirmedFault, setConfirmedFault] = useState('');
  const [customFault, setCustomFault] = useState('');
  const [mechanicNotes, setMechanicNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const vehicle = vehicles.find((entry) => entry.id === vehicleId) ?? null;
  const symptomText = [selectedSymptoms.join('; '), additionalSymptoms.trim()].filter(Boolean).join('. ');
  const verifiedFault = confirmedFault === 'Other mechanic finding' ? customFault : confirmedFault;
  const canCreateRepair = ['owner', 'manager', 'advisor'].includes(role);

  useEffect(() => {
    Promise.all([apiFetch('/api/vehicles?limit=100'), apiFetch('/api/auth/me')])
      .then(async ([vehicleResponse, userResponse]) => {
        const vehicleResult = await vehicleResponse.json() as ApiResult<Vehicle>;
        const userResult = await userResponse.json() as ApiResult<unknown>;
        if (!vehicleResponse.ok) throw new Error(errorMessage(vehicleResult, 'Could not load vehicles.'));
        setVehicles(vehicleResult.records ?? []);
        setVehicleId((vehicleResult.records ?? [])[0]?.id ?? '');
        if (userResponse.ok) setRole(userResult.user?.role ?? '');
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not initialize diagnosis.'));
  }, []);

  useEffect(() => {
    if (!vehicleId) {
      setDiagnoses([]);
      setRepairs([]);
      return;
    }
    let active = true;
    Promise.all([
      apiFetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/diagnoses`),
      apiFetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/repairs`),
    ])
      .then(async ([diagnosisResponse, repairResponse]) => {
        const diagnosisResult = await diagnosisResponse.json() as ApiResult<Diagnosis>;
        const repairResult = await repairResponse.json() as ApiResult<RepairOption>;
        if (!diagnosisResponse.ok) throw new Error(errorMessage(diagnosisResult, 'Could not load diagnosis history.'));
        if (!repairResponse.ok) throw new Error(errorMessage(repairResult, 'Could not load repair jobs.'));
        if (active) {
          setDiagnoses(diagnosisResult.records ?? []);
          setRepairs(repairResult.records ?? []);
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load vehicle history.');
      });
    return () => { active = false; };
  }, [vehicleId]);

  const refreshDiagnoses = async () => {
    if (!vehicleId) return;
    const response = await apiFetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/diagnoses`);
    const result = await response.json() as ApiResult<Diagnosis>;
    if (!response.ok) throw new Error(errorMessage(result, 'Could not refresh diagnosis history.'));
    setDiagnoses(result.records ?? []);
  };

  const runDiagnosis = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!vehicleId) {
      setError('Select a vehicle before requesting a diagnosis.');
      return;
    }
    if (symptomText.length < 10) {
      setError('Select or describe symptoms using at least 10 characters.');
      return;
    }
    if (symptomText.length > 2000) {
      setError('Keep the combined symptoms within 2000 characters.');
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch('/api/diagnoses/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId, symptoms: symptomText, ...(relatedJobId ? { job_id: relatedJobId } : {}) }),
      });
      const result = await response.json() as ApiResult<Diagnosis>;
      if (!response.ok || !result.diagnosis) throw new Error(errorMessage(result, 'Could not run diagnosis.'));
      setActiveDiagnosis(result.diagnosis);
      setConfirmedFault(result.diagnosis.predicted_fault);
      setCustomFault('');
      setMechanicNotes('');
      await refreshDiagnoses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not run diagnosis.');
    } finally {
      setBusy(false);
    }
  };

  const saveReview = async (reviewStatus: Diagnosis['review_status']) => {
    if (!activeDiagnosis) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/diagnoses/${encodeURIComponent(activeDiagnosis.id)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          review_status: reviewStatus,
          confirmed_fault: reviewStatus === 'dismissed' ? null : verifiedFault,
          mechanic_notes: mechanicNotes,
          ...(relatedJobId ? { job_id: relatedJobId } : {}),
        }),
      });
      const result = await response.json() as ApiResult<Diagnosis>;
      if (!response.ok) throw new Error(errorMessage(result, 'Could not save mechanic review.'));
      setActiveDiagnosis({
        ...activeDiagnosis,
        review_status: reviewStatus,
        confirmed_fault: reviewStatus === 'dismissed' ? null : verifiedFault,
        mechanic_notes: mechanicNotes || null,
        job_id: relatedJobId || activeDiagnosis.job_id,
        reviewed_at: new Date().toISOString(),
      });
      setNotice(reviewStatus === 'dismissed' ? 'Suggestion dismissed.' : 'Mechanic review saved.');
      await refreshDiagnoses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save mechanic review.');
    } finally {
      setBusy(false);
    }
  };

  const createRepair = async () => {
    if (!activeDiagnosis || !vehicle || !activeDiagnosis.confirmed_fault || activeDiagnosis.job_id) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: vehicle.customer_id,
          vehicle_id: vehicle.id,
          diagnosis_id: activeDiagnosis.id,
          service_type: 'Diagnostic Inspection',
          reported_problem: activeDiagnosis.reported_symptoms,
          inspection_notes: `Mechanic verified: ${activeDiagnosis.confirmed_fault}. ${activeDiagnosis.mechanic_notes ?? ''}`.trim(),
          additional_notes: 'Created from a mechanic-reviewed AI fault diagnosis. Verify findings with the vehicle service procedure.',
        }),
      });
      const result = await response.json() as ApiResult<Diagnosis>;
      if (!response.ok) throw new Error(errorMessage(result, 'Could not create repair job.'));
      setActiveDiagnosis({ ...activeDiagnosis, job_id: result.record?.id ?? 'linked' });
      setNotice(`Repair job ${result.record?.repair_job_code ?? ''} created and linked.`);
      await refreshDiagnoses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create repair job.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSymptom = (symptom: string) => {
    setSelectedSymptoms((current) => current.includes(symptom)
      ? current.filter((entry) => entry !== symptom)
      : [...current, symptom]);
  };

  return (
    <section className="mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">Workshop tools</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white"><Stethoscope className="h-6 w-6 text-blue-600" />AI Fault Diagnosis</h1>
          <p className="mt-1 text-sm text-slate-500">Symptom-based suggestions for mechanic review.</p>
        </div>
        {vehicle && <div className="text-sm text-slate-600 dark:text-slate-300"><span className="font-semibold">Selected vehicle</span> · {vehicle.registration_number} · {vehicle.make} {vehicle.model}</div>}
      </header>

      <div role="alert" className="flex gap-3 border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <p><strong>Professional verification required.</strong> AI predictions are suggestions, not a diagnosis. A qualified mechanic must inspect and confirm findings before repair decisions. Confidence is a model score and is not calibrated to real-world failure probability.</p>
      </div>

      {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>{error || notice}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <form onSubmit={runDiagnosis} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <label htmlFor="diagnosis-vehicle" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Vehicle</label>
            <select id="diagnosis-vehicle" value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setActiveDiagnosis(null); setRelatedJobId(''); }} required className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="">Select a vehicle</option>
              {vehicles.map((entry) => <option key={entry.id} value={entry.id}>{entry.registration_number} · {entry.manufacturing_year} {entry.make} {entry.model} · {entry.owner_name}</option>)}
            </select>
            {vehicles.length === 0 && <p className="mt-2 text-xs text-slate-500">No accessible vehicles were found. Mechanics see vehicles with an assigned repair job.</p>}
          </div>

          {repairs.length > 0 && <div>
            <label htmlFor="diagnosis-job" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Related repair job <span className="font-normal text-slate-500">(optional)</span></label>
            <select id="diagnosis-job" value={relatedJobId} onChange={(event) => setRelatedJobId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              <option value="">No existing repair job</option>
              {repairs.map((repair) => <option key={repair.id} value={repair.id}>{repair.repair_job_code} · {repair.service_type} · {repair.repair_status}</option>)}
            </select>
          </div>}

          <fieldset>
            <legend className="text-sm font-semibold text-slate-800 dark:text-slate-100">Select observed symptoms</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {SYMPTOM_OPTIONS.map((symptom) => <label key={symptom} className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={selectedSymptoms.includes(symptom)} onChange={() => toggleSymptom(symptom)} className="h-4 w-4 accent-blue-600" />
                {symptom}
              </label>)}
            </div>
          </fieldset>

          <div>
            <label htmlFor="diagnosis-symptoms" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Additional symptoms or scan observations</label>
            <textarea id="diagnosis-symptoms" value={additionalSymptoms} onChange={(event) => setAdditionalSymptoms(event.target.value)} rows={4} maxLength={2000} placeholder="Describe when the symptom occurs, warning lights, scan codes, and test observations." className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <p className="mt-1 text-xs text-slate-500">{symptomText.length}/2000 characters · More specific observations help the model match the training examples.</p>
          </div>

          <button type="submit" disabled={busy || !vehicleId} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}Run fault analysis
          </button>
          <p className="text-xs leading-5 text-slate-500">Training corpus: 48 curated examples based on OBD-II trouble-code descriptions. Holdout metrics describe this small starter set only, not field performance.</p>
        </form>

        <div className="space-y-5">
          {activeDiagnosis ? <article className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">Model suggestions</p><h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{activeDiagnosis.predicted_fault}</h2></div>
              <span className="shrink-0 rounded-md bg-blue-50 px-2.5 py-1 text-sm font-bold text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">{(activeDiagnosis.confidence * 100).toFixed(1)}% score</span>
            </div>
            <div className="mt-4 space-y-3">
              {activeDiagnosis.predictions.map((candidate) => <div key={candidate.fault_category} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-slate-900 dark:text-white">{candidate.fault_category}</h3><span className="text-xs text-slate-500">{candidate.dtc_reference} · {(candidate.confidence * 100).toFixed(1)}%</span></div>
                {candidate === activeDiagnosis.predictions[0] && <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300">{candidate.inspection_procedures.map((procedure) => <li key={procedure} className="flex gap-2"><Wrench className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{procedure}</li>)}</ul>}
              </div>)}
            </div>
            <p className="mt-3 text-xs text-slate-500">Model output is a ranking from the trained classifier. Similar symptom wording and this small curated corpus can affect scores.</p>
          </article> : <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center dark:border-slate-700 dark:bg-slate-900/50"><div><Stethoscope className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">No analysis run for this vehicle</p><p className="mt-1 text-xs text-slate-500">Select symptoms to see ranked fault candidates.</p></div></div>}

          {activeDiagnosis?.review_status === 'pending' && <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Mechanic review</h2>
            <label htmlFor="confirmed-fault" className="block text-sm font-medium text-slate-700 dark:text-slate-200">Verified fault category</label>
            <select id="confirmed-fault" value={confirmedFault} onChange={(event) => setConfirmedFault(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              {activeDiagnosis.predictions.map((candidate) => <option key={candidate.fault_category} value={candidate.fault_category}>{candidate.fault_category}</option>)}
              <option value="Other mechanic finding">Other mechanic finding</option>
            </select>
            {confirmedFault === 'Other mechanic finding' && <input aria-label="Enter verified fault category" value={customFault} onChange={(event) => setCustomFault(event.target.value)} maxLength={160} placeholder="Enter the mechanic's finding" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />}
            <textarea value={mechanicNotes} onChange={(event) => setMechanicNotes(event.target.value)} maxLength={4000} rows={2} placeholder="Inspection evidence or correction notes (optional)" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !verifiedFault.trim()} onClick={() => void saveReview(verifiedFault === activeDiagnosis.predicted_fault ? 'confirmed' : 'corrected')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><Check className="h-4 w-4" />Save mechanic review</button>
              <button type="button" disabled={busy} onClick={() => void saveReview('dismissed')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"><X className="h-4 w-4" />Dismiss suggestion</button>
            </div>
          </section>}

          {activeDiagnosis && ['confirmed', 'corrected'].includes(activeDiagnosis.review_status) && !activeDiagnosis.job_id && canCreateRepair && <button type="button" disabled={busy} onClick={() => void createRepair()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"><FilePlus2 className="h-4 w-4" />Create linked repair job</button>}
          {activeDiagnosis?.job_id && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">This diagnosis is linked to a repair job.</p>}

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Recent vehicle diagnoses</h2>
            {diagnoses.length === 0 ? <p className="mt-3 text-sm text-slate-500">No diagnoses saved for this vehicle yet.</p> : <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{diagnoses.map((entry) => <button type="button" key={entry.id} onClick={() => { setActiveDiagnosis(entry); setConfirmedFault(entry.confirmed_fault ?? entry.predicted_fault); setMechanicNotes(entry.mechanic_notes ?? ''); }} className="block w-full py-3 text-left first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-slate-800 dark:text-slate-100">{entry.confirmed_fault ?? entry.predicted_fault}</span><span className={`rounded px-2 py-0.5 text-xs font-semibold ${entry.review_status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' : entry.review_status === 'dismissed' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>{entry.review_status}</span></div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{entry.reported_symptoms}</p><p className="mt-1 text-xs text-slate-400">{formatDate(entry.created_at)} · {(entry.confidence * 100).toFixed(1)}% model score</p>
            </button>)}</div>}
          </section>
        </div>
      </div>
    </section>
  );
};
