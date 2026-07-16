import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Table2, Landmark, Wallet, Settings, Layers, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePortfolios } from '../hooks/usePortfolios';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/posiciones', label: 'Posiciones', icon: Table2 },
  { to: '/bonos', label: 'Renta fija', icon: Landmark },
  { to: '/aportes', label: 'Aportes', icon: Wallet },
  { to: '/consolidado', label: 'Consolidado', icon: Layers },
  { to: '/config', label: 'Configuración', icon: Settings },
];

export function Layout() {
  const { signOut, session } = useAuth();
  const { portfolios, active, activeId, setActiveId } = usePortfolios();

  return (
    <div className="min-h-full flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
          <span className="text-accent font-black tracking-tight">◇ Portfolio</span>

          {/* Portfolio selector */}
          <div className="relative">
            <select
              value={activeId ?? ''}
              onChange={e => setActiveId(e.target.value)}
              className="appearance-none bg-ink-800 border border-ink-600 rounded-lg pl-3 pr-8 py-1.5 text-sm font-semibold text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {portfolios.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              <option value="__all__">Todos (consolidado)</option>
            </select>
            <ChevronDown className="w-4 h-4 text-ink-600 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11px] text-ink-600 hidden sm:inline">{session?.user.email}</span>
            <button onClick={signOut} className="text-ink-600 hover:text-gray-300" title="Salir">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Nav */}
        <nav className="mx-auto max-w-6xl px-2 flex gap-1 overflow-x-auto">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  isActive ? 'border-accent text-accent' : 'border-transparent text-ink-600 hover:text-gray-300'}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl w-full px-4 py-5 flex-1 animate-fade-in">
        {active || activeId === '__all__'
          ? <Outlet />
          : <EmptyState />}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <p className="text-gray-300 font-semibold">No tenés portfolios todavía</p>
      <p className="text-sm text-ink-600 mt-1">Creá el primero desde Configuración.</p>
    </div>
  );
}
