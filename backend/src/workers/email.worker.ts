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

      // 1. Fetch current job and sender from database
      const emailRecord = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
        include: { sender: true },
      });

      if (!emailRecord) {
        console.warn(`⚠️ EmailJob ${emailJobId} not found in database. Skipping.`);
        return;
      }

      // 2. Strict Idempotency check: Do not re-send already sent emails
      if (emailRecord.status === 'sent') {
        console.log(`ℹ️ EmailJob ${emailJobId} has already been sent. Skipping.`);
        return;
      }

      // 3. Hourly Rate Limit Check via Redis counter
      const rateLimitKey = getHourWindowKey(senderId);
      const currentHourlyCount = parseInt((await redisConnection.get(rateLimitKey)) || '0', 10);

      if (currentHourlyCount >= hourlyLimit) {
        // Calculate the start of the next hour window
        const nextHour = new Date();
        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

        console.warn(
          `🚨 Rate limit hit for sender ${emailRecord.sender.email} (${currentHourlyCount}/${hourlyLimit}). Rescheduling job ${emailJobId} to ${nextHour.toISOString()}`
        );

        // Update database with rescheduled time
        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            scheduledAt: nextHour,
            status: 'scheduled',
          },
        });

        // Trigger real Slack alert to the user's Slack channel
        await sendRateLimitSlackAlert(emailRecord.userId, emailRecord.sender.email, hourlyLimit, nextHour);

        // Reschedule in BullMQ for next hour window
        await scheduleEmailInQueue(job.data, nextHour);

        return { rateLimited: true, rescheduledTo: nextHour };
      }

      // 4. Enforce minimum delay between emails for the sender
      const lastSendKey = `sender:last_send:${senderId}`;
      const lastSendTimeStr = await redisConnection.get(lastSendKey);
      if (lastSendTimeStr) {
        const lastSendTime = parseInt(lastSendTimeStr, 10);
        const elapsed = Date.now() - lastSendTime;
        if (elapsed < minDelay) {
          const waitTime = minDelay - elapsed;
          console.log(`⏳ Throttling: waiting ${waitTime}ms before sending from ${emailRecord.sender.email}`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      // 5. Mark status as processing in DB
      await prisma.emailJob.update({
        where: { id: emailJobId },
        data: { status: 'processing' },
      });
      await updateEmailJobInES(emailJobId, { status: 'processing' });

      // 6. Send the actual email via Ethereal SMTP
      try {
        const sendResult = await sendEmailViaSender(emailRecord.sender, {
          to: toEmail,
          subject,
          body,
        });

        const now = new Date();

        // Increment Redis hourly counter with 2 hours TTL
        const newCount = await redisConnection.incr(rateLimitKey);
        if (newCount === 1) {
          await redisConnection.expire(rateLimitKey, 7200);
        }

        // Update last send timestamp
        await redisConnection.set(lastSendKey, Date.now().toString(), 'EX', 3600);

        // Mark as sent in DB
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

        console.log(`✅ [Sent] Email ${emailJobId} to ${toEmail} | Ethereal Preview: ${sendResult.previewUrl || 'N/A'}`);

        return { success: true, messageId: sendResult.messageId, previewUrl: sendResult.previewUrl };
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

        throw sendErr; // BullMQ will retry according to backoff settings
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

  worker.on('completed', (job) => {
    console.log(`🎉 Job ${job?.id} completed successfully`);
  });

  return worker;
}
