import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData, redisConnection, scheduleEmailInQueue } from '../queues/email.queue.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { sendEmailViaSender } from '../services/email.js';
import { updateEmailJobInES } from '../services/elasticsearch.js';
import { sendRateLimitSlackAlert } from '../services/slack.js';

function getHourWindowKey(senderId: string): string {
  const hourString = new Date().toISOString().slice(0, 13); // e.g. "2026-10-17T11"
  return `ratelimit:sender:${senderId}:${hourString}`;
}

export function createEmailWorker() {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      const { emailJobId, senderId, toEmail, subject, body } = job.data;
      const hourlyLimit = job.data.hourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER;
      const minDelay = job.data.delayBetweenEmailsMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS;

      // 1. Atomic status transition: scheduled -> processing
      // If 0 rows updated, skip immediately. This guarantees a job is NEVER sent twice even under race conditions.
      const updateResult = await prisma.emailJob.updateMany({
        where: {
          id: emailJobId,
          status: 'scheduled',
        },
        data: {
          status: 'processing',
        },
      });

      if (updateResult.count === 0) {
        console.log(
          `⚠️ [Idempotency Guard] Job ${emailJobId} is already processing, sent, or not found. Skipping.`
        );
        return { skipped: true };
      }

      // Fetch the full record with sender details
      const emailRecord = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
        include: { sender: true },
      });

      if (!emailRecord) {
        console.warn(`⚠️ EmailJob ${emailJobId} record missing after transition. Skipping.`);
        return { skipped: true };
      }

      // 2. Check Hourly Rate Limit in Redis
      const rateLimitKey = getHourWindowKey(senderId);
      const currentHourlyCount = parseInt((await redisConnection.get(rateLimitKey)) || '0', 10);

      if (currentHourlyCount >= hourlyLimit) {
        const nextHour = new Date();
        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

        console.warn(
          `🚨 Rate limit hit for sender ${emailRecord.sender.email} (${currentHourlyCount}/${hourlyLimit}). Rescheduling job ${emailJobId} to ${nextHour.toISOString()}`
        );

        // Reset back to scheduled at next hour
        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            scheduledAt: nextHour,
            status: 'scheduled',
          },
        });

        // Trigger real Slack alert
        await sendRateLimitSlackAlert(emailRecord.userId, emailRecord.sender.email, hourlyLimit, nextHour);

        // Re-enqueue in BullMQ for next hour window
        await scheduleEmailInQueue(job.data, nextHour);

        return { rateLimited: true, rescheduledTo: nextHour };
      }

      // 3. Minimum delay throttling between email sends
      const lastSendKey = `sender:last_send:${senderId}`;
      const lastSendTimeStr = await redisConnection.get(lastSendKey);
      if (lastSendTimeStr) {
        const lastSendTime = parseInt(lastSendTimeStr, 10);
        const elapsed = Date.now() - lastSendTime;
        if (elapsed < minDelay) {
          const waitTime = minDelay - elapsed;
          console.log(`⏳ Provider delay: waiting ${waitTime}ms before sending from ${emailRecord.sender.email}`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      // 4. Send email via Nodemailer using Ethereal SMTP
      try {
        const sendResult = await sendEmailViaSender(emailRecord.sender, {
          to: toEmail,
          subject,
          body,
        });

        const now = new Date();

        // Increment Redis rate limit counter
        const newCount = await redisConnection.incr(rateLimitKey);
        if (newCount === 1) {
          await redisConnection.expire(rateLimitKey, 7200);
        }

        // Record last send time
        await redisConnection.set(lastSendKey, Date.now().toString(), 'EX', 3600);

        // Mark sent in DB with sentAt
        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'sent',
            sentAt: now,
            attempts: { increment: 1 },
          },
        });

        // Update Elasticsearch
        await updateEmailJobInES(emailJobId, { status: 'sent', sentAt: now });

        // Print Ethereal preview URLs prominently in the logs as required
        console.log(`\n============================================================`);
        console.log(`🚀 [EMAIL SENT] Job ID: ${emailJobId}`);
        console.log(`   From: ${emailRecord.sender.name} <${emailRecord.sender.email}>`);
        console.log(`   To: ${toEmail}`);
        console.log(`   Subject: "${subject}"`);
        console.log(`   🔗 Ethereal Preview URL: ${sendResult.previewUrl || 'Not available'}`);
        console.log(`============================================================\n`);

        return {
          success: true,
          messageId: sendResult.messageId,
          previewUrl: sendResult.previewUrl,
        };
      } catch (sendErr) {
        const errorMsg = (sendErr as Error).message;
        console.error(`❌ [Failed] Error sending email ${emailJobId}:`, errorMsg);

        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'failed',
            error: errorMsg,
            attempts: { increment: 1 },
          },
        });

        await updateEmailJobInES(emailJobId, { status: 'failed', error: errorMsg });

        throw sendErr;
      }
    },
    {
      connection: redisConnection,
      concurrency: env.WORKER_CONCURRENCY,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed with error:`, err.message);
  });

  return worker;
}
