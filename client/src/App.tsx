import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import AccountRequests from './pages/AccountRequests';
import Assignments from './pages/Assignments';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import ForceChangePassword from './pages/ForceChangePassword';
import Login from './pages/Login';
import MyInfo from './pages/MyInfo';
import OnePage from './pages/OnePage';
import Partners from './pages/Partners';
import ProjectMm from './pages/ProjectMm';
import ProjectWeekly from './pages/ProjectWeekly';
import Projects from './pages/Projects';
import Settings from './pages/Settings';
import Staffing from './pages/Staffing';
import Submissions from './pages/Submissions';
import Utilization from './pages/Utilization';
import WeeklyWork from './pages/WeeklyWork';

function Routed() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Login />;
  if (user.mustChangePw) return <ForceChangePassword />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="weekly" element={<WeeklyWork />} />
        <Route path="weekly/:empId/:week" element={<WeeklyWork />} />
        <Route path="submissions" element={<Submissions />} />
        <Route path="project-weekly" element={<ProjectWeekly />} />
        <Route path="project-weekly/:prjCd/:week" element={<ProjectWeekly />} />
        <Route path="onepage" element={<OnePage />} />
        <Route path="onepage/:week" element={<OnePage />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="staffing" element={<Staffing />} />
        <Route path="utilization" element={<Utilization />} />
        <Route path="project-mm" element={<ProjectMm />} />
        <Route path="project-mm/:prjCd" element={<ProjectMm />} />
        <Route path="employees" element={<Employees />} />
        <Route path="projects" element={<Projects />} />
        <Route path="partners" element={<Partners />} />
        <Route path="settings" element={<Settings />} />
        <Route path="account-requests" element={<AccountRequests />} />
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
