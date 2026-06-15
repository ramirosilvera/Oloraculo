// =============================================================================
// HomePage — Dashboard
// Migrated from: Oloraculo.Web/Components/Pages/Home.razor
// =============================================================================

import { Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData';

const SIMULATION_COUNT = 10_000;

const ladder = [
  { level: 'L0', model: 'Base', signal: 'probabilidad uniforme' },
  { level: 'L1', model: 'Ranking FIFA', signal: 'puntos externos' },
  { level: 'L2', model: 'Elo', signal: 'fortaleza de largo plazo' },
  { level: 'L3', model: 'Forma reciente', signal: 'resultados de corto plazo' },
  { level: 'L4', model: 'Goles', signal: 'marcadores Poisson' },
  { level: 'L5', model: 'Contexto', signal: 'ajuste con fuentes' },
  { level: 'Final', model: 'Oráculo final', signal: 'escalón usable más alto' },
];

export function HomePage() {
  const { teams, fixtures, results, isLoading } = useAppData();

  const statCards = [
    { label: 'Equipos', value: isLoading ? '—' : teams.length },
    { label: 'Partidos', value: isLoading ? '—' : fixtures.length },
    { label: 'Resultados históricos', value: isLoading ? '—' : results.length.toLocaleString('es') },
    { label: 'Simulaciones', value: SIMULATION_COUNT.toLocaleString('es') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Oloráculo</h1>
        <p className="text-gray-500 mt-1">Funciona como huele</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-3xl font-bold text-gray-900">{card.value}</div>
            <div className="text-sm text-gray-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Project flow */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Flujo del proyecto</h2>
          <ol className="space-y-2 text-sm text-gray-600">
            <li className="flex gap-2"><span className="font-semibold text-blue-600">1.</span> Los datos estáticos (equipos, historial, ratings) se cargan de archivos JSON.</li>
            <li className="flex gap-2"><span className="font-semibold text-blue-600">2.</span> El motor de predicción corre 100% en el browser sin servidor.</li>
            <li className="flex gap-2"><span className="font-semibold text-blue-600">3.</span> La escalera predice un partido por vez con hasta 6 modelos.</li>
            <li className="flex gap-2"><span className="font-semibold text-blue-600">4.</span> El Oráculo final elige el escalón usable más alto.</li>
            <li className="flex gap-2"><span className="font-semibold text-blue-600">5.</span> Monte Carlo juega 10.000 veces el torneo completo en un Web Worker.</li>
            <li className="flex gap-2"><span className="font-semibold text-blue-600">6.</span> Las predicciones guardadas se evalúan cuando lleguen resultados reales.</li>
          </ol>
          <Link
            to="/lab"
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Abrir laboratorio
          </Link>
        </div>

        {/* Ladder */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Escalera de modelos</h2>
          <table className="w-full text-sm">
            <tbody>
              {ladder.map(row => (
                <tr key={row.level} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded">{row.level}</span>
                  </td>
                  <td className="py-2 pr-3 font-medium text-gray-700">{row.model}</td>
                  <td className="py-2 text-gray-500 text-xs">{row.signal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
