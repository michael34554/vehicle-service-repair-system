import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../api';

interface ModelMetric {
  model: string;
  accuracy: number;
  weighted_precision: number;
  weighted_recall: number;
  weighted_f1: number;
}

interface Evaluation {
  dataset?: string;
  dataset_examples?: number;
  provenance?: string;
  provenance_counts?: Record<string, number>;
  structured_inputs?: string[];
  data_limitations?: string;
  prediction_warning?: string;
  evaluation?: {
    method?: string;
    leakage_check?: {
      train_source_examples?: number;
      test_source_examples?: number;
      overlapping_source_examples?: number;
    };
    train_examples?: number;
    test_examples?: number;
    models?: ModelMetric[];
    confidence_calibration?: { method?: string; fitted_examples?: number; artifact?: string };
    per_model?: { manufacturer_model: string; examples: number; accuracy: number }[];
  };
}

interface TrainingRun {
  id: string;
  dataset_path: string;
  status: string;
  model_version: string | null;
  provenance_json: string | null;
  error_text: string | null;
  initiated_by_name: string | null;
  created_at: string;
  finished_at: string | null;
}

interface ModelResponse {
  evaluation?: Evaluation | null;
  status?: string;
  note?: string;
  error?: string;
  message?: string;
  runs?: TrainingRun[];
  result?: Evaluation;
  run?: { id: string; status: string };
}

function percent(value: number | undefined): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—';
}

function modelName(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function AiModelPanel({ canRetrain = false }: { canRetrain?: boolean }) {
  const [data, setData] = useState<ModelResponse | null>(null);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    apiFetch('/api/smart-workshop/ai-model', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as ModelResponse;
        if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not load model evaluation.');
        setData(result);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load model evaluation.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!canRetrain) return;
    const controller = new AbortController();
    apiFetch('/api/ai/training-runs', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as ModelResponse;
        if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not load training history.');
        setRuns(result.runs ?? []);
      })
      .catch(() => { /* Training history is supplementary; the evaluation above is authoritative. */ });
    return () => controller.abort();
  }, [canRetrain]);

  const retrain = async () => {
    setRetraining(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/ai/retrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const result = await response.json() as ModelResponse;
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not retrain the model.');
      setNotice(`Retraining completed: ${String(result.run?.status ?? 'succeeded')}. The evaluation below has been refreshed.`);
      setData((current) => ({
        ...(current ?? {}),
        evaluation: result.result ?? current?.evaluation ?? null,
        note: 'Metrics come from the most recent recorded holdout evaluation. Data provenance and limitations must still be checked before operational use.',
      }));
      const history = await apiFetch('/api/ai/training-runs');
      if (history.ok) setRuns(((await history.json()) as ModelResponse).runs ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not retrain the model.');
    } finally {
      setRetraining(false);
    }
  };

  const evaluation = data?.evaluation;
  const models = evaluation?.evaluation?.models ?? [];
  const leakage = evaluation?.evaluation?.leakage_check;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><Activity className="h-5 w-5 text-blue-600 dark:text-blue-400" /> AI model evaluation</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            {data?.note ?? 'Metrics are read from the saved training evaluation. No result is a confirmed diagnosis.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="inline-flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading…</span>}
          {canRetrain && <button type="button" onClick={() => void retrain()} disabled={retraining} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${retraining ? 'animate-spin' : ''}`} />{retraining ? 'Retraining…' : 'Retrain from verified outcomes'}</button>}
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      {!loading && !evaluation && !error && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          No recorded evaluation is available. Train the existing Python service with <code className="font-mono">python ml/diagnosis.py train</code>.
        </p>
      )}

      {evaluation && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Status: {data?.status ?? 'unknown'}</span>
            <span className="rounded bg-violet-100 px-2 py-1 font-semibold text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">Data: {evaluation.provenance ?? 'not recorded'}</span>
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{evaluation.dataset_examples ?? '—'} rows</span>
            {evaluation.evaluation?.confidence_calibration && <span className="rounded bg-emerald-100 px-2 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">Calibrated: {evaluation.evaluation.confidence_calibration.fitted_examples ?? '—'} holdout rows</span>}
            {leakage && (
              <span className={`rounded px-2 py-1 font-semibold ${leakage.overlapping_source_examples === 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'}`}>
                Leakage check: {leakage.overlapping_source_examples ?? '—'} overlapping source example(s)
              </span>
            )}
          </div>
          <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">{evaluation.evaluation?.method ?? 'Evaluation method not recorded.'}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr><th className="py-2 pr-3">Model</th><th className="py-2 pr-3">Accuracy</th><th className="py-2 pr-3">Precision</th><th className="py-2 pr-3">Recall</th><th className="py-2">F1</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {models.map((model) => (
                  <tr key={model.model} className={model.model === 'random_forest' ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}>
                    <td className="py-2 pr-3">{modelName(model.model)}{model.model === 'random_forest' ? ' (primary)' : ''}</td>
                    <td className="py-2 pr-3 tabular-nums">{percent(model.accuracy)}</td>
                    <td className="py-2 pr-3 tabular-nums">{percent(model.weighted_precision)}</td>
                    <td className="py-2 pr-3 tabular-nums">{percent(model.weighted_recall)}</td>
                    <td className="py-2 tabular-nums">{percent(model.weighted_f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {evaluation.provenance_counts && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Sources: {Object.entries(evaluation.provenance_counts).map(([source, count]) => `${source} (${count})`).join(', ')}</p>
          )}
          {(evaluation.evaluation?.per_model?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200">Holdout accuracy by make/model</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {evaluation.evaluation?.per_model?.map((item) => <span key={item.manufacturer_model} className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.manufacturer_model}: {percent(item.accuracy)} ({item.examples})</span>)}
              </div>
            </div>
          )}
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {evaluation.data_limitations ?? 'Training data provenance must be checked before operational use.'} Confidence values are calibrated estimates, not verified failure probabilities.
          </p>
        </div>
      )}

      {canRetrain && runs.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Training audit trail</h3>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            {runs.slice(0, 5).map((run) => <li key={run.id}><span className="font-semibold capitalize text-slate-700 dark:text-slate-200">{run.status}</span> · {run.initiated_by_name ?? 'Unknown'} · {new Date(run.created_at).toLocaleString()} · {run.model_version ?? 'no model version'}{run.error_text ? ` · ${run.error_text}` : ''}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
