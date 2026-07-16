import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Portfolio } from '../types/domain';

const ACTIVE_KEY = 'pf.activeId';

interface PortfoliosCtx {
  portfolios: Portfolio[];
  loading: boolean;
  activeId: string | null;              // null = vista consolidada ("todos")
  active: Portfolio | null;
  setActiveId: (id: string | null) => void;
  createPortfolio: (p: Pick<Portfolio, 'nombre' | 'descripcion' | 'capital_objetivo' | 'moneda_ref'>) => Promise<void>;
  updatePortfolio: (id: string, patch: Partial<Portfolio>) => Promise<void>;
  archivePortfolio: (id: string) => Promise<void>;
}

const Ctx = createContext<PortfoliosCtx>(null as unknown as PortfoliosCtx);
export const usePortfolios = () => useContext(Ctx);

export function PortfoliosProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveIdState] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY) || null);

  const { data: portfolios = [], isLoading } = useQuery({
    queryKey: ['portfolios', session?.user.id],
    enabled: !!session,
    queryFn: async (): Promise<Portfolio[]> => {
      const { data, error } = await supabase
        .from('portfolios').select('*').eq('estado', 'active').order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });

  const setActiveId = (id: string | null) => {
    setActiveIdState(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY);
  };

  // Default the active portfolio to the first one once loaded (unless "consolidado" chosen).
  const active = useMemo(() => {
    if (activeId === '__all__') return null;
    return portfolios.find(p => p.id === activeId) ?? portfolios[0] ?? null;
  }, [portfolios, activeId]);

  const createM = useMutation({
    mutationFn: async (p: Pick<Portfolio, 'nombre' | 'descripcion' | 'capital_objetivo' | 'moneda_ref'>) => {
      const { data, error } = await supabase.from('portfolios')
        .insert({ ...p, user_id: session!.user.id }).select().single();
      if (error) throw error;
      return data as Portfolio;
    },
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['portfolios'] }); setActiveId(row.id); },
  });

  const value: PortfoliosCtx = {
    portfolios,
    loading: isLoading,
    activeId: activeId === '__all__' ? '__all__' : (active?.id ?? null),
    active,
    setActiveId,
    createPortfolio: async (p) => { await createM.mutateAsync(p); },
    updatePortfolio: async (id, patch) => {
      const { error } = await supabase.from('portfolios').update(patch).eq('id', id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['portfolios'] });
    },
    archivePortfolio: async (id) => {
      const { error } = await supabase.from('portfolios').update({ estado: 'archived' }).eq('id', id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['portfolios'] });
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
