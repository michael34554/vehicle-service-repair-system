import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, LoaderCircle, PackageSearch, RefreshCw, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { apiFetch } from '../../api';

interface Recommendation {
  id: string;
  part_id: string;
  sku: string;
  name: string;
  category: string | null;
  quantity: number;
  selling_price_cents: number;
  score: number;
  status: string;
  feedback: string | null;
  reason_json: string | { fault?: string; component_key?: string; compatibility_source?: string; advisory_only?: boolean };
  created_at: string;
}

interface ResponseBody {
  recommendations?: Recommendation[];
  error?: string;
  message?: string;
}

interface Props {
  vehicleId: string;
  canReview: boolean;
}

function reasonOf(value: Recommendation['reason_json']): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value;
}

export function PartsRecommendationPanel({ vehicleId, canReview }: Props) {
  const [records, setRecords] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/intelligence/vehicles/${encodeURIComponent(vehicleId)}/parts`);
      const result = await response.json() as ResponseBody;
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not load part recommendations.');
      setRecords(result.recommendations ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load part recommendations.');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/intelligence/parts/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId }),
      });
      const result = await response.json() as ResponseBody;
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not generate recommendations.');
      await load();
      setNotice(`${result.recommendations?.length ?? 0} advisory recommendation(s) generated. Compatibility must still be confirmed by a mechanic.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not generate recommendations.');
    } finally {
      setBusy(false);
    }
  };

  const sendFeedback = async (id: string, feedback: 'accepted' | 'rejected') => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/intelligence/parts/recommendations/${encodeURIComponent(id)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      const result = await response.json() as ResponseBody;
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not save feedback.');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save feedback.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><PackageSearch className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Parts recommendations</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            Advisory only. Results use confirmed diagnosis context, recorded compatibility and live stock; they do not reserve stock or create repair issues.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />}
          <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" title="Refresh recommendations"><RefreshCw className="h-4 w-4" /></button>
          {canReview && <button type="button" onClick={() => void generate()} disabled={busy || !vehicleId} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Generate advisory list</button>}
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      {records.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700">No advisory recommendations have been recorded for this vehicle.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-3">Part</th><th className="py-2 pr-3">Stock</th><th className="py-2 pr-3">Score</th><th className="py-2 pr-3">Basis</th><th className="py-2">Feedback</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {records.map((record) => {
                const reason = reasonOf(record.reason_json);
                return (
                  <tr key={record.id}>
                    <td className="py-2 pr-3"><p className="font-semibold text-slate-900 dark:text-white">{record.name}</p><p className="text-slate-500">{record.sku} · {record.category ?? 'Uncategorised'}</p></td>
                    <td className="py-2 pr-3 tabular-nums text-slate-600 dark:text-slate-300">{record.quantity} on hand</td>
                    <td className="py-2 pr-3 tabular-nums text-slate-600 dark:text-slate-300">{Number(record.score).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-slate-500"><span>{String(reason.fault ?? 'No confirmed diagnosis')}</span><br /><span>{String(reason.compatibility_source ?? 'workshop stock')}</span></td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {record.feedback ? <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-800">{record.feedback === 'rejected' ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}{record.feedback}</span> : (
                          <>
                            <button type="button" disabled={!canReview || busy} onClick={() => void sendFeedback(record.id, 'accepted')} className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950/40" title="Accept"><ThumbsUp className="h-3.5 w-3.5" /></button>
                            <button type="button" disabled={!canReview || busy} onClick={() => void sendFeedback(record.id, 'rejected')} className="rounded p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/40" title="Reject"><ThumbsDown className="h-3.5 w-3.5" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Confirm fitment against the vehicle and manufacturer data before issuing any part.</p>
        </div>
      )}
    </section>
  );
}
