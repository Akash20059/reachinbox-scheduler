import { prisma } from './prisma.js';
import { env } from '../config/env.js';

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
        console.log(`✅ Seeded/Updated sender: ${sender.email} (${sender.name})`);
      }
    }
  } catch (error) {
    console.error('❌ Failed to seed senders:', error);
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedSenders()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
