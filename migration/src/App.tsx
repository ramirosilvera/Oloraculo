import { Routes, Route, Navigate } from 'react-router-dom';
import { Trophy, Loader2 } from 'lucide-react';
import { MainLayout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { OracleLabPage } from './pages/OracleLabPage';
import { MatchesPage } from './pages/MatchesPage';
import { TournamentPage } from './pages/TournamentPage';
import { TournamentSnapshotsPage } from './pages/TournamentSnapshotsPage';
import { PerformancePage } from './pages/PerformancePage';
import { DataPage } from './pages/DataPage';
import { DebugPage } from './pages/DebugPage';
import { useAppData } from './hooks/useAppData';

function SplashScreen({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 bg-wc-navy flex flex-col items-center justify-center gap-5 z-50">
      <div className="flex items-center gap-3">
        <Trophy className="text-wc-gold" size={36} />
        <span className="text-4xl font-black text-white tracking-tight">Oloráculo</span>
      </div>
      <p className="text-wc-gold text-xs font-semibold tracking-widest uppercase">
        WC 2026 · Predictor
      </p>
      <div className="flex items-center gap-2 text-white/50 text-sm mt-6">
        <Loader2 className="w-4 h-4 animate-spin text-wc-gold" />
        <span>{message}</span>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { isLoading, error } = useAppData();

  if (error) {
    return (
      <div className="fixed inset-0 bg-wc-navy flex flex-col items-center justify-center gap-4 z-50 px-6 text-center">
        <Trophy className="text-wc-gold" size={36} />
        <p className="text-white font-bold text-lg">Error al cargar los datos</p>
        <p className="text-white/50 text-sm max-w-xs">{String(error)}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-5 py-2 rounded-lg bg-wc-gold text-wc-navy font-bold text-sm active:scale-95 transition-transform"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <SplashScreen message="Cargando datos históricos..." />;
  }

  return (
    <div className="animate-fade-in">
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="lab" element={<OracleLabPage />} />
          <Route path="matches" element={<MatchesPage />} />
          <Route path="tournament" element={<TournamentPage />} />
          <Route path="tournament/snapshots" element={<TournamentSnapshotsPage />} />
          <Route path="performance" element={<PerformancePage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="debug" element={<DebugPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </div>
  );
}

export function App() {
  return <AppRoutes />;
}
