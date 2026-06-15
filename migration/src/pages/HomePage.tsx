// =============================================================================
// HomePage — Marketing + Dashboard — FIFA World Cup 2026
// =============================================================================

import { Link } from 'react-router-dom';
import { Trophy, Target, Cpu, Users, Database, Github } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import {
  Card,
  CardHeader,
  StatCard,
  Badge,
  SectionTitle,
  Button,
  Skeleton,
  SkeletonCard,
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
  const { teams, fixtures, results, isLoading } = useAppData();

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
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/1/17/2026_FIFA_World_Cup_emblem.svg"
            alt="FIFA World Cup 2026"
            className="h-28 sm:h-40 object-contain drop-shadow-xl"
            loading="eager"
          />
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
                  <th className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Señal</th>
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
                    <td className="px-3 py-3 text-gray-500">{row.signal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 4. CALL TO ACTION                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="animate-fade-in">
        <Card className="bg-wc-navy text-white border-0 px-8 py-10 text-center space-y-4">
          <p className="text-xs font-semibold tracking-widest text-white/50 uppercase">
            Monte Carlo · Dixon-Coles
          </p>
          <h2 className="text-3xl sm:text-4xl font-black leading-tight">
            ¿Quién va a ganar el Mundial?
          </h2>
          <p className="text-white/70 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
            Corremos 10.000 simulaciones del bracket completo. Monte Carlo. Dixon-Coles. Sin humo.
          </p>
          <div className="pt-2">
            <Link to="/tournament">
              <button className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-wc-gold text-wc-navy font-black text-base rounded-xl hover:brightness-110 transition-all shadow-lg">
                Simular torneo completo →
              </button>
            </Link>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. CREADORES                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="animate-fade-in">
        <Card>
          <CardHeader>
            <SectionTitle sub="Mariano Villa tuvo la idea y construyó el motor estadístico. Ramiro Silvera lo convirtió en aplicación web.">
              Creadores
            </SectionTitle>
          </CardHeader>

          <div className="px-5 py-6 space-y-4">
            <div className="flex items-start gap-4 pb-4 border-b border-gray-100">
              <div className="w-12 h-12 rounded-xl bg-wc-navy/10 flex items-center justify-center shrink-0">
                <span className="text-wc-navy font-black text-base">RS</span>
              </div>
              <div className="flex-1">
                <p className="font-black text-gray-800">Ramiro Silvera</p>
                <p className="text-sm text-gray-500 mt-0.5">Desarrollo de la aplicación web</p>

              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-wc-gold/15 flex items-center justify-center shrink-0">
                <span className="text-wc-gold font-black text-base">MV</span>
              </div>
              <div className="flex-1">
                <p className="font-black text-gray-800">Mariano Villa</p>
                <p className="text-sm text-gray-500 mt-0.5">Idea original y motor estadístico de predicciones</p>
                <a
                  href="https://github.com/marianovilla/oloraculo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-wc-navy hover:text-wc-gold transition-colors"
                >
                  <Github className="w-3.5 h-3.5" />
                  marianovilla/oloraculo
                </a>
              </div>
            </div>
          </div>

          <div className="px-5 py-4 bg-wc-cream/60 rounded-b-2xl border-t border-gray-100">
            <p className="text-sm text-gray-600 leading-relaxed">
              Gracias a Mariano Villa por la idea y el trabajo estadístico que le dan vida a Oloráculo. ⚽
            </p>
          </div>
        </Card>
      </section>

    </div>
  );
}
