import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Activity, AlertTriangle, CarFront, DatabaseZap, LoaderCircle, RefreshCw, ScanLine, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../api';

interface Consent {
  is_granted: number | boolean;
  granted_at: string | null;
  revoked_at: string | null;
  recorded_by_name: string | null;
}

interface TwinState {
  odometer_km: number | null;
  state_json: Record<string, unknown>;
  source: string;
  last_signal_at: string;
  updated_at: string;
}

interface TelemetryEvent {
  signal_key: string;
  signal_value_json: string;
  observed_at: string;
  source: string;
}

interface ApiBody {
  consent?: Consent | null;
  state?: TwinState | null;
  events?: TelemetryEvent[];
  decoded?: Record<string, unknown>;
  provider?: string;
  cached?: boolean;
  accepted?: number;
  error?: string;
  message?: string;
}

interface Props {
  vehicleId: string;
  canManage: boolean;
}

export function TwinPanel({ vehicleId, canManage }: Props) {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [state, setState] = useState<TwinState | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signalKey, setSignalKey] = useState('');
  const [signalValue, setSignalValue] = useState('');
  const [vin, setVin] = useState('');
  const [decoded, setDecoded] = useState<{ payload: Record<string, unknown>; provider: string; cached: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError('');
    try {
      const [consentResponse, stateResponse, historyResponse] = await Promise.all([
        apiFetch(`/api/twin/vehicles/${encodeURIComponent(vehicleId)}/consent`),
        apiFetch(`/api/twin/vehicles/${encodeURIComponent(vehicleId)}/state`),
        apiFetch(`/api/twin/vehicles/${encodeURIComponent(vehicleId)}/history?limit=25`),
      ]);
      const [consentBody, stateBody, historyBody] = await Promise.all([
        consentResponse.json() as Promise<ApiBody>,
        stateResponse.json() as Promise<ApiBody>,
        historyResponse.json() as Promise<ApiBody>,
      ]);
      if (!consentResponse.ok) throw new Error(consentBody.message ?? consentBody.error ?? 'Could not read telemetry consent.');
      if (!stateResponse.ok) throw new Error(stateBody.message ?? stateBody.error ?? 'Could not read the vehicle twin.');
      if (!historyResponse.ok) throw new Error(historyBody.message ?? historyBody.error ?? 'Could not read telemetry history.');
      setConsent(consentBody.consent ?? null);
      setState(stateBody.state ?? null);
      setEvents(historyBody.events ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load digital twin data.');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => { void load(); }, [load]);

  const readBody = async (response: Response, fallback: string): Promise<ApiBody> => {
    const body = await response.json() as ApiBody;
    if (!response.ok) throw new Error(body.message ?? body.error ?? fallback);
    return body;
  };

  const updateConsent = async (granted: boolean) => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/twin/vehicles/${encodeURIComponent(vehicleId)}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_granted: granted }),
      });
      await readBody(response, 'Could not update telemetry consent.');
      await load();
      setNotice(granted ? 'Telemetry consent recorded.' : 'Telemetry consent revoked; further ingestion is blocked.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update telemetry consent.');
    } finally {
      setBusy(false);
    }
  };

  const submitSignal = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let value: unknown = signalValue;
      if (/^-?\d+(\.\d+)?$/.test(signalValue.trim())) value = Number(signalValue);
      else if (/^(true|false)$/i.test(signalValue.trim())) value = signalValue.trim().toLowerCase() === 'true';
      const response = await apiFetch('/api/twin/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          source: 'manual_workshop_entry',
          signals: [{ signal_key: signalKey.trim(), value, observed_at: new Date().toISOString() }],
        }),
      });
      const body = await readBody(response, 'Could not record telemetry.');
      setSignalKey('');
      setSignalValue('');
      await load();
      setNotice(`${body.accepted ?? 1} signal accepted.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not record telemetry.');
    } finally {
      setBusy(false);
    }
  };

  const decodeVin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/twin/vin-decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin: vin.trim() }),
      });
      const body = await readBody(response, 'Could not decode the VIN.');
      setDecoded({ payload: body.decoded ?? {}, provider: body.provider ?? 'unknown', cached: body.cached === true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not decode the VIN.');
    } finally {
      setBusy(false);
    }
  };

  const granted = consent?.is_granted === 1 || consent?.is_granted === true;
  const stateEntries = Object.entries(state?.state_json ?? {}).filter(([key]) => key !== 'odometer_km');

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><CarFront className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Digital twin and telemetry</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            The twin contains only telemetry explicitly received for this vehicle. No telematics device or OEM feed is assumed to be connected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />}
          <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" title="Refresh twin"><RefreshCw className="h-4 w-4" /></button>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${granted ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            <ShieldCheck className="h-3.5 w-3.5" /> {granted ? 'Consent granted' : 'Consent not recorded'}
          </span>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Current state</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-slate-500">Odometer</dt><dd className="mt-0.5 font-semibold text-slate-900 dark:text-white">{state?.odometer_km ?? 'Not recorded'} km</dd></div>
            <div><dt className="text-slate-500">Source</dt><dd className="mt-0.5 font-semibold text-slate-900 dark:text-white">{state?.source ?? '—'}</dd></div>
            <div className="col-span-2"><dt className="text-slate-500">Last signal</dt><dd className="mt-0.5 font-semibold text-slate-900 dark:text-white">{state?.last_signal_at ? new Date(state.last_signal_at).toLocaleString() : '—'}</dd></div>
          </dl>
          {stateEntries.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
              {stateEntries.map(([key, value]) => <p key={key} className="flex justify-between gap-2"><span className="text-slate-500">{key}</span><span className="truncate font-medium text-slate-800 dark:text-slate-200">{String(value)}</span></p>)}
            </div>
          )}
          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void updateConsent(true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Grant telemetry consent</button>
              <button type="button" disabled={busy || !granted} onClick={() => void updateConsent(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Revoke consent</button>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><DatabaseZap className="h-4 w-4 text-violet-600 dark:text-violet-400" /> Record a signal</h3>
          {!granted && <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Record consent before the API accepts telemetry.</p>}
          <form onSubmit={(event) => void submitSignal(event)} className="mt-3 space-y-2">
            <input required value={signalKey} onChange={(event) => setSignalKey(event.target.value)} placeholder="Signal key (e.g. battery_voltage)" className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <input required value={signalValue} onChange={(event) => setSignalValue(event.target.value)} placeholder="Value (number, true/false, or text)" className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <button type="submit" disabled={busy || !canManage || !granted} className="w-full rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700">Record telemetry signal</button>
          </form>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Recent signals</h3>
          {events.length === 0 ? <p className="mt-2 text-xs text-slate-500">No telemetry events recorded.</p> : (
            <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto text-xs">
              {events.map((event, index) => <li key={`${event.signal_key}-${index}`} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60"><span className="font-semibold text-slate-800 dark:text-slate-200">{event.signal_key}</span> = <span className="text-slate-600 dark:text-slate-300">{event.signal_value_json}</span><p className="mt-0.5 text-[10px] text-slate-400">{event.source} · {new Date(event.observed_at).toLocaleString()}</p></li>)}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><ScanLine className="h-4 w-4 text-blue-600 dark:text-blue-400" /> VIN decode</h3>
          <p className="mt-1 text-[11px] text-slate-500">Uses a configured external provider and caches verified responses. Without a provider, only cached VINs can be returned.</p>
          <form onSubmit={(event) => void decodeVin(event)} className="mt-3 flex gap-2">
            <input required minLength={17} maxLength={17} value={vin} onChange={(event) => setVin(event.target.value.toUpperCase())} placeholder="17-character VIN" className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <button type="submit" disabled={busy || !canManage} className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-blue-600">Decode</button>
          </form>
          {decoded && <p className="mt-2 break-words rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-950/60 dark:text-slate-300"><strong>{decoded.cached ? 'Cached' : 'Decoded'}</strong> via {decoded.provider}: {JSON.stringify(decoded.payload)}</p>}
        </div>
      </div>
    </section>
  );
}
