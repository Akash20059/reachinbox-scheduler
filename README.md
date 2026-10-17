# ReachInbox — Distributed Email Job Scheduler & Dashboard

A production-grade, distributed email job scheduler built with **TypeScript**, **Express.js**, **BullMQ**, **Redis (AOF persistence)**, **PostgreSQL (Prisma ORM)**, **Elasticsearch**, and a **React + Vite** frontend designed to match Figma pixel-for-pixel.

---

## 🚀 Key Highlights & Architecture

- **Zero Cron Jobs:** All delays, scheduling, and staggering are managed exclusively by BullMQ delayed queues with millisecond precision.
- **Strict Idempotency & Zero Drops:** Every email job uses `jobId = EmailJob.id`. Atomic database state transitions (`scheduled` ➔ `processing` ➔ `sent` / `failed`) ensure no job is ever dispatched twice.
- **Idempotency-Key HTTP Header:** `POST /api/schedule` supports an optional `Idempotency-Key: <unique-key>` header cached in Redis for 24 hours. Repeating requests with the same key returns the original batch payload with HTTP 200, preventing duplicate dispatches.
- **Per-Batch Throttling & Limits:** Compose forms supply custom `delayBetweenMs` and `hourlyLimit` stored in a dedicated `Batch` record and on `EmailJob` rows, respected by workers and bounded by `MAX_HOURLY_LIMIT_ALLOWED` and `MAX_DELAY_ALLOWED_MS`.
- **Crash Persistence & Recovery:** 
  - Redis runs with `--appendonly yes` to guarantee durability across restarts.
  - On server boot, startup reconciliation automatically cleans up stale `processing` jobs, re-enqueues missing/overdue `scheduled` jobs into BullMQ without duplicates, and synchronizes Elasticsearch index records.
- **Multi-Worker Per-Sender Hourly Rate Limiting:**
  - Evaluated via an atomic Redis Lua script checking `rl:{senderId}:{YYYYMMDDHH}` with 2h TTL.
  - If a sender reaches the limit, jobs are deferred to the next window preserving their original relative ordering (`job.moveToDelayed` with `DelayedError`).
  - If delivery fails before send, the rate limiter counter is safely decremented.
- **Real Slack OAuth & Rate-Limit Alerts:**
  - Full Slack OAuth flow (`/slack/connect`, `/slack/callback`, `/slack/status`, `/slack/disconnect`).
  - Webhook failures are caught and logged without disrupting scheduling or workers.
- **Elasticsearch Full-Text Search with Resilience:**
  - High-performance search across `subject`, `body`, and recipient `toEmail`, strictly scoped by the authenticated `userId`.
  - Resilience guarantees that even if Elasticsearch is unavailable, scheduling, workers, and fallback database queries continue uninterrupted.
- **Client-Side CSV Parsing:**
  - Compose modal parses uploaded CSV/TXT files client-side using `papaparse`, validates RFC compliant email formats, removes duplicates, and renders an *“N email addresses detected”* badge.
- **Bull-Board Live Queue Monitor:**
  - Protected by HTTP Basic Authentication (`BULL_BOARD_USER`, `BULL_BOARD_PASS`) at `/admin/queues`.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend** | TypeScript, Express.js, BullMQ, Redis (ioredis), PostgreSQL (Prisma ORM), Nodemailer |
| **Search & Caching**| Elasticsearch 8.13, Redis 7 (AOF enabled) |
| **Auth & Alerts** | Passport.js (Google OAuth 2.0, JWT httpOnly cookies), Slack OAuth 2.0 & Webhooks |
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS, Lucide Icons, PapaParse, Axios |
| **Infrastructure** | Docker Compose (Postgres, Redis, Elasticsearch) |

---

## 📋 Prerequisites

- **Node.js** v18+ & **npm**
- **Docker** & **Docker Compose**
- **Google Cloud OAuth 2.0 Credentials** (Client ID & Client Secret)
- **Slack App Credentials** (Client ID & Client Secret with `incoming-webhook` scope)
- **Ethereal Email Accounts** (2+ SMTP credentials for testing)

---

## ⚡ Quick Start

### 1. Clone Repository & Setup Environment

```bash
git clone https://github.com/Akash20059/reachinbox-scheduler.git
cd reachinbox-scheduler
```

