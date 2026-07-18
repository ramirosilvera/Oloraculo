import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMacro } from '../hooks/usePosiciones';
import { LADDER, readCurve, nivelTasaLarga, impactoPorTasa, type Luz } from '../engine/rates';
import { Card, CardHeader, Stat, Badge, fmtUsd, fmtPct } from '../components/ui';

const LUZ_BG: Record<Luz, string> = { verde: 'bg-pos/15 text-pos', amarillo: 'bg-warn/15 text-warn', rojo: 'bg-neg/15 text-neg' };
const LUZ_TONE: Record<Luz, 'pos' | 'warn' | 'neg'> = { verde: 'pos', amarillo: 'warn', rojo: 'neg' };

// Precios de los ETFs de la escalera (SHV/IEF/TLT) vía Finnhub.
function useLadderPrices() {
  const etfs = LADDER.map(r => r.etf);
  return useQuery({
    queryKey: ['ladder', etfs.join(',')],
    staleTime: 15 * 60_000,
    queryFn: () => api.quotes(etfs),
  });
}

export function TasasPage() {
  const { data: macro = {} } = useMacro();
  const { data: prices = {} } = useLadderPrices();

  const dgs3mo = (macro as Record<string, number | null>).dgs3mo ?? null;
  const dgs10 = (macro as Record<string, number | null>).dgs10 ?? null;
  const hy = (macro as Record<string, number | null>).hy_spread ?? null;

  const curva = useMemo(() => readCurve(dgs3mo, dgs10), [dgs3mo, dgs10]);
  const nivel = useMemo(() => nivelTasaLarga(dgs10), [dgs10]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-100">Escalera de tasas · EEUU</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="T-Bills 3M" value={dgs3mo != null ? fmtPct(dgs3mo / 100, 2) : '—'} hint="DGS3MO (FRED)" />
        <Stat label="Treasury 10A" value={dgs10 != null ? fmtPct(dgs10 / 100, 2) : '—'} hint="DGS10 (FRED)" />
        <Stat label="Spread 10a−3m" value={curva.spread != null ? `${curva.spread > 0 ? '+' : ''}${curva.spread.toFixed(2)} pp` : '—'} hint="forma de la curva" />
        <Stat label="HY spread" value={hy != null ? fmtPct(hy / 100, 2) : '—'} hint="riesgo de crédito corporativo" />
      </div>

      <Card>
        <CardHeader title="Lectura de la curva"
          right={curva.luz && <Badge tone={LUZ_TONE[curva.luz]}>{curva.forma}</Badge>} />
        <div className="p-4 space-y-2">
          <p className="text-sm text-gray-300">{curva.sugerencia}</p>
          {nivel.luz && (
            <p className={`text-sm rounded-lg px-3 py-2 ${LUZ_BG[nivel.luz]}`}>{nivel.texto}</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Peldaños de la escalera" sub="Cada ETF representa un tramo de la curva de Treasuries." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[11px] text-ink-600 border-b border-ink-700">
              <tr>
                <th className="text-left px-4 py-2">Tramo</th>
                <th className="text-left px-3">ETF</th>
                <th className="text-right px-3">Precio</th>
                <th className="text-right px-3">Duración</th>
                <th className="text-right px-3" title="Impacto en precio si la tasa sube 1%">Si tasa +1%</th>
                <th className="text-right px-4" title="Impacto en precio si la tasa baja 1%">Si tasa −1%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {LADDER.map(r => {
                const px = (prices as Record<string, number | null>)[r.etf] ?? null;
                const up = impactoPorTasa(r.durYears, 1);    // tasa +1% → precio baja
                const down = impactoPorTasa(r.durYears, -1); // tasa −1% → precio sube
                return (
                  <tr key={r.key} className="hover:bg-ink-700/30">
                    <td className="px-4 py-2">
                      <span className="font-semibold text-gray-100">{r.label}</span>
                      <span className="text-[11px] text-ink-600 ml-2">{r.tramo}</span>
                    </td>
                    <td className="px-3 font-semibold text-accent">{r.etf}</td>
                    <td className="text-right px-3 tnum">{fmtUsd(px)}</td>
                    <td className="text-right px-3 tnum text-ink-600">{r.durYears.toFixed(1)}a</td>
                    <td className="text-right px-3 tnum text-neg">{fmtPct(up, 1)}</td>
                    <td className="text-right px-4 tnum text-pos">+{fmtPct(down, 1).replace('-', '')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] text-ink-600">
          Regla de duración: ΔPrecio ≈ −Duración × ΔTasa. El tramo largo (TLT) es el que más sube
          cuando bajan las tasas… y el que más cae cuando suben.
        </p>
      </Card>
    </div>
  );
}
