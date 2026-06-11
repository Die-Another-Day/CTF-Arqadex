'use strict';
require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { Pool }   = require('pg');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const PORT     = process.env.PORT || 3001;
const JWT_SEC  = process.env.JWT_SECRET  || 'dev-secret-change-in-production';
const FLAG_SEC = process.env.FLAG_SECRET || 'dev-flag-secret-change-in-production';

/* ── Database ──────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function q(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) { console.log('No schema.sql found, skipping.'); return; }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('[DB] Schema initialised');
}

/* ── Middleware ────────────────────────────────────────── */
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

// Serve frontend
const FRONTEND = path.join(__dirname, '../frontend');
if (fs.existsSync(FRONTEND)) app.use(express.static(FRONTEND));

// Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SEC);
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function orgOnly(req, res, next) {
  if (req.user.role !== 'organizer' && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Organizer access required' });
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

/* ── Flag Helpers ──────────────────────────────────────── */
function deriveTeamFlag(baseFlag, teamId) {
  const hmac = crypto.createHmac('sha256', FLAG_SEC);
  hmac.update(`${baseFlag}:${teamId}`);
  const hash  = hmac.digest('hex').slice(0, 8);
  const match = baseFlag.match(/^(ARQADEX\{)(.+)(\})$/);
  if (!match) return baseFlag;
  return `${match[1]}${hash}_${match[2]}${match[3]}`;
}

function validateFlag(submitted, baseFlag, teamId) {
  const team = deriveTeamFlag(baseFlag, teamId);
  return submitted === baseFlag || submitted === team;
}

/* ── Rate Limiter (in-memory, replace with Redis in prod) ─ */
const rateBuckets = new Map();
function checkRate(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + windowMs; }
  bucket.count++;
  rateBuckets.set(key, bucket);
  return bucket.count <= limit;
}

/* ── Anti-cheat helpers ────────────────────────────────── */
const recentSolves = new Map(); // challengeId → [{teamId, time}]

async function runAntiCheat(eventId, teamId, challengeId, ipAddress) {
  const alerts = [];
  const now = Date.now();

  // 1. Timing correlation (flag sharing within 90s)
  const key = `solve:${challengeId}`;
  const prev = recentSolves.get(key) || [];
  for (const s of prev) {
    if (s.teamId !== teamId && now - s.time < 90000) {
      alerts.push({ type: 'FLAG_SHARING', severity: 'critical',
        details: { teams: [teamId, s.teamId], gap_ms: now - s.time } });
    }
  }
  prev.push({ teamId, time: now });
  recentSolves.set(key, prev.slice(-10));

  // 2. IP clustering
  const ipSub  = ipAddress.split('.').slice(0, 3).join('.');
  const ipKey  = `ip:${eventId}:${ipSub}`;
  const ipBkt  = rateBuckets.get(ipKey) || new Set();
  ipBkt.add(teamId);
  rateBuckets.set(ipKey, ipBkt);
  if (ipBkt.size > 2) {
    alerts.push({ type: 'IP_CLUSTER', severity: 'warning',
      details: { subnet: ipSub + '.0/24', teams: [...ipBkt] } });
  }

  // Persist alerts
  for (const a of alerts) {
    await q(
      'INSERT INTO anticheat_alerts(event_id,team_id,type,severity,details) VALUES($1,$2,$3,$4,$5)',
      [eventId, teamId, a.type, a.severity, JSON.stringify(a.details)]
    );
  }
  return alerts;
}

/* ═══════════════════════════════════════════════════════
   AUTH ROUTES
═══════════════════════════════════════════════════════ */
const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'username, email and password required' });
    if (username.length < 3 || username.length > 20)
      return res.status(400).json({ error: 'Username must be 3–20 characters' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const allowedRole = ['participant','organizer'].includes(role) ? role : 'participant';
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await q(
      'INSERT INTO users(username,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,username,email,role,created_at',
      [username.toLowerCase().trim(), email.toLowerCase().trim(), hash, allowedRole]
    );
    const user  = rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SEC, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
    res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username or email already taken' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { rows } = await q('SELECT * FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    const ok   = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SEC, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

authRouter.get('/me', auth, async (req, res) => {
  try {
    const { rows } = await q(
      'SELECT id,username,email,role,bio,created_at FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    // Attach team
    const tm = await q(
      `SELECT t.id,t.name,t.invite_code,tm.is_captain FROM teams t
       JOIN team_members tm ON t.id=tm.team_id WHERE tm.user_id=$1 LIMIT 1`, [req.user.id]);
    const user = rows[0];
    user.team  = tm.rows[0] || null;
    res.json({ user });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

authRouter.put('/profile', auth, async (req, res) => {
  try {
    const { bio } = req.body;
    await q('UPDATE users SET bio=$1 WHERE id=$2', [bio || '', req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.use('/api/auth', authRouter);

/* ═══════════════════════════════════════════════════════
   EVENT ROUTES (Public)
═══════════════════════════════════════════════════════ */
const eventsRouter = express.Router();

eventsRouter.get('/', async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT e.id,e.slug,e.name,e.description,e.status,e.start_time,e.end_time,
              e.max_teams,e.team_size,e.prizes,e.banner,e.accent_color,e.categories,
              u.username AS organizer,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id=e.id)::int AS team_count
       FROM events e JOIN users u ON e.organizer_id=u.id
       WHERE e.status != 'draft'
       ORDER BY CASE e.status WHEN 'live' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, e.start_time DESC`
    );
    res.json({ events: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

eventsRouter.get('/:slug', async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT e.*,u.username AS organizer,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id=e.id)::int AS team_count
       FROM events e JOIN users u ON e.organizer_id=u.id WHERE e.slug=$1`, [req.params.slug]);
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    const evt = rows[0];
    // Top 3 teams for past events
    if (evt.status === 'ended' || evt.status === 'archived') {
      const top = await q(
        `SELECT t.name,er.score FROM event_registrations er
         JOIN teams t ON t.id=er.team_id WHERE er.event_id=$1
         ORDER BY er.score DESC LIMIT 3`, [evt.id]);
      evt.top_teams = top.rows;
    }
    res.json({ event: evt });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

eventsRouter.get('/:slug/scoreboard', async (req, res) => {
  try {
    const { rows: evRows } = await q('SELECT id,status FROM events WHERE slug=$1', [req.params.slug]);
    if (!evRows.length) return res.status(404).json({ error: 'Event not found' });
    const evt = evRows[0];
    const { rows } = await q(
      `SELECT t.id,t.name,er.score,
              (SELECT COUNT(*) FROM submissions s
               WHERE s.team_id=t.id AND s.event_id=$1 AND s.is_correct=TRUE)::int AS solve_count,
              ARRAY(SELECT DISTINCT u.username FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=t.id) AS members
       FROM event_registrations er JOIN teams t ON t.id=er.team_id
       WHERE er.event_id=$1 ORDER BY er.score DESC, er.registered_at ASC`, [evt.id]);
    res.json({ scoreboard: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

eventsRouter.get('/:slug/challenges', auth, async (req, res) => {
  try {
    const { rows: evRows } = await q('SELECT id,status FROM events WHERE slug=$1', [req.params.slug]);
    if (!evRows.length) return res.status(404).json({ error: 'Event not found' });
    const evt = evRows[0];
    if (evt.status !== 'live' && req.user.role === 'participant')
      return res.status(403).json({ error: 'Event is not live' });

    // Get team id
    const tm = await q(
      `SELECT t.id FROM teams t JOIN team_members m ON t.id=m.team_id
       WHERE m.user_id=$1 LIMIT 1`, [req.user.id]);
    const teamId = tm.rows[0]?.id;

    // Get team's solved challenges
    let solved = [];
    if (teamId) {
      const { rows: solvedRows } = await q(
        'SELECT challenge_id FROM submissions WHERE team_id=$1 AND event_id=$2 AND is_correct=TRUE',
        [teamId, evt.id]);
      solved = solvedRows.map(r => r.challenge_id);
    }

    const { rows } = await q(
      `SELECT c.id,c.name,c.category,c.description,c.points,c.difficulty,c.solve_count,
              c.first_blood_team,c.is_honeypot,
              ARRAY(SELECT json_build_object('id',cf.id,'name',cf.name,'url',cf.url)
                    FROM challenge_files cf WHERE cf.challenge_id=c.id) AS files,
              ARRAY(SELECT json_build_object('id',h.id,'text',h.text,'cost',h.cost,'order',h.sort_order)
                    FROM challenge_hints h WHERE h.challenge_id=c.id ORDER BY h.sort_order) AS hints
       FROM challenges c WHERE c.event_id=$1 AND c.is_visible=TRUE
       ORDER BY c.category,c.points`, [evt.id]);
    
    // Never send base_flag to client
    const challenges = rows.map(c => ({
      ...c,
      solved: solved.includes(c.id),
      // Generate team-specific flag indicator only (not the actual flag)
      has_team_flag: !!teamId,
    }));
    res.json({ challenges });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Register team for event
eventsRouter.post('/:slug/register', auth, async (req, res) => {
  try {
    const { rows: evRows } = await q(
      'SELECT id,status,max_teams FROM events WHERE slug=$1', [req.params.slug]);
    if (!evRows.length) return res.status(404).json({ error: 'Event not found' });
    const evt = evRows[0];
    if (!['published','live'].includes(evt.status))
      return res.status(400).json({ error: 'Registration is not open' });

    // Get team
    const tm = await q(
      `SELECT t.id FROM teams t JOIN team_members m ON t.id=m.team_id WHERE m.user_id=$1 LIMIT 1`,
      [req.user.id]);
    if (!tm.rows.length) return res.status(400).json({ error: 'You must create or join a team first' });
    const teamId = tm.rows[0].id;

    // Check capacity
    const { rows: cnt } = await q(
      'SELECT COUNT(*) FROM event_registrations WHERE event_id=$1', [evt.id]);
    if (parseInt(cnt[0].count) >= evt.max_teams)
      return res.status(400).json({ error: 'Event is full' });

    await q('INSERT INTO event_registrations(event_id,team_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [evt.id, teamId]);
    res.json({ ok: true, message: 'Team registered for event' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.use('/api/events', eventsRouter);

/* ═══════════════════════════════════════════════════════
   CHALLENGE ROUTES (Participation)
═══════════════════════════════════════════════════════ */
const chalRouter = express.Router();

chalRouter.post('/:id/submit', auth, async (req, res) => {
  try {
    const { flag } = req.body;
    if (!flag) return res.status(400).json({ error: 'Flag required' });

    // Get challenge
    const { rows: chRows } = await q(
      'SELECT c.*,e.status AS event_status FROM challenges c JOIN events e ON e.id=c.event_id WHERE c.id=$1',
      [req.params.id]);
    if (!chRows.length) return res.status(404).json({ error: 'Challenge not found' });
    const ch = chRows[0];

    if (ch.event_status !== 'live')
      return res.status(400).json({ error: 'Event is not live' });

    // Get team
    const tm = await q(
      `SELECT t.id FROM teams t JOIN team_members m ON t.id=m.team_id WHERE m.user_id=$1 LIMIT 1`,
      [req.user.id]);
    if (!tm.rows.length) return res.status(400).json({ error: 'You must be in a team to submit flags' });
    const teamId = tm.rows[0].id;

    // Check team registration
    const reg = await q(
      'SELECT 1 FROM event_registrations WHERE event_id=$1 AND team_id=$2',
      [ch.event_id, teamId]);
    if (!reg.rows.length) return res.status(400).json({ error: 'Your team is not registered for this event' });

    // Already solved?
    const already = await q(
      'SELECT 1 FROM submissions WHERE team_id=$1 AND challenge_id=$2 AND is_correct=TRUE',
      [teamId, ch.id]);
    if (already.rows.length) return res.status(400).json({ error: 'Already solved', already_solved: true });

    // Rate limit: 10 attempts per minute per team per challenge
    const rlKey = `sub:${teamId}:${ch.id}`;
    if (!checkRate(rlKey, 10, 60000))
      return res.status(429).json({ error: 'Too many attempts. Wait before trying again.' });

    const ip       = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const isCorrect = validateFlag(flag.trim(), ch.base_flag, teamId);

    // Record submission
    await q(
      `INSERT INTO submissions(team_id,user_id,challenge_id,event_id,flag,is_correct,ip_address,user_agent)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [teamId, req.user.id, ch.id, ch.event_id, flag.trim(), isCorrect, ip,
       req.headers['user-agent'] || '']);

    if (isCorrect) {
      // Update solve count + first blood
      const solveNum = ch.solve_count + 1;
      const isFirst  = solveNum === 1;
      await q(
        `UPDATE challenges SET solve_count=solve_count+1 ${isFirst ? ',first_blood_team=$2' : ''} WHERE id=$1`,
        isFirst ? [ch.id, teamId] : [ch.id]);

      // Update team score
      await q(
        'UPDATE event_registrations SET score=score+$1 WHERE event_id=$2 AND team_id=$3',
        [ch.points, ch.event_id, teamId]);

      // Anti-cheat
      const alerts = await runAntiCheat(ch.event_id, teamId, ch.id, ip);

      // Emit solve event
      const { rows: teamRow } = await q('SELECT name FROM teams WHERE id=$1', [teamId]);
      io.to(`event:${ch.event_id}`).emit('solve', {
        team:        teamRow[0]?.name || 'Unknown',
        teamId,
        challenge:   ch.name,
        challengeId: ch.id,
        points:      ch.points,
        isFirstBlood: isFirst,
        timestamp:   Date.now(),
      });

      // Emit updated scoreboard
      emitScoreboard(ch.event_id);

      // Check/award achievements
      await checkAchievements(req.user.id, teamId, ch, isFirst);

      return res.json({ correct: true, points: ch.points, firstBlood: isFirst,
        flagged: alerts.length > 0 });
    }

    // Wrong flag — check max attempts
    const { rows: attempts } = await q(
      'SELECT COUNT(*) FROM submissions WHERE team_id=$1 AND challenge_id=$2',
      [teamId, ch.id]);
    const { rows: settings } = await q(
      'SELECT max_wrong_attempts FROM event_settings WHERE event_id=$1', [ch.event_id]);
    const maxAttempts = settings[0]?.max_wrong_attempts || 0;
    const attemptsUsed = parseInt(attempts[0].count);
    const remaining = maxAttempts > 0 ? maxAttempts - attemptsUsed : null;

    // Honeypot trigger
    if (ch.is_honeypot) {
      await q(
        `INSERT INTO anticheat_alerts(event_id,team_id,type,severity,details)
         VALUES($1,$2,'HONEYPOT_TRIGGERED','critical',$3)`,
        [ch.event_id, teamId, JSON.stringify({ challenge: ch.name })]);
    }

    res.json({ correct: false, attemptsUsed, remaining });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

chalRouter.post('/:id/hints/:hintId', auth, async (req, res) => {
  try {
    const { rows: hRows } = await q(
      `SELECT h.*,c.event_id FROM challenge_hints h
       JOIN challenges c ON c.id=h.challenge_id WHERE h.id=$1 AND c.id=$2`,
      [req.params.hintId, req.params.id]);
    if (!hRows.length) return res.status(404).json({ error: 'Hint not found' });
    const hint = hRows[0];

    const tm = await q(
      `SELECT t.id FROM teams t JOIN team_members m ON t.id=m.team_id WHERE m.user_id=$1 LIMIT 1`,
      [req.user.id]);
    if (!tm.rows.length) return res.status(400).json({ error: 'Must be in a team' });
    const teamId = tm.rows[0].id;

    // Already used?
    const used = await q('SELECT 1 FROM hints_used WHERE team_id=$1 AND hint_id=$2', [teamId, hint.id]);
    if (used.rows.length) return res.json({ hint: hint.text, already_used: true });

    // Deduct points
    await q('INSERT INTO hints_used(team_id,hint_id) VALUES($1,$2)', [teamId, hint.id]);
    await q(
      'UPDATE event_registrations SET score=GREATEST(0,score-$1) WHERE event_id=$2 AND team_id=$3',
      [hint.cost, hint.event_id, teamId]);

    emitScoreboard(hint.event_id);
    res.json({ hint: hint.text, cost: hint.cost });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.use('/api/challenges', chalRouter);

/* ═══════════════════════════════════════════════════════
   TEAM ROUTES
═══════════════════════════════════════════════════════ */
const teamsRouter = express.Router();

teamsRouter.get('/my', auth, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT t.id,t.name,t.invite_code,tm.is_captain,
              ARRAY(SELECT json_build_object('id',u.id,'username',u.username,'is_captain',m2.is_captain)
                    FROM team_members m2 JOIN users u ON u.id=m2.user_id WHERE m2.team_id=t.id) AS members
       FROM teams t JOIN team_members tm ON t.id=tm.team_id WHERE tm.user_id=$1`, [req.user.id]);
    res.json({ team: rows[0] || null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

teamsRouter.get('/:id', async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT t.id,t.name,
              ARRAY(SELECT json_build_object('id',u.id,'username',u.username,'is_captain',m.is_captain)
                    FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=t.id) AS members
       FROM teams t WHERE t.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Team not found' });
    res.json({ team: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

teamsRouter.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Team name required (min 2 chars)' });

    // Check already in team
    const existing = await q(
      'SELECT 1 FROM team_members WHERE user_id=$1', [req.user.id]);
    if (existing.rows.length) return res.status(400).json({ error: 'You are already in a team' });

    const { rows } = await q(
      'INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id,name,invite_code',
      [name.trim(), req.user.id]);
    const team = rows[0];
    await q('INSERT INTO team_members(team_id,user_id,is_captain) VALUES($1,$2,TRUE)',
      [team.id, req.user.id]);
    res.status(201).json({ team });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Team name already taken' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

teamsRouter.post('/join', auth, async (req, res) => {
  try {
    const { invite_code } = req.body;
    if (!invite_code) return res.status(400).json({ error: 'Invite code required' });

    const existing = await q('SELECT 1 FROM team_members WHERE user_id=$1', [req.user.id]);
    if (existing.rows.length) return res.status(400).json({ error: 'You are already in a team' });

    const { rows } = await q(
      `SELECT t.id,t.name,(SELECT COUNT(*) FROM team_members WHERE team_id=t.id)::int AS member_count
       FROM teams t WHERE t.invite_code=$1`, [invite_code.trim()]);
    if (!rows.length) return res.status(404).json({ error: 'Invalid invite code' });
    const team = rows[0];
    if (team.member_count >= 4) return res.status(400).json({ error: 'Team is full (max 4 members)' });

    await q('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)', [team.id, req.user.id]);
    res.json({ team: { id: team.id, name: team.name } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

teamsRouter.delete('/leave', auth, async (req, res) => {
  try {
    await q('DELETE FROM team_members WHERE user_id=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.use('/api/teams', auth, teamsRouter);

/* ═══════════════════════════════════════════════════════
   ORGANIZER ROUTES
═══════════════════════════════════════════════════════ */
const orgRouter = express.Router();
orgRouter.use(auth, orgOnly);

// Create event
orgRouter.post('/events', async (req, res) => {
  try {
    const { name, description, slug, start_time, end_time, max_teams, team_size,
            prizes, banner, accent_color, categories, settings } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });

    const { rows } = await q(
      `INSERT INTO events(slug,name,description,organizer_id,start_time,end_time,max_teams,
        team_size,prizes,banner,accent_color,categories)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [slug, name, description || '', req.user.id,
       start_time || null, end_time || null,
       max_teams || 500, team_size || 4,
       prizes || [], banner || 'linear-gradient(135deg,#020228,#0A0A3A)',
       accent_color || '#00F5FF', categories || []]);
    const evt = rows[0];

    // Create settings
    const s = settings || {};
    await q(
      `INSERT INTO event_settings(event_id,per_team_flags,ip_cluster_detection,
        rate_limit_per_min,honeypot_enabled,max_wrong_attempts)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [evt.id, s.per_team_flags ?? true, s.ip_cluster_detection ?? true,
       s.rate_limit_per_min ?? 10, s.honeypot_enabled ?? false,
       s.max_wrong_attempts ?? 0]);

    res.status(201).json({ event: evt });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Event slug already taken' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

// Get organizer's events
orgRouter.get('/events', async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT e.*,(SELECT COUNT(*) FROM event_registrations er WHERE er.event_id=e.id)::int AS team_count
       FROM events e WHERE e.organizer_id=$1 ORDER BY e.created_at DESC`, [req.user.id]);
    res.json({ events: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Update event
orgRouter.put('/events/:id', async (req, res) => {
  try {
    const chk = await q('SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
      [req.params.id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your event' });
    const { name,description,status,start_time,end_time,max_teams,team_size,
            prizes,banner,accent_color,categories } = req.body;
    await q(
      `UPDATE events SET name=COALESCE($2,name),description=COALESCE($3,description),
        status=COALESCE($4,status),start_time=COALESCE($5,start_time),
        end_time=COALESCE($6,end_time),max_teams=COALESCE($7,max_teams),
        team_size=COALESCE($8,team_size),prizes=COALESCE($9,prizes),
        banner=COALESCE($10,banner),accent_color=COALESCE($11,accent_color),
        categories=COALESCE($12,categories) WHERE id=$1`,
      [req.params.id,name,description,status,start_time,end_time,max_teams,
       team_size,prizes,banner,accent_color,categories]);
    if (status === 'live') io.to(`event:${req.params.id}`).emit('event_status', { status: 'live' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Create challenge
orgRouter.post('/challenges', async (req, res) => {
  try {
    const { event_id,name,category,description,points,difficulty,base_flag,
            is_honeypot,hints } = req.body;
    const chk = await q('SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
      [event_id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your event' });
    const { rows } = await q(
      `INSERT INTO challenges(event_id,name,category,description,points,difficulty,base_flag,is_honeypot)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [event_id, name, category, description || '', points || 500,
       difficulty || 3, base_flag, is_honeypot || false]);
    const ch = rows[0];
    if (hints?.length) {
      for (const [i, h] of hints.entries()) {
        await q('INSERT INTO challenge_hints(challenge_id,text,cost,sort_order) VALUES($1,$2,$3,$4)',
          [ch.id, h.text, h.cost || 50, i]);
      }
    }
    res.status(201).json({ challenge: ch });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Update challenge
orgRouter.put('/challenges/:id', async (req, res) => {
  try {
    const chk = await q(
      'SELECT c.id FROM challenges c JOIN events e ON e.id=c.event_id WHERE c.id=$1 AND e.organizer_id=$2',
      [req.params.id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your challenge' });
    const { name,category,description,points,difficulty,base_flag,is_visible,is_honeypot } = req.body;
    await q(
      `UPDATE challenges SET name=COALESCE($2,name),category=COALESCE($3,category),
        description=COALESCE($4,description),points=COALESCE($5,points),
        difficulty=COALESCE($6,difficulty),base_flag=COALESCE($7,base_flag),
        is_visible=COALESCE($8,is_visible),is_honeypot=COALESCE($9,is_honeypot) WHERE id=$1`,
      [req.params.id,name,category,description,points,difficulty,base_flag,is_visible,is_honeypot]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Delete challenge
orgRouter.delete('/challenges/:id', async (req, res) => {
  try {
    const chk = await q(
      'SELECT c.id FROM challenges c JOIN events e ON e.id=c.event_id WHERE c.id=$1 AND e.organizer_id=$2',
      [req.params.id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your challenge' });
    await q('DELETE FROM challenges WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Challenges for event
orgRouter.get('/events/:id/challenges', async (req, res) => {
  try {
    const chk = await q('SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
      [req.params.id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your event' });
    const { rows } = await q(
      `SELECT c.*,
        ARRAY(SELECT json_build_object('id',h.id,'text',h.text,'cost',h.cost) FROM challenge_hints h WHERE h.challenge_id=c.id ORDER BY h.sort_order) AS hints
       FROM challenges c WHERE c.event_id=$1 ORDER BY c.category,c.points`, [req.params.id]);
    res.json({ challenges: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Anti-cheat report
orgRouter.get('/events/:id/anticheat', async (req, res) => {
  try {
    const chk = await q('SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
      [req.params.id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your event' });
    const { rows: alerts } = await q(
      `SELECT a.*,t.name AS team_name FROM anticheat_alerts a
       LEFT JOIN teams t ON t.id=a.team_id WHERE a.event_id=$1
       ORDER BY a.created_at DESC LIMIT 100`, [req.params.id]);
    const { rows: subs } = await q(
      `SELECT s.*,t.name AS team_name,c.name AS challenge_name
       FROM submissions s JOIN teams t ON t.id=s.team_id
       JOIN challenges c ON c.id=s.challenge_id
       WHERE s.event_id=$1 ORDER BY s.submitted_at DESC LIMIT 100`, [req.params.id]);
    res.json({ alerts, submissions: subs });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Analytics
orgRouter.get('/events/:id/analytics', async (req, res) => {
  try {
    const chk = await q('SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
      [req.params.id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your event' });
    const { rows: stats } = await q(
      `SELECT
        (SELECT COUNT(*) FROM event_registrations WHERE event_id=$1)::int AS total_teams,
        (SELECT COUNT(*) FROM submissions WHERE event_id=$1)::int AS total_submissions,
        (SELECT COUNT(*) FROM submissions WHERE event_id=$1 AND is_correct=TRUE)::int AS correct_submissions,
        (SELECT COUNT(*) FROM anticheat_alerts WHERE event_id=$1 AND resolved=FALSE)::int AS active_alerts`,
      [req.params.id]);
    const { rows: catStats } = await q(
      `SELECT c.category,
        COUNT(DISTINCT c.id)::int AS total,
        SUM(c.solve_count)::int AS solves
       FROM challenges c WHERE c.event_id=$1 GROUP BY c.category ORDER BY c.category`,
      [req.params.id]);
    res.json({ stats: stats[0], by_category: catStats });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Send announcement
orgRouter.post('/events/:id/announce', async (req, res) => {
  try {
    const chk = await q('SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
      [req.params.id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Not your event' });
    const { message, type } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const { rows } = await q(
      'INSERT INTO announcements(event_id,message,type) VALUES($1,$2,$3) RETURNING *',
      [req.params.id, message, type || 'info']);
    io.to(`event:${req.params.id}`).emit('announcement', rows[0]);
    res.json({ ok: true, announcement: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Resolve alert
orgRouter.put('/alerts/:id/resolve', async (req, res) => {
  try {
    await q('UPDATE anticheat_alerts SET resolved=TRUE WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.use('/api/organizer', orgRouter);

/* ═══════════════════════════════════════════════════════
   USER / PROFILE ROUTES
═══════════════════════════════════════════════════════ */
app.get('/api/profile/:username', async (req, res) => {
  try {
    const { rows } = await q(
      'SELECT id,username,bio,role,created_at FROM users WHERE username=$1',
      [req.params.username.toLowerCase()]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    // Event history
    const { rows: history } = await q(
      `SELECT e.slug,e.name,e.status,er.score,
              RANK() OVER (PARTITION BY er.event_id ORDER BY er.score DESC) AS rank
       FROM event_registrations er JOIN events e ON e.id=er.event_id
       JOIN team_members tm ON tm.team_id=er.team_id WHERE tm.user_id=$1
       ORDER BY e.start_time DESC`, [user.id]);
    // Achievements
    const { rows: ach } = await q(
      `SELECT a.id,a.name,a.description,a.icon,ua.earned_at
       FROM user_achievements ua JOIN achievements a ON a.id=ua.achievement_id
       WHERE ua.user_id=$1`, [user.id]);
    res.json({ user, history, achievements: ach });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

/* ═══════════════════════════════════════════════════════
   SOCKET.IO
═══════════════════════════════════════════════════════ */
io.on('connection', socket => {
  socket.on('join_event', async ({ eventSlug, token }) => {
    try {
      const { rows } = await q('SELECT id FROM events WHERE slug=$1', [eventSlug]);
      if (!rows.length) return;
      const eventId = rows[0].id;
      socket.join(`event:${eventId}`);
      // Send current scoreboard on join
      const sb = await getScoreboard(eventId);
      socket.emit('scoreboard', { scoreboard: sb });
    } catch {}
  });
  socket.on('disconnect', () => {});
});

async function getScoreboard(eventId) {
  const { rows } = await q(
    `SELECT t.id,t.name,er.score,
            (SELECT COUNT(*) FROM submissions s WHERE s.team_id=t.id AND s.event_id=$1 AND s.is_correct=TRUE)::int AS solve_count
     FROM event_registrations er JOIN teams t ON t.id=er.team_id
     WHERE er.event_id=$1 ORDER BY er.score DESC,er.registered_at ASC LIMIT 50`, [eventId]);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

async function emitScoreboard(eventId) {
  try {
    const sb = await getScoreboard(eventId);
    io.to(`event:${eventId}`).emit('scoreboard', { scoreboard: sb });
  } catch {}
}

/* ═══════════════════════════════════════════════════════
   ACHIEVEMENTS
═══════════════════════════════════════════════════════ */
async function checkAchievements(userId, teamId, challenge, isFirstBlood) {
  try {
    const earn = async (id) => {
      await q(
        'INSERT INTO user_achievements(user_id,achievement_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [userId, id]);
    };
    if (isFirstBlood) await earn('first_blood');
    const hour = new Date().getHours();
    if (hour >= 2 && hour < 5) await earn('night_owl');
    const { rows } = await q(
      'SELECT COUNT(*) FROM submissions WHERE user_id=$1 AND is_correct=TRUE', [userId]);
    const total = parseInt(rows[0].count);
    if (total >= 5) await earn('unstoppable');
  } catch {}
}

/* ═══════════════════════════════════════════════════════
   HEALTH CHECK + 404
═══════════════════════════════════════════════════════ */
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('*', (req, res) => {
  const indexFile = path.join(__dirname, '../frontend/index.html');
  if (fs.existsSync(indexFile)) res.sendFile(indexFile);
  else res.json({ error: 'Frontend not found' });
});

/* ═══════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════ */
async function start() {
  try {
    await pool.connect();
    console.log('[DB] Connected to PostgreSQL');
    await initSchema();
    server.listen(PORT, () => {
      console.log(`\n⚡ ARQADEX CTF SERVER — http://localhost:${PORT}\n`);
      console.log('  Frontend: http://localhost:'+PORT);
      console.log('  API:      http://localhost:'+PORT+'/api');
      console.log('  Health:   http://localhost:'+PORT+'/api/health\n');
    });
  } catch (err) {
    console.error('[FATAL] Could not start server:', err.message);
    process.exit(1);
  }
}

module.exports = { initSchema };
start();