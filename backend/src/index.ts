import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import cookieParser from 'cookie-parser';
import passport from './config/passport.js';

import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { emailQueue, redisConnection } from './queues/email.queue.js';
import { createEmailWorker } from './workers/email.worker.js';
import { initElasticsearch, esClient } from './services/elasticsearch.js';
import { seedSenders } from './db/seed.js';
import { recoverScheduledJobsOnStartup } from './services/recovery.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/error.js';

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
app.use(cookieParser());
app.use(passport.initialize());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// BullMQ Live Dashboard Basic Auth Protection (Requirement 8)
function bullBoardBasicAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    res.status(401).send('Authentication required');
    return;
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username === env.BULL_BOARD_USER && password === env.BULL_BOARD_PASS) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
  res.status(401).send('Invalid credentials');
}

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

app.use('/admin/queues', bullBoardBasicAuth, serverAdapter.getRouter());

// Routes
app.use('/api', emailRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/slack', slackRoutes);

app.use('/auth', authRoutes);
app.use('/emails', emailRoutes);
app.use('/slack', slackRoutes);

// Health Check route
app.get('/health', async (_req: Request, res: Response) => {
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

// Central error-handling middleware (Requirement 10)
app.use(errorHandler);

// Start Server
export async function startServer() {
  try {
    logger.info('Initializing ReachInbox Email Scheduler...');

    // 1. Initialize BullMQ Worker
    createEmailWorker();
    logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'BullMQ Worker started');

    // 2. Start HTTP server
    app.listen(env.PORT, async () => {
      logger.info({ port: env.PORT, dashboard: `http://localhost:${env.PORT}/admin/queues` }, 'Server listening');

      // 3. Connect to Elasticsearch & verify index
      await initElasticsearch();

      // 4. Seed Ethereal SMTP accounts into DB
      await seedSenders();

      // 5. Recover any pending jobs from previous restarts
      await recoverScheduledJobsOnStartup();
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
