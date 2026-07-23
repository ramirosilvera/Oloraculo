import { useState } from 'react';
import { Landmark, Pencil, X, CalendarClock } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, usePosicionMutations, useQuotes } from '../hooks/usePosiciones';
import { Card, CardHeader, Button, Field, Empty, inputCls, fmtUsdCompact, fmtNum, fmtPct } from '../components/ui';
import type { Posicion } from '../types/domain';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FREC: Record<number, string> = { 1: 'Anual', 2: 'Semestral', 4: 'Trimestral', 12: 'Mensual' };

export function BonosPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { update } = usePosicionMutations(active?.id);
  const bonos = posiciones.filter(p => p.tipo === 'bono');
  const { data: quotes = {} } = useQuotes([], bonos.map(b => b.ticker));
  const [editBono, setEditBono] = useState<Posicion | null>(null);

  if (!active) return null;

  const totalCapital = bonos.reduce((s, b) => s + b.precio_compra * b.cantidad, 0);
  const totalMkt = bonos.reduce((s, b) => {
    const px = quotes[b.ticker] ?? null;
    return s + (px != null ? px * b.cantidad : b.precio_compra * b.cantidad);
  }, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Renta fija · {active.nombre}</h1>
      <Card>
        <CardHeader title="Bonos y ONs" sub="Precio por nominal (data912). Editá el cupón (✏️) para que aparezcan en el calendario de Cupones."
          right={<span className="text-xs text-ink-600 tnum">Capital {fmtUsdCompact(totalCapital)} · Mercado {fmtUsdCompact(totalMkt)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Especie</th>
                <th className="text-right px-3">Nominales</th>
                <th className="text-right px-3">Capital</th>
                <th className="text-right px-3">Paridad</th>
                <th className="text-right px-3">Valor mercado</th>
                <th className="text-right px-3">Resultado</th>
                <th className="text-right px-3">Cupón</th>
                <th className="text-right px-3">Venc.</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bonos.map(b => {
                const px = quotes[b.ticker] ?? null;               // precio por nominal (data912/100)
                const paridad = px != null ? px * 100 : null;      // en %
                const capital = b.precio_compra * b.cantidad;
                const mkt = px != null ? px * b.cantidad : null;
                const res = mkt != null ? mkt - capital : null;
                const cuponOk = b.cupon_tasa != null && b.cupon_frecuencia != null && b.cupon_mes != null;
                return (
                  <tr key={b.id} className="hover:bg-canvas align-top">
                    <td className="px-4 py-2" title={b.notas ?? undefined}>
                      <span className="font-semibold text-ink-900">{b.ticker}</span>
                      {(b.empresa || b.notas) && <span className="block text-[10px] text-ink-600 max-w-[220px] truncate">{b.empresa || b.notas}</span>}
                    </td>
                    <td className="text-right px-3 tnum">{fmtNum(b.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-ink-700">{fmtUsdCompact(capital)}</td>
                    <td className="text-right px-3 tnum text-accent">{paridad != null ? fmtPct(paridad / 100, 1) : '—'}</td>
                    <td className="text-right px-3 tnum">{fmtUsdCompact(mkt)}</td>
                    <td className={`text-right px-3 tnum ${res == null ? '' : res >= 0 ? 'text-pos' : 'text-neg'}`}>{res == null ? '—' : `${res >= 0 ? '+' : ''}${fmtUsdCompact(res)}`}</td>
                    <td className="text-right px-3 tnum">
                      {cuponOk
                        ? <span className="text-ink-800">{fmtPct(b.cupon_tasa!, 1)}<span className="text-[10px] text-ink-500"> · {FREC[b.cupon_frecuencia!] ?? `${b.cupon_frecuencia!}/año`}</span></span>
                        : <span className="text-warn text-[11px]">sin cupón</span>}
                    </td>
                    <td className="text-right px-3 tnum text-ink-600">{b.vencimiento ?? '—'}</td>
                    <td className="px-2 text-right">
                      <button onClick={() => setEditBono(b)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Editar cupón" aria-label="Editar cupón"><Pencil className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
              {bonos.length === 0 && <tr><td colSpan={9}><Empty icon={Landmark} title="Sin bonos ni ONs">Agregá uno en Posiciones con el tipo "Bono / ON".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editBono && <CuponModal bono={editBono} onClose={() => setEditBono(null)}
        onSave={async (patch) => { await update(editBono.id, patch); setEditBono(null); }} />}
    </div>
  );
}

// Editar/cargar los datos de cupón de un bono existente (tasa, frecuencia, mes de referencia, venc).
function CuponModal({ bono, onClose, onSave }: { bono: Posicion; onClose: () => void; onSave: (patch: Partial<Posicion>) => Promise<void> }) {
  const [tasa, setTasa] = useState(bono.cupon_tasa != null ? String(+(bono.cupon_tasa * 100).toFixed(4)) : '');
  const [freq, setFreq] = useState(bono.cupon_frecuencia != null ? String(bono.cupon_frecuencia) : '');
  const [mes, setMes] = useState(bono.cupon_mes != null ? String(bono.cupon_mes) : '');
  const [vto, setVto] = useState(bono.vencimiento ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    setBusy(true); setErr(null);
    try {
      await onSave({
        cupon_tasa: tasa ? Number(tasa) / 100 : null,
        cupon_frecuencia: freq ? Number(freq) : null,
        cupon_mes: mes ? Number(mes) : null,
        vencimiento: vto || null,
      });
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <Card className="animate-rise">
          <CardHeader title={`Cupón · ${bono.ticker}`} sub="Con estos datos el bono aparece en el calendario de Cupones."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <Field label="Tasa cupón (% anual)">
              <input type="number" step="0.05" value={tasa} onChange={e => setTasa(e.target.value)} placeholder="ej. 8" className={inputCls} />
            </Field>
            <Field label="Frecuencia">
              <select value={freq} onChange={e => setFreq(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                <option value="1">Anual</option><option value="2">Semestral</option><option value="4">Trimestral</option><option value="12">Mensual</option>
              </select>
            </Field>
            <Field label="Mes de un pago">
              <select value={mes} onChange={e => setMes(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Vencimiento">
              <input type="date" value={vto} onChange={e => setVto(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <p className="px-4 -mt-1 text-[11px] text-ink-500 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" /> El "mes de un pago" alcanza: los demás se derivan por la frecuencia (ej. semestral desde mayo → may y nov).
          </p>
          <p className="px-4 pt-1.5 text-[11px] text-ink-500">
            El calendario asume cupón fijo sobre el nominal actual (bullet). Para bonos que amortizan o con step-up, los pagos posteriores a la amortización quedan sobrestimados.
          </p>
          {err && <p className="px-4 pt-2 text-xs text-warn">{err}</p>}
          <div className="px-4 py-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cupón'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
