import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => {
  logger.info('Connected to Redis successfully');
});

redisConnection.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'Redis connection error');
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
  batchId?: string | null;
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
 * Schedules a single delayed email job into BullMQ
 */
export async function scheduleEmailInQueue(data: EmailJobData, scheduledAt: Date) {
  const now = Date.now();
  const delay = Math.max(0, scheduledAt.getTime() - now);

  const job = await emailQueue.add('send-email', data, {
    delay,
    jobId: data.emailJobId, // Guarantees strict idempotency
  });

  return job;
}

/**
 * Bulk adds jobs to BullMQ queue in a single atomic pipeline
 */
export async function scheduleBulkEmailsInQueue(
  jobs: Array<{ data: EmailJobData; scheduledAt: Date }>
) {
  const now = Date.now();
  const bulkItems = jobs.map((item) => ({
    name: 'send-email',
    data: item.data,
    opts: {
      delay: Math.max(0, item.scheduledAt.getTime() - now),
      jobId: item.data.emailJobId, // Guarantees strict idempotency
    },
  }));

  return emailQueue.addBulk(bulkItems);
}
