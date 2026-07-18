import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardHeader, Button } from './ui';
import type { Posicion } from '../types/domain';

// Review cualitativo de la cartera con IA: concentración, correlación entre posiciones
// (ej. dos apuestas al mismo factor de riesgo), diversificación sectorial y coherencia
// con la estrategia. La IA solo interpreta; no calcula valores.
export function PortfolioReview({ posiciones, pfName }: { posiciones: Posicion[]; pfName: Map<string, string> }) {
  const [txt, setTxt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const resumen = posiciones.map(p => ({
      portfolio: pfName.get(p.portfolio_id) ?? '', ticker: p.ticker, tipo: p.tipo,
      sector: p.sector, rol: p.rol, peso_objetivo: p.peso_objetivo,
    }));
    const r = await api.analisisPortfolio({ posiciones: resumen });
    setTxt(r.analisis ?? r.error ?? 'Sin respuesta');
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader title="Revisión de cartera (IA)" sub="Concentración, correlación entre posiciones, diversificación sectorial y coherencia con la estrategia. No es recomendación de inversión."
        right={<Button variant="ghost" onClick={run} disabled={busy}><Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : txt ? 'Regenerar' : 'Analizar cartera'}</Button>} />
      {txt && <p className="px-4 py-3 text-sm text-ink-700 whitespace-pre-wrap leading-relaxed">{txt}</p>}
    </Card>
  );
}
