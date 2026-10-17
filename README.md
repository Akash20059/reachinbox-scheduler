# ReachInbox — Distributed Email Job Scheduler & Dashboard

A production-grade, distributed email job scheduler built with **TypeScript**, **Express.js**, **BullMQ**, **Redis (AOF persistence)**, **PostgreSQL (Prisma ORM)**, **Elasticsearch**, and a **React + Vite** frontend matching Figma pixel-for-pixel.

---

## 📑 Table of Contents
1. [Key Highlights & Architecture](#-key-highlights--architecture)
2. [Prerequisites & Environment Variables](#-prerequisites--environment-variables)
3. [Setup & Running Locally](#-setup--running-locally)
   - [Docker Compose](#1-start-infrastructure-via-docker-compose)
   - [Ethereal SMTP Accounts Setup](#2-ethereal-smtp-setup)
   - [Starting Backend & Frontend](#3-start-backend--frontend)
4. [Deep-Dive Architecture](#-deep-dive-architecture)
   - [Scheduling & Staggering (Zero Cron Jobs)](#pure-bullmq-scheduling--jobid-idempotency)
   - [Restart Persistence & Crash Durability](#restart-persistence-redis-aof--boot-reconciliation)
   - [Atomic Redis Lua Rate Limiting & Order Preservation](#atomic-redis-lua-rate-limiting--order-preservation)
   - [Bulk Performance (1,000+ Emails in Seconds)](#bulk-performance-1000-emails-in-seconds)
   - [Idempotency-Key Header Support](#idempotency-key-http-header-support)
   - [Elasticsearch Resilience & Boot Sync](#elasticsearch-resilience--boot-synchronization)
   - [Bull-Board Basic Auth Protection](#bull-board-queue-monitor-with-basic-auth)
   - [Strict Auth Scoping](#strict-user-auth-scoping)
5. [Feature Checklist (Backend & Frontend Mapped)](#-feature-checklist)
6. [Assumptions, Shortcuts & Trade-offs](#-assumptions-shortcuts--trade-offs)
7. [5-Minute Demo Script (Video Guide)](#-5-minute-demo-script-video-walkthrough)

---

## 🚀 Key Highlights & Architecture

- **Zero Cron Jobs:** Strictly no cron timers or cron libraries (`node-cron`, `cron`, etc.). All scheduling, staggered spacing, and delays are powered exclusively by BullMQ delayed queues with millisecond accuracy.
- **Strict Idempotency (`jobId = EmailJob.id`):** Every queued email job uses its PostgreSQL UUID as the BullMQ `jobId`. Atomic database status transitions (`scheduled` ➔ `processing` ➔ `sent` / `failed`) ensure no job can ever be sent twice.
- **Restart Persistence & Durability:**
  - Redis runs with `--appendonly yes` so delayed queue state persists across process kills and reboots.
  - On server boot, startup reconciliation automatically checks database vs queue, resets stale `processing` jobs, re-enqueues missing/overdue `scheduled` jobs with 0ms delay, and avoids duplicate queue items.
- **Multi-Worker Per-Sender Hourly Rate Limiting:**
  - Evaluated via an atomic Redis Lua script against `rl:{senderId}:{YYYYMMDDHH}` with 2h TTL.
  - When a sender reaches the hourly threshold, jobs are **not dropped or marked as failed**. Instead, they are deferred to the next hour window (`job.moveToDelayed` + `DelayedError`) preserving their relative scheduling order.
  - If a network or SMTP failure occurs before delivery, the Lua script atomically decrements the counter.
- **Bulk Scaling (1,000+ Emails in Seconds):**
  - Database writes use `prisma.emailJob.createMany`.
  - Queue additions use `emailQueue.addBulk` in a single Redis roundtrip.
  - Elasticsearch indexing uses high-throughput `_bulk` requests.
- **Resilience to Downstream Outages:**
  - If Elasticsearch is offline, scheduling, workers, and fallback database queries continue uninterrupted. Missing documents are synchronized on boot.
  - If a Slack incoming webhook is revoked or invalid, errors are caught and logged without affecting email dispatch.
- **Figma Pixel-Perfect UI:**
  - Clean sidebar with real-time badges, debounced search above tables querying Elasticsearch, 10-second automatic polling, client-side CSV parsing with detected email badges, and distinct visual badges for `Sent` and `Failed` statuses.

---

## 📋 Prerequisites & Environment Variables

### Prerequisites
- **Node.js** v18+ & **npm**
- **Docker** & **Docker Compose**
- **Google Cloud OAuth 2.0 Credentials** (Client ID & Client Secret)
- **Slack App** (Client ID & Client Secret with `incoming-webhook` scope)
- **Ethereal Email Accounts** (Free fake SMTP service for testing)

---

### Environment Variables Breakdown

Copy `.env.example` to `backend/.env` (and root `.env`):

| Variable | Description | Example / Default Value |
| :--- | :--- | :--- |
| `PORT` | Backend server HTTP port | `4000` |
| `NODE_ENV` | Environment mode (`development` / `production`) | `development` |
| `FRONTEND_URL` | Frontend origin for CORS and OAuth redirects | `http://localhost:5173` |
| `BACKEND_URL` | Backend base URL | `http://localhost:4000` |
| `JWT_SECRET` | Secret key for signing httpOnly JWT session cookies | `reachinbox_super_secret_jwt_key_2026` |
| `DATABASE_URL` | PostgreSQL connection string with schema | `postgresql://reachinbox:reachinbox123@localhost:5432/reachinbox_scheduler?schema=public` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `ELASTICSEARCH_URL`| Elasticsearch node endpoint | `http://localhost:9200` |
| `WORKER_CONCURRENCY`| Number of parallel email jobs processed per worker | `5` |
| `MIN_DELAY_BETWEEN_EMAILS_MS`| Minimum provider delay spacing between emails from same sender | `2000` (2 seconds) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER`| Default per-sender hourly rate limit | `200` |
| `MAX_HOURLY_LIMIT_ALLOWED`| Upper safety ceiling accepted from batch requests | `5000` |
| `MAX_DELAY_ALLOWED_MS`| Upper delay ceiling accepted from batch requests | `3600000` (1 hour) |
| `BULL_BOARD_USER` | HTTP Basic Auth username for `/admin/queues` | `admin` |
| `BULL_BOARD_PASS` | HTTP Basic Auth password for `/admin/queues` | `admin123` |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth Client ID | `your_google_client_id` |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth Client Secret | `your_google_client_secret` |
| `GOOGLE_CALLBACK_URL` | Redirect URI registered in Google Console | `http://localhost:4000/auth/google/callback` |
| `SLACK_CLIENT_ID` | Slack App Client ID | `your_slack_client_id` |
| `SLACK_CLIENT_SECRET`| Slack App Client Secret | `your_slack_client_secret` |
| `SLACK_REDIRECT_URI` | Redirect URI registered in Slack App settings | `http://localhost:4000/slack/callback` |
| `SLACK_SIGNING_SECRET`| Slack signing secret | `your_slack_signing_secret` |
| `ETHEREAL_SENDER1_NAME` | Display name for Sender 1 | `"Evelyn Wolf"` |
| `ETHEREAL_SENDER1_USER` | Ethereal SMTP username / email for Sender 1 | `evelyn.wolf97@ethereal.email` |
| `ETHEREAL_SENDER1_PASS` | Ethereal SMTP password for Sender 1 | `your_ethereal_pass1` |
| `ETHEREAL_SENDER2_NAME` | Display name for Sender 2 | `"Johnathon Deckow"` |
| `ETHEREAL_SENDER2_USER` | Ethereal SMTP username / email for Sender 2 | `f2ktta4r34eybrlv@ethereal.email` |
| `ETHEREAL_SENDER2_PASS` | Ethereal SMTP password for Sender 2 | `your_ethereal_pass2` |

---

## ⚡ Setup & Running Locally

### 1. Start Infrastructure via Docker Compose
From the repository root, start PostgreSQL, Redis (with AOF enabled), and Elasticsearch:
```bash
docker compose up -d
```
Verify all 3 containers are healthy:
```bash
docker compose ps
```

### 2. Ethereal SMTP Setup
1. Visit [https://ethereal.email/create](https://ethereal.email/create) in your browser.
2. Note the generated Email address and Password.
3. Repeat once more to create a second sender account.
4. Paste these credentials into `ETHEREAL_SENDER1_USER`, `ETHEREAL_SENDER1_PASS`, `ETHEREAL_SENDER2_USER`, and `ETHEREAL_SENDER2_PASS` in `backend/.env`.

### 3. Start Backend & Frontend

#### Option A: Start Everything with Root npm Script (Recommended)
From the repository root:
```bash
npm install
npm run dev
```
*This uses `concurrently` to launch both the backend server (on port `4000`) and the Vite frontend (on port `5173`).*

#### Option B: Run Individually
**Backend:**
```bash
cd backend
npm install
npx prisma db push
npm run dev
```
**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 🏛️ Deep-Dive Architecture

### Pure BullMQ Scheduling & JobId Idempotency
- When an email batch is scheduled via `POST /api/schedule`, the server calculates the exact dispatch time for each recipient by applying staggering (`startTime + index * delayBetweenMs`).
- A job is submitted to BullMQ via `emailQueue.addBulk` with:
  ```ts
  {
    delay: Math.max(0, scheduledAt.getTime() - Date.now()),
    jobId: emailJob.id // Guarantees BullMQ will reject duplicate IDs
  }
  ```
- Before a worker sends an email, it executes an atomic conditional update:
  ```ts
  const updateResult = await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: 'scheduled' },
    data: { status: 'processing' },
  });
  if (updateResult.count === 0) return { skipped: true };
  ```
  If another worker picked up the job or it was already processed, it is skipped immediately.

### Restart Persistence: Redis AOF + Boot Reconciliation
- **Redis AOF:** The Redis container runs with `--appendonly yes` (configured in `docker-compose.yml`), appending write commands to disk. If Redis restarts, all delayed queue zsets are intact.
- **Boot Reconciliation (`recoverScheduledJobsOnStartup`):**
  When the backend process boots:
  1. Any jobs left in `status = 'processing'` (due to an abrupt server crash mid-execution) are atomically reset back to `'scheduled'`.
  2. All `'scheduled'` jobs in PostgreSQL are checked against BullMQ via `emailQueue.getJob(job.id)`.
  3. Any jobs missing from Redis (including overdue ones where `scheduledAt <= now`) are re-enqueued with `delay = 0` for immediate dispatch.
  4. If a job is already in the queue, it is skipped to guarantee no duplicates are created.

### Atomic Redis Lua Rate Limiting & Order Preservation
- To prevent race conditions across concurrent workers, rate limits are checked and updated atomically in Redis via Lua:
  ```lua
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
  ```
- **Safe Decrement on Failure:** If an email send fails due to network or SMTP errors before delivery, a companion Lua script decrements the counter without dropping below zero.
- **Order Preservation:** When a sender exceeds their hourly limit, the job is deferred to the start of the next hour window (`nextHour`) plus an offset:
  ```ts
  const offsetMs = Math.abs(originalTimeMs % 3600000);
  const rescheduledTimestamp = nextHour.getTime() + offsetMs;
  ```
  Because the offset within the hour is maintained, relative sequence between jobs in the batch remains preserved.
- The worker invokes `await job.moveToDelayed(rescheduledTimestamp, token)` and throws `new DelayedError()`, signaling BullMQ to delay the job without treating it as a failure.

### Bulk Performance (1,000+ Emails in Seconds)
- Traditional loops issuing individual database, Redis, and Elasticsearch calls take minutes for 1,000 rows.
- ReachInbox solves this via bulk pipelines:
  1. `prisma.emailJob.createMany`: Inserts all 1,000 rows in a single SQL statement.
  2. `emailQueue.addBulk`: Enqueues all 1,000 delayed jobs in a single Redis command.
  3. `bulkIndexEmailJobs`: Dispatches an Elasticsearch `_bulk` operation.
- In load tests, **1,000 emails are validated, inserted into PostgreSQL, queued in BullMQ, and indexed into Elasticsearch in ~3.5 seconds**.

### Idempotency-Key HTTP Header Support
- `POST /api/schedule` supports an optional `Idempotency-Key: <unique-string>` header.
- Upon receiving a request with this header, the server checks Redis (`idempotency:<key>`).
- If previously processed within the last 24 hours, the cached response payload is immediately returned with HTTP 200, preventing duplicate batch creation or double-schedules on client retries.

### Elasticsearch Resilience & Boot Synchronization
- All full-text searches (`/api/emails/search`) leverage Elasticsearch across `subject`, `body`, and `toEmail`.
- If Elasticsearch is offline or restarting:
  - Email scheduling and worker dispatch **never fail** (indexing errors are caught and logged).
  - Search queries automatically fall back to PostgreSQL with case-insensitive `ILIKE` pattern matching.
  - On backend startup, `reindexMissingEmailsFromDB()` synchronizes all PostgreSQL jobs into Elasticsearch.

### Bull-Board Queue Monitor with Basic Auth
- Live visual queue inspection is available at `/admin/queues`.
- Protected via HTTP Basic Auth configured by `BULL_BOARD_USER` and `BULL_BOARD_PASS` (`admin` / `admin123`).

### Strict User Auth Scoping
- Every `/api` endpoint is protected by `authMiddleware`.
- Queries (`/api/emails/scheduled`, `/api/emails/sent`, `/api/emails/stats`, `/api/emails/search`) strictly filter by `userId = req.user.id`.
- Unauthenticated requests return HTTP 401 without an active session cookie.

---

## ✅ Feature Checklist

| Requirement | Implementation Component | Status |
| :--- | :--- | :---: |
| **Zero Cron Jobs** | Pure BullMQ delayed queue architecture (`email.queue.ts`) | ✅ Complete |
| **JobId Idempotency** | `jobId = EmailJob.id` + atomic `scheduled -> processing` transition | ✅ Complete |
| **Per-Batch Settings** | `Batch` table + `delayBetweenMs` & `hourlyLimit` on `EmailJob` | ✅ Complete |
| **Configurable Limits** | `MAX_HOURLY_LIMIT_ALLOWED`, `MAX_DELAY_ALLOWED_MS` in `env.ts` | ✅ Complete |
| **Sent Tab (Sent + Failed)** | `GET /api/emails/sent` returns both; distinct UI badges | ✅ Complete |
| **Bulk Performance** | `createMany` + `addBulk` + ES bulk indexing (1,000 in ~3.5s) | ✅ Complete |
| **Idempotency-Key Header** | 24h Redis cache on `POST /api/schedule` | ✅ Complete |
| **Crash Persistence** | Redis AOF (`--appendonly yes`) + startup reconciliation (`recovery.ts`) | ✅ Complete |
| **Atomic Lua Rate Limit** | Atomic script checking `rl:{senderId}:{YYYYMMDDHH}` with safe decrement | ✅ Complete |
| **Order Preservation** | Relative offset preserved during hourly deferral (`moveToDelayed`) | ✅ Complete |
| **Real Slack OAuth** | `/slack/connect`, `/slack/callback`, `/slack/status`, `/slack/disconnect` | ✅ Complete |
| **Slack Failure Resilience** | Webhook errors logged without crashing email queue | ✅ Complete |
| **Elasticsearch Search** | Debounced search above tables with database fallback | ✅ Complete |
| **Boot ES Sync** | `reindexMissingEmailsFromDB()` on server startup | ✅ Complete |
| **Bull-Board Basic Auth** | `/admin/queues` protected with `BULL_BOARD_USER`/`BULL_BOARD_PASS` | ✅ Complete |
| **Strict Auth Scoping** | All queries scoped by `req.user.id`; 401 on missing session | ✅ Complete |
| **Code Quality** | Zero `any` types, central error middleware (`error.ts`), `pino` logger | ✅ Complete |
| **Client-Side CSV Parser** | PapaParse client-side deduplication, regex validator, detected badge | ✅ Complete |
| **10s Auto-Refresh** | Background polling without UI spinner flash | ✅ Complete |

---

## ⚖️ Assumptions, Shortcuts & Trade-offs

1. **SMTP Provider:** Ethereal Email is used as the fake SMTP service. Ethereal simulates real SMTP authentication and delivery while generating inspection preview URLs.
2. **Elasticsearch Fallback:** For maximum developer ergonomics, Elasticsearch runs as a single node (`discovery.type=single-node`). If Elasticsearch container is stopped, the application gracefully degrades to PostgreSQL search queries.
3. **In-Memory Concurrency Limiter:** Concurrency is bounded per worker instance via `WORKER_CONCURRENCY=5`. For multi-instance worker clusters, Redis Lua rate limiting acts as the global safety ceiling.
4. **JWT in httpOnly Cookie:** Auth tokens are stored in `httpOnly` secure cookies to prevent XSS credential theft.

---

## 🎬 5-Minute Demo Script (Video Walkthrough)

Follow this exact script when recording your 5-minute video demonstration:

### [0:00 - 1:00] 1. Scheduling & Client-Side CSV Parsing
1. **Show the Dashboard:** Open `http://localhost:5173/`. Point out the clean UI matching Figma (Sidebar, Scheduled & Sent tabs, BullMQ Monitor link, Slack Status chip in header).
2. **Open Compose Modal:** Click **“+ Compose”** or **“Compose New Email”**.
3. **Upload CSV:** Click **“Upload CSV/Text”** and select `test-leads.csv`.
   * *Highlight:* Point out that the modal parsed the file client-side, filtered duplicates, validated email syntax, and displayed the green **“3 email addresses detected”** badge with removable chips.
4. **Fill Form:** Enter subject `"Welcome to ReachInbox"`, body text, select a 2-second delay, and click **“Schedule”**.
5. **Observe Toast:** Note the loading state and success toast (*“Successfully scheduled 3 email(s)!”*).

### [1:00 - 1:45] 2. Dashboard, Sent View & Distinct Badges
1. **Scheduled View:** Point out the newly scheduled jobs appearing in the table with yellow clock badges displaying staggered scheduled times.
2. **Watch Delivery:** Wait a few seconds for the worker to process them.
3. **Sent Tab:** Click the **“Sent”** tab.
   * *Highlight:* Show the distinct green **“Sent”** checkmark badge for successful deliveries and point out the red **“Failed”** badge for failed dispatches.
4. **Click an Email Row:** Open the email detail modal to view full metadata, recipient, sender address, and the clickable Ethereal preview URL.

### [1:45 - 2:45] 3. Server Crash & Restart Persistence
1. **Queue Staggered Emails:** In Compose modal, schedule 5 emails with a 10-second delay between them so they sit in the queue.
2. **Kill the Backend:** In your backend terminal, hit `Ctrl+C` to terminate the server mid-queue.
3. **Verify Zero Loss:** Show that Redis AOF kept the delayed queue.
4. **Restart Backend:** Run `npm run dev` in `backend`.
5. **Show Boot Logs:**
   * *Highlight:* Point out the log: `[Startup Reconciliation] Verifying scheduled jobs in BullMQ queue...`.
   * Show that all jobs continue to execute and complete with zero duplicate sends and zero dropped jobs.

### [2:45 - 4:00] 4. Rate-Limiting & Real Slack Alert
1. **Connect Slack:** Click **“Connect Slack”** in the top header. Complete the OAuth authorization to link your Slack workspace channel.
   * Point out the header chip updating to `#your-channel` with a green live dot.
2. **Trigger Load Test:** Run the load test script in the backend terminal:
   ```bash
   npx tsx scripts/load-test.ts
   ```
3. **Observe Results:**
   * Show that 1,000 emails were submitted and accepted in ~3.5 seconds.
   * Point out the worker logs: after reaching the sender limit of 5 emails/hr, remaining jobs are delayed to the next hour window preserving sequence.
4. **Show Slack Message:** Switch to Slack to show the real rate-limit notification received via the webhook detailing the sender and deferred window.

### [4:00 - 5:00] 5. Bull-Board Monitor & Search
1. **Open Bull-Board:** Click the **“BullMQ Queue UI”** link or navigate to `http://localhost:4000/admin/queues`.
2. **Authenticate:** Enter username `admin` and password `admin123`.
3. **Inspect Queue:** Show the delayed jobs waiting for their staggered time or rate-limit windows.
4. **Elasticsearch Search:** Return to the frontend, type a query (e.g. `reachinbox` or a recipient name) into the search bar above the tables, and show debounced full-text search results filtering instantly.