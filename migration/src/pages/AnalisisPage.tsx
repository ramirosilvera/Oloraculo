import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useQuotes, useMacro } from '../hooks/usePosiciones';
import { useCikMap } from '../hooks/useCikMap';
import { usePortfolios } from '../hooks/usePortfolios';
import { computeRatios } from '../engine/ratios';
import { computeDcf, sensitivityTable, dcfDefaultsFor, DEFAULT_DCF_INPUTS, type DcfInputs, type CapexMethod } from '../engine/dcf';
import { useDcfInputs } from '../hooks/useDcfInputs';
import { Card, CardHeader, Button, Badge, Stat, fmtUsd, fmtNum, fmtPct } from '../components/ui';
import type { Fundamentals } from '../types/domain';

export function AnalisisPage() {
  const { ticker = '' } = useParams();
  const T = ticker.toUpperCase();
  const { active } = usePortfolios();
  const [inp, setInp] = useState<DcfInputs>(DEFAULT_DCF_INPUTS);
  const [beta, setBeta] = useState(1.0);

  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const { map: dcfMap, isLoading: dcfLoading, save: saveDcf, remove: removeDcf } = useDcfInputs();
  const cik = cikMap.get(T)?.cik;
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data: fund, isLoading, error } = useQuery({
    queryKey: ['fundamentals', T, cik ?? ''],
    enabled: !cikLoading,   // esperar el cik_map para tickers fuera del set por defecto
    queryFn: () => api.fundamentals(T, cik),
    staleTime: 12 * 60 * 60_000,
  });
  // Fuerza re-consulta a EDGAR salteando la cache del server (fresh=1) y actualiza la vista.
  const actualizar = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.fundamentals(T, cik, true);
      qc.setQueryData(['fundamentals', T, cik ?? ''], fresh);
    } catch { /* se muestra el estado de error normal */ } finally { setRefreshing(false); }
  };
  const { data: quotes = {} } = useQuotes([T]);
  const { data: macro = {} } = useMacro();
  const price = quotes[T] ?? null;
  const riskFree = (macro.dgs10 ?? 4.3) / 100;

  const seededFor = useRef<string | null>(null);
  useEffect(() => { seededFor.current = null; setSaveMsg(null); }, [T]);

  const { ratios, dcf, sens } = useMemo(() => {
    if (!fund) return { ratios: null, dcf: null, sens: null };
    const f = fund as Fundamentals;
    const r = computeRatios(f, price, beta, riskFree);
    const d = computeDcf(f, price, r.wacc, inp, r.roic);
    const s = sensitivityTable(f, r.wacc, inp,
      [inp.g - 0.04, inp.g - 0.02, inp.g, inp.g + 0.02, inp.g + 0.04].map(x => Math.max(0, x)),
      [inp.d - 0.02, inp.d, inp.d + 0.02, inp.d + 0.04]);
    return { ratios: r, dcf: d, sens: s };
  }, [fund, price, beta, riskFree, inp]);

  // Al abrir un ticker (una vez que hay ratios y cargó lo guardado): si el usuario ya guardó
  // supuestos para ese ticker, los usamos; si no, calculamos los defaults por empresa
  // (g = EG5Y−1pto, d = WACC, gt 3%, N 20, MoS 20%).
  useEffect(() => {
    if (!ratios || dcfLoading || seededFor.current === T) return;
    seededFor.current = T;
    const saved = dcfMap.get(T);
    if (saved) { const { beta: b, ...rest } = saved; setInp(rest); setBeta(b); }
    else { setInp(dcfDefaultsFor(ratios)); setBeta(1.0); }
  }, [ratios, dcfLoading, T, dcfMap]);

  const guardarSupuestos = async () => {
    try { await saveDcf(T, { ...inp, beta }); setSaveMsg('Guardado ✓ — el Radar usará estos supuestos.'); }
    catch (e) { setSaveMsg(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`); }
  };
  const restablecer = async () => {
    if (ratios) { setInp(dcfDefaultsFor(ratios)); setBeta(1.0); }
    try { await removeDcf(T); setSaveMsg('Restablecido a los valores por defecto.'); } catch { /* */ }
  };

  if (cikLoading || isLoading) return <p className="text-ink-600">Cargando fundamentals de {T}…</p>;
  if (error) return (
    <div className="space-y-3">
      <Link to="/analisis" className="text-xs text-celeste-600 hover:underline">← Volver a Análisis</Link>
      <div className="text-sm text-warn space-y-1">
        <p>No hay fundamentals de <b>{T}</b> vía EDGAR.</p>
        <p className="text-ink-600">Solo funciona con empresas que reportan a la SEC. Si es una grande de EE.UU. que no reconocemos, cargá su par ticker → CIK en <b>Configuración</b>.</p>
      </div>
    </div>
  );
  if (!fund || !ratios || !dcf) return null;

  const verdictTone = dcf.verdict === 'COMPRAR' ? 'pos' : dcf.verdict === 'CARO' ? 'neg' : 'warn';

  return (
    <div className="space-y-4">
      <Link to="/analisis" className="inline-flex items-center text-xs text-celeste-600 hover:underline">← Volver a Análisis</Link>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">{T}</h1>
        <span className="text-sm text-ink-600">{(fund as Fundamentals).entityName ?? ''}</span>
        <Badge tone={verdictTone as 'pos'|'neg'|'warn'}>{dcf.verdict}</Badge>
        {(fund as { warning?: string }).warning && <Badge tone="warn">datos incompletos EDGAR</Badge>}
        <Button variant="ghost" onClick={actualizar} disabled={refreshing} className="ml-auto">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Actualizando…' : 'Actualizar datos'}
        </Button>
      </div>
      {(fund as { warning?: string }).warning && (
        <p className="text-[11px] text-warn">{(fund as { warning?: string }).warning}</p>
      )}

      {/* Veredicto + valuación */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Precio" value={fmtUsd(price)} />
        <Stat label="Valor intrínseco / acc." value={fmtUsd(dcf.intrinsicPerShare)} hint="DCF Owner Earnings" />
        <Stat label="Margen de seguridad" value={fmtPct(dcf.marginOfSafety)} hint={`exigido ${fmtPct(inp.mosRequired)}`} />
        <Stat label="Owner earnings norm." value={fmtUsd(dcf.ownerEarningsNorm, 0)} hint="promedio 5 años" />
      </div>

      {/* Ratios */}
      <Card>
        <CardHeader title="Ratios" sub="Calculados por el código desde EDGAR (no por IA)." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
          <Metric l="P/E" v={fmtNum(ratios.pe, 1)} />
          <Metric l="P/E fwd" v={fmtNum(ratios.peForward, 1)} />
          <Metric l="P/B" v={fmtNum(ratios.pb, 1)} />
          <Metric l="ROIC" v={fmtPct(ratios.roic)} tone={ratios.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? 'pos' : 'warn'} />
          <Metric l="Ke (CAPM)" v={fmtPct(ratios.costOfEquity)} />
          <Metric l="WACC" v={fmtPct(ratios.wacc)} />
          <Metric l="EG5Y (real)" v={fmtPct(ratios.eg5y)} />
          <Metric l="Margen op." v={fmtPct(ratios.operatingMargin)} />
          <Metric l="Deuda/Eq." v={fmtNum(ratios.debtToEquity, 2)} />
          <Metric l="DeudaNeta/EBITDA" v={fmtNum(ratios.netDebtToEbitda, 2)} />
          <Metric l="Div yield" v={fmtPct(ratios.divYield)} />
          <Metric l="Payout" v={fmtPct(ratios.payout)} tone={ratios.payout != null && ratios.payout > 0.9 ? 'neg' : undefined} />
          <Metric l="Tasa imp. ef." v={fmtPct(ratios.effectiveTaxRate)} />
        </div>
      </Card>

      {/* Inputs DCF + nota tasa/dividendo */}
      <Card>
        <CardHeader title="Supuestos del DCF" sub="Editá los supuestos y guardalos por ticker: el Radar usará estos mismos para el score."
          right={
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={restablecer}>Restablecer</Button>
              <Button onClick={guardarSupuestos}>Guardar</Button>
            </div>
          } />
        {saveMsg && <p className="px-4 pt-3 -mb-1 text-xs text-pos">{saveMsg}</p>}
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <NumIn l="Crecimiento g" v={inp.g} step={0.01} onChange={g => setInp({ ...inp, g })} pct />
          <NumIn l="Tasa descuento d" v={inp.d} step={0.01} onChange={d => setInp({ ...inp, d })} pct />
          <NumIn l="Crec. terminal gt" v={inp.gt} step={0.005} onChange={gt => setInp({ ...inp, gt })} pct />
          <NumIn l="Años N" v={inp.N} step={1} onChange={N => setInp({ ...inp, N })} />
          <NumIn l="MoS exigido" v={inp.mosRequired} step={0.05} onChange={mosRequired => setInp({ ...inp, mosRequired })} pct />
          <div>
            <label className="text-[10px] uppercase text-ink-600">Capex mant.</label>
            <select value={inp.capexMethod} onChange={e => setInp({ ...inp, capexMethod: e.target.value as CapexMethod })}
              className="w-full bg-surface border border-line rounded-xl px-2 py-1.5 mt-1 text-ink-900 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300">
              <option value="dna">= D&A</option><option value="capex">= Capex total</option><option value="avg">promedio</option>
            </select>
          </div>
          <NumIn l="Beta" v={beta} step={0.1} onChange={setBeta} />
        </div>
        {/* Nota metodológica dividendo ↔ tasa */}
        <div className="mx-4 mb-4 rounded-xl bg-celeste-500/10 border border-celeste-500/25 px-3 py-2 text-[11px] text-ink-600 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn mt-0.5" />
          <p>
            Div yield <b className="text-ink-800">{fmtPct(ratios.divYield)}</b> · payout <b className="text-ink-800">{fmtPct(ratios.payout)}</b>.
            El dividendo YA está dentro de los owner earnings — la tasa NO se ajusta sola por el yield (sería doble conteo).
            Un dividendo alto y estable con payout sano (&lt;70%) es señal de negocio maduro: esa menor incertidumbre puede
            justificar que VOS bajes la tasa a mano. Un payout &gt;90% es alarma (dividendo en riesgo), no calidad.
          </p>
        </div>
      </Card>

      {/* Owner earnings por año (con capex de crecimiento) */}
      <Card>
        <CardHeader title="Owner Earnings por año" sub="OCF − capex de mantenimiento. El capex de crecimiento se muestra aparte." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr><th className="text-left px-4 py-2">Año</th><th className="text-right px-3">OCF</th>
                <th className="text-right px-3">Capex mant.</th><th className="text-right px-3">Capex crec.</th>
                <th className="text-right px-4">Owner Earnings</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dcf.ownerEarningsByYear.slice(-5).map(y => (
                <tr key={y.fy} className="hover:bg-canvas">
                  <td className="px-4 py-1.5 text-ink-700">{y.fy}</td>
                  <td className="text-right px-3 tnum">{fmtUsd(y.ocf, 0)}</td>
                  <td className="text-right px-3 tnum text-ink-600">{fmtUsd(y.maintenanceCapex, 0)}</td>
                  <td className="text-right px-3 tnum text-warn">{fmtUsd(y.growthCapex, 0)}</td>
                  <td className="text-right px-4 tnum font-semibold text-ink-900">{fmtUsd(y.ownerEarnings, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Sensibilidad */}
      {sens && (
        <Card>
          <CardHeader title="Sensibilidad — valor intrínseco / acción" sub="Filas = crecimiento g · Columnas = tasa de descuento d" />
          <div className="overflow-x-auto p-2">
            <table className="w-full text-xs tnum">
              <thead><tr><th className="px-2 py-1 text-left text-ink-600">g \ d</th>
                {[inp.d - 0.02, inp.d, inp.d + 0.02, inp.d + 0.04].map((d, i) => <th key={i} className="px-2 py-1 text-right text-ink-600">{fmtPct(d, 0)}</th>)}</tr></thead>
              <tbody>
                {sens.map((row, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 text-ink-600">{fmtPct(row.g, 0)}</td>
                    {row.cells.map((c, j) => {
                      const good = c != null && price != null && c > price;
                      return <td key={j} className={`px-2 py-1 text-right ${good ? 'text-pos' : 'text-ink-700'}`}>{fmtUsd(c, 0)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Chequeos Munger */}
      <Card>
        <CardHeader title="Chequeos Munger" />
        <div className="p-4 space-y-2">
          {dcf.mungerChecks.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              {c.ok ? <CheckCircle2 className="w-4 h-4 text-pos" /> : <AlertTriangle className="w-4 h-4 text-warn" />}
              <span className="text-ink-700">{c.label}</span>
              <span className="ml-auto text-[11px] text-ink-600">{c.detail}</span>
            </div>
          ))}
        </div>
      </Card>

      <GeminiAnalysis ticker={T} portfolioId={active?.id ?? null} context={{
        ratios, verdict: dcf.verdict, entityName: (fund as Fundamentals).entityName,
        // Magnitudes del DCF para que la IA fundamente con cifras reales (no solo la palabra del veredicto)
        precio: price, valorIntrinsecoPorAccion: dcf.intrinsicPerShare,
        margenDeSeguridad: dcf.marginOfSafety, ownerEarningsNorm: dcf.ownerEarningsNorm,
      }} />
    </div>
  );
}

function GeminiAnalysis({ ticker, portfolioId, context }: { ticker: string; portfolioId: string | null; context: unknown }) {
  const [txt, setTxt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await api.analisisEmpresa({ ticker, portfolio_id: portfolioId, context });
    setTxt(r.analisis ?? r.error ?? 'Sin respuesta');
    setBusy(false);
  };
  return (
    <Card>
      <CardHeader title="Análisis cualitativo (IA)" sub="Gemini interpreta los números calculados por el código. No es recomendación de inversión."
        right={<Button variant="ghost" onClick={run} disabled={busy}><Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : txt ? 'Regenerar' : 'Analizar'}</Button>} />
      {txt && (
        <div className="px-4 py-3">
          <p className="text-sm text-ink-700 whitespace-pre-wrap break-words leading-relaxed">{txt}</p>
        </div>
      )}
    </Card>
  );
}

function Metric({ l, v, tone }: { l: string; v: string; tone?: 'pos' | 'neg' | 'warn' }) {
  const c = tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : tone === 'warn' ? 'text-warn' : 'text-ink-900';
  return <div><p className="text-[10px] uppercase text-ink-600">{l}</p><p className={`font-semibold tnum ${c}`}>{v}</p></div>;
}
function NumIn({ l, v, step, onChange, pct }: { l: string; v: number; step: number; onChange: (n: number) => void; pct?: boolean }) {
  return (
    <div>
      <label className="text-[10px] uppercase text-ink-600">{l}{pct ? ' (%)' : ''}</label>
      <input type="number" step={pct ? step * 100 : step} value={pct ? +(v * 100).toFixed(2) : v}
        onChange={e => onChange(pct ? Number(e.target.value) / 100 : Number(e.target.value))}
        className="w-full bg-surface border border-line rounded-xl px-2 py-1.5 mt-1 tnum text-ink-900 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300" />
    </div>
  );
}
