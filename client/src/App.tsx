import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import Approvals from './pages/Approvals';
import Assignments from './pages/Assignments';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Login from './pages/Login';
import MyInfo from './pages/MyInfo';
import Partners from './pages/Partners';
import ProjectMm from './pages/ProjectMm';
import Projects from './pages/Projects';
import Settings from './pages/Settings';
import Utilization from './pages/Utilization';
import WeeklyWork from './pages/WeeklyWork';

function Routed() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="weekly" element={<WeeklyWork />} />
        <Route path="weekly/:empId/:week" element={<WeeklyWork />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="utilization" element={<Utilization />} />
        <Route path="project-mm" element={<ProjectMm />} />
        <Route path="project-mm/:prjCd" element={<ProjectMm />} />
        <Route path="employees" element={<Employees />} />
        <Route path="projects" element={<Projects />} />
        <Route path="partners" element={<Partners />} />
        <Route path="settings" element={<Settings />} />
        <Route path="me" element={<MyInfo />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routed />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
