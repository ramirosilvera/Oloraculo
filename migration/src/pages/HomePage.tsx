// =============================================================================
// HomePage — Marketing + Dashboard — FIFA World Cup 2026
// =============================================================================

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Target, Cpu, Users, Database, ChevronRight } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import {
  Card,
  CardHeader,
  StatCard,
  Badge,
  SectionTitle,
  Button,
  SkeletonCard,
  FlagImg,
} from '../components/ui';

// ---------------------------------------------------------------------------
// Escalera de predicción
// ---------------------------------------------------------------------------
const ladder: { level: string; model: string; signal: string; color: 'gray' | 'blue' | 'green' | 'gold' | 'red' | 'navy' }[] = [
  { level: 'L0',    model: 'Base',           signal: 'probabilidad uniforme',      color: 'gray'  },
  { level: 'L1',    model: 'Ranking FIFA',   signal: 'puntos externos',            color: 'blue'  },
  { level: 'L2',    model: 'Elo',            signal: 'fortaleza de largo plazo',   color: 'blue'  },
  { level: 'L3',    model: 'Forma reciente', signal: 'resultados de corto plazo',  color: 'green' },
  { level: 'L4',    model: 'Goles (Poisson)',signal: 'marcadores Dixon-Coles',     color: 'gold'  },
  { level: 'L5',    model: 'Contexto',       signal: 'ajuste con disponibilidad',  color: 'red'   },
  { level: 'Final', model: 'Oráculo',        signal: 'escalón usable más alto',    color: 'navy'  },
];

// ---------------------------------------------------------------------------
// HomePage
// ---------------------------------------------------------------------------

