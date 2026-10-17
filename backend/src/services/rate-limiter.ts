import { redisConnection } from '../queues/email.queue.js';
import { env } from '../config/env.js';

// Lua script for atomic hourly rate limiting
// Returns 1 if allowed (incremented), 0 if limit exceeded
const RATE_LIMIT_LUA = `
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) >= tonumber(ARGV[1]) then
    return 0
else
    local newVal = redis.call('INCR', KEYS[1])
    if newVal == 1 then
        redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
    end
    return 1
end
`;

export function getHourWindowKey(senderId: string, date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `rl:${senderId}:${yyyy}${mm}${dd}${hh}`;
}

export async function checkAndIncrementRateLimit(
  senderId: string,
  hourlyLimit: number = env.MAX_EMAILS_PER_HOUR_PER_SENDER
): Promise<{ allowed: boolean; hourKey: string }> {
  const hourKey = getHourWindowKey(senderId);
  const expireSeconds = 7200; // 2 hours TTL

  const result = await redisConnection.eval(
    RATE_LIMIT_LUA,
    1,
    hourKey,
    hourlyLimit.toString(),
    expireSeconds.toString()
  );

  return {
    allowed: result === 1,
    hourKey,
  };
}

export async function decrementRateLimit(hourKey: string): Promise<void> {
  try {
    await redisConnection.decr(hourKey);
  } catch (error) {
    console.error(`Failed to decrement rate limit counter on ${hourKey}:`, error);
  }
}
