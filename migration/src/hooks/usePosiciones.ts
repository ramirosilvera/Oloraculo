import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import type { Posicion, Movimiento } from '../types/domain';

// Historial de movimientos de un portfolio (opcionalmente filtrado por ticker).
export function useMovimientos(portfolioId: string | null | undefined, ticker?: string) {
  return useQuery({
    queryKey: ['movimientos', portfolioId, ticker ?? 'all'],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Movimiento[]> => {
      let q = supabase.from('movimientos').select('*')
        .eq('portfolio_id', portfolioId)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false });
      if (ticker) q = q.eq('ticker', ticker);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePosiciones(portfolioId: string | null | undefined) {
  return useQuery({
    queryKey: ['posiciones', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Posicion[]> => {
      const { data, error } = await supabase.from('posiciones')
        .select('*').eq('portfolio_id', portfolioId).order('peso_objetivo', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// All positions across the user's active portfolios (for the consolidated view).
export function useAllPosiciones(enabled: boolean) {
  return useQuery({
    queryKey: ['posiciones', 'all'],
    enabled,
    queryFn: async (): Promise<Posicion[]> => {
      const { data, error } = await supabase.from('posiciones').select('*');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePosicionMutations(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['posiciones'] });
    qc.invalidateQueries({ queryKey: ['movimientos'] });
  };
  return {
    // Alta con CONSOLIDACIÓN: si el activo ya existe en el portfolio, suma la cantidad y
    // recalcula el precio con costo promedio ponderado; si no, crea la posición. Siempre
    // registra el movimiento (compra) para dejar el historial completo.
    add: async (p: Partial<Posicion>) => {
      const ticker = (p.ticker ?? '').toUpperCase().trim();
      const addQty = Number(p.cantidad) || 0;
      const addPrice = Number(p.precio_compra) || 0;

      const { data: existing, error: selErr } = await supabase.from('posiciones')
        .select('*').eq('portfolio_id', portfolioId).eq('ticker', ticker).eq('tipo', p.tipo ?? '')
        .limit(1).maybeSingle();
      if (selErr) throw selErr;

      let posId: string;
      if (existing) {
        const oldQty = Number(existing.cantidad) || 0;
        const oldPrice = Number(existing.precio_compra) || 0;
        const newQty = oldQty + addQty;
        const newPrice = newQty > 0 ? (oldQty * oldPrice + addQty * addPrice) / newQty : oldPrice;
        const patch: Partial<Posicion> = { cantidad: newQty, precio_compra: newPrice };
        // completar campos que faltaban en la posición existente
        if (existing.ratio_cedear == null && p.ratio_cedear != null) patch.ratio_cedear = p.ratio_cedear;
        if (!existing.sector && p.sector) patch.sector = p.sector;
        if (existing.peso_objetivo == null && p.peso_objetivo != null) patch.peso_objetivo = p.peso_objetivo;
        // datos de cupón: si el activo es bono y no los tenía, tomarlos
        if (existing.cupon_tasa == null && p.cupon_tasa != null) patch.cupon_tasa = p.cupon_tasa;
        if (existing.cupon_frecuencia == null && p.cupon_frecuencia != null) patch.cupon_frecuencia = p.cupon_frecuencia;
        if (existing.cupon_mes == null && p.cupon_mes != null) patch.cupon_mes = p.cupon_mes;
        if (existing.vencimiento == null && p.vencimiento != null) patch.vencimiento = p.vencimiento;
        const { error: updErr } = await supabase.from('posiciones').update(patch).eq('id', existing.id);
        if (updErr) throw updErr;
        posId = existing.id;
      } else {
        const { data: created, error: insErr } = await supabase.from('posiciones')
          .insert({ ...p, ticker, portfolio_id: portfolioId }).select('id').single();
        if (insErr) throw insErr;
        posId = created.id;
      }

      if (addQty > 0) {
        await supabase.from('movimientos').insert({
          portfolio_id: portfolioId, posicion_id: posId, ticker,
          tipo: 'compra', cantidad: addQty, precio: addPrice,
          fecha: p.fecha_compra ?? new Date().toISOString().slice(0, 10),
          nota: p.notas ?? null,
        });
      }
      invalidate();
    },
    update: async (id: string, patch: Partial<Posicion>) => {
      const { error } = await supabase.from('posiciones').update(patch).eq('id', id);
      if (error) throw error; invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('posiciones').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}

// Live prices (US equities via Finnhub/FMP, bonds via data912, AR stocks via data912+MEP).
export function useQuotes(tickers: string[], bondTickers: string[] = [], arTickers: string[] = []) {
  return useQuery({
    queryKey: ['quotes', [...tickers].sort().join(','), [...bondTickers].sort().join(','), [...arTickers].sort().join(',')],
    enabled: tickers.length > 0 || bondTickers.length > 0 || arTickers.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, number | null>> => {
      const [eq, bo, ar] = await Promise.allSettled([
        tickers.length ? api.quotes(tickers) : Promise.resolve({}),
        bondTickers.length ? api.bonos() : Promise.resolve({}),
        arTickers.length ? api.accionesAr(arTickers) : Promise.resolve({ precios: {} }),
      ]);
      const out: Record<string, number | null> = {};
      if (eq.status === 'fulfilled') Object.assign(out, eq.value);
      if (bo.status === 'fulfilled') for (const t of bondTickers) out[t] = (bo.value as Record<string, number>)[t] ?? null;
      if (ar.status === 'fulfilled') for (const t of arTickers) out[t] = (ar.value as { precios: Record<string, number | null> }).precios?.[t] ?? null;
      return out;
    },
  });
}

export function useMacro() {
  return useQuery({
    queryKey: ['macro'],
    staleTime: 15 * 60_000,
    queryFn: async () => {
      // allSettled: si una fuente cae (ej. riesgo-país 502), las demás igual se muestran.
      const [fx, rp, fred, ind] = await Promise.allSettled([api.fx(), api.riesgoPais(), api.fred(), api.indicadores()]);
      const out: Record<string, number | null> = {};
      if (fx.status === 'fulfilled') Object.assign(out, fx.value);
      if (rp.status === 'fulfilled') out.riesgo_pais = rp.value.riesgo_pais;
      if (fred.status === 'fulfilled') Object.assign(out, fred.value);
      if (ind.status === 'fulfilled') Object.assign(out, ind.value);
      return out;
    },
  });
}
