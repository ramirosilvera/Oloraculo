import { useState, useEffect } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown, PiggyBank, GripVertical } from 'lucide-react';
import { useFlujo, useFlujoMutations } from '../hooks/useFlujo';
import { useMacro } from '../hooks/usePosiciones';
import { resumenFlujo, type FlujoDestino } from '../engine/flujo';
import { Card, CardHeader, Stat, Button, Empty, inputCls } from '../components/ui';
import type { FlujoItem, FlujoCategoria } from '../types/domain';

const DESTINOS: { key: FlujoDestino; label: string }[] = [
  { key: 'fci', label: 'FCI' },
  { key: 'mercadopago', label: 'Mercado Pago' },
  { key: 'cedears', label: 'CEDEARs' },
  { key: 'bonos', label: 'Bonos' },
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'otro', label: 'Otro' },
];
const destinoLabel = (d: string | null) => DESTINOS.find(x => x.key === d)?.label ?? '—';

const SECCIONES: { cat: FlujoCategoria; titulo: string; sub: string; icon: typeof TrendingUp; nuevo: string }[] = [
  { cat: 'ingreso', titulo: 'Ingresos', sub: 'Sueldo y otras entradas.', icon: TrendingUp, nuevo: 'Nuevo ingreso' },
  { cat: 'egreso', titulo: 'Egresos', sub: 'Tarjetas y gastos principales.', icon: TrendingDown, nuevo: 'Nuevo egreso' },
  { cat: 'inversion', titulo: 'Inversiones / asignaciones', sub: 'A dónde va lo que te queda: FCI, Mercado Pago, CEDEARs, bonos.', icon: PiggyBank, nuevo: 'Nueva asignación' },
];

// Formato de pesos argentinos (sin decimales).
export const fmtArs = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : `$${Math.round(n).toLocaleString('es-AR')}`;

export function FinanzasPage() {
  const { data: items = [], isLoading } = useFlujo();
  const { add } = useFlujoMutations();
  const { data: macro = {} } = useMacro();
  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;
  const r = resumenFlujo(items, mep);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Finanzas · flujo de caja</h1>
        <span className="text-xs text-ink-600">{mep != null ? `MEP $${Math.round(mep).toLocaleString('es-AR')}` : 'MEP no disponible'}</span>
      </div>

      {/* Resumen cascada */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat label="Ingresos" value={fmtArs(r.ingresos)} />
        <Stat label="Egresos" value={<span className="text-neg">{fmtArs(r.egresos)}</span>} />
        <Stat label="Disponible" value={<span className={r.disponible >= 0 ? 'text-pos' : 'text-neg'}>{fmtArs(r.disponible)}</span>}
          delta={r.tasaAhorro ?? undefined} hint="ingresos − egresos · el delta es tu tasa de ahorro" />
        <Stat label="Asignado" value={fmtArs(r.invertido)} hint="suma de inversiones/asignaciones" />
        <Stat label="Sin asignar" value={<span className={r.sinAsignar >= 0 ? 'text-ink-900' : 'text-neg'}>{fmtArs(r.sinAsignar)}</span>}
          hint="disponible − asignado: lo que todavía no colocaste" />
        <Stat label="FCI + billetera" value={fmtArs(r.fci)} hint={mep ? `≈ US$${Math.round(r.fci / mep).toLocaleString('en-US')}` : 'sleeve near-cash'} />
      </div>

      {r.pendientesConversion > 0 && (
        <p className="text-[11px] text-warn">
          {r.pendientesConversion} fila(s) en USD sin poder convertir (no hay MEP disponible); no se suman a los totales hasta que vuelva el dato.
        </p>
      )}

      {isLoading ? (
        <Card><div className="p-6 text-sm text-ink-600">Cargando flujo…</div></Card>
      ) : (
        SECCIONES.map(s => (
          <Seccion key={s.cat} def={s} items={items.filter(i => i.categoria === s.cat)} onAdd={() => add(s.cat, { orden: items.filter(i => i.categoria === s.cat).length })} />
        ))
      )}

      <p className="text-[11px] text-ink-600 leading-relaxed">
        Es tu planilla: agregá o quitá filas, editá conceptos y montos como en Excel (se guardan solos al salir del campo).
        Los totales los calcula el código; el MEP convierte las filas en USD. La parte de FCI + Mercado Pago se muestra en el Dashboard.
      </p>
    </div>
  );
}

