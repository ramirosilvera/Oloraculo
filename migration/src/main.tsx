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
} from './services/static-data';
import { PredictionEngine } from './engine/prediction-engine';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

// Pre-warm all static data immediately so it's cached before any page renders.
// Teams/groups/fixtures/ratings load in parallel; engine starts once results arrive.
setTimeout(() => {
  Promise.all([
    queryClient.fetchQuery({ queryKey: ['teams'],    queryFn: loadStaticTeams,    staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['groups'],   queryFn: loadStaticGroups,   staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['fixtures'], queryFn: loadStaticFixtures, staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['ratings'],  queryFn: loadStaticRatings,  staleTime: Infinity }),
    queryClient.fetchQuery({ queryKey: ['results'],  queryFn: loadStaticResults,  staleTime: Infinity })
      .then(results =>
        queryClient.fetchQuery({
          queryKey: ['engine'],
          queryFn: () => new PredictionEngine(results),
          staleTime: Infinity,
          gcTime: Infinity,
        }),
      ),
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
