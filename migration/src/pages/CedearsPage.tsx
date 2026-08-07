import { useState } from 'react';
import { Building2, Pencil, X } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosicionMutations } from '../hooks/usePosiciones';
import { useCedearsCalc, resumenCedears } from '../hooks/useCedears';
import { ROL_LABEL, ROLES, ROL_COLOR, SIN_CLASIFICAR_COLOR } from '../engine/cedears';
import { Card, CardHeader, Button, Badge, Stat, Field, Empty, inputCls, fmtUsdCompact, fmtNum, fmtPct, PIE_COLORS } from '../components/ui';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useChartTheme } from '../hooks/usePrefs';
import type { Posicion, AssetRole } from '../types/domain';

// Lista cerrada (select) estilo GICS en español, igual a la que ya aparece en el seed de ejemplo.
// `sector` sigue siendo texto libre en la columna (compartida con Posiciones/acción/ETF, que no
// tocamos) — el ClasificarModal ofrece la opción actual como extra si no matchea ninguna de estas,
// para no perder en silencio un valor cargado antes desde otro lado.
const SECTORES_SUGERIDOS = [
  'Energía', 'Materiales', 'Industriales', 'Consumo discrecional', 'Consumo básico',
  'Salud', 'Finanzas', 'Tecnología', 'Comunicación', 'Servicios públicos', 'Inmobiliario',
];

// Dos umbrales DISTINTOS, aunque hoy compartan el mismo valor — separados para que cambiar uno
// (ej. si "mayor posición" individual se vuelve más laxo) no mueva el otro sin querer.
const CONCENTRACION_POSICION_ALERTA = 0.40;  // un solo ticker concentra esto o más del capital en CEDEARs
const CONCENTRACION_SECTOR_ALERTA = 0.40;    // un solo sector concentra esto o más (repartido entre varios tickers)

function RolBadge({ rol }: { rol: AssetRole | null }) {
  if (!rol) return <span className="text-ink-500 text-[11px]">—</span>;
  return (
    <span title={ROL_LABEL[rol].desc}>
      <Badge tone="accent">{ROL_LABEL[rol].label}</Badge>
    </span>
  );
}

