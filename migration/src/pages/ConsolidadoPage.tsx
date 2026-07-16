import { useMemo } from 'react';
import { Layers, Info } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAllPosiciones, useQuotes } from '../hooks/usePosiciones';
import { PortfolioReview } from '../components/PortfolioReview';
import { Card, CardHeader, Stat, Badge, fmtUsd, fmtPct } from '../components/ui';
import type { Posicion } from '../types/domain';

function unitUSD(p: Posicion, live: number | null): number | null {
  if (live == null) return null;
  if (p.tipo === 'cedear' && p.ratio_cedear) return live / p.ratio_cedear;
  return live;
}

export function ConsolidadoPage() {
  const { portfolios } = usePortfolios();
  const { data: posiciones = [] } = useAllPosiciones(true);
  const equity = [...new Set(posiciones.filter(p => p.tipo !== 'bono' && p.tipo !== 'cash').map(p => p.ticker))];
  const bonds = [...new Set(posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker))];
  const { data: quotes = {} } = useQuotes(equity, bonds);

  const pfName = useMemo(() => new Map(portfolios.map(p => [p.id, p.nombre])), [portfolios]);

  const { porPortfolio, porTicker, total } = useMemo(() => {
    const mv = (p: Posicion) => {
      const u = unitUSD(p, quotes[p.ticker] ?? null);
      return u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
    };
    const porPortfolio = new Map<string, number>();
    const porTicker = new Map<string, { total: number; portfolios: Set<string> }>();
    let total = 0;
    for (const p of posiciones) {
      const v = mv(p);
      total += v;
      porPortfolio.set(p.portfolio_id, (porPortfolio.get(p.portfolio_id) ?? 0) + v);
      const t = porTicker.get(p.ticker) ?? { total: 0, portfolios: new Set<string>() };
      t.total += v; t.portfolios.add(p.portfolio_id); porTicker.set(p.ticker, t);
    }
    return { porPortfolio, porTicker, total };
  }, [posiciones, quotes]);

  const tickersOrdenados = [...porTicker.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-accent" />
        <h1 className="text-xl font-bold text-gray-100">Consolidado</h1>
        <Badge tone="accent">solo lectura</Badge>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-ink-900 border border-ink-700 px-3 py-2 text-[11px] text-ink-600">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>Vista agregada de todos los portfolios. La <b className="text-gray-300">gestión se hace por portfolio</b> (elegilo en el header); acá solo ves el total y la exposición combinada.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Patrimonio total" value={fmtUsd(total, 0)} />
        <Stat label="Portfolios" value={portfolios.length} />
        <Stat label="Activos distintos" value={porTicker.size} />
      </div>

      <Card>
        <CardHeader title="Peso por portfolio" />
        <div className="p-4 space-y-2">
          {portfolios.map(p => {
            const v = porPortfolio.get(p.id) ?? 0;
            const w = total > 0 ? v / total : 0;
            return (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-28 font-semibold text-gray-200 truncate">{p.nombre}</span>
                <div className="flex-1 h-2 rounded-full bg-ink-700 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.min(100, w * 100)}%` }} /></div>
                <span className="w-24 text-right tnum text-ink-600">{fmtUsd(v, 0)}</span>
                <span className="w-12 text-right tnum">{fmtPct(w, 0)}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Exposición consolidada por activo" sub="Cuánto pesa cada activo sumando todos los portfolios." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="text-[11px] text-ink-600 border-b border-ink-700">
              <tr><th className="text-left px-4 py-2">Activo</th><th className="text-right px-3">Valor total</th><th className="text-right px-3">% del total</th><th className="text-left px-4">En portfolios</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {tickersOrdenados.map(([ticker, info]) => (
                <tr key={ticker}>
                  <td className="px-4 py-2 font-semibold text-gray-100">{ticker}
                    {info.portfolios.size > 1 && <Badge tone="warn"><span className="ml-1">en {info.portfolios.size}</span></Badge>}
                  </td>
                  <td className="text-right px-3 tnum">{fmtUsd(info.total, 0)}</td>
                  <td className="text-right px-3 tnum">{fmtPct(total > 0 ? info.total / total : 0, 0)}</td>
                  <td className="px-4 text-[11px] text-ink-600">{[...info.portfolios].map(id => pfName.get(id)).join(', ')}</td>
                </tr>
              ))}
              {tickersOrdenados.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-600">Sin posiciones en ningún portfolio.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <PortfolioReview posiciones={posiciones} pfName={pfName} />
    </div>
  );
}
