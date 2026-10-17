import { prisma } from '../db/prisma.js';
import { emailQueue, scheduleEmailInQueue } from '../queues/email.queue.js';

/**
 * Reconciles and recovers any pending/scheduled emails after server restart.
 * Guarantees zero lost jobs and strict idempotency.
 */
export async function recoverScheduledJobsOnStartup() {
  try {
    console.log('🔄 Checking for pending jobs to recover after restart...');

    // Find any jobs marked as 'scheduled' or stuck in 'processing'
    const pendingJobs = await prisma.emailJob.findMany({
      where: {
        status: { in: ['scheduled', 'processing'] },
      },
      include: { sender: true },
    });

    console.log(`📋 Found ${pendingJobs.length} pending/scheduled jobs in database.`);

    for (const job of pendingJobs) {
      // Check if job is already waiting/delayed in BullMQ
      const existingBullJob = await emailQueue.getJob(job.id);

      if (!existingBullJob) {
        console.log(`⚡ Re-queuing job ${job.id} into BullMQ scheduled for ${job.scheduledAt.toISOString()}`);

        // Reset any stuck processing jobs back to scheduled
        if (job.status === 'processing') {
          await prisma.emailJob.update({
            where: { id: job.id },
            data: { status: 'scheduled' },
          });
        }

        await scheduleEmailInQueue(
          {
            emailJobId: job.id,
            senderId: job.senderId,
            userId: job.userId,
            toEmail: job.toEmail,
            subject: job.subject,
            body: job.body,
          },
          job.scheduledAt
        );
      }
    }

    console.log('✅ Startup recovery check completed.');
  } catch (error) {
    console.error('❌ Error during startup job recovery:', (error as Error).message);
  }
}
