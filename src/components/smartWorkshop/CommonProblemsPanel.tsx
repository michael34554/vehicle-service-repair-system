import { useEffect, useState } from 'react';
import { AlertTriangle, BrainCircuit, History, LibraryBig, LoaderCircle } from 'lucide-react';
import { apiFetch } from '../../api';
import { isComponentKey, type ComponentKey } from '@/shared/smartWorkshop';

interface KnowledgeRecord {
  id: string;
  fault_name: string;
  description: string;
  provenance: string;
  fidelity_note?: string | null;
  severity?: string | null;
  system_key: string;
  component_key: string | null;
  symptoms?: string[];
  possible_causes?: string[];
  dtc_codes?: string[];
}

interface HistoricalRecord {
  id: string;
  repair_job_code?: string | null;
  service_type?: string | null;
  problems_identified?: string | null;
  inspection_findings?: string | null;
  recommendations?: string | null;
  created_at: string;
}

interface PredictionRecord {
  id: string;
  predicted_fault: string;
  confirmed_fault?: string | null;
  review_status: string;
  confidence: number;
  created_at: string;
  predictions?: { fault_category: string; confidence: number }[];
}

interface ProblemCategory {
  label: string;
  description: string;
  records: (KnowledgeRecord | HistoricalRecord | PredictionRecord)[];
}

interface ProblemsResponse {
  categories?: {
    knowledge_base?: ProblemCategory;
    historical?: ProblemCategory;
    ai_predictions?: ProblemCategory;
  };
  separation_note?: string;
  error?: string;
  message?: string;
}

interface Props {
  vehicleId: string;
  refreshToken: number;
  onSelectComponent?: (key: ComponentKey) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function provenanceStyle(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'verified') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
  if (normalized === 'synthetic') return 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function componentLabel(value: string | null): string | null {
  if (!value || !isComponentKey(value)) return null;
  return value.replace(/_/g, ' ');
}

export function CommonProblemsPanel({ vehicleId, refreshToken, onSelectComponent }: Props) {
  const [data, setData] = useState<ProblemsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vehicleId) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    apiFetch(`/api/smart-workshop/vehicles/${encodeURIComponent(vehicleId)}/common-problems`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as ProblemsResponse;
        if (!response.ok) throw new Error(result.message ?? result.error ?? 'Could not load common problems.');
        setData(result);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load common problems.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [vehicleId, refreshToken]);

  const categories = [
    { key: 'knowledge_base' as const, icon: LibraryBig, tone: 'text-blue-600 dark:text-blue-400' },
    { key: 'historical' as const, icon: History, tone: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'ai_predictions' as const, icon: BrainCircuit, tone: 'text-violet-600 dark:text-violet-400' },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Common problems</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            {data?.separation_note ?? 'Reference knowledge, workshop history and model suggestions are kept separate.'}
          </p>
        </div>
        {loading && <span className="inline-flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading…</span>}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {categories.map(({ key, icon: Icon, tone }) => {
          const category = data?.categories?.[key];
          return (
            <div key={key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{category?.label ?? '—'}</h3>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{category?.description ?? 'No data available.'}</p>
                </div>
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-200">{category?.records?.length ?? 0} record(s)</p>
              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto pr-1">
                {(category?.records ?? []).length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700">No records in this category.</p>
                )}
                {key === 'knowledge_base' && ((category?.records ?? []) as KnowledgeRecord[]).map((record) => (
                  <div key={record.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{record.fault_name}</p>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${provenanceStyle(record.provenance)}`}>{record.provenance}</span>
                    </div>
                    <p className="mt-1 leading-5 text-slate-600 dark:text-slate-300">{record.description}</p>
                    {(record.symptoms?.length ?? 0) > 0 && (
                      <p className="mt-1 text-slate-500"><span className="font-semibold">Symptoms:</span> {record.symptoms?.slice(0, 3).join('; ')}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      {record.severity && <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Severity: {record.severity}</span>}
                      {record.dtc_codes?.length ? <span>DTC: {record.dtc_codes.slice(0, 3).join(', ')}</span> : null}
                      {componentLabel(record.component_key) && (
                        <button
                          type="button"
                          onClick={() => record.component_key && isComponentKey(record.component_key) && onSelectComponent?.(record.component_key)}
                          className="font-semibold text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-300"
                          disabled={!onSelectComponent}
                        >
                          Show {componentLabel(record.component_key)}
                        </button>
                      )}
                    </div>
                    {record.fidelity_note && <p className="mt-2 text-[10px] italic text-slate-400">{record.fidelity_note}</p>}
                  </div>
                ))}
                {key === 'historical' && ((category?.records ?? []) as HistoricalRecord[]).map((record) => (
                  <div key={record.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{record.repair_job_code ?? record.service_type ?? 'Workshop record'}</p>
                      <span className="text-[10px] text-slate-400">{formatDate(record.created_at)}</span>
                    </div>
                    {record.problems_identified && <p className="mt-1 leading-5 text-slate-600 dark:text-slate-300"><span className="font-semibold">Identified:</span> {record.problems_identified}</p>}
                    {record.inspection_findings && <p className="mt-1 leading-5 text-slate-600 dark:text-slate-300"><span className="font-semibold">Findings:</span> {record.inspection_findings}</p>}
                    {record.recommendations && <p className="mt-1 leading-5 text-slate-500"><span className="font-semibold">Recommendation:</span> {record.recommendations}</p>}
                  </div>
                ))}
                {key === 'ai_predictions' && ((category?.records ?? []) as PredictionRecord[]).map((record) => (
                  <div key={record.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{record.confirmed_fault ?? record.predicted_fault}</p>
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">{record.review_status}</span>
                    </div>
                    <p className="mt-1 text-slate-500">{formatDate(record.created_at)} · {(record.confidence * 100).toFixed(1)}% top score</p>
                    {(record.predictions?.length ?? 0) > 1 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                        {record.predictions?.slice(1).map((candidate) => (
                          <li key={candidate.fault_category}>{candidate.fault_category} · {(candidate.confidence * 100).toFixed(1)}%</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
