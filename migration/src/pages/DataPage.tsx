import { Database, Users, Calendar, Star, History } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import {
  Card,
  CardHeader,
  StatCard,
  Badge,
  SectionTitle,
  SkeletonCard,
} from '../components/ui';

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

function flag(teamId: string) {
  return FLAGS[teamId.toLowerCase()] ?? '🏳️';
}

export function DataPage() {
  const { teams, fixtures, results, ratings, groups, teamMap, isLoading } = useAppData();

  const eloRatings  = ratings.filter(r => r.type === 'elo');
  const fifaRatings = ratings.filter(r => r.type === 'fifa');
  const latestElo   = eloRatings[0]?.as_of  ?? null;
  const latestFifa  = fifaRatings[0]?.as_of ?? null;

  const topElo  = [...eloRatings].sort((a, b) => b.value - a.value).slice(0, 20);
  const topFifa = [...fifaRatings].sort((a, b) => b.value - a.value).slice(0, 20);

  const years = results.map(r => new Date(r.date).getFullYear()).filter(Boolean);
  const minYear = years.length ? Math.min(...years) : null;
  const maxYear = years.length ? Math.max(...years) : null;

  const tournamentCounts = new Map<string, number>();
  for (const r of results) {
    tournamentCounts.set(r.tournament, (tournamentCounts.get(r.tournament) ?? 0) + 1);
  }
  const topTournaments = [...tournamentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SectionTitle sub="Cargando datos del sistema…">Datos del Sistema</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle sub="Los datos estáticos se sirven desde archivos JSON del repositorio. Solo predicciones y evaluaciones van a Supabase.">
        Datos del Sistema
      </SectionTitle>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Equipos cargados"
          value={teams.length}
          icon={<Users className="w-5 h-5" />}
        />
        <StatCard
          label="Fixtures WC2026"
          value={fixtures.length}
          icon={<Calendar className="w-5 h-5" />}
        />
        <StatCard
          label="Ratings cargados"
          value={ratings.length}
          icon={<Star className="w-5 h-5" />}
        />
        <StatCard
          label="Resultados históricos"
          value={results.length.toLocaleString('es')}
          icon={<History className="w-5 h-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-wc-navy" />
            <p className="font-semibold text-wc-navy">Equipos por grupo</p>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 font-semibold w-20">Grupo</th>
                <th className="text-left px-4 py-3 font-semibold">Equipos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map(group => (
                <tr key={group.name} className="hover:bg-wc-cream/30 transition-colors">
                  <td className="px-5 py-3">
                    <Badge color="navy">Grupo {group.name}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {group.team_ids.map(id => {
                        const name = teamMap.get(id)?.name ?? id;
                        return (
                          <span key={id} className="inline-flex items-center gap-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 font-medium text-gray-700">
                            <span>{flag(id)}</span>
                            <span>{name}</span>
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-wc-navy" />
            <p className="font-semibold text-wc-navy">Ratings — Top 20</p>
            <div className="ml-auto flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 text-right">
              {latestElo && <span>Elo: {new Date(latestElo).toLocaleDateString('es')}</span>}
              {latestFifa && <span>FIFA: {new Date(latestFifa).toLocaleDateString('es')}</span>}
            </div>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 font-semibold w-10">#</th>
                <th className="text-left px-4 py-3 font-semibold">Equipo</th>
                <th className="text-right px-4 py-3 font-semibold">Elo</th>
                <th className="text-right px-5 py-3 font-semibold">FIFA pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topElo.map((elo, i) => {
                const name = teamMap.get(elo.team_id)?.name ?? elo.team_id;
                const fifa = fifaRatings.find(f => f.team_id === elo.team_id);
                return (
                  <tr key={elo.team_id} className="hover:bg-wc-cream/30 transition-colors">
                    <td className="px-5 py-2.5 text-gray-400 font-semibold tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      <span className="mr-1.5">{flag(elo.team_id)}</span>{name}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-wc-navy">{Math.round(elo.value)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">{fifa ? Math.round(fifa.value) : '—'}</td>
                  </tr>
                );
              })}
              {topFifa.filter(f => !topElo.find(e => e.team_id === f.team_id)).map((fifa, i) => {
                const name = teamMap.get(fifa.team_id)?.name ?? fifa.team_id;
                return (
                  <tr key={`fifa-only-${fifa.team_id}`} className="hover:bg-wc-cream/30 transition-colors">
                    <td className="px-5 py-2.5 text-gray-400 font-semibold tabular-nums">{topElo.length + i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      <span className="mr-1.5">{flag(fifa.team_id)}</span>{name}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">—</td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-wc-navy">{Math.round(fifa.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-wc-navy" />
            <p className="font-semibold text-wc-navy">Resultados históricos</p>
          </div>
        </CardHeader>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Total partidos</p>
              <p className="text-2xl font-black text-wc-navy mt-1">{results.length.toLocaleString('es')}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Rango de años</p>
              <p className="text-2xl font-black text-wc-navy mt-1">
                {minYear && maxYear ? `${minYear} – ${maxYear}` : '—'}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 col-span-2 sm:col-span-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Torneos distintos</p>
              <p className="text-2xl font-black text-wc-navy mt-1">{tournamentCounts.size}</p>
            </div>
          </div>
          {topTournaments.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Torneos más frecuentes</p>
              <div className="space-y-1.5">
                {topTournaments.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium truncate">{name}</span>
                    <Badge color="gray">{count.toLocaleString('es')} partidos</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="rounded-2xl p-5 text-sm text-wc-navy border border-wc-navy/15 bg-wc-navy/5">
        <p className="font-semibold mb-1">Arquitectura</p>
        <p className="text-gray-600 leading-relaxed">
          Los datos estáticos (equipos, grupos, fixtures, historial, ratings) se sirven como archivos JSON
          desde GitHub Pages — sin base de datos. Solo las predicciones guardadas, evaluaciones y contextos
          de partidos van a Supabase. El motor de predicción y la simulación Monte Carlo corren 100% en el browser.
        </p>
      </div>
    </div>
  );
}
