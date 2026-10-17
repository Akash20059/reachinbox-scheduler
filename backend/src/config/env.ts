import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from backend folder or root
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  WORKER_CONCURRENCY: z.coerce.number().default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().default(200),
  MAX_HOURLY_LIMIT_ALLOWED: z.coerce.number().default(5000),
  MAX_DELAY_ALLOWED_MS: z.coerce.number().default(3600000),

  BULL_BOARD_USER: z.string().default('admin'),
  BULL_BOARD_PASS: z.string().default('admin123'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/auth/google/callback'),
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/slack/callback'),
  SLACK_SIGNING_SECRET: z.string().default(''),
  JWT_SECRET: z.string().default('reachinbox_super_secret_jwt_key_2026'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  BACKEND_URL: z.string().default('http://localhost:4000'),

  ETHEREAL_SENDER1_NAME: z.string().default('Evelyn Wolf'),
  ETHEREAL_SENDER1_USER: z.string().default(''),
  ETHEREAL_SENDER1_PASS: z.string().default(''),
  ETHEREAL_SENDER2_NAME: z.string().default('Johnathon Deckow'),
  ETHEREAL_SENDER2_USER: z.string().default(''),
  ETHEREAL_SENDER2_PASS: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  process.stderr.write(`Invalid environment variables: ${JSON.stringify(parsed.error.format())}\n`);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
