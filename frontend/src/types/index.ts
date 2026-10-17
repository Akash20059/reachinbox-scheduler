export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  host: string;
  port: number;
}

export type JobStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface EmailJob {
  id: string;
  userId: string | null;
  senderId: string;
  toEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  status: JobStatus;
  attempts: number;
  error: string | null;
  batchId: string | null;
  createdAt: string;
  sender?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface EmailStats {
  scheduled: number;
  sent: number;
}

export interface SlackStatus {
  connected: boolean;
  channel: string | null;
  teamName: string | null;
}

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  emails: T[];
  source?: string;
}

export interface ScheduleEmailPayload {
  emails: string[];
  subject: string;
  body: string;
  startTime?: string;
  delayBetweenMs?: number;
  hourlyLimit?: number;
  senderId?: string;
}
