import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Guard, Home, Layout } from './components/Layout';
import Permissions from './pages/Permissions';
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
import CostBasis from './pages/CostBasis';
import Profit from './pages/Profit';
import ProfitSim from './pages/ProfitSim';
import Staffing from './pages/Staffing';
import StaffingDetail from './pages/StaffingDetail';
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
        <Route index element={<Home><Dashboard /></Home>} />
        <Route path="weekly" element={<Guard menu="weekly"><WeeklyWork /></Guard>} />
        <Route path="weekly/:empId/:week" element={<WeeklyWork />} />
        <Route path="submissions" element={<Guard menu="submissions"><Submissions /></Guard>} />
        <Route path="project-weekly" element={<Guard menu="projectWeekly"><ProjectWeekly /></Guard>} />
        <Route path="project-weekly/:prjCd/:week" element={<Guard menu="projectWeekly"><ProjectWeekly /></Guard>} />
        <Route path="onepage" element={<Guard menu="onepage"><OnePage /></Guard>} />
        <Route path="onepage/:week" element={<Guard menu="onepage"><OnePage /></Guard>} />
        <Route path="assignments" element={<Guard menu="assignments"><Assignments /></Guard>} />
        <Route path="staffing" element={<Guard menu="staffing"><Staffing /></Guard>} />
        <Route path="staffing/:prjCd" element={<Guard menu="staffing"><StaffingDetail /></Guard>} />
        <Route path="utilization" element={<Guard menu="utilization"><Utilization /></Guard>} />
        <Route path="project-mm" element={<Guard menu="projectMm"><ProjectMm /></Guard>} />
        <Route path="project-mm/:prjCd" element={<Guard menu="projectMm"><ProjectMm /></Guard>} />
        <Route path="profit" element={<Guard menu="profit"><Profit /></Guard>} />
        <Route path="profit/sim/:id" element={<Guard menu="profit"><ProfitSim /></Guard>} />
        <Route path="employees" element={<Guard menu="employees"><Employees /></Guard>} />
        <Route path="projects" element={<Guard menu="projects"><Projects /></Guard>} />
        <Route path="partners" element={<Guard menu="partners"><Partners /></Guard>} />
        <Route path="settings" element={<Guard menu="settings"><Settings /></Guard>} />
        <Route path="cost-basis" element={<Guard menu="costBasis"><CostBasis /></Guard>} />
        <Route path="account-requests" element={<Guard menu="accountRequests"><AccountRequests /></Guard>} />
        <Route path="me" element={<MyInfo />} />
        <Route path="permissions" element={<Guard menu="permissions"><Permissions /></Guard>} />
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
