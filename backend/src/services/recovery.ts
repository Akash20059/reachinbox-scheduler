import { prisma } from '../db/prisma.js';
import { emailQueue, scheduleEmailInQueue } from '../queues/email.queue.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { reindexMissingEmailsFromDB } from './elasticsearch.js';

/**
 * Reconciles DB vs Queue vs Elasticsearch on server boot:
 * 1. Resets stale 'processing' rows back to 'scheduled'.
 * 2. Re-enqueues any status='scheduled' rows missing from Redis BullMQ queue (including overdue ones with delay=0).
 * 3. Never creates duplicate jobs for rows already in the queue.
 * 4. Reindexes any missing EmailJob rows into Elasticsearch.
 */
export async function recoverScheduledJobsOnStartup(): Promise<void> {
  try {
    logger.info('Starting server boot reconciliation...');

    // 1. Reset any stale 'processing' jobs back to 'scheduled'
    const resetResult = await prisma.emailJob.updateMany({
      where: { status: 'processing' },
      data: { status: 'scheduled' },
    });

    if (resetResult.count > 0) {
      logger.warn({ count: resetResult.count }, 'Reset stale processing jobs back to scheduled');
    }

    // 2. Fetch all 'scheduled' jobs
    const scheduledJobs = await prisma.emailJob.findMany({
      where: { status: 'scheduled' },
      include: { sender: true },
    });

    logger.info({ totalScheduledInDB: scheduledJobs.length }, 'Verifying scheduled jobs in BullMQ queue...');

    let reEnqueuedCount = 0;

    for (const job of scheduledJobs) {
      // (c) Never create a duplicate job if it is already in BullMQ
      const existingJob = await emailQueue.getJob(job.id);

      if (!existingJob) {
        // (b) Re-enqueue missing rows, including overdue ones (scheduledAt in past => delay=0)
        await scheduleEmailInQueue(
          {
            emailJobId: job.id,
            senderId: job.senderId,
            userId: job.userId,
            toEmail: job.toEmail,
            subject: job.subject,
            body: job.body,
            delayBetweenEmailsMs: job.delayBetweenMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS,
            hourlyLimit: job.hourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER,
            batchId: job.batchId,
          },
          job.scheduledAt
        );

        reEnqueuedCount++;
      }
    }

    logger.info(
      {
        verified: scheduledJobs.length,
        reEnqueued: reEnqueuedCount,
      },
      'Queue reconciliation completed'
    );

    // 4. Reindex missing jobs in Elasticsearch
    await reindexMissingEmailsFromDB();
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Error during startup job recovery');
  }
}
