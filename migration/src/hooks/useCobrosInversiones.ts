import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { CobroInversion } from '../types/domain';

// Ledger de "cuánto del saldo disponible ya se invirtió" — ver 0019_cobros_inversiones.sql y
// engine/cobros.ts (saldoInvertible). Por portfolio, no por usuario (cada portfolio tiene su
// propio saldo disponible).
export function useCobrosInversiones(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cobros_inversiones', portfolioId] });

  const q = useQuery({
    queryKey: ['cobros_inversiones', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<CobroInversion[]> => {
      const { data, error } = await supabase.from('cobros_inversiones').select('*').eq('portfolio_id', portfolioId)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    data: q.data ?? [],
    isLoading: q.isLoading,

    marcarInversion: async (input: { monto: number; fecha: string; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.from('cobros_inversiones').insert({
        portfolio_id: portfolioId, fecha: input.fecha, monto: input.monto, nota: input.nota || null,
      });
      if (error) throw error; invalidate();
    },

    // No es un dato "real" con historial impositivo — es una anotación del usuario ("ya invertí
    // esto"), así que un borrado directo (sin descartado/soft-delete) alcanza para deshacerla.
    remove: async (id: string) => {
      const { error } = await supabase.from('cobros_inversiones').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}
