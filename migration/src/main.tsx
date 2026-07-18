import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000, // conservar en memoria 24h para poder persistir
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Persistencia en localStorage: al volver a abrir la app, los últimos datos (precios,
// fundamentos, macro, posiciones, watchlist) aparecen al instante y se revalidan en segundo
// plano. Así no hay que esperar a que recarguen entre sesiones.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'portafolio-rq-cache',
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000 }}
    >
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
