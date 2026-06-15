import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData';
import { saveTournamentSnapshot } from '../services/supabase-client';
import type { TournamentProjection } from '../types/domain';
import type { SimulationInput } from '../engine/simulation-engine';
import { Button, Badge, Card, CardHeader, Skeleton, Tooltip } from '../components/ui';
import { Trophy, Play, Save, CheckCircle2, History, ChevronRight, Medal } from 'lucide-react';

const FLAGS: Record<string, string> = {
  'argentina': '🇦🇷', 'brazil': '🇧🇷', 'france': '🇫🇷', 'england': '🇬🇧',
  'spain': '🇪🇸', 'germany': '🇩🇪', 'portugal': '🇵🇹', 'netherlands': '🇳🇱',
  'belgium': '🇧🇪', 'colombia': '🇨🇴', 'uruguay': '🇺🇾', 'mexico': '🇲🇽',
  'united-states': '🇺🇸', 'canada': '🇨🇦', 'japan': '🇯🇵', 'south-korea': '🇰🇷',
  'morocco': '🇲🇦', 'senegal': '🇸🇳', 'ecuador': '🇪🇨', 'australia': '🇦🇺',
  'croatia': '🇭🇷', 'switzerland': '🇨🇭', 'norway': '🇳🇴', 'sweden': '🇸🇪',
  'austria': '🇦🇹', 'turkey': '🇹🇷', 'iran': '🇮🇷', 'egypt': '🇪🇬',
  'saudi-arabia': '🇸🇦', 'south-africa': '🇿🇦', 'ghana': '🇬🇭', 'tunisia': '🇹🇳',
  'algeria': '🇩🇿', 'ivory-coast': '🇨🇮', 'nigeria': '🇳🇬', 'cameroon': '🇨🇲',
  'scotland': '🏴󠁧󠁢󠁳󠁣󠁵󠁳󠁿', 'czechia': '🇨🇿', 'poland': '🇵🇱', 'serbia': '🇷🇸',
  'paraguay': '🇵🇾', 'haiti': '🇭🇹', 'panama': '🇵🇦', 'curacao': '🇨🇼',
  'jordan': '🇯🇴', 'iraq': '🇮🇶', 'new-zealand': '🇳🇿', 'cape-verde': '🇨🇻',
  'uzbekistan': '🇺🇿', 'congo-dr': '🇨🇩', 'bosnia-and-herzegovina': '🇧🇦',
  'qatar': '🇶🇦',
};

const SIMULATION_COUNT = 10_000;
const SIMULATION_SEED  = 2026;

function pct1(n: number) { return `${(n * 100).toFixed(1)}%`; }
function pct0(n: number) { return `${(n * 100).toFixed(0)}%`;  }

interface ProbTableProps {
  teams: TournamentProjection['teams'];
  getTeamName: (id: string) => string;
}

