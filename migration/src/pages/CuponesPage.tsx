import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { CalendarClock, Wallet, Trash2, Plus, Sparkles, Check, X } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useDividendosProyectados } from '../hooks/usePosiciones';
import { useCobros, COBRO_TIPO_LABEL } from '../hooks/useCobros';
import { useCobrosInversiones } from '../hooks/useCobrosInversiones';
import { useChartTheme } from '../hooks/usePrefs';
import { couponCalendar, cuponAnualTotal, type CouponBond } from '../engine/coupons';
import { dividendCalendar, dividendoAnualEstimado, type DividendPosicion } from '../engine/dividendProjection';
import { resumenCobros, saldoInvertible } from '../engine/cobros';
import { Card, CardHeader, Button, Badge, Field, Stat, Empty, inputCls, fmtUsd, fmtPct } from '../components/ui';
import type { Cobro, CobroInversion, CobroTipo, Posicion } from '../types/domain';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const hoy = () => new Date().toISOString().slice(0, 10);

export function CuponesPage() {
  const { active } = usePortfolios();
  const [tab, setTab] = useState<'cobrado' | 'proyectado'>('cobrado');

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Cobros · {active.nombre}</h1>
        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={() => setTab('cobrado')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${tab === 'cobrado' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600 hover:text-ink-900'}`}>Cobrado</button>
          <button onClick={() => setTab('proyectado')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${tab === 'proyectado' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600 hover:text-ink-900'}`}>Proyectado</button>
        </div>
      </div>
      {tab === 'cobrado' ? <CobradoTab portfolioId={active.id} /> : <ProyectadoTab portfolioId={active.id} />}
    </div>
  );
}

// ── Cobrado: registro REAL de dividendos/intereses/amortizaciones ────────────────────────────
function CobradoTab({ portfolioId }: { portfolioId: string }) {
  const { data: posiciones = [] } = usePosiciones(portfolioId);
  const { data: cobros, isLoading, registrar, registrarAmortizacion, marcarEstado, confirmarPendiente, descartarPendiente, remove } = useCobros(portfolioId);
  const { data: inversiones, marcarInversion, remove: removeInversion } = useCobrosInversiones(portfolioId);
  const resumen = useMemo(() => resumenCobros(cobros), [cobros]);
  const saldo = useMemo(() => saldoInvertible(resumen.disponible, inversiones), [resumen.disponible, inversiones]);
  // Los 'pendiente' (sugeridos por el cron) van en su propia bandeja, nunca en el historial normal
  // — ahí el toggle Disponible/Reinvertido no aplicaría y se prestaría a confusión. 'descartado'
  // no se muestra en ningún lado (quedó resuelto), pero la fila sigue en la base para que el cron
  // no vuelva a sugerir lo mismo.
  const pendientes = useMemo(() => cobros.filter(c => c.estado === 'pendiente'), [cobros]);
  const confirmados = useMemo(() => cobros.filter(c => c.estado === 'disponible' || c.estado === 'reinvertido'), [cobros]);

  const [modo, setModo] = useState<'existente' | 'otro'>(posiciones.length > 0 ? 'existente' : 'otro');
  const [posId, setPosId] = useState(posiciones[0]?.id ?? '');
  const [otroTicker, setOtroTicker] = useState('');
  const [tipo, setTipo] = useState<CobroTipo>('dividendo');
  const [fecha, setFecha] = useState(hoy());
  const [monto, setMonto] = useState('');
  const [nominales, setNominales] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Amortización: solo puede ser una posición EXISTENTE de tipo bono (reduce su nominal real).
  const opcionesPosicion = tipo === 'amortizacion' ? posiciones.filter(p => p.tipo === 'bono') : posiciones;
  const onTipoChange = (t: CobroTipo) => {
    setTipo(t);
    if (t === 'amortizacion') {
      setModo('existente');
      const bonos = posiciones.filter(p => p.tipo === 'bono');
      if (!bonos.some(p => p.id === posId)) setPosId(bonos[0]?.id ?? '');
    }
  };

  const pos = modo === 'existente' ? posiciones.find(p => p.id === posId) : undefined;
  const ticker = modo === 'existente' ? (pos?.ticker ?? '') : otroTicker.trim().toUpperCase();

  const submit = async () => {
    setErr(null);
    const m = Number(monto) || 0;
    if (!(m > 0)) { setErr('Ingresá un monto mayor a 0.'); return; }
    if (!ticker) { setErr('Elegí una posición o ingresá un ticker.'); return; }
    setBusy(true);
    try {
      if (tipo === 'amortizacion') {
        if (!pos) { setErr('La amortización requiere elegir un bono existente de la cartera.'); setBusy(false); return; }
        const nom = Number(nominales) || 0;
        if (!(nom > 0)) { setErr('Ingresá los nominales amortizados.'); setBusy(false); return; }
        await registrarAmortizacion({ posicionId: pos.id, ticker, fecha, monto: m, nominales: nom, nota: nota || null });
      } else {
        await registrar({ posicionId: pos?.id ?? null, ticker, tipo, fecha, monto: m, nota: nota || null });
      }
      setMonto(''); setNominales(''); setNota('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo registrar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Cobrado total" value={fmtUsd(resumen.total, 0)} hint="dividendos + intereses + amortizaciones" />
        <Stat label="Saldo p/ invertir" value={fmtUsd(saldo.neto, 0)} hint={`de ${fmtUsd(resumen.disponible, 0)} disponible, ya invertiste ${fmtUsd(saldo.invertido, 0)}`} />
        <Stat label="Reinvertido" value={fmtUsd(resumen.reinvertido, 0)} />
        <Stat label="Renta (div. + int.)" value={fmtUsd(resumen.porTipo.dividendo + resumen.porTipo.interes, 0)} hint="sin contar amortización (es capital, no renta)" />
      </div>

      {pendientes.length > 0 && (
        <PendientesCard pendientes={pendientes} onConfirmar={confirmarPendiente} onDescartar={descartarPendiente} />
      )}

      <SaldoInvertibleCard saldo={saldo} inversiones={inversiones} onMarcar={marcarInversion} onBorrar={removeInversion} />

      <Card>
        <CardHeader title="Registrar un cobro" sub="Dividendo/interés no tocan la posición. Amortización reduce el nominal del bono (movimiento 'ajuste')." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="col-span-2 sm:col-span-2 flex items-center gap-2">
            <button type="button" onClick={() => setModo('existente')} disabled={opcionesPosicion.length === 0}
              className={`flex-1 px-3 py-1.5 rounded-full text-xs font-semibold ${modo === 'existente' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600'} disabled:opacity-40`}>Posición existente</button>
            <button type="button" onClick={() => setModo('otro')} disabled={tipo === 'amortizacion'}
              className={`flex-1 px-3 py-1.5 rounded-full text-xs font-semibold ${modo === 'otro' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600'} disabled:opacity-40`}>Otro ticker</button>
          </div>
          <Field label="Tipo">
            <select value={tipo} onChange={e => onTipoChange(e.target.value as CobroTipo)} className={`${inputCls} appearance-none`}>
              <option value="dividendo">Dividendo</option>
              <option value="interes">Interés</option>
              <option value="amortizacion">Amortización (bono)</option>
            </select>
          </Field>
          <Field label="Fecha">
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls} />
          </Field>

          {modo === 'existente' ? (
            <Field label="Posición" className="col-span-2">
              <select value={posId} onChange={e => setPosId(e.target.value)} className={`${inputCls} appearance-none`}>
                {opcionesPosicion.length === 0 && <option value="">— sin bonos en la cartera —</option>}
                {opcionesPosicion.map(p => <option key={p.id} value={p.id}>{p.ticker} · {p.tipo}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Ticker" className="col-span-2">
              <input value={otroTicker} onChange={e => setOtroTicker(e.target.value.toUpperCase())} className={inputCls} placeholder="ej. AAPL (ya vendida, etc.)" />
            </Field>
          )}

          <Field label="Monto cobrado (USD)"><input type="number" value={monto} onChange={e => setMonto(e.target.value)} className={inputCls} placeholder="USD" /></Field>
          {tipo === 'amortizacion' && (
            <Field label="Nominales amortizados" hint={pos ? `tenencia actual: ${pos.cantidad}` : undefined}>
              <input type="number" value={nominales} onChange={e => setNominales(e.target.value)} className={inputCls} placeholder="nominales" />
            </Field>
          )}
          <Field label="Nota (opcional)" className="col-span-2 sm:col-span-2">
            <input value={nota} onChange={e => setNota(e.target.value)} className={inputCls} placeholder="opcional" />
          </Field>
        </div>
        {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
        <div className="px-4 pb-4 flex justify-end">
          <Button onClick={submit} disabled={busy}><Plus className="w-4 h-4" /> {busy ? 'Guardando…' : 'Registrar cobro'}</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Historial" sub="Marcá un cobro puntual como Reinvertido solo si sabés en qué activo lo pusiste — reduce el saldo de 'Saldo disponible para invertir' de arriba. Para invertir un monto general sin atarlo a un cobro puntual, usá esa tarjeta en vez de esto (no marques las dos cosas para la misma plata)." />
        {isLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : confirmados.length === 0 ? (
          <Empty icon={Wallet} title="Sin cobros registrados">Registrá el primero arriba cuando cobres un dividendo, interés o amortización.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2">Fecha</th>
                  <th className="text-left px-3">Activo</th>
                  <th className="text-left px-3">Tipo</th>
                  <th className="text-right px-3">Monto</th>
                  <th className="text-center px-3">Estado</th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {confirmados.map(c => (
                  <tr key={c.id} className="hover:bg-canvas">
                    <td className="px-4 py-2 text-ink-700">{c.fecha}</td>
                    <td className="px-3 font-semibold text-ink-900">{c.ticker}</td>
                    <td className="px-3"><Badge tone={c.tipo === 'amortizacion' ? 'warn' : 'accent'}>{COBRO_TIPO_LABEL[c.tipo]}</Badge></td>
                    <td className="text-right px-3 tnum font-semibold text-ink-900">{fmtUsd(c.monto, 0)}</td>
                    <td className="text-center px-3">
                      <button onClick={() => marcarEstado(c.id, c.estado === 'disponible' ? 'reinvertido' : 'disponible')}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${c.estado === 'reinvertido' ? 'bg-celeste-100 text-celeste-700 dark:bg-celeste-500/20 dark:text-celeste-300' : 'bg-warn/10 text-warn'}`}>
                        {c.estado === 'reinvertido' ? 'Reinvertido' : 'Disponible'}
                      </button>
                    </td>
                    <td className="px-2 text-right">
                      <button onClick={() => { if (window.confirm(`¿Borrar el registro de cobro de ${c.ticker}?`)) remove(c.id); }}
                        className="text-ink-500 hover:text-neg inline-flex items-center justify-center w-8 h-8" title="Borrar" aria-label="Borrar">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Por confirmar: sugerencias del cron (dividendos declarados/estimados, cupones sintéticos que
// llegaron a su fecha). NUNCA se auto-confirman — el usuario revisa el monto (editable, porque el
// dato es bruto y puede diferir del real por retención, dividendo especial, etc.) y confirma UNO
// POR UNO. A propósito no hay "confirmar todos": eso es exactamente lo que se quiere evitar —
// que se acepten en lote sin mirar.
function PendientesCard({ pendientes, onConfirmar, onDescartar }: {
  pendientes: Cobro[]; onConfirmar: (id: string, monto: number) => Promise<void>; onDescartar: (id: string) => Promise<void>;
}) {
  return (
    <Card className="ring-1 ring-inset ring-warn/30">
      <CardHeader title="Por confirmar" sub="Sugeridos automáticamente — revisá el monto (es bruto, sin retención) y confirmá uno por uno."
        right={<Badge tone="warn">{pendientes.length}</Badge>} />
      <div className="divide-y divide-line">
        {pendientes.map(p => <PendienteRow key={p.id} p={p} onConfirmar={onConfirmar} onDescartar={onDescartar} />)}
      </div>
    </Card>
  );
}

function PendienteRow({ p, onConfirmar, onDescartar }: {
  p: Cobro; onConfirmar: (id: string, monto: number) => Promise<void>; onDescartar: (id: string) => Promise<void>;
}) {
  const [monto, setMonto] = useState(String(p.monto));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // `finally` siempre libera `busy`, tanto si sale bien (la fila desaparece al refetch de todos
  // modos) como si falla (sin esto, un error dejaba el botón trabado en "confirmando…" para siempre).
  const confirmar = async () => {
    const m = Number(monto) || 0;
    if (!(m > 0)) { setErr('Monto inválido.'); return; }
    setBusy(true); setErr(null);
    try { await onConfirmar(p.id, m); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo confirmar'); }
    finally { setBusy(false); }
  };
  const descartar = async () => {
    if (!window.confirm(`¿Descartar la sugerencia de ${p.ticker}? El cron no la va a volver a sugerir.`)) return;
    setBusy(true); setErr(null);
    try { await onDescartar(p.id); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo descartar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 flex flex-wrap items-start gap-3 text-sm">
      <div className="min-w-[140px]">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-warn shrink-0" />
          <span className="font-semibold text-ink-900">{p.ticker}</span>
          <Badge tone={p.tipo === 'amortizacion' ? 'warn' : 'accent'}>{COBRO_TIPO_LABEL[p.tipo]}</Badge>
        </div>
        <p className="text-[11px] text-ink-600 mt-0.5">{p.fecha}</p>
      </div>
      <div className="flex-1 min-w-[220px]">
        {p.nota && <p className="text-[11px] text-ink-500 leading-relaxed">{p.nota}</p>}
        {err && <p className="text-[11px] text-warn mt-1">{err}</p>}
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <div className="relative flex-1 sm:flex-none min-w-0">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 text-xs">US$</span>
          <input type="number" value={monto} onChange={e => setMonto(e.target.value)} disabled={busy}
            className={`${inputCls} w-full sm:w-28 pl-8`} />
        </div>
        <Button onClick={confirmar} disabled={busy} className="shrink-0"><Check className="w-4 h-4" /> Confirmar</Button>
        <button onClick={descartar} disabled={busy} title="Descartar" aria-label="Descartar"
          className="text-ink-500 hover:text-neg inline-flex items-center justify-center w-9 h-9 shrink-0 disabled:opacity-50">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Saldo p/ invertir: el dinero cobrado se va acumulando solo (dividendos/intereses/amortizaciones
// confirmados); esto es lo que faltaba — decidir CUÁNTO de ese saldo ya se puso a trabajar, sin
// tener que elegir a mano cuáles filas puntuales de cobros "son" esa plata (nunca coincide exacto,
// porque junta varios dividendos chicos). Cada "marcar inversión" resta del saldo bruto.
function SaldoInvertibleCard({ saldo, inversiones, onMarcar, onBorrar }: {
  saldo: ReturnType<typeof saldoInvertible>; inversiones: CobroInversion[];
  onMarcar: (input: { monto: number; fecha: string; nota?: string | null }) => Promise<void>;
  onBorrar: (id: string) => Promise<void>;
}) {
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);

  const marcar = async () => {
    setErr(null);
    const m = Number(monto) || 0;
    if (!(m > 0)) { setErr('Ingresá un monto mayor a 0.'); return; }
    if (m - saldo.neto > 0.005) { setErr(`Ese monto supera el saldo disponible (${fmtUsd(saldo.neto, 0)}).`); return; }
    setBusy(true);
    try { await onMarcar({ monto: m, fecha, nota: nota || null }); setMonto(''); setNota(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo registrar'); }
    finally { setBusy(false); }
  };

  return (
    <Card className={saldo.sobregirado ? 'ring-1 ring-inset ring-warn/40' : undefined}>
      <CardHeader title="Saldo disponible para invertir" sub="Los cobros confirmados se acumulan solos; marcá acá cuánto de ese saldo ya pusiste a trabajar (no hace falta también tocar el toggle Reinvertido del Historial para la misma plata)." />
      <div className="p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-bold text-ink-900 tnum">{fmtUsd(saldo.neto, 0)}</span>
          <span className="text-xs text-ink-600">nuevo saldo · de {fmtUsd(saldo.disponibleBruto, 0)} cobrado ya invertiste {fmtUsd(saldo.invertido, 0)}</span>
        </div>
        {saldo.sobregirado && (
          <p className="text-xs text-warn">Marcaste más inversión de la que hay disponible (seguramente porque un cobro se editó o borró después). Revisá el historial de abajo.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm items-end">
          <Field label="Monto a invertir (USD)"><input type="number" value={monto} onChange={e => setMonto(e.target.value)} className={inputCls} placeholder="USD" /></Field>
          <Field label="Fecha"><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls} /></Field>
          <Field label="Nota (opcional)" className="col-span-2 sm:col-span-1"><input value={nota} onChange={e => setNota(e.target.value)} className={inputCls} placeholder="ej. MSFT +2" /></Field>
          <Button onClick={marcar} disabled={busy}><Plus className="w-4 h-4" /> {busy ? 'Guardando…' : 'Marcar inversión'}</Button>
        </div>
        {err && <p className="text-xs text-warn">{err}</p>}

        {inversiones.length > 0 && (
          <div className="pt-1">
            <button onClick={() => setVerHistorial(v => !v)} className="text-xs text-celeste-600 hover:underline">
              {verHistorial ? 'Ocultar' : 'Ver'} historial ({inversiones.length})
            </button>
            {verHistorial && (
              <div className="mt-2 divide-y divide-line border border-line rounded-xl overflow-hidden">
                {inversiones.map(i => (
                  <div key={i.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="text-ink-700">{i.fecha}</span>
                      {i.nota && <span className="text-ink-500 ml-2 text-xs">{i.nota}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="tnum font-semibold text-ink-900">{fmtUsd(i.monto, 0)}</span>
                      <button onClick={() => { if (window.confirm('¿Deshacer esta inversión? El monto vuelve al saldo disponible.')) onBorrar(i.id); }}
                        className="text-ink-500 hover:text-neg inline-flex items-center justify-center w-7 h-7" title="Deshacer" aria-label="Deshacer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Proyectado: calendario a futuro — cupones de bonos (sintético, de tasa/frecuencia cargadas a
// mano) + dividendos de CEDEARs/acciones/ETFs (a partir del proveedor: declarado o estimado por
// cadencia histórica si no hay fecha confirmada — SIEMPRE a confirmar contra el cobro real,
// nunca se auto-registra: ver PendientesCard más arriba, que es donde eso se confirma de verdad).
function ProyectadoTab({ portfolioId }: { portfolioId: string }) {
  const { data: posiciones = [] } = usePosiciones(portfolioId);
  const chart = useChartTheme();

  const bonds = useMemo<CouponBond[]>(() =>
    posiciones
      .filter((p: Posicion) => p.tipo === 'bono' && p.cupon_tasa && p.cupon_frecuencia && p.cupon_mes)
      .map(p => ({
        ticker: p.ticker,
        faceValue: p.cantidad,
        tasaAnual: p.cupon_tasa!,
        frecuencia: p.cupon_frecuencia!,
        mesRef: p.cupon_mes!,
        vencimiento: p.vencimiento,
      })), [posiciones]);

  const equities = useMemo(() => posiciones.filter(p =>
    (p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf') && p.cantidad > 0), [posiciones]);
  const equityTickers = useMemo(() => [...new Set(equities.map(p => p.ticker))], [equities]);
  const { data: divInfo = {} } = useDividendosProyectados(equityTickers);
  const divPosiciones = useMemo<DividendPosicion[]>(() =>
    equities.map(p => ({ ticker: p.ticker, tipo: p.tipo, cantidad: p.cantidad, ratioCedear: p.ratio_cedear })),
    [equities]);

  const now = new Date();
  const cal = useMemo(() => couponCalendar(bonds, now.getFullYear(), now.getMonth() + 1, 12),
    [bonds, now.getFullYear(), now.getMonth()]);
  const divCal = useMemo(() => dividendCalendar(divPosiciones, divInfo, now.getFullYear(), now.getMonth() + 1, 12),
    [divPosiciones, divInfo, now.getFullYear(), now.getMonth()]);

  const anual = cuponAnualTotal(bonds);
  const divAnual = useMemo(() => dividendoAnualEstimado(divPosiciones, divInfo, now.getFullYear(), now.getMonth() + 1),
    [divPosiciones, divInfo, now.getFullYear(), now.getMonth()]);
  const capitalBonos = useMemo(() =>
    posiciones.filter(p => p.tipo === 'bono').reduce((s, p) => s + p.precio_compra * p.cantidad, 0),
    [posiciones]);
  const proximo = cal.find(m => m.total > 0);
  const proximoDiv = divCal.find(m => m.total > 0);

  // Mismo eje de meses para las dos series (ambos calendarios arrancan en el mismo fromYear/fromMonth
  // con 12 meses) — se combinan índice a índice para el chart apilado y la tabla de detalle.
  const chartData = cal.map((m, i) => ({ mes: MESES[m.month - 1], Cupones: m.total, Dividendos: divCal[i]?.total ?? 0 }));

  const totalBonos = posiciones.filter(p => p.tipo === 'bono').length;
  const conCupon = bonds.length;
  const conDividendo = equities.filter(p => {
    const info = divInfo[p.ticker.toUpperCase()];
    return info && info.estado !== 'sin-dato';
  }).length;

  const sinDatos = conCupon === 0 && conDividendo === 0 && equities.length === 0 && totalBonos === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Cupón anual" value={fmtUsd(anual, 0)} hint="suma de cupones de 12 meses (proyectado)" />
        <Stat label="Yield s/ costo" value={capitalBonos > 0 ? fmtPct(anual / capitalBonos, 1) : '—'} hint="cupón anual / capital invertido en bonos" />
        <Stat label="Próximo cupón" value={proximo ? `${MESES[proximo.month - 1]} ${proximo.year}` : '—'} hint={proximo ? fmtUsd(proximo.total, 0) : undefined} />
        <Stat label="Cargados (bonos)" value={`${conCupon}/${totalBonos}`} hint="bonos con datos de cupón / total de bonos" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Dividendos anual (estimado)" value={fmtUsd(divAnual, 0)} hint="CEDEARs/acciones — a confirmar contra el cobro real" />
        <Stat label="Próximo dividendo" value={proximoDiv ? `${MESES[proximoDiv.month - 1]} ${proximoDiv.year}` : '—'} hint={proximoDiv ? fmtUsd(proximoDiv.total, 0) : undefined} />
        <Stat label="Cargados (dividendos)" value={`${conDividendo}/${equities.length}`} hint="con dato del proveedor / total de CEDEARs-acciones" />
        <Stat label="Total proyectado 12m" value={fmtUsd(anual + divAnual, 0)} hint="cupones + dividendos, ambos estimados" />
      </div>

      {sinDatos ? (
        <Card>
          <Empty icon={CalendarClock} title="Sin datos para proyectar">
            En Posiciones, cargá tasa/frecuencia/mes de cupón en tus bonos, o esperá a que el proveedor tenga calendario de dividendos para tus CEDEARs/acciones.
          </Empty>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Calendario 12 meses" sub="Proyección — cuánto DEBERÍAS cobrar cada mes (USD), no lo ya cobrado. Dividendos: siempre a confirmar contra el pago real." />
            <div className="p-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" stroke={chart.axis} fontSize={11} />
                  <YAxis stroke={chart.axis} fontSize={11} tickFormatter={v => `US$${v}`} width={52} />
                  <Tooltip contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, fontSize: 12, color: chart.tooltipText }}
                    formatter={(v: number) => fmtUsd(v, 0)} cursor={{ fill: 'rgba(116,172,223,0.10)' }} />
                  <Bar dataKey="Cupones" stackId="p" fill="#4F97D4" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Dividendos" stackId="p" fill="#E3B341" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Detalle por mes" sub="🔵 cupón de bono · 🟡 dividendo (declarado o estimado, a confirmar)" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead className="text-[11px] text-ink-600 border-b border-line">
                  <tr>
                    <th className="text-left px-4 py-2">Mes</th>
                    <th className="text-left px-3">Activos que pagan</th>
                    <th className="text-right px-4">Total USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {cal.map((m, i) => {
                    const dm = divCal[i];
                    const total = m.total + (dm?.total ?? 0);
                    if (total <= 0) return null;
                    return (
                      <tr key={m.ym} className="hover:bg-canvas">
                        <td className="px-4 py-2 text-ink-800">{MESES[m.month - 1]} {m.year}</td>
                        <td className="px-3 text-ink-600 text-[12px]">
                          {[
                            ...m.detalle.map(d => `🔵 ${d.ticker} (${fmtUsd(d.monto, 0)})`),
                            ...(dm?.detalle.map(d => `🟡 ${d.ticker} (${fmtUsd(d.monto, 0)})${d.estado === 'estimado' ? ' est.' : ''}`) ?? []),
                          ].join(' · ')}
                        </td>
                        <td className="text-right px-4 tnum font-semibold text-accent">{fmtUsd(total, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
