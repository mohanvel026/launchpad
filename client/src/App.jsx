import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login         from './pages/Login';
import AuthCallback  from './pages/AuthCallback';
import Dashboard     from './pages/Dashboard';
import NewProject    from './pages/NewProject';
import ProjectDetail from './pages/ProjectDetail';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"             element={<Login />} />
        <Route path="/auth/callback"     element={<AuthCallback />} />
        <Route path="/dashboard"         element={<Dashboard />} />
        <Route path="/projects/new"      element={<NewProject />} />
        <Route path="/projects/:id"      element={<ProjectDetail />} />
        <Route path="/"                  element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}