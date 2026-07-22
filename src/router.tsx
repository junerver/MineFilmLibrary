import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Toaster } from './components/Toaster';
import LibraryPage from './pages/LibraryPage';
import FilmDetailPage from './pages/FilmDetailPage';
import ActorPage from './pages/ActorPage';
import ScanPage from './pages/ScanPage';
import TrashPage from './pages/TrashPage';
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
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Toaster>
  );
}
