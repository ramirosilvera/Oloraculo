import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Table2, Landmark, Wallet, Settings, Layers, TrendingUp, Percent, CalendarClock, Radar, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePortfolios } from '../hooks/usePortfolios';
import { Wordmark } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/posiciones', label: 'Posiciones', icon: Table2 },
  { to: '/radar', label: 'Radar', icon: Radar },
  { to: '/bonos', label: 'Renta fija', icon: Landmark },
  { to: '/tasas', label: 'Tasas EEUU', icon: Percent },
  { to: '/cupones', label: 'Cupones', icon: CalendarClock },
  { to: '/aportes', label: 'Aportes', icon: Wallet },
  { to: '/proyeccion', label: 'Proyección', icon: TrendingUp },
  { to: '/consolidado', label: 'Consolidado', icon: Layers },
  { to: '/config', label: 'Configuración', icon: Settings },
];

export function Layout() {
  const { signOut, session } = useAuth();
  const { portfolios, active, activeId, setActiveId, loading } = usePortfolios();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-full flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-3">
          <Link to="/" className="shrink-0"><Wordmark /></Link>

          {/* Portfolio selector */}
          <div className="relative min-w-0 flex-1 sm:flex-none sm:ml-2">
            <select
              value={activeId ?? ''}
              onChange={e => {
                const v = e.target.value;
                setActiveId(v);
                if (v === '__all__') navigate('/consolidado');
              }}
              className="w-full max-w-full truncate appearance-none bg-canvas border border-line rounded-full pl-4 pr-9 py-2 text-sm font-semibold text-ink-800 focus:outline-none focus:ring-2 focus:ring-celeste-300"
            >
              {portfolios.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              <option value="__all__">Todos (consolidado)</option>
            </select>
            <ChevronDown className="w-4 h-4 text-ink-600 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-ink-600 hidden sm:inline max-w-[160px] truncate">{session?.user.email}</span>
            <button onClick={signOut} className="text-ink-600 hover:text-neg hover:bg-neg/5 inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors" title="Salir">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Nav — pills */}
        <nav className="mx-auto max-w-6xl px-3 pb-2.5 flex gap-1.5 overflow-x-auto no-scrollbar">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive ? 'bg-celeste-500 text-white shadow-glow' : 'text-ink-600 hover:bg-canvas hover:text-ink-800'}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl w-full px-4 py-6 flex-1 animate-fade-in">
        {loading
          ? <div className="text-center py-20 text-ink-600">Cargando…</div>
          : portfolios.length === 0
            ? <EmptyState />
            : activeId === '__all__' && location.pathname !== '/consolidado'
              ? <ConsolidadoHint />
              : <Outlet />}
      </main>

      <footer className="mx-auto max-w-6xl w-full px-4 py-6 text-center text-[11px] text-ink-500">
        Portafolio · los números los calcula el código, la IA solo interpreta lo cualitativo.
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <p className="text-ink-900 font-bold text-lg font-display">No tenés portfolios todavía</p>
      <p className="text-sm text-ink-600 mt-1 mb-5">Creá el primero para empezar a cargar posiciones.</p>
      <Link to="/config" className="inline-flex items-center gap-1.5 rounded-full bg-celeste-500 text-white px-5 py-2.5 text-sm font-semibold shadow-glow hover:bg-celeste-600 transition-colors">
        Crear mi primer portfolio
      </Link>
    </div>
  );
}

function ConsolidadoHint() {
  return (
    <div className="text-center py-20">
      <p className="text-ink-900 font-bold text-lg font-display">Estás en vista consolidada</p>
      <p className="text-sm text-ink-600 mt-1 mb-5">La gestión se hace por portfolio. Elegí uno en el selector de arriba, o mirá el total.</p>
      <Link to="/consolidado" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface text-ink-800 px-5 py-2.5 text-sm font-semibold hover:border-celeste-300 transition-colors">
        Ver Consolidado
      </Link>
    </div>
  );
}
