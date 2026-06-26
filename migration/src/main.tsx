import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';
import {
  loadStaticTeams,
  loadStaticGroups,
  loadStaticFixtures,
  loadStaticRatings,
  loadStaticResults,
  loadStaticFixtureContexts,
  loadStaticSquads,
  loadStaticSquadStrength,
  loadStaticTacticalProfiles,
} from './services/static-data';
import { loadAllMatchGoals, loadEvaluations } from './services/supabase-client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Never garbage-collect cached queries: all app data is preloaded once at
      // startup and must stay warm so navigating between sections is instant.
      // (Default 10 min eviction made Partidos re-fetch goals/evals on return.)
      gcTime: Infinity,
    },
  },
});

// Pre-warm all static data immediately so it's cached before any page renders.
// Teams/groups/fixtures/ratings load in parallel; engine starts once results arrive.
setTimeout(() => {
  Promise.all([
    queryClient.fetchQuery({ queryKey: ['teams'],           queryFn: loadStaticTeams,            staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['groups'],          queryFn: loadStaticGroups,           staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['fixtures'],        queryFn: loadStaticFixtures,         staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['ratings'],         queryFn: loadStaticRatings,          staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['static-contexts'],  queryFn: loadStaticFixtureContexts,  staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['squads'],           queryFn: loadStaticSquads,           staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['squad-strength'],   queryFn: loadStaticSquadStrength,    staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['tactical-profiles'],queryFn: loadStaticTacticalProfiles, staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['results'],          queryFn: loadStaticResults,          staleTime: Infinity }),
    // Supabase live data — preload so Partidos (goleadores + evaluaciones) is
    // warm before the user navigates there. staleTime 60s keeps it fresh.
    queryClient.fetchQuery({ queryKey: ['match-goals'],      queryFn: loadAllMatchGoals,          staleTime: 60_000 }),
    queryClient.fetchQuery({ queryKey: ['evaluations'],      queryFn: loadEvaluations,            staleTime: 60_000 }),
  ]).catch(() => {});
}, 0);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
