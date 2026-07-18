import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, Table2, Landmark, Wallet, Settings, Layers, TrendingUp, Percent,
  CalendarClock, Radar, Sparkles, LogOut, ChevronDown, Sun, Moon, Rows3, MoreHorizontal,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePrefs } from '../hooks/usePrefs';
import { Wordmark } from './ui';

const NAV_PRIMARY = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/posiciones', label: 'Posiciones', icon: Table2 },
  { to: '/radar', label: 'Radar', icon: Radar },
  { to: '/bonos', label: 'Renta fija', icon: Landmark },
];
const NAV_SECONDARY = [
  { to: '/analisis', label: 'Análisis', icon: Sparkles },
  { to: '/tasas', label: 'Tasas EEUU', icon: Percent },
  { to: '/cupones', label: 'Cupones', icon: CalendarClock },
  { to: '/aportes', label: 'Aportes', icon: Wallet },
  { to: '/proyeccion', label: 'Proyección', icon: TrendingUp },
  { to: '/consolidado', label: 'Consolidado', icon: Layers },
  { to: '/config', label: 'Configuración', icon: Settings },
];

const pill = (isActive: boolean) =>
  `flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
    isActive ? 'bg-celeste-500 text-white shadow-glow' : 'text-ink-600 hover:bg-canvas hover:text-ink-800'}`;

export function Layout() {
  const { signOut, session } = useAuth();
  const { portfolios, active, activeId, setActiveId, loading } = usePortfolios();
  const { theme, density, toggleTheme, toggleDensity } = usePrefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-3">
          <Link to="/" className="shrink-0"><Wordmark /></Link>

          <div className="relative min-w-0 flex-1 sm:flex-none sm:ml-2">
            <select
              value={activeId ?? ''}
              onChange={e => { const v = e.target.value; setActiveId(v); if (v === '__all__') navigate('/consolidado'); }}
              className="w-full max-w-full truncate appearance-none bg-canvas border border-line rounded-full pl-4 pr-9 py-2 text-sm font-semibold text-ink-800 focus:outline-none focus:ring-2 focus:ring-celeste-300"
            >
              {portfolios.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              <option value="__all__">Todos (consolidado)</option>
            </select>
            <ChevronDown className="w-4 h-4 text-ink-600 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="ml-auto flex items-center gap-1 shrink-0">
            <IconBtn onClick={toggleDensity} title={density === 'compact' ? 'Densidad cómoda' : 'Densidad compacta'} active={density === 'compact'}>
              <Rows3 className="w-4 h-4" />
            </IconBtn>
            <IconBtn onClick={toggleTheme} title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </IconBtn>
            <span className="text-[11px] text-ink-600 hidden md:inline max-w-[150px] truncate ml-1">{session?.user.email}</span>
            <IconBtn onClick={signOut} title="Salir" danger><LogOut className="w-4 h-4" /></IconBtn>
          </div>
        </div>

        {/* Nav — pills; en móvil los secundarios van al menú "Más".
            El scroll horizontal va SOLO en el contenedor de pills; el menú "Más" queda fuera
            para que su dropdown no lo recorte el overflow. */}
        <div className="mx-auto max-w-6xl px-3 pb-2.5 flex items-center gap-1.5">
          <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
            {NAV_PRIMARY.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => pill(isActive)}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </NavLink>
            ))}
            {/* Secundarios: pills en desktop */}
            {NAV_SECONDARY.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `${pill(isActive)} hidden lg:flex`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </NavLink>
            ))}
          </nav>
          {/* "Más" en móvil/tablet (fuera del scroll) */}
          <div className="relative lg:hidden shrink-0">
            <button onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} className={pill(NAV_SECONDARY.some(n => location.pathname === n.to))}>
              <MoreHorizontal className="w-3.5 h-3.5" /> Más
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 mt-1.5 z-50 w-48 rounded-2xl border border-line bg-surface shadow-card p-1.5 animate-fade-in">
                  {NAV_SECONDARY.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} onClick={() => setMoreOpen(false)}
                      className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                        isActive ? 'bg-celeste-100 text-celeste-700' : 'text-ink-700 hover:bg-canvas'}`}>
                      <Icon className="w-4 h-4" /> {label}
                    </NavLink>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
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

function IconBtn({ children, onClick, title, active, danger }: {
  children: React.ReactNode; onClick?: () => void; title: string; active?: boolean; danger?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
        active ? 'bg-celeste-100 text-celeste-700'
        : danger ? 'text-ink-600 hover:text-neg hover:bg-neg/5'
        : 'text-ink-600 hover:text-ink-900 hover:bg-canvas'}`}>
      {children}
    </button>
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
