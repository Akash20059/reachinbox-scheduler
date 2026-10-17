import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export async function seedSenders() {
  try {
    const senders = [
      {
        name: env.ETHEREAL_SENDER1_NAME,
        email: env.ETHEREAL_SENDER1_USER,
        user: env.ETHEREAL_SENDER1_USER,
        pass: env.ETHEREAL_SENDER1_PASS,
        host: 'smtp.ethereal.email',
        port: 587,
      },
      {
        name: env.ETHEREAL_SENDER2_NAME,
        email: env.ETHEREAL_SENDER2_USER,
        user: env.ETHEREAL_SENDER2_USER,
        pass: env.ETHEREAL_SENDER2_PASS,
        host: 'smtp.ethereal.email',
        port: 587,
      },
    ];

    for (const sender of senders) {
      if (sender.email) {
        await prisma.sender.upsert({
          where: { email: sender.email },
          update: {
            name: sender.name,
            user: sender.user,
            pass: sender.pass,
          },
          create: {
            name: sender.name,
            email: sender.email,
            user: sender.user,
            pass: sender.pass,
            host: sender.host,
            port: sender.port,
          },
        });
        logger.info(`Seeded/Updated sender: ${sender.email} (${sender.name})`);
      }
    }

    // Seed default demo user
    await prisma.user.upsert({
      where: { email: 'oliver.brown@domain.io' },
      update: { name: 'Oliver Brown' },
      create: {
        email: 'oliver.brown@domain.io',
        name: 'Oliver Brown',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&auto=format&fit=crop&q=80',
      },
    });
    logger.info('Seeded default user: oliver.brown@domain.io');
  } catch (error) {
    logger.error({ error }, 'Failed to seed senders or default user');
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedSenders()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Seed script failed');
      process.exit(1);
    });
}