Configure backend environment variables in `backend/.env`:
```env
PORT=4000
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgresql://reachinbox:reachinbox123@localhost:5432/reachinbox_db?schema=public
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_EMAILS_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
JWT_SECRET=super_secret_jwt_key_at_least_32_characters_long
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_REDIRECT_URI=http://localhost:4000/slack/callback
```

Configure frontend environment variables in `frontend/.env`:
```env
VITE_BACKEND_URL=http://localhost:4000
```

---

### 2. Start Infrastructure Containers

Start PostgreSQL, Redis (AOF), and Elasticsearch via Docker Compose:
```bash
docker compose up -d
```

Verify containers are healthy:
```bash
docker compose ps
```

---

### 3. Initialize & Start Backend

```bash
cd backend
npm install
npx prisma db push
npm run dev
```
The backend starts on `http://localhost:4000`. On boot, the server seeds initial senders, initializes the Elasticsearch index, runs queue reconciliation, and mounts Bull-Board at `http://localhost:4000/admin/queues`.

---

### 4. Start Frontend

In a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 🧪 Testing & Verification Scripts

### A. 1,000 Email Rate-Limit & Rescheduling Load Test

To verify per-sender hourly rate limiting, sender round-robin distribution, and BullMQ `moveToDelayed` scheduling:

```bash
cd backend
npx tsx scripts/load-test.ts
```
*Expected Result:*
- Under a limit of 5/sender/hour across 2 senders, exactly **10 emails** are dispatched immediately in the current window.
- The remaining **990 emails** are dynamically rescheduled to the next hour window (`moveToDelayed`) with preserved order offsets.
- 0 emails dropped, 0 duplicate sends.

### B. Server Crash & Persistence Test

1. Schedule 5 emails spaced 5 seconds apart in the Compose Modal.
2. Terminate the backend server (`Ctrl+C` or kill process) while jobs are waiting in the queue.
3. Restart the backend: `npm run dev`.
4. Observe startup logs:
   - Server recovers pending jobs from PostgreSQL and re-enqueues them into Redis.
   - All 5 jobs complete successfully with generated Ethereal preview URLs and 0 duplicate dispatches.

---

## 🔗 Key API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/schedule` | Schedules a batch of emails with round-robin senders & delay |
| `GET` | `/api/emails/scheduled` | Paginated list of upcoming scheduled email jobs |
| `GET` | `/api/emails/sent` | Paginated list of delivered / failed email jobs |
| `GET` | `/api/emails/search` | Elasticsearch debounced full-text search across emails |
| `GET` | `/api/emails/stats` | Count of scheduled and sent emails |
| `GET` | `/slack/connect` | Initiates Slack OAuth redirect |
| `GET` | `/slack/status` | Current Slack webhook connection status & channel |
| `DELETE`| `/slack/disconnect` | Disconnects stored Slack webhook |
| `GET` | `/auth/google` | Google OAuth 2.0 login |
| `GET` | `/admin/queues` | Bull-Board Queue visualizer |
| `GET` | `/health` | Server and database health check |

---

## 🎨 UI Features (Matching Figma)

- **Login Screen:** Clean aesthetic with Google OAuth login and demo bypass option.
- **Left Sidebar:** Logo branding, user profile card, `+ Compose` button, `Scheduled` and `Sent` counter badges, and BullMQ Live Queue UI link.
- **Header:** Live Slack Connection status chip with channel info and Disconnect dropdown, manual refresh button, user avatar, and Logout button.
- **Dashboard Search & Auto-Sync:** Debounced search box directly above the email tables querying Elasticsearch, paired with an automatic 10-second background polling mechanism.
- **Compose Modal:**
  - Client-side CSV/TXT parsing with `papaparse`.
  - Format validation, deduplication, and *“N email addresses detected”* chip list with remove controls.
  - Start Time picker with presets (*“In 1 Minute”*, *“Tomorrow 10:00 AM”*).
  - Delay between emails (seconds) and Hourly limit controls.
  - Rich formatting toolbar (Bold, Italic, Lists, Quotes, Code).
  - Instant schedule dispatch with loading spinner and toast notifications.
- **Email Detail Modal:** Click any email row to view recipients, sender address, exact timestamp, status badge, full email body, and Ethereal preview link.

---

## 👥 Submission Information

- **Repository:** [https://github.com/Akash20059/reachinbox-scheduler](https://github.com/Akash20059/reachinbox-scheduler)
- **Collaborators Invited:** `Mitrajit`, `Yadav036`