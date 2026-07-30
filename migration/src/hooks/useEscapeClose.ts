import { useEffect } from 'react';

// Cierra con Escape — mismo criterio que el bottom sheet de Layout.tsx, pero reusable para
// cualquier modal fixed-overlay de la app en vez de repetir el listener en cada uno.
export function useEscapeClose(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
}
