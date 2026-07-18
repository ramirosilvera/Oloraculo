import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones } from '../hooks/usePosiciones';
import { couponCalendar, cuponAnualTotal, type CouponBond } from '../engine/coupons';
import { Card, CardHeader, Stat, fmtUsd, fmtPct } from '../components/ui';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function CuponesPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);

  const bonds = useMemo<CouponBond[]>(() =>
    posiciones
      .filter(p => p.tipo === 'bono' && p.cupon_tasa && p.cupon_frecuencia && p.cupon_mes)
      .map(p => ({
        ticker: p.ticker,
        faceValue: p.cantidad,
        tasaAnual: p.cupon_tasa!,
        frecuencia: p.cupon_frecuencia!,
        mesRef: p.cupon_mes!,
        vencimiento: p.vencimiento,
      })), [posiciones]);

  const now = new Date();
  const cal = useMemo(() => couponCalendar(bonds, now.getFullYear(), now.getMonth() + 1, 12),
    [bonds, now.getFullYear(), now.getMonth()]);

  const anual = cuponAnualTotal(bonds);
  const capitalBonos = useMemo(() =>
    posiciones.filter(p => p.tipo === 'bono').reduce((s, p) => s + p.precio_compra * p.cantidad, 0),
    [posiciones]);
  const proximo = cal.find(m => m.total > 0);
  const chartData = cal.map(m => ({ mes: `${MESES[m.month - 1]}`, USD: m.total }));

  if (!active) return null;

  const totalBonos = posiciones.filter(p => p.tipo === 'bono').length;
  const conCupon = bonds.length;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-100">Flujo de cupones · {active.nombre}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Cupón anual" value={fmtUsd(anual, 0)} hint="suma de cupones de 12 meses" />
        <Stat label="Yield s/ costo" value={capitalBonos > 0 ? fmtPct(anual / capitalBonos, 1) : '—'} hint="cupón anual / capital invertido en bonos" />
        <Stat label="Próximo cobro" value={proximo ? `${MESES[proximo.month - 1]} ${proximo.year}` : '—'} hint={proximo ? fmtUsd(proximo.total, 0) : undefined} />
        <Stat label="Cargados" value={`${conCupon}/${totalBonos}`} hint="bonos con datos de cupón / total de bonos" />
      </div>

      {conCupon === 0 ? (
        <Card>
          <div className="p-6 text-center text-sm text-ink-600">
            Ningún bono tiene datos de cupón cargados todavía. En <b>Posiciones</b>, editá un bono y completá
            <b> tasa de cupón</b>, <b>frecuencia</b> y <b>mes de pago</b> para ver el calendario.
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Calendario 12 meses" sub="Cuánto cobrás de cupones cada mes (USD)." />
            <div className="p-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke="#1e2739" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" stroke="#6b7280" fontSize={11} />
                  <YAxis stroke="#6b7280" fontSize={11} tickFormatter={v => `$${v}`} width={48} />
                  <Tooltip contentStyle={{ background: '#0e1420', border: '1px solid #2a3446', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtUsd(v, 0)} cursor={{ fill: '#ffffff08' }} />
                  <Bar dataKey="USD" fill="#2dd4bf" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Detalle por mes" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead className="text-[11px] text-ink-600 border-b border-ink-700">
                  <tr>
                    <th className="text-left px-4 py-2">Mes</th>
                    <th className="text-left px-3">Bonos que pagan</th>
                    <th className="text-right px-4">Total USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/60">
                  {cal.filter(m => m.total > 0).map(m => (
                    <tr key={m.ym} className="hover:bg-ink-700/30">
                      <td className="px-4 py-2 text-gray-200">{MESES[m.month - 1]} {m.year}</td>
                      <td className="px-3 text-ink-600 text-[12px]">
                        {m.detalle.map(d => `${d.ticker} (${fmtUsd(d.monto, 0)})`).join(' · ')}
                      </td>
                      <td className="text-right px-4 tnum font-semibold text-accent">{fmtUsd(m.total, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