function ProbTable({ teams, getTeamName }: ProbTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-wc-navy text-white text-xs">
            <th className="text-left px-3 py-3 font-semibold w-8">#</th>
            <th className="text-left px-3 py-3 font-semibold">Equipo</th>
            <th className="text-left px-3 py-3 font-semibold">Grp</th>
            <th className="text-right px-3 py-3 font-semibold">Clasifica</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">16avos</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">Cuartos</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">Semis</th>
            <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">Final</th>
            <th className="text-right px-3 py-3 font-semibold bg-wc-navy pr-4">
              <span className="text-wc-gold font-black">Campeón</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {teams.slice(0, 32).map((t, i) => {
            const isTop8 = i < 8;
            return (
              <tr
                key={t.teamId}
                className={`transition-colors hover:bg-amber-50/60 ${isTop8 ? 'bg-amber-50/30' : 'bg-white'}`}
              >
                <td className="px-3 py-2.5 text-gray-400 text-xs font-medium">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2 font-semibold text-gray-800">
                    <span className="text-base leading-none">{FLAGS[t.teamId] ?? '🏳️'}</span>
                    <span>{getTeamName(t.teamId)}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-gray-500 text-xs font-medium">{t.group}</td>
                <td className="px-3 py-2.5 text-right text-gray-600">{pct0(t.qualify)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachRoundOf16)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachQuarterFinal)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachSemiFinal)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{pct0(t.reachFinal)}</td>
                <td className="px-3 py-2.5 text-right pr-4 bg-wc-navy/5">
                  <span className="font-black text-wc-gold text-base">{pct1(t.winTournament)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TournamentPage() {
  const { groups, fixtures, results, ratings, teamMap, isLoading } = useAppData();
  const [projection, setProjection] = useState<TournamentProjection | null>(null);
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  const getTeamName = (id: string) => teamMap.get(id)?.name ?? id;

  const runSimulation = useCallback(async () => {
    if (busy || groups.length === 0) return;
    setBusy(true);
    setError('');
    setSaved(false);
    setProgress(0);

    const ticker = setInterval(() => {
      setProgress(p => (p >= 90 ? 90 : p + Math.random() * 8));
    }, 300);

    try {
      const input: SimulationInput = {
        groups,
        fixtures,
        allResults: results,
        ratings,
        simulations: SIMULATION_COUNT,
        seed: SIMULATION_SEED,
      };

      const worker = new Worker(
        new URL('../workers/simulation.worker.ts', import.meta.url),
        { type: 'module' },
      );

      const result = await new Promise<TournamentProjection>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: TournamentProjection; error?: string }>) => {
          worker.terminate();
          if (e.data.ok && e.data.result) resolve(e.data.result);
          else reject(new Error(e.data.error ?? 'Simulation failed'));
        };
        worker.onerror = reject;
        worker.postMessage(input);
      });

      clearInterval(ticker);
      setProgress(100);
      setProjection(result);
    } catch (e) {
      setError(String(e));
    } finally {
      clearInterval(ticker);
      setBusy(false);
    }
  }, [groups, fixtures, results, ratings, busy]);

  const saveSnapshot = async () => {
    if (!projection) return;
    setSaving(true);
    try {
      await saveTournamentSnapshot(projection, {
        modelName: projection.modelName,
        inputSummaryHash: projection.inputSummaryHash,
      });
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-wc-gradient rounded-2xl px-6 py-8 sm:px-10 sm:py-10 text-white shadow-lg">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Trophy className="w-6 h-6 text-wc-gold" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black leading-tight">
              Simulación del Torneo
            </h1>
            <p className="text-white/60 text-sm mt-1">
              10.000 iteraciones Monte Carlo · bracket oficial WC2026
            </p>
          </div>
        </div>

        {!busy ? (
          <button
            onClick={runSimulation}
            disabled={groups.length === 0}
            className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-white text-wc-navy font-black rounded-xl shadow hover:shadow-lg hover:bg-wc-cream transition-all text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-5 h-5 fill-wc-navy" />
            Correr simulación
          </button>
        ) : (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-white/20 text-white font-black rounded-xl text-base cursor-wait">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Simulando 10.000 partidos…
            </div>
            <div className="w-full max-w-sm">
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-wc-gold rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-white/50 text-xs mt-1.5">{Math.round(progress)}% completado</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {projection && (
        <>
          <Card>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Medal className="w-4 h-4 text-wc-gold" />
                <span className="text-sm font-semibold text-gray-700">
                  {projection.simulations.toLocaleString('es')} simulaciones completadas
                </span>
              </div>

              <div className="ml-auto flex items-center gap-3">
                {saved ? (
                  <>
                    <Badge color="green">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Guardada
                    </Badge>
                    <Link
                      to="/tournament/snapshots"
                      className="inline-flex items-center gap-1 text-sm text-wc-navy font-semibold hover:underline"
                    >
                      Ver historial
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </>
                ) : (
                  <Tooltip text="Guardá para comparar cómo cambian las probabilidades a medida que avanza el torneo">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={saveSnapshot}
                      loading={saving}
                      disabled={saving}
                    >
                      <Save className="w-3.5 h-3.5" />
                      Guardar esta simulación como referencia
                    </Button>
                  </Tooltip>
                )}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-wc-gold" />
                <h2 className="font-black text-wc-navy text-base">Probabilidades del torneo</h2>
                <span className="ml-auto">
                  <Badge color="gold">Top 8 resaltados</Badge>
                </span>
              </div>
            </CardHeader>
            <ProbTable teams={projection.teams} getTeamName={getTeamName} />
          </Card>
        </>
      )}

      {!projection && !busy && (
        <Card className="p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-wc-navy/5 flex items-center justify-center">
            <Trophy className="w-8 h-8 text-wc-navy/30" />
          </div>
          <p className="text-gray-500 text-sm max-w-xs mx-auto">
            Presioná "Correr simulación" para ver las probabilidades de cada selección de ganar el Mundial 2026.
          </p>
        </Card>
      )}

      <div className="flex justify-end">
        <Link
          to="/tournament/snapshots"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-wc-navy transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          Ver historial de simulaciones
        </Link>
      </div>
    </div>
  );
}
