import { RefreshCw } from 'lucide-react';
import { useDataStatus } from '../hooks/usePosiciones';

// Muestra cuándo se actualizaron por última vez los datos de mercado (referencia para el usuario).
export function UpdatedAt({ className = '', icon = false }: { className?: string; icon?: boolean }) {
  const { data } = useDataStatus();
  if (!data?.last) return null;
  const d = new Date(data.last);
  const corto = d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] text-ink-500 ${className}`}
      title={`Datos de mercado actualizados: ${d.toLocaleString('es-AR')}`}>
      {icon && <RefreshCw className="w-3 h-3" />} Datos al {corto} hs
    </span>
  );
}
