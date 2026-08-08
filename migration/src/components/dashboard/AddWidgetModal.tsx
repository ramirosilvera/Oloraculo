import { useState } from 'react';
import { X } from 'lucide-react';
import { Card, CardHeader, Field, Button, inputCls } from '../ui';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { METRIC_CATALOG, SECCION_CATALOG } from '../../engine/dashboardCatalog';
import type { DashboardViz, DashboardWidget, MetricKey, SeccionKey } from '../../types/domain';

const VIZ_LABEL: Record<DashboardViz, string> = { stat: 'Número', donut: 'Donut', bar: 'Barras', table: 'Tabla' };

// Constructor de tarjetas: agregar una sección completa (de las que todavía no están en el layout) o
// armar una tarjeta a medida (métrica del catálogo + visualización compatible + título opcional).
// También sirve para editar una tarjeta 'metrica' existente (viz/título — cambiar de métrica se hace
// borrando y agregando de nuevo, más simple que reconciliar un cambio de shape a mitad de edición).
export function AddWidgetModal({
  layout, editing, onClose, onAgregarMetrica, onAgregarSeccion, onActualizarMetrica,
}: {
  layout: DashboardWidget[];
  editing: Extract<DashboardWidget, { kind: 'metrica' }> | null;
  onClose: () => void;
  onAgregarMetrica: (metrica: MetricKey, viz: DashboardViz, titulo?: string) => Promise<void>;
  onAgregarSeccion: (seccion: SeccionKey) => Promise<void>;
  onActualizarMetrica: (id: string, viz: DashboardViz, titulo?: string) => Promise<void>;
}) {
  useEscapeClose(onClose);
  const [metricaKey, setMetricaKey] = useState<MetricKey | null>(editing?.metrica ?? null);
  const metricaDef = METRIC_CATALOG.find(m => m.key === metricaKey) ?? null;
  const [viz, setViz] = useState<DashboardViz | null>(editing?.viz ?? null);
  const [titulo, setTitulo] = useState(editing?.titulo ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const seccionesUsadas = new Set(layout.filter(w => w.kind === 'seccion').map(w => w.seccion));
  const seccionesDisponibles = SECCION_CATALOG.filter(s => !seccionesUsadas.has(s.key));

  const elegirMetrica = (key: MetricKey) => {
    setMetricaKey(key);
    const def = METRIC_CATALOG.find(m => m.key === key)!;
    setViz(def.vizDefault);
  };

  const agregarSeccion = async (key: SeccionKey) => {
    setErr(null); setBusy(true);
    try { await onAgregarSeccion(key); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); setBusy(false); }
  };

  const guardarMetrica = async () => {
    if (!metricaKey || !viz) return;
    setErr(null); setBusy(true);
    try {
      if (editing) await onActualizarMetrica(editing.id, viz, titulo.trim() || undefined);
      else await onAgregarMetrica(metricaKey, viz, titulo.trim() || undefined);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Agregar tarjeta">
        <Card className="animate-rise">
          <CardHeader title={editing ? 'Editar tarjeta' : 'Agregar tarjeta'}
            sub={editing ? undefined : 'Elegí una sección completa, o armá una tarjeta a medida con una métrica + visualización.'}
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />

          {!editing && seccionesDisponibles.length > 0 && (
            <div className="p-4 border-b border-line">
              <p className="text-[11px] uppercase tracking-wide text-ink-600 font-semibold mb-2">Secciones</p>
              <div className="flex flex-wrap gap-2">
                {seccionesDisponibles.map(s => (
                  <button key={s.key} disabled={busy} onClick={() => agregarSeccion(s.key)} title={s.descripcion}
                    className="px-3 py-1.5 rounded-full text-sm font-semibold border border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300 disabled:opacity-50">
                    {s.titulo}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 space-y-4">
            {!editing && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-600 font-semibold mb-2">Tarjeta a medida</p>
                <div className="space-y-3">
                  {Object.entries(agrupar(METRIC_CATALOG)).map(([categoria, metricas]) => (
                    <div key={categoria}>
                      <p className="text-[10px] text-ink-500 font-semibold mb-1">{categoria}</p>
                      <div className="flex flex-wrap gap-2">
                        {metricas.map(m => (
                          <button key={m.key} disabled={busy} onClick={() => elegirMetrica(m.key)} title={m.descripcion || undefined}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold border disabled:opacity-50 ${metricaKey === m.key ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300'}`}>
                            {m.titulo}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {metricaDef && viz && (
              <div className="space-y-3 pt-1">
                <Field label="Visualización">
                  <div className="flex flex-wrap gap-2">
                    {metricaDef.vizDisponibles.map(v => (
                      <button key={v} disabled={busy} onClick={() => setViz(v)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold border disabled:opacity-50 ${viz === v ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300'}`}>
                        {VIZ_LABEL[v]}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Título (opcional)" hint={`Default: "${metricaDef.titulo}"`}>
                  <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={metricaDef.titulo} className={inputCls} maxLength={60} />
                </Field>
                {err && <p className="text-xs text-neg">{err}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
                  <Button onClick={guardarMetrica} disabled={busy}>{editing ? 'Guardar' : 'Agregar tarjeta'}</Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function agrupar<T extends { categoria: string }>(items: T[]): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  for (const it of items) (m[it.categoria] ??= []).push(it);
  return m;
}
