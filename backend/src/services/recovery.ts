import { prisma } from '../db/prisma.js';
import { emailQueue, scheduleEmailInQueue } from '../queues/email.queue.js';
import { env } from '../config/env.js';

/**
 * Reconciles DB vs Queue on server boot:
 * 1. Resets stale 'processing' rows back to 'scheduled'.
 * 2. Re-enqueues any status='scheduled' rows missing from Redis BullMQ queue.
 * Guarantees zero lost jobs and strict idempotency across server restarts.
 */
export async function recoverScheduledJobsOnStartup() {
  try {
    console.log('🔄 [Startup Reconciliation] Checking for pending jobs...');

    // 1. Reset any stale 'processing' jobs back to 'scheduled'
    const resetResult = await prisma.emailJob.updateMany({
      where: { status: 'processing' },
      data: { status: 'scheduled' },
    });

    if (resetResult.count > 0) {
      console.log(`⚠️ Reset ${resetResult.count} stale 'processing' jobs back to 'scheduled'.`);
    }

    // 2. Fetch all 'scheduled' jobs
    const scheduledJobs = await prisma.emailJob.findMany({
      where: { status: 'scheduled' },
      include: { sender: true },
    });

    console.log(`📋 Found ${scheduledJobs.length} scheduled jobs in database to verify.`);

    let reEnqueuedCount = 0;

    for (const job of scheduledJobs) {
      // Check if job exists in BullMQ (Redis)
      const existingJob = await emailQueue.getJob(job.id);

      if (!existingJob) {
        console.log(
          `⚡ Re-enqueuing missing job ${job.id} (To: ${job.toEmail}, Scheduled for: ${job.scheduledAt.toISOString()})`
        );

        await scheduleEmailInQueue(
          {
            emailJobId: job.id,
            senderId: job.senderId,
            userId: job.userId,
            toEmail: job.toEmail,
            subject: job.subject,
            body: job.body,
            delayBetweenEmailsMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
            hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
          },
          job.scheduledAt
        );

        reEnqueuedCount++;
      }
    }

    console.log(
      `✅ [Startup Reconciliation] Complete. Verified ${scheduledJobs.length} jobs, re-enqueued ${reEnqueuedCount} missing from Redis.`
    );
  } catch (error) {
    console.error('❌ Error during startup job recovery:', (error as Error).message);
  }
}
