import { Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { scheduleBulkEmailsInQueue, redisConnection } from '../queues/email.queue.js';
import { bulkIndexEmailJobs, searchEmailsInES } from '../services/elasticsearch.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';

// Zod validation schema for POST /api/schedule
const scheduleRequestSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  emails: z
    .array(z.string().email('Invalid email address format'))
    .min(1, 'At least one recipient email address is required'),
  startTime: z.string().optional(),
  delayBetweenMs: z
    .number()
    .min(0, 'Delay cannot be negative')
    .max(env.MAX_DELAY_ALLOWED_MS, `Delay cannot exceed ${env.MAX_DELAY_ALLOWED_MS} ms`)
    .optional(),
  hourlyLimit: z
    .number()
    .positive('Hourly limit must be greater than zero')
    .max(env.MAX_HOURLY_LIMIT_ALLOWED, `Hourly limit cannot exceed ${env.MAX_HOURLY_LIMIT_ALLOWED}`)
    .optional(),
  senderId: z.string().optional(),
});

interface ScheduleResponseBody {
  success: boolean;
  batchId: string;
  totalScheduled: number;
  jobs: Array<{
    id: string;
    toEmail: string;
    scheduledAt: Date;
    status: string;
  }>;
}

export async function scheduleEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  // 1. Idempotency Check: Support optional Idempotency-Key header stored in Redis for 24h
  const idempotencyKey = (req.header('Idempotency-Key') || req.header('idempotency-key'))?.trim();
  if (idempotencyKey) {
    try {
      const cached = await redisConnection.get(`idempotency:${idempotencyKey}`);
      if (cached) {
        logger.info({ idempotencyKey }, 'Returning cached batch for idempotent request');
        res.status(200).json(JSON.parse(cached));
        return;
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Redis idempotency lookup failed, proceeding');
    }
  }

  // Fallback alias 'to' -> emails
  const requestBody = { ...req.body };
  if (!requestBody.emails && requestBody.to) {
    requestBody.emails = Array.isArray(requestBody.to) ? requestBody.to : [requestBody.to];
  }

  const validationResult = scheduleRequestSchema.safeParse(requestBody);
  if (!validationResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: validationResult.error.flatten().fieldErrors,
    });
    return;
  }

  const { subject, body, emails, startTime, delayBetweenMs, hourlyLimit, senderId } =
    validationResult.data;

  // Fetch senders from Sender table
  let senders = await prisma.sender.findMany({
    orderBy: { createdAt: 'asc' },
  });

  if (senders.length === 0) {
    res.status(400).json({ error: 'No senders found in the Sender table.' });
    return;
  }

  if (senderId) {
    const specificSender = senders.find((s) => s.id === senderId);
    if (specificSender) {
      senders = [specificSender];
    }
  }

  const baseScheduledTime = startTime ? new Date(startTime) : new Date();
  const delayStep = delayBetweenMs !== undefined ? delayBetweenMs : env.MIN_DELAY_BETWEEN_EMAILS_MS;
  const finalHourlyLimit = hourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const batchId = randomUUID();

  // 2. Create Batch record for per-batch settings tracking
  await prisma.batch.create({
    data: {
      id: batchId,
      userId,
      subject,
      body,
      delayBetweenMs: delayStep,
      hourlyLimit: finalHourlyLimit,
      totalCount: emails.length,
    },
  });

  // 3. Prepare bulk arrays for fast execution (1,000+ emails in seconds)
  const emailJobsData: Prisma.EmailJobCreateManyInput[] = [];
  const bulkBullJobs: Array<{
    data: {
      emailJobId: string;
      senderId: string;
      userId: string;
      toEmail: string;
      subject: string;
      body: string;
      delayBetweenEmailsMs: number;
      hourlyLimit: number;
      batchId: string;
    };
    scheduledAt: Date;
  }> = [];
  const bulkEsDocs = [];

  for (let i = 0; i < emails.length; i++) {
    const emailJobId = randomUUID();
    const toEmail = emails[i];
    const assignedSender = senders[i % senders.length];
    const staggeredScheduledAt = new Date(baseScheduledTime.getTime() + i * delayStep);

    emailJobsData.push({
      id: emailJobId,
      userId,
      senderId: assignedSender.id,
      toEmail,
      subject,
      body,
      delayBetweenMs: delayStep,
      hourlyLimit: finalHourlyLimit,
      scheduledAt: staggeredScheduledAt,
      status: 'scheduled',
      batchId,
    });

    bulkBullJobs.push({
      data: {
        emailJobId,
        senderId: assignedSender.id,
        userId,
        toEmail,
        subject,
        body,
        delayBetweenEmailsMs: delayStep,
        hourlyLimit: finalHourlyLimit,
        batchId,
      },
      scheduledAt: staggeredScheduledAt,
    });

    bulkEsDocs.push({
      id: emailJobId,
      userId,
      senderId: assignedSender.id,
      senderEmail: assignedSender.email,
      toEmail,
      subject,
      body,
      status: 'scheduled',
      scheduledAt: staggeredScheduledAt,
    });
  }

  // A. Bulk Database Insert with createMany
  await prisma.emailJob.createMany({
    data: emailJobsData,
  });

  // B. Bulk BullMQ Queue Insert with addBulk
  await scheduleBulkEmailsInQueue(bulkBullJobs);

  // C. Bulk Elasticsearch Index Request (Resilient: failure will not fail scheduling)
  await bulkIndexEmailJobs(bulkEsDocs);

  const responseBody: ScheduleResponseBody = {
    success: true,
    batchId,
    totalScheduled: emailJobsData.length,
    jobs: emailJobsData.map((j) => ({
      id: j.id || '',
      toEmail: j.toEmail,
      scheduledAt: j.scheduledAt as Date,
      status: 'scheduled',
    })),
  };

  // Cache in Redis for 24h if Idempotency-Key header provided
  if (idempotencyKey) {
    try {
      await redisConnection.set(
        `idempotency:${idempotencyKey}`,
        JSON.stringify(responseBody),
        'EX',
        86400
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Failed to cache idempotency response in Redis');
    }
  }

  logger.info({ batchId, totalScheduled: emailJobsData.length, userId }, 'Scheduled email batch successfully');
  res.status(201).json(responseBody);
}

