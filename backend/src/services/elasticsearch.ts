import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
});

export const EMAILS_INDEX = 'reachinbox_emails';

export async function initElasticsearch() {
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
      console.log(`✅ Elasticsearch index "${EMAILS_INDEX}" created.`);
    } else {
      console.log(`✅ Elasticsearch index "${EMAILS_INDEX}" ready.`);
    }
  } catch (error) {
    console.warn('⚠️ Elasticsearch initialization warning (will retry on operations):', (error as Error).message);
  }
}

export async function indexEmailJob(job: {
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
}) {
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
    console.error(`❌ Failed to index email ${job.id} to Elasticsearch:`, (error as Error).message);
  }
}

export async function updateEmailJobInES(
  id: string,
  update: { status?: string; sentAt?: Date | null; error?: string | null }
) {
  try {
    await esClient.update({
      index: EMAILS_INDEX,
      id,
      doc: update,
      refresh: true,
    });
  } catch (error) {
    console.error(`❌ Failed to update email ${id} in Elasticsearch:`, (error as Error).message);
  }
}

export async function searchEmailsInES(params: {
  query?: string;
  status?: string;
  userId?: string;
  from?: number;
  size?: number;
}) {
  try {
    const must: any[] = [];

    if (params.status) {
      must.push({ term: { status: params.status } });
    }

    if (params.userId) {
      must.push({ term: { userId: params.userId } });
    }

    if (params.query && params.query.trim()) {
      must.push({
        multi_match: {
          query: params.query.trim(),
          fields: ['toEmail^3', 'subject^2', 'body', 'senderEmail'],
          fuzziness: 'AUTO',
        },
      });
    }

    const response = await esClient.search({
      index: EMAILS_INDEX,
      from: params.from || 0,
      size: params.size || 50,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
      sort: [{ scheduledAt: { order: 'desc' } }],
    });

    return {
      total: typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0,
      hits: response.hits.hits.map((hit) => hit._source),
    };
  } catch (error) {
    console.error('❌ Elasticsearch search error:', (error as Error).message);
    return null; // fallback to DB if ES search fails
  }
}