function Seccion({ def, items, onAdd }: {
  def: { cat: FlujoCategoria; titulo: string; sub: string; icon: typeof TrendingUp; nuevo: string };
  items: FlujoItem[]; onAdd: () => void;
}) {
  const Icon = def.icon;
  const total = items.filter(i => i.activo).reduce((s, i) => s + (i.moneda === 'USD' ? 0 : i.monto), 0);
  const totalUsd = items.filter(i => i.activo && i.moneda === 'USD').reduce((s, i) => s + i.monto, 0);
  return (
    <Card>
      <CardHeader title={def.titulo} sub={def.sub}
        right={<span className="text-xs text-ink-600 tnum">{fmtArs(total)}{totalUsd ? ` + US$${totalUsd.toLocaleString('en-US')}` : ''}</span>} />
      <div className="divide-y divide-line">
        <div className="hidden sm:flex items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wide text-ink-500 font-semibold">
          <span className="w-4" />
          <span className="flex-1">Concepto</span>
          <span className="w-32 text-right">Monto</span>
          <span className="w-20">Moneda</span>
          {def.cat === 'inversion' && <span className="w-32">Destino</span>}
          <span className="w-9" />
        </div>
        {items.map(it => <Row key={it.id} it={it} />)}
        {items.length === 0 && (
          <div className="px-4 py-6"><Empty icon={Icon} title={`Sin ${def.titulo.toLowerCase()}`}>Agregá la primera fila.</Empty></div>
        )}
      </div>
      <div className="px-4 py-3 border-t border-line">
        <Button variant="ghost" onClick={onAdd}><Plus className="w-4 h-4" /> {def.nuevo}</Button>
      </div>
    </Card>
  );
}

// Fila editable estilo planilla: los campos de texto/número se guardan al salir (onBlur); los
// selects y el toggle se guardan al instante. Mantiene un borrador local para no escribir en la
// base con cada tecla.
function Row({ it }: { it: FlujoItem }) {
  const { update, remove } = useFlujoMutations();
  const [concepto, setConcepto] = useState(it.concepto);
  const [monto, setMonto] = useState(String(it.monto ?? ''));

  // Si el ítem cambia desde afuera (refetch), sincronizamos el borrador.
  useEffect(() => { setConcepto(it.concepto); }, [it.concepto]);
  useEffect(() => { setMonto(String(it.monto ?? '')); }, [it.monto]);

  const commitConcepto = () => { if (concepto !== it.concepto) update(it.id, { concepto }); };
  const commitMonto = () => { const n = Number(monto) || 0; if (n !== it.monto) update(it.id, { monto: n }); };

  return (
    <div className={`flex flex-wrap sm:flex-nowrap items-center gap-2 px-4 py-2 ${it.activo ? '' : 'opacity-45'}`}>
      <button onClick={() => update(it.id, { activo: !it.activo })} title={it.activo ? 'Desactivar (no suma)' : 'Activar'}
        className="w-4 shrink-0 text-ink-400 hover:text-celeste-500" aria-label="Activar/desactivar fila">
        <GripVertical className="w-4 h-4" />
      </button>
      <input value={concepto} onChange={e => setConcepto(e.target.value)} onBlur={commitConcepto}
        placeholder="Concepto (ej. Sueldo)" className={`${inputCls} flex-1 min-w-[8rem]`} />
      <input type="number" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} onBlur={commitMonto}
        placeholder="0" className={`${inputCls} w-28 sm:w-32 text-right tnum`} />
      <select value={it.moneda} onChange={e => update(it.id, { moneda: e.target.value as 'ARS' | 'USD' })} className={`${inputCls} w-20`}>
        <option value="ARS">ARS</option><option value="USD">USD</option>
      </select>
      {it.categoria === 'inversion' && (
        <select value={it.destino ?? 'otro'} onChange={e => update(it.id, { destino: e.target.value as FlujoDestino })} className={`${inputCls} w-32`}>
          {DESTINOS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      )}
      <button onClick={() => { if (window.confirm('¿Borrar esta fila?')) remove(it.id); }} aria-label="Borrar fila" title="Borrar fila"
        className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// Reexport para el Dashboard.
export { destinoLabel };
