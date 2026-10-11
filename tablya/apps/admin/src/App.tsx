import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './auth';
import { Audit } from './pages/Audit';
import { Catalog } from './pages/Catalog';
import { Dashboard } from './pages/Dashboard';
import { KitchenDetail, Kitchens } from './pages/Kitchens';
import { Login } from './pages/Login';
import { MfaSetup } from './pages/MfaSetup';
import { Marketing } from './pages/Marketing';
import { Moderation } from './pages/Moderation';
import { OrderDetail, Orders } from './pages/Orders';
import { Payments } from './pages/Payments';
import { Settings } from './pages/Settings';
import { Support } from './pages/Support';
import { Users } from './pages/Users';

function Guard({ children }: { children: ReactElement }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return session.mfaSetup ? <MfaSetup /> : children;
}

// Route visibility mirrors the server's RBAC for UX only; every API call is authorised server-side.
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Guard>
            <Layout />
          </Guard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="kitchens" element={<Kitchens />} />
        <Route path="kitchens/:id" element={<KitchenDetail />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="users" element={<Users />} />
        <Route path="moderation" element={<Moderation />} />
        <Route path="payments" element={<Payments />} />
        <Route path="marketing" element={<Marketing />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="support" element={<Support />} />
        <Route path="settings" element={<Settings />} />
        <Route path="audit" element={<Audit />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
