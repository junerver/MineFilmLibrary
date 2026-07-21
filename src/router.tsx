import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Toaster } from './components/Toaster';
import LibraryPage from './pages/LibraryPage';
import FilmDetailPage from './pages/FilmDetailPage';

export default function Router() {
  return (
    <Toaster>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/film/:id" element={<FilmDetailPage />} />
          <Route path="/actors" element={<div>Actors (placeholder)</div>} />
          <Route path="/scan" element={<div>Scan (placeholder)</div>} />
          <Route path="/trash" element={<div>Trash (placeholder)</div>} />
          <Route path="/settings" element={<div>Settings (placeholder)</div>} />
        </Route>
      </Routes>
    </Toaster>
  );
}