// 2. GET /api/emails/scheduled (Paginated, scoped by userId)
export async function getScheduledEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;

  const whereClause: Prisma.EmailJobWhereInput = {
    userId,
    status: { in: ['scheduled', 'processing'] },
  };

  if (search && search.trim()) {
    whereClause.OR = [
      { toEmail: { contains: search, mode: 'insensitive' } },
      { subject: { contains: search, mode: 'insensitive' } },
      { body: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [total, emails] = await Promise.all([
    prisma.emailJob.count({ where: whereClause }),
    prisma.emailJob.findMany({
      where: whereClause,
      include: { sender: { select: { id: true, name: true, email: true } } },
      orderBy: { scheduledAt: 'asc' },
      skip,
      take: limit,
    }),
  ]);

  res.json({
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    emails,
  });
}

// 3. GET /api/emails/sent (Returns BOTH sent and failed, scoped by userId)
export async function getSentEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;

  const whereClause: Prisma.EmailJobWhereInput = {
    userId,
    status: { in: ['sent', 'failed'] },
  };

  if (search && search.trim()) {
    whereClause.OR = [
      { toEmail: { contains: search, mode: 'insensitive' } },
      { subject: { contains: search, mode: 'insensitive' } },
      { body: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [total, emails] = await Promise.all([
    prisma.emailJob.count({ where: whereClause }),
    prisma.emailJob.findMany({
      where: whereClause,
      include: { sender: { select: { id: true, name: true, email: true } } },
      orderBy: { sentAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  res.json({
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    emails,
  });
}

// 4. GET /api/emails/stats (Scoped by userId)
export async function getEmailStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  const [scheduledCount, sentCount] = await Promise.all([
    prisma.emailJob.count({
      where: {
        userId,
        status: { in: ['scheduled', 'processing'] },
      },
    }),
    prisma.emailJob.count({
      where: {
        userId,
        status: { in: ['sent', 'failed'] },
      },
    }),
  ]);

  res.json({
    scheduled: scheduledCount,
    sent: sentCount,
  });
}

// 5. GET /api/emails/search (Scoped by userId with Elasticsearch & Postgres fallback)
export async function searchEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  const q = (req.query.q as string) || (req.query.search as string) || '';
  const status = req.query.status as string | undefined;
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;

  // 1. Full-text search via Elasticsearch scoped by userId
  const esResult = await searchEmailsInES({
    q,
    status,
    userId,
    from: skip,
    size: limit,
  });

  if (esResult) {
    res.json({
      total: esResult.total,
      page,
      limit,
      totalPages: Math.ceil(esResult.total / limit),
      emails: esResult.emails,
      source: 'elasticsearch',
    });
    return;
  }

  // 2. Database fallback if ES is warming up or unavailable
  const whereClause: Prisma.EmailJobWhereInput = {
    userId,
  };

  if (status) {
    whereClause.status = status as Prisma.EnumJobStatusFilter;
  }

  if (q && q.trim()) {
    whereClause.OR = [
      { toEmail: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
      { body: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [total, emails] = await Promise.all([
    prisma.emailJob.count({ where: whereClause }),
    prisma.emailJob.findMany({
      where: whereClause,
      include: { sender: { select: { id: true, name: true, email: true } } },
      orderBy: { scheduledAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  res.json({
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    emails,
    source: 'postgres',
  });
}

// 6. GET /api/emails/senders
export async function getSenders(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const senders = await prisma.sender.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      host: true,
      port: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json({ senders });
}
