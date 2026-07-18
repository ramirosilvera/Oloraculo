import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, LineChart, Radar } from 'lucide-react';
import { api } from '../lib/api';
import { useMacro, useQuotes } from '../hooks/usePosiciones';
import { useCikMap } from '../hooks/useCikMap';
import { useWatchlist, type WatchItem } from '../hooks/useWatchlist';
import { computeRatios } from '../engine/ratios';
import { computeDcf, DEFAULT_DCF_INPUTS } from '../engine/dcf';
import { computeScore, type Rating } from '../engine/score';
import { Card, CardHeader, Button, Badge, Field, Empty, inputCls, fmtUsd, fmtPct } from '../components/ui';
import type { Fundamentals } from '../types/domain';

const RATING_TONE: Record<Rating, 'pos' | 'accent' | 'warn' | 'neg'> = { A: 'pos', B: 'accent', C: 'warn', D: 'neg' };

export function RadarPage() {
  const { data: items = [], isLoading, add, remove } = useWatchlist();
  const [ticker, setTicker] = useState('');
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: macro = {} } = useMacro();
  const riskFree = ((macro as Record<string, number | null>).dgs10 ?? 4.3) / 100;

  const agregar = async () => {
    if (!ticker.trim()) { setErr('Ingresá un ticker.'); return; }
    setBusy(true); setErr(null);
    try { await add(ticker, null, nota); setTicker(''); setNota(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Radar · Watchlist</h1>

      <Card>
        <div className="p-4 flex flex-wrap gap-2 items-end text-sm">
          <Field label="Ticker">
            <input placeholder="Ticker (ej. GOOGL)" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
              className={`${inputCls} w-32`} />
          </Field>
          <Field label="Nota (opcional)" className="flex-1 min-w-[140px]">
            <input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)}
              className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Button onClick={agregar} disabled={busy}><Plus className="w-4 h-4" /> Seguir</Button>
          </div>
        </div>
        {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      </Card>

      <Card>
        <CardHeader title="Tickers en seguimiento"
          sub="Score = valuación (MoS) + calidad (ROIC−WACC, margen) + crecimiento (EG5Y) + solidez (deuda). Calculado por el código." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Ticker</th>
                <th className="text-right px-3">Precio</th>
                <th className="text-right px-3">MoS</th>
                <th className="text-right px-3">ROIC</th>
                <th className="text-right px-3">EG5Y</th>
                <th className="text-right px-3">Veredicto</th>
                <th className="text-right px-3">Score</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map(it => <RadarRow key={it.id} item={it} riskFree={riskFree} onRemove={() => remove(it.id)} />)}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={8}><Empty icon={Radar} title="Radar vacío">Agregá un ticker arriba para ver su score.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] text-ink-600">
          El score de fundamentos requiere datos de EDGAR (SEC proxy). Sin eso, se muestra solo el precio y el score queda parcial o —.
        </p>
      </Card>
    </div>
  );
}

function RadarRow({ item, riskFree, onRemove }: { item: WatchItem; riskFree: number; onRemove: () => void }) {
  const T = item.ticker.toUpperCase();
  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const cik = item.cik || cikMap.get(T)?.cik;

  const { data: fund } = useQuery({
    queryKey: ['fundamentals', T, cik ?? ''],
    enabled: !cikLoading,
    queryFn: () => api.fundamentals(T, cik),
    staleTime: 12 * 60 * 60_000,
    retry: false,
  });
  const { data: quotes = {} } = useQuotes([T]);
  const price = quotes[T] ?? null;

  const { ratios, dcf, score } = useMemo(() => {
    if (!fund || (fund as { error?: string }).error) return { ratios: null, dcf: null, score: null };
    const f = fund as Fundamentals;
    const r = computeRatios(f, price, 1.0, riskFree);
    const d = computeDcf(f, price, r.wacc, DEFAULT_DCF_INPUTS, r.roic);
    const s = computeScore({
      marginOfSafety: d.marginOfSafety, roic: r.roic, wacc: r.wacc,
      operatingMargin: r.operatingMargin, debtToEquity: r.debtToEquity, eg5y: r.eg5y,
    });
    return { ratios: r, dcf: d, score: s };
  }, [fund, price, riskFree]);

  const verdictTone = dcf?.verdict === 'COMPRAR' ? 'pos' : dcf?.verdict === 'CARO' ? 'neg' : 'warn';

  return (
    <tr className="hover:bg-canvas">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink-900">{T}</span>
          {item.nota && <span className="text-[10px] text-ink-600 truncate max-w-[160px]">{item.nota}</span>}
        </div>
      </td>
      <td className="text-right px-3 tnum">{fmtUsd(price)}</td>
      <td className="text-right px-3 tnum">{dcf ? fmtPct(dcf.marginOfSafety) : '—'}</td>
      <td className={`text-right px-3 tnum ${ratios?.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? 'text-pos' : ''}`}>{ratios ? fmtPct(ratios.roic) : '—'}</td>
      <td className="text-right px-3 tnum">{ratios ? fmtPct(ratios.eg5y) : '—'}</td>
      <td className="text-right px-3">{dcf ? <Badge tone={verdictTone as 'pos' | 'neg' | 'warn'}>{dcf.verdict}</Badge> : <span className="text-ink-600">—</span>}</td>
      <td className="text-right px-3">
        {score?.score != null
          ? <span className="inline-flex items-center gap-1.5"><span className="tnum font-bold text-ink-900">{score.score}</span><Badge tone={RATING_TONE[score.rating!]}>{score.rating}</Badge></span>
          : <span className="text-ink-600">—</span>}
      </td>
      <td className="px-2 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <Link to={`/analisis/${T}`} className="text-ink-600 hover:text-accent inline-flex items-center justify-center w-9 h-9" title="Análisis / DCF"><LineChart className="w-4 h-4" /></Link>
          <button onClick={() => { if (window.confirm(`¿Sacar ${T} del radar?`)) onRemove(); }} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9" title="Quitar"><Trash2 className="w-4 h-4" /></button>
        </div>
      </td>
    </tr>
  );
}
