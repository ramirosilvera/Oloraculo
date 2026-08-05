import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useEstadoCuenta } from './hooks/useAdmin';
import { PortfoliosProvider } from './hooks/usePortfolios';
import { LoginPage } from './pages/LoginPage';
import { PendingApprovalPage } from './pages/PendingApprovalPage';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { PosicionesPage } from './pages/PosicionesPage';
import { AnalisisPage } from './pages/AnalisisPage';
import { BonosPage } from './pages/BonosPage';
import { AportesPage } from './pages/AportesPage';
import { ConfigPage } from './pages/ConfigPage';
import { ConsolidadoPage } from './pages/ConsolidadoPage';
import { ProyeccionesPage } from './pages/ProyeccionesPage';
import { TasasPage } from './pages/TasasPage';
import { CuponesPage } from './pages/CuponesPage';
import { RadarPage } from './pages/RadarPage';
import { AnalisisHomePage } from './pages/AnalisisHomePage';
import { FinanzasPage } from './pages/FinanzasPage';
import { BrokersPage } from './pages/BrokersPage';
import { MacroPage } from './pages/MacroPage';
import { AdminPage } from './pages/AdminPage';
import { TransferenciasPage } from './pages/TransferenciasPage';

export function App() {
  const { session, loading } = useAuth();
  // Se resuelve server-side (whoami) y es la fuente de la verdad SOLO para decidir qué pantalla
  // mostrar acá — no reemplaza el chequeo real (policy portfolios_insert exige is_approved() en
  // la base), así que aunque este gate se saltee de algún modo, no se puede crear un portfolio.
  const { isAdmin, isApproved, isLoading: chequeandoCuenta } = useEstadoCuenta();

  if (loading) {
    return <div className="h-full grid place-items-center text-ink-600">Cargando…</div>;
  }
  if (!session) return <LoginPage />;
  if (chequeandoCuenta) {
    return <div className="h-full grid place-items-center text-ink-600">Cargando…</div>;
  }
  if (!isAdmin && !isApproved) return <PendingApprovalPage />;

  return (
    <PortfoliosProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="posiciones" element={<PosicionesPage />} />
          <Route path="analisis" element={<AnalisisHomePage />} />
          <Route path="analisis/:ticker" element={<AnalisisPage />} />
          <Route path="bonos" element={<BonosPage />} />
          <Route path="tasas" element={<TasasPage />} />
          <Route path="cupones" element={<CuponesPage />} />
          <Route path="radar" element={<RadarPage />} />
          <Route path="finanzas" element={<FinanzasPage />} />
          <Route path="aportes" element={<AportesPage />} />
          <Route path="proyeccion" element={<ProyeccionesPage />} />
          <Route path="brokers" element={<BrokersPage />} />
          <Route path="transferencias" element={<TransferenciasPage />} />
          <Route path="macro" element={<MacroPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="consolidado" element={<ConsolidadoPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </PortfoliosProvider>
  );
}
