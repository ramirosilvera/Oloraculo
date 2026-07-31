import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  signInPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirm: boolean }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Al cerrar sesión, limpiar la cache EN MEMORIA y la PERSISTIDA (localStorage). El persister
      // escribe con throttle: si solo hiciéramos qc.clear(), un cierre de pestaña inmediato podría
      // dejar los datos del usuario anterior en disco y rehidratarse para el próximo usuario.
      if (event === 'SIGNED_OUT') {
        qc.clear();
        try { localStorage.removeItem('portafolio-rq-cache'); } catch { /* */ }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const value: AuthCtx = {
    session,
    loading,
    signInPassword: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    signUp: async (email, password) => {
      const { data, error } = await supabase.auth.signUp({ email, password });
      // Si Supabase tiene confirmación por email activada, no hay sesión hasta confirmar.
      const needsConfirm = !error && !data.session;
      return { error: error?.message ?? null, needsConfirm };
    },
    updatePassword: async (newPassword) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      return { error: error?.message ?? null };
    },
    signOut: async () => { await supabase.auth.signOut(); },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
