import { useEffect, useState } from 'react';

// ¿Está activo el modo oscuro? Observa la clase `dark` del <html> (la maneja usePrefs en el
// Layout) para que componentes con colores imperativos (recharts) re-rendericen al cambiar tema.
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// Colores para gráficos recharts según tema (recharts no resuelve CSS vars en atributos SVG).
export function useChartTheme() {
  const dark = useIsDark();
  return dark
    ? { grid: '#263144', axis: '#96A3B2', tooltipBg: '#161D2D', tooltipBorder: '#263144', tooltipText: '#EDF2F8', line2: '#475466' }
    : { grid: '#E4ECF4', axis: '#5C6A7D', tooltipBg: '#FFFFFF', tooltipBorder: '#E4ECF4', tooltipText: '#14212E', line2: '#C4CEDB' };
}

type Theme = 'light' | 'dark';
type Density = 'comfortable' | 'compact';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'light'; }
}
function initialDensity(): Density {
  try { return localStorage.getItem('density') === 'compact' ? 'compact' : 'comfortable'; }
  catch { return 'comfortable'; }
}

// Preferencias de UI (tema claro/oscuro + densidad de tablas), persistidas en localStorage.
export function usePrefs() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [density, setDensity] = useState<Density>(initialDensity);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('theme', theme); } catch { /* */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0A0E16' : '#F4F8FC');
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle('density-compact', density === 'compact');
    try { localStorage.setItem('density', density); } catch { /* */ }
  }, [density]);

  return {
    theme, density,
    toggleTheme: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),
    toggleDensity: () => setDensity(d => (d === 'compact' ? 'comfortable' : 'compact')),
  };
}
