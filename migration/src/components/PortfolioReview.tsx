import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardHeader, Button } from './ui';
import type { Posicion } from '../types/domain';

// Review cualitativo de la cartera con IA: concentración, correlación entre posiciones
// (ej. dos apuestas al mismo factor de riesgo), diversificación sectorial y coherencia
// con la estrategia. La IA solo interpreta; no calcula valores.
export function PortfolioReview({ posiciones, pfName, pesos }: {
  posiciones: Posicion[]; pfName: Map<string, string>;
  pesos?: Map<string, number>;   // peso REAL por ticker (valor de mercado / total), calculado por el código
}) {
  const [txt, setTxt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const resumen = posiciones.map(p => ({
      portfolio: pfName.get(p.portfolio_id) ?? '', ticker: p.ticker, tipo: p.tipo,
      sector: p.sector, rol: p.rol, peso_objetivo: p.peso_objetivo,
      // Sin el peso real la IA no puede juzgar concentración; lo calcula el código, no ella.
      peso_actual: pesos?.get(p.ticker) != null ? +(pesos.get(p.ticker)! * 100).toFixed(1) + '%' : null,
    }));
    const r = await api.analisisPortfolio({ posiciones: resumen });
    setTxt(r.analisis ?? r.error ?? 'Sin respuesta');
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader title="Revisión de cartera (IA)" sub="Concentración, correlación entre posiciones, diversificación sectorial y coherencia con la estrategia. No es recomendación de inversión."
        right={<Button variant="ghost" onClick={run} disabled={busy}><Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : txt ? 'Regenerar' : 'Analizar cartera'}</Button>} />
      {txt && (
        <div className="px-4 py-3">
          <p className="text-sm text-ink-700 whitespace-pre-wrap break-words leading-relaxed">{txt}</p>
        </div>
      )}
    </Card>
  );
}
