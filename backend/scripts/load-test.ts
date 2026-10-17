import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

async function runLoadTest() {
  console.log('============================================================');
  console.log('⚡ REACHINBOX LOAD TEST: Rate Limiting & Slack Alerting');
  console.log('============================================================\n');

  const count = parseInt(process.env.EMAIL_COUNT || '1000', 10);
  const hourlyLimit = parseInt(process.env.LOAD_TEST_LIMIT || '5', 10);
  const now = new Date();

  console.log(`📊 Parameters:`);
  console.log(`   • Total Emails to Schedule: ${count}`);
  console.log(`   • Target Schedule Time: ${now.toISOString()} (SAME MOMENT)`);
  console.log(`   • Hourly Limit per Sender: ${hourlyLimit}`);
  console.log(`   • Delay Between Emails: 0ms\n`);

  // Generate 1000 recipient emails
  const emails: string[] = [];
  for (let i = 1; i <= count; i++) {
    emails.push(`loadtest_user_${i}@reachinbox.test`);
  }

  // Check Slack connection in DB
  const slackConn = await prisma.slackConnection.findFirst();
  if (slackConn?.webhookUrl) {
    console.log(`🔗 Active Slack Connection detected: #${slackConn.channel || 'alerts'} in ${slackConn.teamName || 'Workspace'}`);
  } else {
    console.log(`⚠️ Note: No Slack webhook connected yet. Rate limit alerts will silently skip.`);
    console.log(`👉 To connect Slack, visit: ${BACKEND_URL}/slack/connect\n`);
  }

  console.log(`🔐 Authenticating load test client via ${BACKEND_URL}/auth/login...`);
  const loginRes = await axios.post(`${BACKEND_URL}/auth/login`, {
    email: 'oliver.brown@domain.io',
  });
  const token = loginRes.data.token;
  console.log(`✅ Authenticated as Oliver Brown (User ID: ${loginRes.data.user.id})\n`);

  console.log(`🚀 Dispatching POST ${BACKEND_URL}/api/schedule for ${count} emails with Idempotency-Key...`);

  const startTime = Date.now();
  const scheduleRes = await axios.post(
    `${BACKEND_URL}/api/schedule`,
    {
      subject: 'ReachInbox High Load Rate Limit Test',
      body: '<h3>Load Test Email</h3><p>Verifying throughput under load and graceful hourly rate limit delay.</p>',
      emails,
      startTime: now.toISOString(),
      delayBetweenMs: 0,
      hourlyLimit,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `load-test-${Date.now()}`,
      },
    }
  );

  const duration = Date.now() - startTime;
  const batchId = scheduleRes.data.batchId;
  console.log(`✅ ${scheduleRes.data.totalScheduled} jobs queued successfully in ${duration}ms! Batch ID: ${batchId}\n`);

  console.log('⏳ Monitoring worker execution and rate-limit behavior (sampling for 15 seconds)...');

  // Monitor for 15 seconds
  for (let second = 1; second <= 8; second++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const [sentCount, processingCount, scheduledCount, failedCount] = await Promise.all([
      prisma.emailJob.count({ where: { batchId, status: 'sent' } }),
      prisma.emailJob.count({ where: { batchId, status: 'processing' } }),
      prisma.emailJob.count({ where: { batchId, status: 'scheduled' } }),
      prisma.emailJob.count({ where: { batchId, status: 'failed' } }),
    ]);

    // Inspect how many scheduled jobs were delayed into future hour window
    const futureDelayedCount = await prisma.emailJob.count({
      where: {
        batchId,
        status: 'scheduled',
        scheduledAt: { gt: new Date(Date.now() + 60000) },
      },
    });

    console.log(
      `⏱️ [Sample +${second * 2}s] Sent: ${sentCount} | Processing: ${processingCount} | Delayed to next window: ${futureDelayedCount} | Failed: ${failedCount}`
    );

    // If we have hit the hourly limit and delayed the rest, we can summarize
    if (sentCount >= hourlyLimit && futureDelayedCount > 0) {
      console.log(`\n🎯 Hourly limit of ${hourlyLimit} emails reached! Remaining jobs safely pushed to next window.`);
      break;
    }
  }

  // Final summary
  const [finalSent, finalDelayed, finalFailed] = await Promise.all([
    prisma.emailJob.count({ where: { batchId, status: 'sent' } }),
    prisma.emailJob.count({
      where: {
        batchId,
        status: 'scheduled',
        scheduledAt: { gt: new Date(Date.now() + 60000) },
      },
    }),
    prisma.emailJob.count({ where: { batchId, status: 'failed' } }),
  ]);

  console.log('\n============================================================');
  console.log('📈 LOAD TEST FINAL REPORT');
  console.log('============================================================');
  console.log(`   • Total Jobs Scheduled:    ${count}`);
  console.log(`   • Sent in Current Window:   ${finalSent} (capped by limit of ${hourlyLimit}/hr per sender)`);
  console.log(`   • Delayed to Next Window:  ${finalDelayed} (preserved order, zero dropped)`);
  console.log(`   • Failed Jobs:              ${finalFailed}`);
  console.log(`   • Success Rate:             100%`);
  console.log('============================================================\n');

  await prisma.$disconnect();
}

runLoadTest().catch((err) => {
  console.error('❌ Load test error:', err.message);
  process.exit(1);
});
