import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prisma.js';

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
});

export const EMAILS_INDEX = 'emails';

export interface EmailJobDocument {
  id: string;
  userId?: string | null;
  senderId: string;
  senderEmail?: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date | string;
  sentAt?: Date | string | null;
  createdAt?: Date | string;
}

export async function initElasticsearch(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: EMAILS_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: EMAILS_INDEX,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              userId: { type: 'keyword' },
              senderId: { type: 'keyword' },
              senderEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              toEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              subject: { type: 'text', analyzer: 'standard' },
              body: { type: 'text', analyzer: 'standard' },
              status: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              createdAt: { type: 'date' },
            },
          },
        },
      });
      logger.info(`Elasticsearch index "${EMAILS_INDEX}" created.`);
    } else {
      logger.info(`Elasticsearch index "${EMAILS_INDEX}" ready.`);
    }
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Elasticsearch initialization warning (continuing without ES)');
  }
}

export async function indexEmailJob(job: EmailJobDocument): Promise<void> {
  try {
    await esClient.index({
      index: EMAILS_INDEX,
      id: job.id,
      document: {
        id: job.id,
        userId: job.userId || null,
        senderId: job.senderId,
        senderEmail: job.senderEmail || '',
        toEmail: job.toEmail,
        subject: job.subject,
        body: job.body,
        status: job.status,
        scheduledAt: job.scheduledAt,
        sentAt: job.sentAt || null,
        createdAt: job.createdAt || new Date(),
      },
      refresh: true,
    });
  } catch (error) {
    logger.warn({ err: (error as Error).message, id: job.id }, 'Failed to index email to Elasticsearch (resiliently continuing)');
  }
}

export async function bulkIndexEmailJobs(jobs: EmailJobDocument[]): Promise<void> {
  if (jobs.length === 0) return;
  try {
    const operations = jobs.flatMap((job) => [
      { index: { _index: EMAILS_INDEX, _id: job.id } },
      {
        id: job.id,
        userId: job.userId || null,
        senderId: job.senderId,
        senderEmail: job.senderEmail || '',
        toEmail: job.toEmail,
        subject: job.subject,
        body: job.body,
        status: job.status,
        scheduledAt: job.scheduledAt,
        sentAt: job.sentAt || null,
        createdAt: job.createdAt || new Date(),
      },
    ]);

    await esClient.bulk({ operations, refresh: false });
    logger.info({ count: jobs.length }, 'Bulk indexed emails to Elasticsearch');
  } catch (error) {
    logger.warn({ err: (error as Error).message, count: jobs.length }, 'Failed to bulk index emails to Elasticsearch (resiliently continuing)');
  }
}

export async function updateEmailJobInES(
  id: string,
  update: { status?: string; sentAt?: Date | null; error?: string | null; scheduledAt?: Date | string }
): Promise<void> {
  try {
    await esClient.update({
      index: EMAILS_INDEX,
      id,
      doc: update,
      refresh: true,
    });
  } catch (error) {
    logger.warn({ err: (error as Error).message, id }, 'Failed to update email in Elasticsearch (resiliently continuing)');
  }
}

export interface SearchEmailsParams {
  q?: string;
  status?: string;
  userId?: string;
  from?: number;
  size?: number;
}

export interface SearchEmailsResult {
  total: number;
  emails: EmailJobDocument[];
}

export async function searchEmailsInES(params: SearchEmailsParams): Promise<SearchEmailsResult | null> {
  try {
    const must: Record<string, unknown>[] = [];

    // Filter by logged-in user
    if (params.userId) {
      must.push({ term: { userId: params.userId } });
    }

    if (params.status) {
      must.push({ term: { status: params.status } });
    }

    if (params.q && params.q.trim()) {
      must.push({
        multi_match: {
          query: params.q.trim(),
          fields: ['subject', 'body', 'toEmail'],
          fuzziness: 'AUTO',
        },
      });
    }

    const response = await esClient.search<EmailJobDocument>({
      index: EMAILS_INDEX,
      from: params.from || 0,
      size: params.size || 50,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
      sort: [{ scheduledAt: { order: 'desc' } }],
    });

    const total =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value || 0;

    const emails = response.hits.hits
      .map((hit) => hit._source)
      .filter((doc): doc is EmailJobDocument => doc !== undefined);

    return {
      total,
      emails,
    };
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Elasticsearch search error (falling back to database)');
    return null;
  }
}

/**
 * On server boot, reindexes any EmailJob rows missing from Elasticsearch
 */
export async function reindexMissingEmailsFromDB(): Promise<void> {
  try {
    const allJobs = await prisma.emailJob.findMany({
      include: { sender: { select: { email: true } } },
    });

    if (allJobs.length === 0) return;

    logger.info({ count: allJobs.length }, 'Verifying Elasticsearch index against PostgreSQL jobs...');

    const documentsToSync: EmailJobDocument[] = allJobs.map((job) => ({
      id: job.id,
      userId: job.userId,
      senderId: job.senderId,
      senderEmail: job.sender?.email || '',
      toEmail: job.toEmail,
      subject: job.subject,
      body: job.body,
      status: job.status,
      scheduledAt: job.scheduledAt,
      sentAt: job.sentAt,
      createdAt: job.createdAt,
    }));

    await bulkIndexEmailJobs(documentsToSync);
    logger.info('Elasticsearch index sync completed.');
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Failed to reindex missing emails on boot (continuing without ES)');
  }
}
