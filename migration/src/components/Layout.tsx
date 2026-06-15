import { Outlet, NavLink } from 'react-router-dom';

const navItems = [
  { to: '/',                      label: 'Inicio' },
  { to: '/lab',                   label: 'Laboratorio' },
  { to: '/matches',               label: 'Partidos' },
  { to: '/tournament',            label: 'Torneo' },
  { to: '/tournament/snapshots',  label: 'Snapshots' },
  { to: '/performance',           label: 'Rendimiento' },
  { to: '/data',                  label: 'Datos' },
];

export function MainLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <nav className="w-52 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-100">
          <span className="text-xl font-bold text-gray-900">Oloráculo</span>
          <p className="text-xs text-gray-400 mt-0.5">WC 2026 Predictor</p>
        </div>
        <ul className="flex-1 py-3 space-y-0.5 px-2">
          {navItems.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
