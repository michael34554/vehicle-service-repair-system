import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus, Trash2, Warehouse } from 'lucide-react';
import { apiFetch } from '../../api';

interface Bay {
  id: string;
  code: string;
  label: string | null;
  is_active: number | boolean;
}

interface ApiBody {
  bays?: Bay[];
  error?: string;
  message?: string;
}

interface Props {
  canManage: boolean;
  onChanged?: () => void;
}

export function BayRegistryPanel({ canManage, onChanged }: Props) {
  const [bays, setBays] = useState<Bay[]>([]);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/workshop/bays');
      const body = await response.json() as ApiBody;
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Could not load the bay registry.');
      setBays(body.bays ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the bay registry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createBay = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/workshop/bays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), label: label.trim() || undefined }),
      });
      const body = await response.json() as ApiBody;
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Could not register the bay.');
      setCode('');
      setLabel('');
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not register the bay.');
    } finally {
      setBusy(false);
    }
  };

  const removeBay = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/workshop/bays/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) {
        const body = await response.json() as ApiBody;
        throw new Error(body.message ?? body.error ?? 'Could not remove the bay.');
      }
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not remove the bay.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Warehouse className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Registered bays</h3>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">The floor board shows these registered bays together with bay names already used on repair jobs.</p>
        </div>
        {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {canManage && (
        <form onSubmit={(event) => void createBay(event)} className="mt-3 flex flex-wrap gap-2">
          <input required maxLength={80} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Bay code" className="w-36 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          <input maxLength={160} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" className="w-44 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          <button type="submit" disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-blue-600"><Plus className="h-3.5 w-3.5" /> Add bay</button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {bays.length === 0 && <p className="text-xs text-slate-500">No bays registered yet.</p>}
        {bays.map((bay) => (
          <span key={bay.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
            <span className="font-semibold">{bay.code}</span>{bay.label && <span className="text-slate-500">· {bay.label}</span>}
            {canManage && <button type="button" disabled={busy} onClick={() => void removeBay(bay.id)} className="text-slate-400 hover:text-red-600 disabled:opacity-50" title={`Remove ${bay.code}`}><Trash2 className="h-3.5 w-3.5" /></button>}
          </span>
        ))}
      </div>
    </div>
  );
}
