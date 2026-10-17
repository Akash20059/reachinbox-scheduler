import axios from 'axios';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

export function getSlackOAuthUrl(userId: string): string {
  const scope = encodeURIComponent('incoming-webhook,chat:write');
  const redirectUri = encodeURIComponent(env.SLACK_REDIRECT_URI);
  return `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=${scope}&redirect_uri=${redirectUri}&state=${userId}`;
}

export async function exchangeSlackCode(code: string, userId: string) {
  const response = await axios.post(
    'https://slack.com/api/oauth.v2.access',
    null,
    {
      params: {
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: env.SLACK_REDIRECT_URI,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const data = response.data;
  if (!data.ok) {
    throw new Error(`Slack OAuth exchange failed: ${data.error}`);
  }

  const webhookUrl = data.incoming_webhook?.url || null;
  const channel = data.incoming_webhook?.channel || null;
  const teamName = data.team?.name || null;
  const accessToken = data.access_token || null;

  const connection = await prisma.slackConnection.upsert({
    where: { userId },
    update: {
      webhookUrl,
      channel,
      teamName,
      accessToken,
    },
    create: {
      userId,
      webhookUrl,
      channel,
      teamName,
      accessToken,
    },
  });

  return connection;
}

export async function sendRateLimitSlackAlert(
  userId: string | null | undefined,
  senderEmail: string,
  hourlyLimit: number,
  rescheduledTo: Date
) {
  if (!userId) {
    // If job was triggered without specific user, check for any connected Slack workspace
    const anyConnection = await prisma.slackConnection.findFirst();
    if (!anyConnection?.webhookUrl) return;
    return sendWebhookPayload(anyConnection.webhookUrl, senderEmail, hourlyLimit, rescheduledTo);
  }

  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
  });

  if (!connection?.webhookUrl) {
    console.log(`ℹ️ Slack alert skipped: user ${userId} has not connected Slack.`);
    return;
  }

  return sendWebhookPayload(connection.webhookUrl, senderEmail, hourlyLimit, rescheduledTo);
}

async function sendWebhookPayload(
  webhookUrl: string,
  senderEmail: string,
  hourlyLimit: number,
  rescheduledTo: Date
) {
  try {
    const formattedDate = rescheduledTo.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const payload = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ Email Hourly Rate Limit Exceeded',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Sender:* \`${senderEmail}\`\n*Limit:* \`${hourlyLimit} emails / hour\` reached!\n*Action Taken:* Remaining jobs have been *safely rescheduled* to the next available hour window (*${formattedDate}*). No emails were dropped.`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `ReachInbox Scheduler • ${new Date().toISOString()}`,
            },
          ],
        },
      ],
    };

    const res = await axios.post(webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    console.log('✅ Real Slack notification sent successfully:', res.status);
  } catch (err) {
    console.error('❌ Failed to dispatch Slack rate limit alert:', (err as Error).message);
  }
}
