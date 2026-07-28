import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Toaster } from './components/Toaster';
import LibraryPage from './pages/LibraryPage';
import FilmDetailPage from './pages/FilmDetailPage';
import ActorPage from './pages/ActorPage';
import SettingsPage from './pages/SettingsPage';

export default function Router() {
  return (
    <Toaster>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/film/:id" element={<FilmDetailPage />} />
          <Route path="/actors" element={<ActorPage />} />
          {/* 旧独立页入口：兼容书签 / 外链 */}
          <Route path="/scan" element={<Navigate to="/settings?tab=scan" replace />} />
          <Route path="/trash" element={<Navigate to="/settings?tab=trash" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Toaster>
  );
}