export function CedearsPage() {
  const { active } = usePortfolios();
  const { cedears, cedearsCalc, isLoading: posLoading } = useCedearsCalc(active?.id);
  const { update } = usePosicionMutations(active?.id);
  const [editPos, setEditPos] = useState<Posicion | null>(null);
  const chart = useChartTheme();

  if (!active) return null;

  const { totalCapital, totalMkt, mayorPosicion, nSectores, hhiSector, porSector, porRol } = resumenCedears(cedearsCalc);
  const mayorSector = porSector.length > 0 ? porSector[0] : null;

  const sectorData = porSector.map(s => ({ name: s.sector, value: s.pct }));
  const rolData = porRol.map(r => ({ name: r.rol === 'sin_clasificar' ? 'Sin clasificar' : ROL_LABEL[r.rol].label, key: r.rol, value: r.pct }));
  // "Sin sector" tiene el mismo gris neutro que "sin_clasificar" en rol — sin esto competía por un
  // color de PIE_COLORS como si fuera un sector real, y si dominaba la cartera podía leerse como
  // el sector más grande en vez de "no cargaste esto todavía". Los sectores reales ciclan
  // PIE_COLORS con su propio contador, sin "perder" un color cuando "Sin sector" está presente.
  let sectorRealIdx = 0;
  const sectorColors = sectorData.map(s => s.name === 'Sin sector' ? SIN_CLASIFICAR_COLOR : PIE_COLORS[sectorRealIdx++ % PIE_COLORS.length]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">CEDEARs · {active.nombre}</h1>
      <Card>
        <CardHeader title="Renta variable" sub="Sector y estilo (Peter Lynch) por posición. Editá con el ✏️ para clasificar."
          right={<span className="text-xs text-ink-600 tnum">Capital {fmtUsdCompact(totalCapital)} · Mercado {fmtUsdCompact(totalMkt)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Especie</th>
                <th className="text-left px-3">Sector</th>
                <th className="text-left px-3">Estilo (Lynch)</th>
                <th className="text-right px-3">Nominales</th>
                <th className="text-right px-3">Capital</th>
                <th className="text-right px-3">Valor mercado</th>
                <th className="text-right px-3">Resultado</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cedearsCalc.map(cc => {
                const p = cc.pos;
                return (
                  <tr key={p.id} className="hover:bg-canvas align-top">
                    <td className="px-4 py-2" title={p.notas ?? undefined}>
                      <span className="font-semibold text-ink-900">{p.ticker}</span>
                      {(p.empresa || p.notas) && <span className="block text-[10px] text-ink-600 max-w-[220px] truncate">{p.empresa || p.notas}</span>}
                    </td>
                    <td className="px-3 text-ink-700">{p.sector || <span className="text-ink-500">—</span>}</td>
                    <td className="px-3"><RolBadge rol={p.rol} /></td>
                    <td className="text-right px-3 tnum">{fmtNum(p.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-ink-700">{fmtUsdCompact(cc.capital)}</td>
                    <td className="text-right px-3 tnum">{fmtUsdCompact(cc.mkt)}</td>
                    <td className={`text-right px-3 tnum ${cc.res == null ? '' : cc.res >= 0 ? 'text-pos' : 'text-neg'}`}>{cc.res == null ? '—' : `${cc.res >= 0 ? '+' : ''}${fmtUsdCompact(cc.res)}`}</td>
                    <td className="px-2 text-right">
                      <button onClick={() => setEditPos(p)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Clasificar (sector / estilo)" aria-label="Clasificar sector y estilo"><Pencil className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
              {posLoading
                ? <tr><td colSpan={8}><p className="p-4 text-sm text-ink-600">Cargando…</p></td></tr>
                : cedears.length === 0 && <tr><td colSpan={8}><Empty icon={Building2} title="Sin CEDEARs">Agregá uno en Posiciones con el tipo "CEDEAR".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {cedears.length > 0 && (
        <Card>
          <CardHeader title="Indicadores clave" sub="Concentración y diversificación de la cartera de renta variable." />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
            <Stat label="Capital" value={fmtUsdCompact(totalMkt)} />
            <Stat label="Mayor posición" value={mayorPosicion
              ? <span className={mayorPosicion.pct >= CONCENTRACION_POSICION_ALERTA ? 'text-warn' : 'text-ink-900'}>{mayorPosicion.ticker} · {fmtPct(mayorPosicion.pct, 0)}</span>
              : <span className="text-ink-500">—</span>}
              hint={`% del capital en CEDEARs concentrado en un solo ticker — alerta a partir de ${fmtPct(CONCENTRACION_POSICION_ALERTA, 0)}`} />
            <Stat label="Sectores distintos" value={nSectores}
              hint="Cantidad de sectores distintos con capital cargado (no cuenta 'Sin sector')" />
            <Stat label="Concentración sectorial" value={hhiSector != null
              ? <span className={hhiSector >= 0.33 ? 'text-warn' : 'text-ink-900'}>{fmtNum(hhiSector, 2)}</span>
              : <span className="text-ink-500">—</span>}
              hint="Índice de Herfindahl (Σ pesoᵢ²) sobre el capital por sector: 1/N con N sectores parejos, 1 = todo en un sector. Por encima de 0.33 (equivalente a ~3 sectores parejos) empieza a ser una concentración alta." />
          </div>
        </Card>
      )}

      {cedears.length > 0 && (
        <Card>
          <CardHeader title="Distribución por sector y estilo" sub="Peso sobre el capital en CEDEARs (valor de mercado, o costo si no hay cotización)." />
          <div className="p-4 grid sm:grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-2">Por sector</p>
              {sectorData.length > 0 ? (
                <div className="grid grid-cols-[minmax(0,140px)_1fr] gap-3 items-center">
                  <div className="h-[140px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={sectorData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={64} paddingAngle={2} stroke="none">
                          {sectorData.map((_, i) => <Cell key={i} fill={sectorColors[i]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => [fmtPct(v, 0), 'Peso']}
                          contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    {sectorData.map((s, i) => (
                      <div key={s.name} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sectorColors[i] }} />
                        <span className="truncate text-ink-700">{s.name}</span>
                        <span className="ml-auto tnum text-ink-600">{fmtPct(s.value, 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-[11px] text-ink-500">Sin capital valuado todavía.</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-2">Por estilo (Peter Lynch)</p>
              {rolData.length > 0 ? (
                <div className="grid grid-cols-[minmax(0,140px)_1fr] gap-3 items-center">
                  <div className="h-[140px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={rolData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={64} paddingAngle={2} stroke="none">
                          {rolData.map((r, i) => <Cell key={i} fill={r.key === 'sin_clasificar' ? SIN_CLASIFICAR_COLOR : ROL_COLOR[r.key as AssetRole]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => [fmtPct(v, 0), 'Peso']}
                          contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    {rolData.map(r => (
                      <div key={r.name} className="flex items-center gap-1.5" title={r.key !== 'sin_clasificar' ? ROL_LABEL[r.key as AssetRole].desc : undefined}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.key === 'sin_clasificar' ? SIN_CLASIFICAR_COLOR : ROL_COLOR[r.key as AssetRole] }} />
                        <span className="truncate text-ink-700">{r.name}</span>
                        <span className="ml-auto tnum text-ink-600">{fmtPct(r.value, 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-[11px] text-ink-500">Sin capital valuado todavía.</p>}
            </div>
          </div>
          <p className="px-4 pb-1.5 text-[10px] text-ink-500">
            "Compounder" no es una de las 6 categorías de "One Up on Wall Street" — es un agregado del proyecto para negocios que reinvierten capital a tasas altas de forma sostenida (pasá el mouse sobre cada estilo para ver su descripción).
          </p>
          {mayorSector && mayorSector.pct >= CONCENTRACION_SECTOR_ALERTA && (
            <p className="px-4 pb-4 text-[11px] text-warn">
              {fmtPct(mayorSector.pct, 0)} del capital en CEDEARs está en {mayorSector.sector} — concentración sectorial alta.
            </p>
          )}
        </Card>
      )}

      {editPos && <ClasificarModal pos={editPos} onClose={() => setEditPos(null)}
        onSave={async (patch) => { await update(editPos.id, patch); setEditPos(null); }} />}
    </div>
  );
}

// Cargar sector (texto libre, con sugerencias) y estilo Peter Lynch de un CEDEAR existente.
function ClasificarModal({ pos, onClose, onSave }: { pos: Posicion; onClose: () => void; onSave: (patch: Partial<Posicion>) => Promise<void> }) {
  useEscapeClose(onClose);
  const [sector, setSector] = useState(pos.sector ?? '');
  const [rol, setRol] = useState<AssetRole | ''>(pos.rol ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    setBusy(true); setErr(null);
    try {
      await onSave({ sector: sector.trim() || null, rol: rol || null });
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Clasificar ${pos.ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Clasificar · ${pos.ticker}`} sub="Alimenta la distribución por sector y por estilo, y el resumen de cartera con IA."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 space-y-3 text-sm">
            <Field label="Sector">
              <select value={sector} onChange={e => setSector(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                {/* Si ya tenía cargado un sector fuera de la lista (texto libre de antes de este
                    cambio), lo dejamos como opción extra arriba para no perderlo en silencio al
                    abrir el modal — el select no lo pisa hasta que el usuario elija otra cosa. */}
                {sector && !SECTORES_SUGERIDOS.includes(sector) && <option value={sector}>{sector} (no está en la lista)</option>}
                {SECTORES_SUGERIDOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Estilo (Peter Lynch)">
              <select value={rol} onChange={e => setRol(e.target.value as AssetRole | '')} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r].label}</option>)}
              </select>
            </Field>
            {rol && <p className="text-[11px] text-ink-500 -mt-1">{ROL_LABEL[rol].desc}</p>}
          </div>
          {err && <p className="px-4 pt-1 text-xs text-warn">{err}</p>}
          <div className="px-4 py-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
