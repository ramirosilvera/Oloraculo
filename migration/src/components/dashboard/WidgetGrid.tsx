import type { ReactNode } from 'react';
import { ChevronUp, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../ui';
import { getMetricDef, getSeccionDef, resolveKey, resolveViz } from '../../engine/dashboardCatalog';
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
        let enCatalogo: boolean;
        // Distinto de "no está en el catálogo" (se renombró/borró la key — ver más abajo): esto es
        // una sección VÁLIDA que hoy no tiene nada que mostrar (ej. "Bonos" sin bonos cargados) — el
        // componente ya se auto-oculta (null) igual que hacía antes de existir el Dashboard
        // personalizable. En modo Personalizar necesita igual un lugar visible para sus controles
        // (mover/eliminar), porque si no quedan flotando sobre nada.
        let sinDatosAhora = false;

        // Resolver alias ANTES de indexar cualquier catálogo/registro — si esto solo se resolviera
        // en getMetricDef/getSeccionDef pero no acá, una key renombrada quedaba en un estado
        // inconsistente: el catálogo la reconoce pero el componente/nodo no se encuentra nunca.
        if (w.kind === 'seccion') {
          const key = resolveKey(w.seccion) as SeccionKey;
          const def = getSeccionDef(key);
          enCatalogo = !!def;
          titulo = def?.titulo ?? w.seccion;
          sub = undefined; // las secciones arman su propio CardHeader — no se envuelve de nuevo
          const nodo = enCatalogo ? seccionNodes[key] : undefined;
          sinDatosAhora = enCatalogo && nodo == null;
          contenido = nodo ?? null;
        } else {
          const key = resolveKey(w.metrica) as typeof w.metrica;
          const def = getMetricDef(key);
          const Comp = METRIC_COMPONENTS[key];
          enCatalogo = !!def && !!Comp;
          titulo = w.titulo ?? def?.titulo ?? w.metrica;
          sub = personalizando ? undefined : def?.descripcion || undefined;
          const viz = resolveViz(key, w.viz);
          // Las tarjetas 'metrica' siempre renderizan algo (Loading/Empty/valor real vía Render en
          // metrics.tsx) — nunca quedan sin nodo, así que no aplica el caso "sinDatosAhora". Cada
          // Comp arma su PROPIO Card+CardHeader (con badge/link — ver metrics.tsx), así que `sub`
          // viaja como prop en vez de envolverse acá.
          contenido = enCatalogo && Comp ? <Comp ctx={ctx} viz={viz} titulo={titulo} sub={sub} personalizando={personalizando} /> : null;
        }

        if (!enCatalogo) {
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

        if (sinDatosAhora) {
          // Fuera de modo Personalizar, una sección sin datos no debe ocupar espacio — mismo
          // comportamiento que antes de que existiera el Dashboard personalizable.
          if (!personalizando) return null;
          return (
            <div key={w.id} className="relative group">
              <Card><CardHeader title={titulo} sub="Sin datos en este portfolio — se mostrará cuando los haya." /></Card>
              <Controles i={i} total={layout.length} onMover={dir => onMover(w.id, dir)} onEliminar={() => onEliminar(w.id)} />
            </div>
          );
        }

        // Tanto 'seccion' como 'metrica' llegan acá ya siendo un <Card> completo (armado por el
        // componente, no por WidgetGrid) — envolver de nuevo duplicaría el borde.
        const cuerpo = contenido;

        if (!personalizando) return <div key={w.id}>{cuerpo}</div>;

        return (
          <div key={w.id} className="relative group">
            {cuerpo}
            <Controles i={i} total={layout.length} onMover={dir => onMover(w.id, dir)}
              onEditar={w.kind === 'metrica' ? () => onEditar(w) : undefined} onEliminar={() => onEliminar(w.id)} />
          </div>
        );
      })}
    </>
  );
}

// Cluster de controles del modo Personalizar — posicionado AFUERA del borde de la tarjeta (no
// "absolute top-3 right-3" hacia adentro) para no tapar el slot `right` del CardHeader (badges de
// concentración, links "Ver más", etc.), que vive exactamente ahí.
function Controles({ i, total, onMover, onEditar, onEliminar }: {
  i: number; total: number; onMover: (dir: 'arriba' | 'abajo') => void; onEditar?: () => void; onEliminar: () => void;
}) {
  return (
    <div className="absolute -top-2 -right-2 flex items-center gap-0.5 bg-surface/95 backdrop-blur rounded-full border border-line shadow-soft px-1 py-0.5 z-10">
      <button onClick={() => onMover('arriba')} disabled={i === 0} className={ctrlBtn} aria-label="Mover arriba"><ChevronUp className="w-4 h-4" /></button>
      <button onClick={() => onMover('abajo')} disabled={i === total - 1} className={ctrlBtn} aria-label="Mover abajo"><ChevronDown className="w-4 h-4" /></button>
      {onEditar && <button onClick={onEditar} className={ctrlBtn} aria-label="Editar tarjeta"><Pencil className="w-4 h-4" /></button>}
      <button onClick={onEliminar} className={`${ctrlBtn} hover:text-neg`} aria-label="Eliminar tarjeta"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}
