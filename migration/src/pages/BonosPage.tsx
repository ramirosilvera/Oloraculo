import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes } from '../hooks/usePosiciones';
import { Card, CardHeader, fmtUsd, fmtNum, fmtPct } from '../components/ui';

export function BonosPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const bonos = posiciones.filter(p => p.tipo === 'bono');
  const { data: quotes = {} } = useQuotes([], bonos.map(b => b.ticker));

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
        <CardHeader title="Bonos y ONs" sub="Precio por nominal desde data912 (paridad = precio/100 × 100)."
          right={<span className="text-xs text-ink-600 tnum">Capital {fmtUsd(totalCapital, 0)} · Mercado {fmtUsd(totalMkt, 0)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Especie</th>
                <th className="text-right px-3">Nominales</th>
                <th className="text-right px-3">Capital</th>
                <th className="text-right px-3">Paridad</th>
                <th className="text-right px-3">Valor mercado</th>
                <th className="text-right px-3">Resultado</th>
                <th className="text-left px-4">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bonos.map(b => {
                const px = quotes[b.ticker] ?? null;               // precio por nominal (data912/100)
                const paridad = px != null ? px * 100 : null;      // en %
                const capital = b.precio_compra * b.cantidad;
                const mkt = px != null ? px * b.cantidad : null;
                const res = mkt != null ? mkt - capital : null;
                return (
                  <tr key={b.id} className="hover:bg-canvas">
                    <td className="px-4 py-2 font-semibold text-ink-900">{b.ticker}</td>
                    <td className="text-right px-3 tnum">{fmtNum(b.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-ink-700">{fmtUsd(capital, 0)}</td>
                    <td className="text-right px-3 tnum text-accent">{paridad != null ? fmtPct(paridad / 100, 1) : '—'}</td>
                    <td className="text-right px-3 tnum">{fmtUsd(mkt, 0)}</td>
                    <td className={`text-right px-3 tnum ${res == null ? '' : res >= 0 ? 'text-pos' : 'text-neg'}`}>{res == null ? '—' : `${res >= 0 ? '+' : ''}${fmtUsd(res, 0)}`}</td>
                    <td className="px-4 text-[11px] text-ink-600">{b.notas || '—'}</td>
                  </tr>
                );
              })}
              {bonos.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-600">Sin bonos en este portfolio. Agregalos en Posiciones (tipo "Bono/ON").</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
