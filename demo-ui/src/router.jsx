import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppNav from './components/AppNav';
import AppDemoPage from './pages/AppDemoPage';
import ExplorerPage from './pages/ExplorerPage';
import AppQueryPage from './pages/AppQueryPage';

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AppNav />
      <Routes>
        <Route path="/" element={<Navigate to="/explorer" replace />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/app-demo" element={<AppDemoPage />} />
        <Route path="/app-query" element={<AppQueryPage />} />
        <Route path="*" element={<Navigate to="/explorer" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
