import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';
import { loadStaticResults } from './services/static-data';
import { PredictionEngine } from './engine/prediction-engine';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

// Pre-warm results + engine immediately so it's ready before the user
// navigates to MatchesPage and taps "Predecir" for the first time.
setTimeout(() => {
  queryClient
    .fetchQuery({ queryKey: ['results'], queryFn: loadStaticResults, staleTime: Infinity })
    .then(results =>
      queryClient.fetchQuery({
        queryKey: ['engine'],
        queryFn: () => new PredictionEngine(results),
        staleTime: Infinity,
        gcTime: Infinity,
      }),
    )
    .catch(() => {});
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
