import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Transferencia {
  id: string;
  portfolio_origen_id: string;
  portfolio_destino_id: string;
  posicion_origen_id: string;
  posicion_destino_id: string | null;
  ticker: string;
  tipo: string;
  cantidad: number;
  precio_compra: number;
  fecha_compra: string | null;
  nota: string | null;
  created_at: string;
}

// Historial de transferencias donde participó CUALQUIERA de los portfolios del usuario (como
// origen o como destino) — no se filtra por uno solo, porque una transferencia le importa a los
// dos lados. RLS (transferencias_select) ya solo deja ver las propias.
export function useTransferencias() {
  return useQuery({
    queryKey: ['transferencias'],
    queryFn: async (): Promise<Transferencia[]> => {
      const { data, error } = await supabase.from('transferencias').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Todo el movimiento (restar en origen + crear en destino + loguear) pasa por una única función
// atómica en la base — ver 0024_transferencias.sql. No es una venta (no toca movimientos/pnl) ni
// capital externo (no toca aportes/TIR): es una reclasificación contable entre portfolios propios.
export function useTransferirPosicion() {
  const qc = useQueryClient();
  return async (posicionId: string, portfolioDestino: string, cantidad: number, nota?: string): Promise<void> => {
    const { error } = await supabase.rpc('transferir_posicion', {
      p_posicion_id: posicionId, p_portfolio_destino: portfolioDestino, p_cantidad: cantidad, p_nota: nota || null,
    });
    if (error) throw error;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['posiciones'] }),
      qc.invalidateQueries({ queryKey: ['transferencias'] }),
    ]);
  };
}
