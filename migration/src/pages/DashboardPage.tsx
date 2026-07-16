import { useMemo } from 'react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes, useMacro } from '../hooks/usePosiciones';
import { SEMAFOROS, sintesis, type Luz } from '../engine/semaforos';
import { Card, CardHeader, Stat, Badge, fmtUsd, fmtPct } from '../components/ui';
import { unitValueUSD as unitUSD } from '../lib/valuation';

const LUZ_BG: Record<Luz, string> = { verde: 'bg-pos/15 text-pos', amarillo: 'bg-warn/15 text-warn', rojo: 'bg-neg/15 text-neg' };

export function DashboardPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const equity = posiciones.filter(p => p.tipo !== 'bono' && p.tipo !== 'cash').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds);
  const { data: macro = {} } = useMacro();

  const { patrimonio, costo, pnl } = useMemo(() => {
    let patrimonio = 0, costo = 0;
    for (const p of posiciones) {
      const u = unitUSD(p, quotes[p.ticker] ?? null);
      patrimonio += (u != null ? u * p.cantidad : p.precio_compra * p.cantidad);
      costo += p.precio_compra * p.cantidad;
    }
    return { patrimonio, costo, pnl: patrimonio - costo };
  }, [posiciones, quotes]);

  const semaforos = SEMAFOROS.map(s => {
    const v = (macro as Record<string, number | null>)[s.key];
    return { def: s, valor: v ?? null, luz: v != null ? s.evalua(v) : null };
  });
  const luces = semaforos.map(s => s.luz).filter(Boolean) as Luz[];
  const sint = sintesis(luces);

  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-100">Dashboard · {active.nombre}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Patrimonio" value={fmtUsd(patrimonio, 0)} />
        <Stat label="Costo" value={fmtUsd(costo, 0)} />
        <Stat label="P&L" value={fmtUsd(pnl, 0)} delta={costo > 0 ? pnl / costo : undefined} />
        <Stat label="Objetivo" value={fmtUsd(active.capital_objetivo, 0)} hint="capital objetivo del portfolio" />
      </div>

      <Card>
        <CardHeader title="Contexto macro" sub="Umbrales de la planilla original."
          right={<Badge tone={sint.luz === 'rojo' ? 'neg' : sint.luz === 'amarillo' ? 'warn' : 'pos'}>{sint.texto} · {sint.rojos} 🔴</Badge>} />
        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {semaforos.map(({ def, valor, luz }) => (
            <div key={def.key} className={`rounded-lg px-3 py-2 ${luz ? LUZ_BG[luz] : 'bg-ink-800/60 text-ink-600'}`}>
              <p className="text-[10px] uppercase tracking-wide opacity-70">{def.label}</p>
              <p className="text-base font-bold tnum">{valor != null ? (def.fmt ? def.fmt(valor) : valor) : '—'}</p>
            </div>
          ))}
        </div>
        <p className="px-4 pb-3 text-[11px] text-ink-600">
          Los indicadores de mercado (S&P, VIX, oro, BTC, Dollar index, Merval, ADR YPF) se completan
          cuando el cron de precios los cargue en <code>macro_cache</code>.
        </p>
      </Card>

      <Card>
        <CardHeader title="Distribución por posición" />
        <div className="p-4 space-y-1.5">
          {posiciones.map(p => {
            const u = unitUSD(p, quotes[p.ticker] ?? null);
            const mkt = u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
            const w = patrimonio > 0 ? mkt / patrimonio : 0;
            return (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-16 font-semibold text-gray-200">{p.ticker}</span>
                <div className="flex-1 h-2 rounded-full bg-ink-700 overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, w * 100)}%` }} />
                </div>
                <span className="w-12 text-right tnum text-ink-600">{fmtPct(w, 0)}</span>
                {p.peso_objetivo != null && <span className="w-16 text-right tnum text-[10px] text-ink-600">obj {fmtPct(p.peso_objetivo, 0)}</span>}
              </div>
            );
          })}
          {posiciones.length === 0 && <p className="text-sm text-ink-600">Sin posiciones. Cargalas en Posiciones.</p>}
        </div>
      </Card>
    </div>
  );
}
