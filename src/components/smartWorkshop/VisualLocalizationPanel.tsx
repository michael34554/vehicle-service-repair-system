import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Camera, Check, Crosshair, LoaderCircle, RefreshCw, ScanSearch, X } from 'lucide-react';
import { apiFetch } from '../../api';
import { SMART_WORKSHOP_CONFIG, isComponentKey, type ComponentKey } from '@/shared/smartWorkshop';

interface FaultImage {
  id: string;
  image_url: string;
  mime_type: string | null;
  source: string;
  captured_at: string | null;
  created_at: string;
}

interface Projection {
  normalized_center?: [number, number];
  normalized_size?: [number, number];
  component_key?: string;
  basis?: string;
}

interface Localization {
  id: string;
  image_id: string;
  component_key: string;
  confidence: number | null;
  projection_json: string | Projection;
  provider: string;
  status: string;
  created_at: string;
}

interface ApiBody {
  images?: FaultImage[];
  localizations?: Localization[];
  image?: { id: string; image_url: string };
  error?: string;
  message?: string;
}

interface Props {
  vehicleId: string;
  canReview: boolean;
}

function projectionOf(value: Localization['projection_json']): Projection {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Projection; } catch { return {}; }
  }
  return value;
}

export function VisualLocalizationPanel({ vehicleId, canReview }: Props) {
  const [images, setImages] = useState<FaultImage[]>([]);
  const [localizations, setLocalizations] = useState<Localization[]>([]);
  const [imageId, setImageId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [componentKey, setComponentKey] = useState<ComponentKey>('engine');
  const [box, setBox] = useState({ x: '0.25', y: '0.25', width: '0.5', height: '0.5' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError('');
    try {
      const [imageResponse, localizationResponse] = await Promise.all([
        apiFetch(`/api/visual/vehicles/${encodeURIComponent(vehicleId)}/images`),
        apiFetch(`/api/visual/vehicles/${encodeURIComponent(vehicleId)}/localizations`),
      ]);
      const [imageBody, localizationBody] = await Promise.all([
        imageResponse.json() as Promise<ApiBody>,
        localizationResponse.json() as Promise<ApiBody>,
      ]);
      if (!imageResponse.ok) throw new Error(imageBody.message ?? imageBody.error ?? 'Could not load vehicle images.');
      if (!localizationResponse.ok) throw new Error(localizationBody.message ?? localizationBody.error ?? 'Could not load localizations.');
      setImages(imageBody.images ?? []);
      setLocalizations(localizationBody.localizations ?? []);
      setImageId((current) => current || imageBody.images?.[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load visual localization data.');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => { void load(); }, [load]);

  const addImage = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/visual/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId, image_url: imageUrl.trim(), source: 'manual_upload' }),
      });
      const body = await response.json() as ApiBody;
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Could not register the image.');
      setImageUrl('');
      if (body.image) setImageId(body.image.id);
      await load();
      setNotice('Image registered. Add a component annotation before localizing it.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not register the image.');
    } finally {
      setBusy(false);
    }
  };

  const annotateAndLocalize = async (event: FormEvent) => {
    event.preventDefault();
    const values = Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Number(value)])) as Record<string, number>;
    if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0 || value > 1) || values.width === 0 || values.height === 0) {
      setError('Bounding box values must be normalized between 0 and 1, with non-zero width and height.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const annotationResponse = await apiFetch(`/api/visual/images/${encodeURIComponent(imageId)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component_key: componentKey, bbox: values }),
      });
      const annotationBody = await annotationResponse.json() as ApiBody;
      if (!annotationResponse.ok) throw new Error(annotationBody.message ?? annotationBody.error ?? 'Could not save the annotation.');
      const localizationResponse = await apiFetch('/api/visual/localize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId, image_id: imageId }),
      });
      const localizationBody = await localizationResponse.json() as ApiBody;
      if (!localizationResponse.ok) throw new Error(localizationBody.message ?? localizationBody.error ?? 'Could not project the annotation.');
      await load();
      setNotice('Manual annotation projected onto the inspection image. Review it before using it as evidence.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not localize the component.');
    } finally {
      setBusy(false);
    }
  };

  const review = async (id: string, status: 'confirmed' | 'rejected') => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/visual/localizations/${encodeURIComponent(id)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await response.json() as ApiBody;
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Could not review the localization.');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not review the localization.');
    } finally {
      setBusy(false);
    }
  };

  const selectedImage = images.find((image) => image.id === imageId);
  const visibleLocalizations = localizations.filter((item) => item.image_id === imageId);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><ScanSearch className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Visual fault localization</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            Manual annotations are projected onto inspection images and saved as proposed evidence. No computer-vision dataset or external model is assumed to be configured.
          </p>
        </div>
        {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />}
        <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" title="Refresh images"><RefreshCw className="h-4 w-4" /></button>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Camera className="h-4 w-4 text-violet-600 dark:text-violet-400" /> Inspection images</h3>
          <form onSubmit={(event) => void addImage(event)} className="mt-3 flex gap-2">
            <input required value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="/assets/... or https://..." className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <button type="submit" disabled={busy || !canReview} className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-blue-600">Add image</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {images.length === 0 && <p className="text-xs text-slate-500">No images registered for this vehicle.</p>}
            {images.map((image) => (
              <button key={image.id} type="button" onClick={() => setImageId(image.id)} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${image.id === imageId ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                {image.source} · {new Date(image.created_at).toLocaleDateString()}
              </button>
            ))}
          </div>
          {selectedImage && (
            <div className="relative mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800">
              <img src={selectedImage.image_url} alt="Vehicle inspection" className="max-h-72 w-full object-contain" />
              {visibleLocalizations.map((item) => {
                const projection = projectionOf(item.projection_json);
                const center = projection.normalized_center ?? [0.5, 0.5];
                const size = projection.normalized_size ?? [0.2, 0.2];
                return (
                  <span
                    key={item.id}
                    title={`${item.component_key} · ${item.status}`}
                    className={`pointer-events-none absolute rounded border-2 ${item.status === 'confirmed' ? 'border-emerald-400 bg-emerald-400/10' : item.status === 'rejected' ? 'border-red-400 bg-red-400/10' : 'border-amber-400 bg-amber-400/10'}`}
                    style={{
                      left: `${Math.max(0, center[0] - size[0] / 2) * 100}%`,
                      top: `${Math.max(0, center[1] - size[1] / 2) * 100}%`,
                      width: `${size[0] * 100}%`,
                      height: `${size[1] * 100}%`,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Crosshair className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Annotate and project</h3>
          <form onSubmit={(event) => void annotateAndLocalize(event)} className="mt-3 space-y-2">
            <select value={componentKey} onChange={(event) => setComponentKey(event.target.value as ComponentKey)} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white">
              {SMART_WORKSHOP_CONFIG.components.map((component) => <option key={component.key} value={component.key}>{component.label}</option>)}
            </select>
            <div className="grid grid-cols-4 gap-2">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <label key={key} className="text-[10px] uppercase text-slate-500">{key}
                  <input required min="0" max="1" step="0.01" value={box[key]} onChange={(event) => setBox((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
              ))}
            </div>
            <button type="submit" disabled={busy || !imageId || !canReview} className="w-full rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-blue-600">Save annotation and project</button>
          </form>

          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Proposed localizations</h4>
            {visibleLocalizations.length === 0 ? <p className="mt-2 text-xs text-slate-500">No localizations for the selected image.</p> : (
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {visibleLocalizations.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">{isComponentKey(item.component_key) ? item.component_key.replaceAll('_', ' ') : item.component_key}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${item.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : item.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>{item.status}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">{item.provider} · {new Date(item.created_at).toLocaleString()}</p>
                    {canReview && item.status === 'proposed' && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void review(item.id, 'confirmed')} className="inline-flex items-center gap-1 rounded border border-emerald-300 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300"><Check className="h-3 w-3" /> Confirm</button>
                        <button type="button" disabled={busy} onClick={() => void review(item.id, 'rejected')} className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300"><X className="h-3 w-3" /> Reject</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
