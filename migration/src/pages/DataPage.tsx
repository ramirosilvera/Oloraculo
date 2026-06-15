// =============================================================================
// DataPage — Data status and refresh information
// =============================================================================

import { useAppData } from '../hooks/useAppData';

export function DataPage() {
  const { teams, fixtures, results, ratings, isLoading } = useAppData();

  const eloRatings  = ratings.filter(r => r.type === 'elo');
  const fifaRatings = ratings.filter(r => r.type === 'fifa');
  const latestElo   = eloRatings[0]?.as_of  ?? null;
  const latestFifa  = fifaRatings[0]?.as_of ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Estado de los datos</h1>
        <p className="text-gray-500 mt-1">Los datos estáticos se cargan desde archivos JSON del repositorio.</p>
      </div>

      {/* Current data status */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Datos cargados en esta sesión</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {[
            { label: 'Equipos', value: isLoading ? '…' : teams.length, file: 'public/data/teams.json', badge: 'estático' },
            { label: 'Partidos WC2026', value: isLoading ? '…' : fixtures.length, file: 'public/data/fixtures.json', badge: 'estático' },
            { label: 'Resultados históricos', value: isLoading ? '…' : results.length.toLocaleString('es'), file: 'public/data/historical_results.json', badge: 'estático' },
            { label: 'Ratings ELO', value: isLoading ? '…' : eloRatings.length, file: 'public/data/ratings.json', badge: `actualizado ${latestElo ? new Date(latestElo).toLocaleDateString('es') : '—'}` },
            { label: 'Rankings FIFA', value: isLoading ? '…' : fifaRatings.length, file: 'public/data/ratings.json', badge: `actualizado ${latestFifa ? new Date(latestFifa).toLocaleDateString('es') : '—'}` },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between px-5 py-3">
              <div>
                <span className="font-medium text-gray-800">{row.label}</span>
                <span className="ml-2 text-xs text-gray-400">{row.file}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{row.badge}</span>
                <span className="font-bold text-gray-800 text-right w-16">{row.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How to update */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-gray-800">¿Cómo actualizar los datos?</h2>

        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">1</span>
            <div>
              <p className="font-medium text-gray-800">Rankings ELO y FIFA — automático</p>
              <p className="text-gray-500 mt-0.5">
                GitHub Actions los actualiza cada semana automáticamente. No necesitás hacer nada.
                El workflow se llama <code className="bg-gray-100 px-1 rounded">.github/workflows/refresh-ratings.yml</code>.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">2</span>
            <div>
              <p className="font-medium text-gray-800">Resultados históricos — manual si querés</p>
              <p className="text-gray-500 mt-0.5">
                Se agregan una vez que termina el torneo. El workflow
                <code className="bg-gray-100 px-1 rounded ml-1">refresh-ratings.yml</code> también puede actualizarlos.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">3</span>
            <div>
              <p className="font-medium text-gray-800">Contexto de partidos (lesiones, formaciones)</p>
              <p className="text-gray-500 mt-0.5">
                Editalo directamente en la página de <strong>Partidos</strong>: expandí el partido y usá el editor de contexto.
                Se guarda en Supabase automáticamente.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Architecture info */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 text-sm text-blue-800">
        <p className="font-semibold mb-1">Arquitectura actual</p>
        <p>
          Los datos estáticos (equipos, grupos, fixtures, historial, ratings) se sirven como archivos JSON
          desde Cloudflare Pages — sin base de datos. Solo las predicciones guardadas, evaluaciones y contextos
          de partidos van a Supabase. El motor de predicción y la simulación Monte Carlo corren 100% en el browser.
        </p>
      </div>
    </div>
  );
}
