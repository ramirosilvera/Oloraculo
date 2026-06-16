import { useState, useTransition, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation, matchPath } from 'react-router-dom';
import {
  Home,
  FlaskConical,
  Swords,
  Trophy,
  History,
  BarChart3,
  Database,
  Menu,
  Loader2,
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

// Module-level counter so NavButton instances can signal the top bar
// without React context or prop drilling.  Each NavButton increments when
// its transition starts and decrements when it ends; MainLayout listens
// with a 'nav-pending-change' CustomEvent.
function emitPendingDelta(delta: 1 | -1) {
  window.dispatchEvent(
    new CustomEvent<number>('nav-pending-change', { detail: delta })
  );
}

function NavButton({
  to,
  icon: Icon,
  label,
  onClose,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isPending, startTransition] = useTransition();

  const isActive = !!matchPath({ path: to, end: to === '/' }, location.pathname);

  // Track previous isPending so we emit exactly one delta per edge.
  const prevPending = useRef(false);
  useEffect(() => {
    if (isPending === prevPending.current) return;
    emitPendingDelta(isPending ? 1 : -1);
    prevPending.current = isPending;
  }, [isPending]);

  // Cleanup: if the button unmounts while pending, decrement the counter.
  useEffect(() => {
    return () => {
      if (prevPending.current) {
        emitPendingDelta(-1);
        prevPending.current = false;
      }
    };
  }, []);

  function handleClick() {
    if (onClose) onClose();
    startTransition(() => {
      navigate(to);
    });
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.96] active:brightness-90 ${
        isActive
          ? 'bg-white/10 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white active:bg-white/15'
      }`}
    >
      {isPending ? (
        <Loader2 size={17} className="animate-spin" />
      ) : (
        <Icon size={17} />
      )}
      {label}
    </button>
  );
}

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
        {navItems.map(({ to, icon, label }) => (
          <NavButton
            key={to}
            to={to}
            icon={icon}
            label={label}
            onClose={onClose}
          />
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
  const [anyNavPending, setAnyNavPending] = useState(false);

  // Listen for nav-pending-change events emitted by NavButton instances.
  useEffect(() => {
    let count = 0;
    function handler(e: Event) {
      count = Math.max(0, count + (e as CustomEvent<number>).detail);
      setAnyNavPending(count > 0);
    }
    window.addEventListener('nav-pending-change', handler);
    return () => window.removeEventListener('nav-pending-change', handler);
  }, []);

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Gold top-bar progress indicator */}
      <div
        className={`fixed top-0 left-0 right-0 z-[100] h-[3px] bg-wc-gold transition-opacity duration-200 ${
          anyNavPending ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

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
            className="text-white/80 hover:text-white p-1 active:scale-[0.90] active:brightness-75 transition-all"
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
