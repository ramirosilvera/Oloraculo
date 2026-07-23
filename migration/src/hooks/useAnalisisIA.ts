import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// Persistencia de los análisis de IA entre sesiones y días. El server ya guarda cada análisis en
// analisis_ia; acá cargamos el ÚLTIMO para un ticker/tipo al montar, así la caja no aparece vacía.
// La key incluye el user_id (aislamiento de la cache persistida en localStorage).
export function useUltimoAnalisis(ticker: string, tipo: string) {
  const { session } = useAuth();
  const uid = session?.user.id ?? 'anon';
  const q = useQuery({
    queryKey: ['analisis-ia', uid, tipo, ticker],
    enabled: !!session && !!ticker,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<{ respuesta: string; created_at: string } | null> => {
      const { data, error } = await supabase.from('analisis_ia')
        .select('respuesta, created_at')
        .eq('ticker', ticker).eq('tipo', tipo)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
  return { texto: q.data?.respuesta ?? null, fecha: q.data?.created_at ?? null, isLoading: q.isLoading };
}

// Escribe el análisis recién generado en la cache (para que se vea al instante y se persista aunque
// todavía no se relea de la base).
export function useSetUltimoAnalisis() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user.id ?? 'anon';
  return (ticker: string, tipo: string, respuesta: string) => {
    qc.setQueryData(['analisis-ia', uid, tipo, ticker], { respuesta, created_at: new Date().toISOString() });
  };
}
