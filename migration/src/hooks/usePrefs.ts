import { useEffect, useState } from 'react';

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
