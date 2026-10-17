import axios from 'axios';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { redisConnection } from '../queues/email.queue.js';
import { logger } from '../utils/logger.js';

export function getSlackOAuthUrl(userId: string): string {
  const scope = encodeURIComponent('incoming-webhook,chat:write');
  const redirectUri = encodeURIComponent(env.SLACK_REDIRECT_URI);
  return `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=${scope}&redirect_uri=${redirectUri}&state=${userId}`;
}

export async function exchangeSlackCode(code: string, userId: string) {
  try {
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

    logger.info({ userId, teamName, channel }, 'Slack OAuth connected successfully');
    return connection;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Slack OAuth exchange error');
    throw error;
  }
}

/**
 * Sends a real Slack notification on hourly limit hit.
 * Uses Redis SET NX to ensure it fires only once per sender per hour window.
 * Silently catches and logs failures (revoked, expired, or invalid webhook) without crashing.
 */
export async function sendRateLimitSlackAlert(
  userId: string | null | undefined,
  senderEmail: string,
  hourlyLimit: number,
  rescheduledTo: Date,
  hourKey: string
): Promise<void> {
  try {
    // 1. Deduplication Guard: Once per sender per hour window
    const alertDedupeKey = `alert_sent:${senderEmail}:${hourKey}`;
    const acquired = await redisConnection.set(alertDedupeKey, '1', 'EX', 7200, 'NX');

    if (!acquired) {
      return;
    }

    // 2. Fetch connection from DB dynamically
    let webhookUrl: string | null = null;

    if (userId) {
      const userConnection = await prisma.slackConnection.findUnique({
        where: { userId },
      });
      webhookUrl = userConnection?.webhookUrl || null;
    }

    if (!webhookUrl) {
      const anyConnection = await prisma.slackConnection.findFirst();
      webhookUrl = anyConnection?.webhookUrl || null;
    }

    if (!webhookUrl) {
      return;
    }

    const formattedTime = rescheduledTo.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });

    const payload = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Rate Limit Reached - ReachInbox Scheduler',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Sender:* \`${senderEmail}\`\n*Hourly Limit:* \`${hourlyLimit} emails/hr\` reached for window *${hourKey}*.\n\n*Safety Action:* Jobs have been automatically delayed to the next window (*${formattedTime}*) preserving order. Zero emails were lost.`,
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

    logger.info({ senderEmail, status: res.status }, 'Slack rate limit alert dispatched successfully');
  } catch (error) {
    logger.warn({ err: (error as Error).message, senderEmail }, 'Failed to dispatch Slack alert (invalid/revoked webhook caught safely)');
  }
}
