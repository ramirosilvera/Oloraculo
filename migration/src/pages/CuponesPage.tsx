import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { CalendarClock } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones } from '../hooks/usePosiciones';
import { couponCalendar, cuponAnualTotal, type CouponBond } from '../engine/coupons';
import { Card, CardHeader, Stat, Empty, fmtUsd, fmtPct } from '../components/ui';

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
      <h1 className="text-2xl font-bold text-ink-900 font-display">Flujo de cupones · {active.nombre}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Cupón anual" value={fmtUsd(anual, 0)} hint="suma de cupones de 12 meses" />
        <Stat label="Yield s/ costo" value={capitalBonos > 0 ? fmtPct(anual / capitalBonos, 1) : '—'} hint="cupón anual / capital invertido en bonos" />
        <Stat label="Próximo cobro" value={proximo ? `${MESES[proximo.month - 1]} ${proximo.year}` : '—'} hint={proximo ? fmtUsd(proximo.total, 0) : undefined} />
        <Stat label="Cargados" value={`${conCupon}/${totalBonos}`} hint="bonos con datos de cupón / total de bonos" />
      </div>

      {conCupon === 0 ? (
        <Card>
          <Empty icon={CalendarClock} title="Sin datos de cupón">
            En Posiciones, editá un bono y completá tasa de cupón, frecuencia y mes de pago para ver el calendario.
          </Empty>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Calendario 12 meses" sub="Cuánto cobrás de cupones cada mes (USD)." />
            <div className="p-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke="#E4ECF4" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" stroke="#8595A8" fontSize={11} />
                  <YAxis stroke="#8595A8" fontSize={11} tickFormatter={v => `$${v}`} width={48} />
                  <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E4ECF4', borderRadius: 12, fontSize: 12, color: '#14212E' }}
                    formatter={(v: number) => fmtUsd(v, 0)} cursor={{ fill: 'rgba(116,172,223,0.10)' }} />
                  <Bar dataKey="USD" fill="#4F97D4" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Detalle por mes" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead className="text-[11px] text-ink-600 border-b border-line">
                  <tr>
                    <th className="text-left px-4 py-2">Mes</th>
                    <th className="text-left px-3">Bonos que pagan</th>
                    <th className="text-right px-4">Total USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {cal.filter(m => m.total > 0).map(m => (
                    <tr key={m.ym} className="hover:bg-canvas">
                      <td className="px-4 py-2 text-ink-800">{MESES[m.month - 1]} {m.year}</td>
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
