import { createClient } from '@supabase/supabase-js';

// Public anon key is safe to ship ONLY because every table is protected by RLS
// (user_id = auth.uid()). Sensitive server-only work goes through Pages Functions
// with the service-role key, never the browser.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Surfaced early in dev; in prod the env vars are set at build time.
  console.warn('[supabase] faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
