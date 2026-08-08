import { useState } from 'react';
import { X } from 'lucide-react';
import { Card, CardHeader, Field, Button, inputCls } from '../ui';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { METRIC_CATALOG, SECCION_CATALOG, getMetricDef, resolveKey, resolveViz } from '../../engine/dashboardCatalog';
import type { DashboardViz, DashboardWidget, MetricKey, SeccionKey } from '../../types/domain';

const VIZ_LABEL: Record<DashboardViz, string> = { stat: 'Número', donut: 'Donut', bar: 'Barras', table: 'Tabla' };
// Más de esto y la grilla de 4 columnas queda en 2 filas desparejas (4+1, 4+2...) — difícil de leer
// de un vistazo, que es todo el punto de una tarjeta combinada.
const MAX_COMBO = 4;

// Constructor de tarjetas: agregar una sección completa (de las que todavía no están en el layout) o
// armar una tarjeta a medida — una o más métricas del catálogo (2+ solo entre `shape:'scalar'`, se
// combinan en una grilla dentro de la misma Card) + visualización (solo aplica con 1 sola métrica) +
// título opcional. También sirve para editar una tarjeta 'metrica' existente: agregar/quitar métricas
// libremente, no solo cambiar viz/título — pensado para poder sumarle un 4to número a una
// combinación ya armada sin tener que borrarla y rehacerla desde cero.
export function AddWidgetModal({
  layout, editing, onClose, onAgregarMetrica, onAgregarSeccion, onActualizarMetrica,
}: {
  layout: DashboardWidget[];
  editing: Extract<DashboardWidget, { kind: 'metrica' }> | null;
  onClose: () => void;
  onAgregarMetrica: (metricas: MetricKey[], viz: DashboardViz, titulo?: string) => Promise<void>;
  onAgregarSeccion: (seccion: SeccionKey) => Promise<void>;
  onActualizarMetrica: (id: string, metricas: MetricKey[], viz: DashboardViz, titulo?: string) => Promise<void>;
}) {
  useEscapeClose(onClose);
  const [seleccion, setSeleccion] = useState<MetricKey[]>(editing?.metricas ?? []);
  const [viz, setViz] = useState<DashboardViz | null>(
    editing && editing.metricas.length === 1 ? resolveViz(editing.metricas[0], editing.viz) : null,
  );
  const [titulo, setTitulo] = useState(editing?.titulo ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const seccionesUsadas = new Set(layout.filter(w => w.kind === 'seccion').map(w => resolveKey(w.seccion)));
  const seccionesDisponibles = SECCION_CATALOG.filter(s => !seccionesUsadas.has(s.key));

  const defsSeleccionados = seleccion.map(k => getMetricDef(k)).filter((d): d is NonNullable<typeof d> => !!d);
  const categoriasCompartidas = new Set(defsSeleccionados.map(d => d.categoria));
  // Con 2+ métricas no hay un título "default" único del catálogo (cada una tiene el suyo) — se
  // arma uno razonable: el nombre de la categoría si todas la comparten (ej. "Bonos"), si no, la
  // unión de los títulos.
  const tituloDefaultCombo = defsSeleccionados.length > 1
    ? (categoriasCompartidas.size === 1 ? [...categoriasCompartidas][0] : defsSeleccionados.map(d => d.titulo).join(' · '))
    : defsSeleccionados[0]?.titulo;

  const toggleMetrica = (key: MetricKey) => {
    const yaElegida = seleccion.includes(key);
    let next: MetricKey[];
    if (yaElegida) {
      next = seleccion.filter(k => k !== key);
    } else {
      if (seleccion.length >= MAX_COMBO) return;
      const def = getMetricDef(key);
      if (!def) return;
      // Combinar solo tiene sentido entre escalares (varios números en una grilla) — una categórica
      // (donut/tabla) no cabe ahí, así que elegir una bloquea cualquier otra combinación.
      const hayCategoricaElegida = seleccion.some(k => getMetricDef(k)?.shape === 'categorico');
      if (seleccion.length > 0 && (hayCategoricaElegida || def.shape === 'categorico')) return;
      next = [...seleccion, key];
    }
    setSeleccion(next);
    if (next.length === 1) setViz(getMetricDef(next[0])!.vizDefault);
  };

  const agregarSeccion = async (key: SeccionKey) => {
    setErr(null); setBusy(true);
    try { await onAgregarSeccion(key); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); setBusy(false); }
  };

  const guardarMetrica = async () => {
    if (seleccion.length === 0 || (seleccion.length === 1 && !viz)) return;
    setErr(null); setBusy(true);
    try {
      const vizFinal: DashboardViz = seleccion.length === 1 ? viz! : 'stat'; // ignorado en modo combo, pero el tipo lo pide
      const tituloFinal = titulo.trim() || (seleccion.length > 1 ? tituloDefaultCombo : undefined);
      if (editing) await onActualizarMetrica(editing.id, seleccion, vizFinal, tituloFinal);
      else await onAgregarMetrica(seleccion, vizFinal, tituloFinal);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Agregar tarjeta">
        <Card className="animate-rise">
          <CardHeader title={editing ? 'Editar tarjeta' : 'Agregar tarjeta'}
            sub={editing ? 'Agregá o quitá métricas, cambiá el título — para cambiar de visualización, dejá una sola métrica elegida.' : 'Elegí una sección completa, o armá una tarjeta a medida con una o más métricas.'}
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
            {err && <p className="text-xs text-neg">{err}</p>}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-600 font-semibold mb-2">
                Tarjeta a medida {seleccion.length > 0 && <span className="text-ink-400 normal-case font-normal">· {seleccion.length}/{MAX_COMBO} elegidas</span>}
              </p>
              <div className="space-y-3">
                {Object.entries(agrupar(METRIC_CATALOG)).map(([categoria, metricas]) => (
                  <div key={categoria}>
                    <p className="text-[10px] text-ink-500 font-semibold mb-1">{categoria}</p>
                    <div className="flex flex-wrap gap-2">
                      {metricas.map(m => {
                        const yaElegida = seleccion.includes(m.key);
                        const hayCategoricaElegida = seleccion.some(k => getMetricDef(k)?.shape === 'categorico');
                        const deshabilitada = !yaElegida && (
                          busy || seleccion.length >= MAX_COMBO || hayCategoricaElegida
                          || (seleccion.length > 0 && m.shape === 'categorico')
                        );
                        return (
                          <button key={m.key} disabled={deshabilitada} onClick={() => toggleMetrica(m.key)}
                            title={deshabilitada ? 'Solo se pueden combinar métricas numéricas entre sí' : (m.descripcion || undefined)}
                            aria-pressed={yaElegida}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold border disabled:opacity-40 ${yaElegida ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300'}`}>
                            {m.titulo}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {seleccion.length > 0 && (
              <div className="space-y-3 pt-1">
                {seleccion.length === 1 && viz && (
                  <Field label="Visualización">
                    <div className="flex flex-wrap gap-2">
                      {defsSeleccionados[0]!.vizDisponibles.map(v => (
                        <button key={v} disabled={busy} onClick={() => setViz(v)} aria-pressed={viz === v}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold border disabled:opacity-50 ${viz === v ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300'}`}>
                          {VIZ_LABEL[v]}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
                <Field label="Título (opcional)" hint={`Default: "${tituloDefaultCombo}"`}>
                  <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={tituloDefaultCombo} className={inputCls} maxLength={60} />
                </Field>
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
