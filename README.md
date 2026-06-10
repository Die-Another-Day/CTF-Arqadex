# ⚡ ARQADEX CTF PLATFORM — Production
### ctf.arqadex.site — Real Auth · PostgreSQL · WebSockets

---

## Quick Start (Docker — recommended)

```bash
git clone / unzip this project
cp server/.env.example server/.env
# Edit server/.env — change JWT_SECRET and FLAG_SECRET

docker compose up -d
# Server: http://localhost:3001
# Frontend: http://localhost:3001
```

---

## Manual Setup

### 1. PostgreSQL
```bash
createdb arqadex_ctf
psql arqadex_ctf -f server/schema.sql   # creates all tables + seed data
```

### 2. Server
```bash
cd server
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, FLAG_SECRET

npm install
npm start          # production
npm run dev        # development (auto-restart)
```

### 3. Frontend
The frontend is served by the Express server as static files from `frontend/`.
No separate build step needed.

---

## Project Structure

```
ctf-production/
├── frontend/
│   ├── index.html      ← SPA shell (unchanged from prototype)
│   ├── style.css       ← Complete design system (unchanged)
│   └── app.js          ← Production SPA — real API calls, real auth
│
├── server/
│   ├── server.js       ← Complete Express backend (886 lines)
│   ├── schema.sql      ← PostgreSQL schema + seed data
│   ├── package.json    ← Dependencies: express, pg, bcrypt, jwt, socket.io
│   ├── Dockerfile
│   └── .env.example
│
├── docker-compose.yml  ← Full stack: Postgres + Node
└── README.md
```

---

## What's Real Now

| Feature | Before | Now |
|---|---|---|
| Authentication | Fake (localStorage) | Real JWT + bcrypt |
| User accounts | Mock | PostgreSQL `users` table |
| Events | Hardcoded array | PostgreSQL `events` table |
| Challenges | Hardcoded array | PostgreSQL `challenges` table |
| Flag submission | Client-side string compare | Server-side validation + per-team flag |
| Scoreboard | Mock data | Live from `event_registrations` |
| Teams | Mock | PostgreSQL `teams` + `team_members` |
| Organizer panel | Demo UI | Real CRUD via `/api/organizer/*` |
| Anti-cheat | UI only | Real timing correlation + IP clustering |
| Live updates | `setInterval` fake feed | Socket.io WebSockets |
| Achievements | Static list | Awarded server-side on solve |

---

## API Endpoints

### Auth
```
POST /api/auth/register   { username, email, password, role }
POST /api/auth/login      { email, password }
GET  /api/auth/me
PUT  /api/auth/profile    { bio }
```

### Events
```
GET  /api/events
GET  /api/events/:slug
GET  /api/events/:slug/scoreboard
GET  /api/events/:slug/challenges    (JWT required)
POST /api/events/:slug/register      (JWT required)
```

### Challenges
```
POST /api/challenges/:id/submit      { flag }    (JWT required)
POST /api/challenges/:id/hints/:hid  {}          (JWT required)
```

### Teams
```
GET  /api/teams/my                   (JWT required)
POST /api/teams                      { name }
POST /api/teams/join                 { invite_code }
DELETE /api/teams/leave
```

### Organizer (JWT + organizer role)
```
GET  /api/organizer/events
POST /api/organizer/events           { name, slug, description, ... }
PUT  /api/organizer/events/:id       { status, ... }
POST /api/organizer/challenges       { event_id, name, category, points, base_flag, ... }
PUT  /api/organizer/challenges/:id
DELETE /api/organizer/challenges/:id
GET  /api/organizer/events/:id/challenges
GET  /api/organizer/events/:id/anticheat
GET  /api/organizer/events/:id/analytics
POST /api/organizer/events/:id/announce  { message, type }
PUT  /api/organizer/alerts/:id/resolve
```

---

## Demo Accounts (seeded)

| Role | Email | Password |
|---|---|---|
| Organizer | org@arqadex.site | arqadex2025 |

Register any participant account via `/register`.

---

## Integrity Shield — How It Works

### Per-team flag derivatives
```
base_flag = "ARQADEX{oracle_whispers}"
team_flag = HMAC-SHA256(FLAG_SECRET, "ARQADEX{oracle_whispers}:teamId")
         = "ARQADEX{0x4f7a_oracle_whispers}"
```
Both the base flag and the team-specific flag are accepted on submission.
If two teams submit the same exact flag string (not their derived variant), an alert fires.

### IP Clustering
Teams sharing a /24 subnet trigger a warning alert after the 3rd team.

### Timing Correlation
If the same challenge is solved by two different teams within 90 seconds, a CRITICAL alert fires.

### Rate Limiting
10 submission attempts per team per challenge per minute.

---

## Production Deployment

### Railway (recommended)
```bash
# Backend
railway new
railway add postgresql  # auto-sets DATABASE_URL
railway deploy          # from /server directory

# Set env vars in Railway dashboard:
JWT_SECRET=<64 random chars>
FLAG_SECRET=<64 different random chars>
FRONTEND_URL=https://ctf.arqadex.site
```

### Frontend
```bash
# Cloudflare Pages or Netlify
# Build: none (static files)
# Publish directory: frontend/
# Set BACKEND_URL env var if frontend is separate from backend
```

### DNS
```
ctf.arqadex.site     → Frontend (Cloudflare Pages / Netlify)
api.ctf.arqadex.site → Backend (Railway)
```

If deploying frontend + backend together (Express serves static files):
```
ctf.arqadex.site → Railway backend (serves frontend as static)
```

---

## Generate Secure Secrets
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Run twice — one for JWT_SECRET, one for FLAG_SECRET
```

---

*ARQADEX CTF DIVISION © 2025 — Built for chaos.*
