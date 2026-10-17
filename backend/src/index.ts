import express, { Request, Response } from 'express';
import cors from 'cors';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { emailQueue, redisConnection } from './queues/email.queue.js';
import { createEmailWorker } from './workers/email.worker.js';
import { initElasticsearch, esClient } from './services/elasticsearch.js';
import { seedSenders } from './db/seed.js';
import { recoverScheduledJobsOnStartup } from './services/recovery.js';

import authRoutes from './routes/auth.routes.js';
import emailRoutes from './routes/email.routes.js';
import slackRoutes from './routes/slack.routes.js';

const app = express();

// Middleware
app.use(
  cors({
    origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// BullMQ Live Dashboard setup
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// Routes (supporting both /api/... and top-level endpoints)
app.use('/api', emailRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/slack', slackRoutes);

app.use('/auth', authRoutes);
app.use('/emails', emailRoutes);
app.use('/slack', slackRoutes);

// Health Check route
app.get('/health', async (req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let esStatus = 'disconnected';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'healthy';
  } catch (e) {
    dbStatus = `unhealthy: ${(e as Error).message}`;
  }

  try {
    const pong = await redisConnection.ping();
    if (pong === 'PONG') redisStatus = 'healthy';
  } catch (e) {
    redisStatus = `unhealthy: ${(e as Error).message}`;
  }

  try {
    const esHealth = await esClient.cluster.health();
    esStatus = esHealth.status || 'healthy';
  } catch (e) {
    esStatus = `warning: ${(e as Error).message}`;
  }

  const isHealthy = dbStatus === 'healthy' && redisStatus === 'healthy';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      postgres: dbStatus,
      redis: redisStatus,
      elasticsearch: esStatus,
    },
    bullBoardUrl: `http://localhost:${env.PORT}/admin/queues`,
  });
});

// Start Server
async function startServer() {
  try {
    console.log('🚀 Initializing ReachInbox Email Scheduler...');

    // 1. Initialize BullMQ Worker
    createEmailWorker();
    console.log(`✅ BullMQ Worker started with concurrency: ${env.WORKER_CONCURRENCY}`);

    // 2. Start HTTP server
    app.listen(env.PORT, async () => {
      console.log(`🌐 Server listening at http://localhost:${env.PORT}`);
      console.log(`📊 BullMQ Dashboard: http://localhost:${env.PORT}/admin/queues`);
      console.log(`🩺 Health check: http://localhost:${env.PORT}/health`);

      // 3. Connect to Elasticsearch & create index
      await initElasticsearch();

      // 4. Seed Ethereal SMTP accounts into DB
      await seedSenders();

      // 5. Recover any pending jobs from previous restarts
      await recoverScheduledJobsOnStartup();
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
