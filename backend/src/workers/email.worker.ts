import { Worker, Job, DelayedError } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData, redisConnection } from '../queues/email.queue.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { sendEmailViaSender } from '../services/email.js';
import { updateEmailJobInES } from '../services/elasticsearch.js';
import { sendRateLimitSlackAlert } from '../services/slack.js';
import { checkAndIncrementRateLimit, decrementRateLimit } from '../services/rate-limiter.js';
import { logger } from '../utils/logger.js';

export function createEmailWorker() {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>, token?: string) => {
      const { emailJobId, senderId, toEmail, subject, body } = job.data;

      // 1. Atomic status transition: scheduled -> processing
      // If 0 rows updated, another worker picked it up or it was already sent. Skip immediately.
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
        return { skipped: true };
      }

      // Fetch the full record with sender credentials and per-batch settings
      const emailRecord = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
        include: { sender: true },
      });

      if (!emailRecord) {
        logger.warn({ emailJobId }, 'EmailJob record missing in database, skipping');
        return { skipped: true };
      }

      // 2. Use batch settings, falling back to env defaults
      const hourlyLimit =
        job.data.hourlyLimit || emailRecord.hourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER;
      const minDelay =
        job.data.delayBetweenEmailsMs ?? emailRecord.delayBetweenMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS;

      // 3. Atomic Rate Limit Check via Redis Lua Script
      const rateCheck = await checkAndIncrementRateLimit(senderId, hourlyLimit);

      if (!rateCheck.allowed) {
        // Limit exceeded! Calculate start of next hour window + offset based on original scheduledAt
        const now = new Date();
        const nextHour = new Date(now);
        nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);

        // Keep relative offset within the hour window (0 to 3,599,999 ms) to strictly preserve sequence
        const originalTimeMs = new Date(emailRecord.scheduledAt).getTime();
        const offsetMs = Math.abs(originalTimeMs % 3600000);
        const rescheduledTimestamp = nextHour.getTime() + offsetMs;
        const rescheduledDate = new Date(rescheduledTimestamp);

        logger.warn(
          {
            senderEmail: emailRecord.sender.email,
            hourlyLimit,
            hourKey: rateCheck.hourKey,
            emailJobId,
            rescheduledDate: rescheduledDate.toISOString(),
          },
          'Rate limit exceeded for sender, deferring job to next hour window'
        );

        // Reset status to 'scheduled' and update scheduledAt in DB
        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            scheduledAt: rescheduledDate,
            status: 'scheduled',
          },
        });

        // Update Elasticsearch
        await updateEmailJobInES(emailJobId, {
          status: 'scheduled',
          scheduledAt: rescheduledDate,
        });

        // Send Slack alert (deduplicated per sender per hour window via Redis SET NX)
        await sendRateLimitSlackAlert(
          emailRecord.userId,
          emailRecord.sender.email,
          hourlyLimit,
          rescheduledDate,
          rateCheck.hourKey
        );

        // Move job to delayed in BullMQ and throw DelayedError
        await job.moveToDelayed(rescheduledTimestamp, token);
        throw new DelayedError();
      }

      // 4. Minimum delay between individual email sends for this sender
      const lastSendKey = `sender:last_send:${senderId}`;
      const lastSendTimeStr = await redisConnection.get(lastSendKey);
      if (lastSendTimeStr) {
        const lastSendTime = parseInt(lastSendTimeStr, 10);
        const elapsed = Date.now() - lastSendTime;
        if (elapsed < minDelay) {
          const waitTime = minDelay - elapsed;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      // 5. Send email via Nodemailer with Ethereal SMTP
      try {
        const sendResult = await sendEmailViaSender(emailRecord.sender, {
          to: toEmail,
          subject,
          body,
        });

        const now = new Date();

        // Record last send timestamp
        await redisConnection.set(lastSendKey, Date.now().toString(), 'EX', 3600);

        // Mark sent in DB
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

        logger.info(
          {
            emailJobId,
            toEmail,
            sender: emailRecord.sender.email,
            previewUrl: sendResult.previewUrl,
          },
          'Email sent successfully'
        );

        return {
          success: true,
          messageId: sendResult.messageId,
          previewUrl: sendResult.previewUrl,
        };
      } catch (sendErr) {
        // If a send fails before delivery, decrement the counter
        await decrementRateLimit(rateCheck.hourKey);

        const errorMsg = (sendErr as Error).message;
        logger.error({ emailJobId, err: errorMsg }, 'Error sending email');

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
    if (err.name !== 'DelayedError') {
      logger.error({ jobId: job?.id, err: err.message }, 'BullMQ Job execution failed');
    }
  });

  return worker;
}
