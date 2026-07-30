import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Cobro, CobroTipo } from '../types/domain';

export function useCobros(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cobros', portfolioId] });
    qc.invalidateQueries({ queryKey: ['posiciones'] });
    qc.invalidateQueries({ queryKey: ['movimientos'] });
  };

  const q = useQuery({
    queryKey: ['cobros', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Cobro[]> => {
      const { data, error } = await supabase.from('cobros').select('*').eq('portfolio_id', portfolioId)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    data: q.data ?? [],
    isLoading: q.isLoading,

    // Dividendo o interés: solo plata, no toca la posición (a diferencia de la amortización).
    registrar: async (input: { posicionId: string | null; ticker: string; tipo: 'dividendo' | 'interes'; fecha: string; monto: number; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.from('cobros').insert({
        portfolio_id: portfolioId, posicion_id: input.posicionId, ticker: input.ticker.toUpperCase().trim(),
        tipo: input.tipo, fecha: input.fecha, monto: input.monto, nota: input.nota || null, origen: 'manual',
      });
      if (error) throw error; invalidate();
    },

    // Amortización: devolución de CAPITAL, no renta — además de registrar la plata, reduce el
    // nominal tenido vía un movimiento 'ajuste' (mismo camino que un split/corrección: no toca el
    // costo promedio, ver engine/tenencia.ts). Si el usuario quiere deshacerlo, lo hace borrando ese
    // movimiento desde el historial de Posiciones (ya reconstruye la tenencia correctamente).
    registrarAmortizacion: async (input: { posicionId: string; ticker: string; fecha: string; monto: number; nominales: number; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      if (!(input.nominales > 0)) throw new Error('Los nominales amortizados deben ser mayores a 0.');
      const { data: pos, error: posErr } = await supabase.from('posiciones').select('cantidad').eq('id', input.posicionId).single();
      if (posErr) throw posErr;
      const cantidadActual = Number(pos.cantidad) || 0;
      const nominales = Math.min(input.nominales, cantidadActual);
      const ticker = input.ticker.toUpperCase().trim();
      const { data: mov, error: movErr } = await supabase.from('movimientos').insert({
        portfolio_id: portfolioId, posicion_id: input.posicionId, ticker,
        tipo: 'ajuste', cantidad: -nominales, precio: 0, fecha: input.fecha, nota: 'amortización de capital',
      }).select('id').single();
      if (movErr) throw movErr;
      const { error: updErr } = await supabase.from('posiciones').update({ cantidad: Math.max(0, cantidadActual - nominales) }).eq('id', input.posicionId);
      if (updErr) throw new Error(`Se registró el movimiento pero no se pudo actualizar el nominal: ${updErr.message}`);
      const { error: cobroErr } = await supabase.from('cobros').insert({
        portfolio_id: portfolioId, posicion_id: input.posicionId, ticker,
        tipo: 'amortizacion', fecha: input.fecha, monto: input.monto, movimiento_id: mov.id, nota: input.nota || null, origen: 'manual',
      });
      if (cobroErr) throw new Error(`El nominal se ajustó pero no se pudo registrar el cobro: ${cobroErr.message}`);
      invalidate();
    },

    marcarEstado: async (id: string, estado: 'disponible' | 'reinvertido') => {
      const { error } = await supabase.from('cobros').update({ estado }).eq('id', id);
      if (error) throw error; invalidate();
    },

    // Confirmar un PENDIENTE (generado por el cron): pasa a 'disponible' y el usuario puede haber
    // corregido el monto antes de confirmar (dividendo real ≠ estimado por retención/redondeo/
    // dividendo especial). Nunca en lote — uno a la vez, a propósito, para que se revise cada uno.
    confirmarPendiente: async (id: string, montoFinal: number) => {
      if (!(montoFinal > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.from('cobros').update({ estado: 'disponible', monto: montoFinal }).eq('id', id);
      if (error) throw error; invalidate();
    },

    // Descartar un PENDIENTE (sugerido por el cron): NO se borra la fila, se marca 'descartado' —
    // si se borrara, el índice de deduplicación (cobros_cron_dedupe) quedaría libre y el cron
    // volvería a sugerir EXACTAMENTE lo mismo en la próxima corrida (cada 30 min, o el mes/ventana
    // completa para cupones de bono). engine/cobros.ts excluye 'descartado' de todos los totales.
    descartarPendiente: async (id: string) => {
      const { error } = await supabase.from('cobros').update({ estado: 'descartado' }).eq('id', id);
      if (error) throw error; invalidate();
    },

    // Borra SOLO el registro de cobro (la plata que se anotó como cobrada). Si era una
    // amortización, el nominal reducido NO se revierte acá a propósito: eso realmente pasó. Para
    // deshacer el efecto en la posición hay que borrar el movimiento 'ajuste' desde su historial
    // en Posiciones (el link movimiento_id de este cobro queda en null solo, por la FK).
    // Para un PENDIENTE usar descartarPendiente, no esto (ver comentario arriba).
    remove: async (id: string) => {
      const { error } = await supabase.from('cobros').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}

export const COBRO_TIPO_LABEL: Record<CobroTipo, string> = {
  dividendo: 'Dividendo', interes: 'Interés', amortizacion: 'Amortización',
};
