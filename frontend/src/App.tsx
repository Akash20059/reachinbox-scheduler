import React from 'react';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { Spinner } from './components/ui/Spinner';

const MainApp: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <Spinner fullPage label="Loading ReachInbox..." />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return <DashboardPage />;
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ToastProvider>
  );
};

export default App;
