import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => {
  console.log('✅ Connected to Redis successfully');
});

redisConnection.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

export interface EmailJobData {
  emailJobId: string;
  senderId: string;
  userId?: string | null;
  toEmail: string;
  subject: string;
  body: string;
  delayBetweenEmailsMs?: number;
  hourlyLimit?: number;
}

export const EMAIL_QUEUE_NAME = 'email-scheduler-queue';

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

/**
 * Schedules a delayed email job into BullMQ
 */
export async function scheduleEmailInQueue(data: EmailJobData, scheduledAt: Date) {
  const now = Date.now();
  const delay = Math.max(0, scheduledAt.getTime() - now);

  const job = await emailQueue.add('send-email', data, {
    delay,
    jobId: data.emailJobId, // Guarantees idempotency
  });

  return job;
}
