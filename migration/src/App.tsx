import { Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { OracleLabPage } from './pages/OracleLabPage';
import { MatchesPage } from './pages/MatchesPage';
import { TournamentPage } from './pages/TournamentPage';
import { TournamentSnapshotsPage } from './pages/TournamentSnapshotsPage';
import { PerformancePage } from './pages/PerformancePage';
import { DataPage } from './pages/DataPage';
import { DebugPage } from './pages/DebugPage';

export function App() {
  return (
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
  );
}
