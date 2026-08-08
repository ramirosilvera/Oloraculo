import type { ReactNode } from 'react';
import { ChevronUp, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../ui';
import { getMetricDef, getSeccionDef, resolveViz } from '../../engine/dashboardCatalog';
import type { DashboardWidget, SeccionKey } from '../../types/domain';
import { METRIC_COMPONENTS, type MetricContext } from './metrics';

const ctrlBtn = 'w-7 h-7 inline-flex items-center justify-center rounded-full text-ink-600 hover:text-ink-900 hover:bg-canvas disabled:opacity-30 disabled:hover:bg-transparent';

// Motor de renderizado del Dashboard personalizable: recorre el layout guardado y, para cada
// tarjeta, decide qué pintar. `seccionNodes` son elementos YA armados por DashboardPage (JSX es
// perezoso — armar `<CedearsResumen/>` acá no ejecuta sus hooks hasta que React lo monte de verdad,
// así que una sección que el usuario sacó del layout simplemente nunca corre sus queries).
export function WidgetGrid({
  layout, seccionNodes, ctx, personalizando, onMover, onEliminar, onEditar,
}: {
  layout: DashboardWidget[];
  seccionNodes: Partial<Record<SeccionKey, ReactNode>>;
  ctx: MetricContext;
  personalizando: boolean;
  onMover: (id: string, dir: 'arriba' | 'abajo') => void;
  onEliminar: (id: string) => void;
  onEditar: (widget: Extract<DashboardWidget, { kind: 'metrica' }>) => void;
}) {
  return (
    <>
      {layout.map((w, i) => {
        let titulo: string;
        let sub: string | undefined;
        let contenido: ReactNode;
        let disponible = true;

        if (w.kind === 'seccion') {
          const def = getSeccionDef(w.seccion);
          disponible = !!def && w.seccion in seccionNodes;
          titulo = def?.titulo ?? w.seccion;
          sub = undefined; // las secciones arman su propio CardHeader — no se envuelve de nuevo
          contenido = disponible ? seccionNodes[w.seccion] : null;
        } else {
          const def = getMetricDef(w.metrica);
          const Comp = METRIC_COMPONENTS[w.metrica];
          disponible = !!def && !!Comp;
          titulo = w.titulo ?? def?.titulo ?? w.metrica;
          sub = personalizando ? undefined : def?.descripcion || undefined;
          const viz = def ? resolveViz(w.metrica, w.viz) : w.viz;
          contenido = disponible && Comp ? <Comp ctx={ctx} viz={viz} /> : null;
        }

        if (!disponible) {
          // Nunca desaparece en silencio (una métrica/sección guardada dejó de existir en el
          // catálogo, ej. tras un rename mal migrado) — se ve como placeholder con botón Eliminar,
          // no como si el dato fuera 0 o el layout estuviera roto.
          return (
            <Card key={w.id}>
              <CardHeader title={titulo} sub="Esta tarjeta ya no está disponible." />
              <div className="p-3">
                <button onClick={() => onEliminar(w.id)}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-neg hover:underline">
                  <Trash2 className="w-4 h-4" /> Eliminar
                </button>
              </div>
            </Card>
          );
        }

        // Las 'seccion' ya son un <Card> completo (CedearsResumen, etc. arman su propio
        // Card+CardHeader) — envolver de nuevo duplicaría el borde. Las 'metrica' sí se envuelven acá.
        const cuerpo = w.kind === 'metrica'
          ? <Card><CardHeader title={titulo} sub={sub} />{contenido}</Card>
          : contenido;

        if (!personalizando) return <div key={w.id}>{cuerpo}</div>;

        return (
          <div key={w.id} className="relative group min-h-[52px]">
            {cuerpo}
            <div className="absolute top-3 right-3 flex items-center gap-0.5 bg-surface/95 backdrop-blur rounded-full border border-line shadow-soft px-1 py-0.5">
              <button onClick={() => onMover(w.id, 'arriba')} disabled={i === 0} className={ctrlBtn} aria-label="Mover arriba"><ChevronUp className="w-4 h-4" /></button>
              <button onClick={() => onMover(w.id, 'abajo')} disabled={i === layout.length - 1} className={ctrlBtn} aria-label="Mover abajo"><ChevronDown className="w-4 h-4" /></button>
              {w.kind === 'metrica' && (
                <button onClick={() => onEditar(w)} className={ctrlBtn} aria-label="Editar tarjeta"><Pencil className="w-4 h-4" /></button>
              )}
              <button onClick={() => onEliminar(w.id)} className={`${ctrlBtn} hover:text-neg`} aria-label="Eliminar tarjeta"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        );
      })}
    </>
  );
}