export function HomePage() {
  const { teams, fixtures, results, teamMap, isLoading } = useAppData();
  const [logoLoaded, setLogoLoaded] = useState(false);

  return (
    <div className="space-y-10 animate-fade-in">

      {/* ------------------------------------------------------------------ */}
      {/* 1. HERO BANNER                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-wc-gradient rounded-2xl py-12 sm:py-20 px-6 text-white text-center space-y-5">
        <div className="flex justify-center">
          <Badge color="gold">
            <Trophy className="w-3 h-3 mr-1 inline-block" />
            FIFA World Cup 2026 · USA · CAN · MEX
          </Badge>
        </div>

        <div className="flex justify-center">
          <div className="relative h-28 sm:h-40 w-28 sm:w-40">
            {!logoLoaded && (
              <div className="absolute inset-0 rounded-full animate-pulse bg-white/10" />
            )}
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/1/17/2026_FIFA_World_Cup_emblem.svg"
              alt="FIFA World Cup 2026"
              className={`h-28 sm:h-40 object-contain drop-shadow-xl transition-opacity duration-500 ${logoLoaded ? 'opacity-100' : 'opacity-0'}`}
              loading="eager"
              onLoad={() => setLogoLoaded(true)}
              onError={() => setLogoLoaded(true)}
            />
          </div>
        </div>

        <h1 className="font-black text-4xl sm:text-6xl tracking-tight leading-none">
          Oloráculo
        </h1>

        <p className="text-white/80 text-base sm:text-xl max-w-xl mx-auto leading-relaxed">
          Predicciones estadísticas con Machine Learning para el Mundial 2026
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link to="/matches">
            <Button
              variant="secondary"
              size="lg"
              className="bg-white text-wc-navy hover:bg-wc-cream font-black w-full sm:w-auto"
            >
              Predecir partido →
            </Button>
          </Link>
          <Link to="/tournament">
            <Button
              variant="ghost"
              size="lg"
              className="text-white border border-white/30 hover:bg-white/10 w-full sm:w-auto"
            >
              Ver simulación
            </Button>
          </Link>
        </div>

        <div className="pt-5 border-t border-white/20 space-y-1 text-center">
          <p className="text-white/40 text-[10px] uppercase tracking-widest font-semibold">Creadores</p>
          <p className="text-white text-sm font-bold">
            Mariano Villa
            <span className="font-normal text-white/60"> · idea y motor estadístico · </span>
            <a
              href="https://github.com/marianovilla/oloraculo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-wc-gold underline underline-offset-2 hover:text-white transition-colors"
            >
              marianovilla/oloraculo
            </a>
          </p>
          <p className="text-white text-sm font-bold">
            Ramiro Silvera
            <span className="font-normal text-white/60"> · app web</span>
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. STATS ROW                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              <StatCard
                label="Equipos"
                value={teams.length}
                icon={<Users className="w-5 h-5" />}
              />
              <StatCard
                label="Partidos"
                value={fixtures.length}
                icon={<Target className="w-5 h-5" />}
              />
              <StatCard
                label="Resultados históricos"
                value={results.length.toLocaleString('es')}
                icon={<Database className="w-5 h-5" />}
              />
              <StatCard
                label="Simulaciones"
                value="10.000"
                icon={<Cpu className="w-5 h-5" />}
              />
            </>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. CÓMO FUNCIONA — Escalera de predicción                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="animate-fade-in">
        <Card>
          <CardHeader>
            <SectionTitle sub="Cada partido se predice con el mejor modelo disponible, de menor a mayor fidelidad.">
              Escalera de predicción
            </SectionTitle>
          </CardHeader>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Nivel</th>
                  <th className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Modelo</th>
                  <th className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Señal</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((row) => (
                  <tr
                    key={row.level}
                    className={`border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50 ${
                      row.level === 'Final' ? 'bg-wc-navy/5' : ''
                    }`}
                  >
                    <td className="px-5 py-3">
                      <Badge color={row.color}>{row.level}</Badge>
                    </td>
                    <td className="px-3 py-3 font-semibold text-gray-800">{row.model}</td>
                    <td className="px-3 py-3 text-gray-500 hidden sm:table-cell">{row.signal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 4. PRÓXIMOS PARTIDOS                                                */}
      {/* ------------------------------------------------------------------ */}
      {!isLoading && (() => {
        const now = new Date().toISOString();
        const upcoming = fixtures
          .filter(f => f.kickoff_utc && f.kickoff_utc > now)
          .sort((a, b) => (a.kickoff_utc ?? '').localeCompare(b.kickoff_utc ?? ''))
          .slice(0, 5);
        if (upcoming.length === 0) return null;
        return (
          <section className="animate-fade-in">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <SectionTitle>Próximos partidos</SectionTitle>
                  <Link to="/matches" className="text-xs font-semibold text-wc-navy hover:underline active:opacity-70 transition-opacity py-2 px-1">
                    Ver todos →
                  </Link>
                </div>
              </CardHeader>
              <div className="divide-y divide-gray-50">
                {upcoming.map(f => {
                  const homeName = teamMap.get(f.home_team_id)?.name ?? f.home_team_id;
                  const awayName = teamMap.get(f.away_team_id)?.name ?? f.away_team_id;
                  const kickoffDate = f.kickoff_utc ? new Date(f.kickoff_utc).toLocaleDateString('es-AR', {
                    weekday: 'short', day: 'numeric', month: 'short',
                    timeZone: 'America/Argentina/Buenos_Aires',
                  }) : '';
                  const kickoffTime = f.kickoff_utc ? new Date(f.kickoff_utc).toLocaleTimeString('es-AR', {
                    hour: '2-digit', minute: '2-digit',
                    timeZone: 'America/Argentina/Buenos_Aires',
                  }) : '';
                  return (
                    <Link key={f.id} to="/matches" className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 active:bg-gray-100 transition-colors">
                      <FlagImg id={f.home_team_id} className="w-7 h-5 object-cover rounded-[3px] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{homeName} <span className="text-gray-400 font-normal">vs</span> {awayName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{kickoffDate} · {kickoffTime} ART · Grp {f.group_name}</p>
                      </div>
                      <FlagImg id={f.away_team_id} className="w-7 h-5 object-cover rounded-[3px] shrink-0" />
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </Card>
          </section>
        );
      })()}

    </div>
  );
}
