import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import {
  Home,
  FlaskConical,
  Swords,
  Trophy,
  History,
  BarChart3,
  Database,
  Menu,
} from 'lucide-react';

const navItems = [
  { to: '/',                     icon: Home,         label: 'Inicio' },
  { to: '/lab',                  icon: FlaskConical, label: 'Laboratorio' },
  { to: '/matches',              icon: Swords,       label: 'Partidos' },
  { to: '/tournament',           icon: Trophy,       label: 'Torneo' },
  { to: '/tournament/snapshots', icon: History,      label: 'Historial' },
  { to: '/performance',          icon: BarChart3,    label: 'Rendimiento' },
  { to: '/data',                 icon: Database,     label: 'Datos' },
];

function SidebarContent({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex flex-col h-full w-56 bg-wc-navy">
      <div className="px-5 py-5">
        <div className="flex items-center gap-2">
          <Trophy className="text-wc-gold" size={22} />
          <span className="text-xl font-bold text-white">Oloráculo</span>
        </div>
        <p className="text-xs text-wc-gold mt-1 ml-0.5">WC 2026 · Predictor</p>
      </div>
      <div className="h-0.5 bg-wc-gold mx-4 mb-3" />
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3">
        <p className="text-[10px] text-white/30 text-center">⚽ Powered by Dixon-Coles</p>
      </div>
    </div>
  );
}

export function MainLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="hidden lg:flex flex-shrink-0">
        <SidebarContent />
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent onClose={() => setOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-wc-navy">
          <div className="flex items-center gap-2">
            <Trophy className="text-wc-gold" size={20} />
            <span className="text-lg font-bold text-white">Oloráculo</span>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="text-white/80 hover:text-white p-1"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
