import { Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { scheduleEmailInQueue } from '../queues/email.queue.js';
import { indexEmailJob, searchEmailsInES } from '../services/elasticsearch.js';
import { env } from '../config/env.js';

export async function scheduleEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      senderId,
      to,
      subject,
      body,
      scheduledAt,
      delayBetweenEmailsMs,
      hourlyLimit,
    } = req.body;

    if (!to || (!Array.isArray(to) && typeof to !== 'string')) {
      res.status(400).json({ error: 'Recipient email(s) ("to") is required.' });
      return;
    }

    if (!subject || !body) {
      res.status(400).json({ error: 'Subject and Body are required.' });
      return;
    }

    // Determine sender
    let sender = null;
    if (senderId) {
      sender = await prisma.sender.findUnique({ where: { id: senderId } });
    }
    if (!sender) {
      sender = await prisma.sender.findFirst();
    }
    if (!sender) {
      res.status(400).json({ error: 'No email senders configured in system.' });
      return;
    }

    const recipients = Array.isArray(to) ? to : [to];
    const cleanRecipients = recipients
      .map((r: string) => r.trim())
      .filter((r: string) => r.length > 0 && r.includes('@'));

    if (cleanRecipients.length === 0) {
      res.status(400).json({ error: 'No valid recipient email addresses provided.' });
      return;
    }

    const baseScheduledTime = scheduledAt ? new Date(scheduledAt) : new Date();
    const delayStep = Number(delayBetweenEmailsMs) >= 0 ? Number(delayBetweenEmailsMs) : env.MIN_DELAY_BETWEEN_EMAILS_MS;
    const batchId = randomUUID();
    const createdJobs = [];

    for (let i = 0; i < cleanRecipients.length; i++) {
      const recipient = cleanRecipients[i];
      // Stagger each recipient in the batch by delayStep
      const targetTime = new Date(baseScheduledTime.getTime() + i * delayStep);

      // Create in Postgres
      const emailJob = await prisma.emailJob.create({
        data: {
          userId: req.user?.id || null,
          senderId: sender.id,
          toEmail: recipient,
          subject,
          body,
          scheduledAt: targetTime,
          status: 'scheduled',
          batchId,
        },
        include: { sender: true },
      });

      // Index into Elasticsearch
      await indexEmailJob({
        id: emailJob.id,
        userId: emailJob.userId,
        senderId: emailJob.senderId,
        senderEmail: sender.email,
        toEmail: emailJob.toEmail,
        subject: emailJob.subject,
        body: emailJob.body,
        status: emailJob.status,
        scheduledAt: emailJob.scheduledAt,
      });

      // Enqueue to BullMQ delayed queue
      await scheduleEmailInQueue(
        {
          emailJobId: emailJob.id,
          senderId: sender.id,
          userId: emailJob.userId,
          toEmail: recipient,
          subject,
          body,
          delayBetweenEmailsMs: delayStep,
          hourlyLimit: hourlyLimit ? Number(hourlyLimit) : env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        },
        targetTime
      );

      createdJobs.push(emailJob);
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

export async function getScheduledEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const search = req.query.search as string;

    if (search && search.trim()) {
      // Search via Elasticsearch
      const esResults = await searchEmailsInES({
        query: search,
        status: 'scheduled',
      });

      if (esResults) {
        res.json({
          total: esResults.total,
          emails: esResults.hits,
          source: 'elasticsearch',
        });
        return;
      }
    }

    // Database lookup
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
      }),
    ]);

    res.json({ total, emails, source: 'postgres' });
  } catch (error) {
    console.error('Error fetching scheduled emails:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
}

export async function getSentEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const search = req.query.search as string;

    if (search && search.trim()) {
      const esResults = await searchEmailsInES({
        query: search,
        status: 'sent',
      });

      if (esResults) {
        res.json({
          total: esResults.total,
          emails: esResults.hits,
          source: 'elasticsearch',
        });
        return;
      }
    }

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
      }),
    ]);

    res.json({ total, emails, source: 'postgres' });
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
    });

    res.json({ senders });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch senders' });
  }
}
