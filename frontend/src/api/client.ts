import axios from 'axios';
import type {
  User,
  EmailJob,
  EmailStats,
  SlackStatus,
  PaginatedResponse,
  ScheduleEmailPayload,
  Sender,
} from '../types';

export const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  getMe: async (): Promise<{ user: User; slackConnected: boolean; slackChannel: string | null }> => {
    const res = await apiClient.get('/auth/me');
    return res.data;
  },
  loginWithEmail: async (email: string): Promise<{ user: User; token: string }> => {
    const res = await apiClient.post('/auth/login', { email });
    if (res.data?.token) {
      localStorage.setItem('token', res.data.token);
    }
    return res.data;
  },
  logout: async (): Promise<void> => {
    localStorage.removeItem('token');
    await apiClient.post('/auth/logout');
  },
  getGoogleAuthUrl: (): string => {
    return `${API_BASE_URL}/auth/google`;
  },
};

export const emailApi = {
  getScheduled: async (
    page = 1,
    limit = 20,
    search = ''
  ): Promise<PaginatedResponse<EmailJob>> => {
    const res = await apiClient.get('/api/emails/scheduled', {
      params: { page, limit, search },
    });
    return res.data;
  },

  getSent: async (
    page = 1,
    limit = 20,
    search = ''
  ): Promise<PaginatedResponse<EmailJob>> => {
    const res = await apiClient.get('/api/emails/sent', {
      params: { page, limit, search },
    });
    return res.data;
  },

  search: async (
    q: string,
    status = '',
    page = 1,
    limit = 20
  ): Promise<PaginatedResponse<EmailJob>> => {
    const res = await apiClient.get('/api/emails/search', {
      params: { q, status, page, limit },
    });
    return res.data;
  },

  getStats: async (): Promise<EmailStats> => {
    const res = await apiClient.get('/api/emails/stats');
    return res.data;
  },

  getSenders: async (): Promise<{ senders: Sender[] }> => {
    const res = await apiClient.get('/api/emails/senders');
    return res.data;
  },

  schedule: async (
    payload: ScheduleEmailPayload
  ): Promise<{ success: boolean; batchId: string; totalScheduled: number }> => {
    const res = await apiClient.post('/api/schedule', payload);
    return res.data;
  },
};

export const slackApi = {
  getStatus: async (): Promise<SlackStatus> => {
    const res = await apiClient.get('/slack/status');
    return res.data;
  },
  getConnectUrl: (): string => {
    return `${API_BASE_URL}/slack/connect`;
  },
  disconnect: async (): Promise<void> => {
    await apiClient.delete('/slack/disconnect');
  },
};
