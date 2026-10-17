import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '../types';
import { authApi } from '../api/client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  slackConnected: boolean;
  slackChannel: string | null;
  loginWithEmail: (email: string) => Promise<void>;
  loginWithGoogle: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [slackConnected, setSlackConnected] = useState<boolean>(false);
  const [slackChannel, setSlackChannel] = useState<string | null>(null);

  const fetchCurrentUser = async () => {
    try {
      setLoading(true);
      const data = await authApi.getMe();
      setUser(data.user);
      setSlackConnected(data.slackConnected);
      setSlackChannel(data.slackChannel);
    } catch (err) {
      setUser(null);
      setSlackConnected(false);
      setSlackChannel(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const loginWithEmail = async (email: string) => {
    const data = await authApi.loginWithEmail(email);
    setUser(data.user);
    await fetchCurrentUser();
  };

  const loginWithGoogle = () => {
    // Redirect to real Google OAuth endpoint
    window.location.href = authApi.getGoogleAuthUrl();
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setSlackConnected(false);
      setSlackChannel(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        slackConnected,
        slackChannel,
        loginWithEmail,
        loginWithGoogle,
        logout,
        refreshUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
