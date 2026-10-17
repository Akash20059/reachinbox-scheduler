import { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { scheduleEmailInQueue } from '../queues/email.queue.js';
import { indexEmailJob, searchEmailsInES } from '../services/elasticsearch.js';
import { env } from '../config/env.js';

// 1. Zod validation schema for POST /api/schedule
const scheduleRequestSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  emails: z
    .array(z.string().email('Invalid email address format'))
    .min(1, 'At least one recipient email address is required'),
  startTime: z
    .string()
    .datetime({ offset: true })
    .or(z.string())
    .optional(),
  delayBetweenMs: z.number().min(0).optional(),
  hourlyLimit: z.number().positive().optional(),
  senderId: z.string().optional(),
});

export async function scheduleEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    // Also accept 'to' as fallback alias for emails
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

    // If specific senderId requested, filter or prioritize
    if (senderId) {
      const specificSender = senders.find((s) => s.id === senderId);
      if (specificSender) {
        senders = [specificSender];
      }
    }

    const baseScheduledTime = startTime ? new Date(startTime) : new Date();
    const delayStep =
      delayBetweenMs !== undefined ? delayBetweenMs : env.MIN_DELAY_BETWEEN_EMAILS_MS;
    const batchId = randomUUID();
    const createdJobs = [];

    // Assign senders round-robin and stagger scheduledAt
    for (let i = 0; i < emails.length; i++) {
      const toEmail = emails[i];
      const assignedSender = senders[i % senders.length]; // Round-robin sender assignment
      const staggeredScheduledAt = new Date(baseScheduledTime.getTime() + i * delayStep);

      // 1. Insert EmailJob row (status = scheduled)
      const emailJob = await prisma.emailJob.create({
        data: {
          userId: req.user?.id || null,
          senderId: assignedSender.id,
          toEmail,
          subject,
          body,
          scheduledAt: staggeredScheduledAt,
          status: 'scheduled',
          batchId,
        },
        include: { sender: true },
      });

      // 2. Add BullMQ delayed job with jobId = EmailJob.id (Guarantees strict idempotency)
      await scheduleEmailInQueue(
        {
          emailJobId: emailJob.id,
          senderId: assignedSender.id,
          userId: emailJob.userId,
          toEmail,
          subject,
          body,
          delayBetweenEmailsMs: delayStep,
          hourlyLimit: hourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        },
        staggeredScheduledAt
      );

      // 3. Index to Elasticsearch
      await indexEmailJob({
        id: emailJob.id,
        userId: emailJob.userId,
        senderId: emailJob.senderId,
        senderEmail: assignedSender.email,
        toEmail: emailJob.toEmail,
        subject: emailJob.subject,
        body: emailJob.body,
        status: emailJob.status,
        scheduledAt: emailJob.scheduledAt,
      });

      createdJobs.push({
        id: emailJob.id,
        toEmail: emailJob.toEmail,
        senderEmail: assignedSender.email,
        scheduledAt: emailJob.scheduledAt,
        status: emailJob.status,
      });
    }

    res.status(201).json({
      success: true,
      batchId,
      totalScheduled: createdJobs.length,
      jobs: createdJobs,
    });
  } catch (error) {
    console.error('Error scheduling emails:', error);
    res.status(500).json({ error: 'Failed to schedule emails' });
  }
}

// 2. GET /api/emails/scheduled (Paginated)
export async function getScheduledEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const whereClause: any = {
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
  } catch (error) {
    console.error('Error fetching scheduled emails:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
}

// 2. GET /api/emails/sent (Paginated)
export async function getSentEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const whereClause: any = {
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
  } catch (error) {
    console.error('Error fetching sent emails:', error);
    res.status(500).json({ error: 'Failed to fetch sent emails' });
  }
}

export async function getEmailStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const [scheduledCount, sentCount] = await Promise.all([
      prisma.emailJob.count({ where: { status: { in: ['scheduled', 'processing'] } } }),
      prisma.emailJob.count({ where: { status: 'sent' } }),
    ]);

    res.json({
      scheduled: scheduledCount,
      sent: sentCount,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch email statistics' });
  }
}

export async function getSenders(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch senders' });
  }
}
