import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart2, Play, TrendingUp, AlertCircle } from 'lucide-react';
import { loadEvaluations } from '../services/supabase-client';
import { SectionTitle, Card, CardHeader, Button, Skeleton } from '../components/ui';

const THRESHOLDS = [0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12, 0.15];

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function pick(hw: number, dr: number, aw: number, t: number): 'Home' | 'Draw' | 'Away' {
  if (Math.max(hw, aw) - dr < t) return 'Draw';
  return hw >= aw ? 'Home' : 'Away';
}

interface ThresholdRow {
  t: number;
  global: number;
  homeAcc: number;
  drawAcc: number;
  awayAcc: number;
  drawPredPct: number;
  drawF1: number;
}

interface ModelRow {
  name: string;
  n: number;
  global: number;
  drawHit: number;
  drawActual: number;
  drawF1: number;
}

export function CalibrationPage() {
  const { data: evals, isLoading } = useQuery({ queryKey: ['evaluations'], queryFn: loadEvaluations });
  const [bestMetric, setBestMetric] = useState<'f1' | 'global'>('f1');

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Cargando evaluaciones…">Calibración</SectionTitle>
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      </div>
    );
  }

  if (!evals || evals.length === 0) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Sin datos">Calibración</SectionTitle>
        <Card className="p-10 text-center">
          <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Sin evaluaciones. Registrá resultados y presioná "Recalcular" en Rendimiento primero.</p>
        </Card>
      </div>
    );
  }

  // Outcome distribution
  const dist = { Home: 0, Draw: 0, Away: 0 };
  for (const e of evals) dist[e.actual as 'Home' | 'Draw' | 'Away']++;
  const total = evals.length;

  // Grid search
  const gridRows: ThresholdRow[] = THRESHOLDS.map(t => {
    const byActual = { Home: { c: 0, n: 0 }, Draw: { c: 0, n: 0 }, Away: { c: 0, n: 0 } };
    let drawPred = 0, drawHit = 0;
    for (const e of evals) {
      const p = pick(e.home_win, e.draw, e.away_win, t);
      const actual = e.actual as 'Home' | 'Draw' | 'Away';
      byActual[actual].n++;
      if (p === actual) byActual[actual].c++;
      if (p === 'Draw') drawPred++;
      if (p === 'Draw' && actual === 'Draw') drawHit++;
    }
    const correct = byActual.Home.c + byActual.Draw.c + byActual.Away.c;
    const prec = drawPred > 0 ? drawHit / drawPred : 0;
    const rec  = byActual.Draw.n > 0 ? drawHit / byActual.Draw.n : 0;
    const f1   = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0;
    return {
      t,
      global: correct / total,
      homeAcc: byActual.Home.c / Math.max(1, byActual.Home.n),
      drawAcc: byActual.Draw.c / Math.max(1, byActual.Draw.n),
      awayAcc: byActual.Away.c / Math.max(1, byActual.Away.n),
      drawPredPct: drawPred / total,
      drawF1: f1,
    };
  });

  const bestRow = [...gridRows].sort((a, b) =>
    bestMetric === 'f1' ? b.drawF1 - a.drawF1 : b.global - a.global
  )[0];

  // Per-model at threshold=0.04 (current) and best
  const models = [...new Set(evals.map(e => e.model_name))];
  const CURRENT_T = 0.03;

  const modelRows: ModelRow[] = models.map(name => {
    const rows = evals.filter(e => e.model_name === name);
    const drawActual = rows.filter(r => r.actual === 'Draw').length;
    let correct = 0, drawPred = 0, drawHit = 0;
    for (const e of rows) {
      const p = pick(e.home_win, e.draw, e.away_win, CURRENT_T);
      if (p === e.actual) correct++;
      if (p === 'Draw') drawPred++;
      if (p === 'Draw' && e.actual === 'Draw') drawHit++;
    }
    const prec = drawPred > 0 ? drawHit / drawPred : 0;
    const rec  = drawActual > 0 ? drawHit / drawActual : 0;
    return {
      name,
      n: rows.length,
      global: correct / rows.length,
      drawHit,
      drawActual,
      drawF1: prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0,
    };
  }).sort((a, b) => b.global - a.global);

  const currentRow = gridRows.find(r => r.t === CURRENT_T)!;

  return (
    <div className="space-y-6">
      <SectionTitle sub={`${total} evaluaciones · ${dist.Home} local / ${dist.Draw} empate / ${dist.Away} visitante`}>
        Calibración de Umbral
      </SectionTitle>

      {/* Distribution */}
      <div className="grid grid-cols-3 gap-3">
        {(['Home', 'Draw', 'Away'] as const).map(outcome => {
          const labels = { Home: 'Local', Draw: 'Empate', Away: 'Visitante' };
          const colors = { Home: 'text-blue-700 bg-blue-50 border-blue-100', Draw: 'text-gray-700 bg-gray-50 border-gray-100', Away: 'text-red-700 bg-red-50 border-red-100' };
          return (
            <div key={outcome} className={`border rounded-2xl p-3 text-center ${colors[outcome]}`}>
              <p className="text-xl font-black tabular-nums">{pct(dist[outcome] / total)}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide opacity-60">{labels[outcome]}</p>
              <p className="text-xs tabular-nums opacity-50">{dist[outcome]}/{total}</p>
            </div>
          );
        })}
      </div>

      {/* Metric toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setBestMetric('f1')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${bestMetric === 'f1' ? 'bg-wc-navy text-white' : 'bg-gray-100 text-gray-500'}`}
        >
          Optimizar Draw F1
        </button>
        <button
          onClick={() => setBestMetric('global')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${bestMetric === 'global' ? 'bg-wc-navy text-white' : 'bg-gray-100 text-gray-500'}`}
        >
          Optimizar Global%
        </button>
      </div>

      {/* Grid search table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-wc-navy" />
            <span className="font-semibold text-wc-navy text-sm">Grid Search · Umbral de Empate</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Umbral actual en código: <strong>0.03</strong> · Mejor por {bestMetric === 'f1' ? 'Draw F1' : 'Global%'}:{' '}
            <strong className="text-wc-gold">{bestRow.t}</strong>
          </p>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Umbral</th>
                <th className="text-center px-3 py-2.5 font-semibold">Global%</th>
                <th className="text-center px-3 py-2.5 font-semibold">Local%</th>
                <th className="text-center px-3 py-2.5 font-semibold">Empate%</th>
                <th className="text-center px-3 py-2.5 font-semibold">Visit%</th>
                <th className="text-center px-3 py-2.5 font-semibold">%Pred.Emp</th>
                <th className="text-center px-3 py-2.5 font-semibold">Draw F1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gridRows.map(row => {
                const isBest = row.t === bestRow.t;
                const isCurrent = row.t === CURRENT_T;
                return (
                  <tr key={row.t} className={isBest ? 'bg-amber-50' : isCurrent ? 'bg-blue-50/40' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-2 font-mono font-bold text-gray-700">
                      {row.t.toFixed(2)}
                      {isBest && <span className="ml-1.5 text-[9px] font-bold text-amber-600 bg-amber-100 px-1 py-px rounded">MEJOR</span>}
                      {isCurrent && !isBest && <span className="ml-1.5 text-[9px] font-bold text-blue-600 bg-blue-100 px-1 py-px rounded">ACTUAL</span>}
                    </td>
                    <td className="px-3 py-2 text-center font-semibold tabular-nums">{pct(row.global)}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-blue-700">{pct(row.homeAcc)}</td>
                    <td className={`px-3 py-2 text-center tabular-nums font-bold ${row.drawAcc > 0.3 ? 'text-green-700' : row.drawAcc > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {pct(row.drawAcc)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-red-700">{pct(row.awayAcc)}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-gray-500">{pct(row.drawPredPct)}</td>
                    <td className="px-3 py-2 text-center tabular-nums font-bold text-wc-navy">{row.drawF1.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Per-model at current threshold */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-wc-navy" />
            <span className="font-semibold text-wc-navy text-sm">Por modelo · umbral actual (0.03)</span>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Modelo</th>
                <th className="text-center px-3 py-2.5 font-semibold">N</th>
                <th className="text-center px-3 py-2.5 font-semibold">Global%</th>
                <th className="text-center px-3 py-2.5 font-semibold">Emp. acertados</th>
                <th className="text-center px-3 py-2.5 font-semibold">Draw F1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {modelRows.map((row, i) => (
                <tr key={row.name} className={i === 0 ? 'bg-amber-50/60' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-2 font-medium text-gray-800">
                    {i === 0 && <span className="mr-1 text-amber-500">★</span>}
                    {row.name}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-500 tabular-nums">{row.n}</td>
                  <td className="px-3 py-2 text-center font-bold tabular-nums text-gray-800">{pct(row.global)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    <span className={row.drawHit > 0 ? 'text-green-700 font-bold' : 'text-gray-400'}>
                      {row.drawHit}/{row.drawActual}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums font-bold text-wc-navy">
                    {row.drawF1 > 0 ? row.drawF1.toFixed(3) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-gray-400 text-center">
        Draw F1 = media armónica entre precisión y recall de empates · actualizado en tiempo real desde Supabase
      </p>
    </div>
  );
}
