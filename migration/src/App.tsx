import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { PortfoliosProvider } from './hooks/usePortfolios';
import { LoginPage } from './pages/LoginPage';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { PosicionesPage } from './pages/PosicionesPage';
import { AnalisisPage } from './pages/AnalisisPage';
import { BonosPage } from './pages/BonosPage';
import { AportesPage } from './pages/AportesPage';
import { ConfigPage } from './pages/ConfigPage';
import { ConsolidadoPage } from './pages/ConsolidadoPage';

export function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="h-full grid place-items-center text-ink-600">Cargando…</div>;
  }
  if (!session) return <LoginPage />;

  return (
    <PortfoliosProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="posiciones" element={<PosicionesPage />} />
          <Route path="analisis/:ticker" element={<AnalisisPage />} />
          <Route path="bonos" element={<BonosPage />} />
          <Route path="aportes" element={<AportesPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="consolidado" element={<ConsolidadoPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </PortfoliosProvider>
  );
}
