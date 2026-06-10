-- ═══════════════════════════════════════════════════════════
-- ARQADEX CTF PLATFORM — PostgreSQL Schema
-- Run once: psql $DATABASE_URL -f schema.sql
-- ═══════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role   AS ENUM ('participant','organizer','admin');
  CREATE TYPE event_status AS ENUM ('draft','published','live','ended','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Users ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'participant',
  bio           TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Teams ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT UNIQUE NOT NULL,
  invite_code TEXT UNIQUE NOT NULL DEFAULT substring(gen_random_uuid()::text,1,8),
  created_by  TEXT REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    TEXT REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  is_captain BOOLEAN DEFAULT FALSE,
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- ── Events ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  organizer_id TEXT NOT NULL REFERENCES users(id),
  status       event_status NOT NULL DEFAULT 'draft',
  start_time   TIMESTAMPTZ,
  end_time     TIMESTAMPTZ,
  max_teams    INT DEFAULT 500,
  team_size    INT DEFAULT 4,
  prizes       TEXT[] DEFAULT '{}',
  rules        TEXT DEFAULT '',
  banner       TEXT DEFAULT 'linear-gradient(135deg,#020228,#0A0A3A)',
  accent_color TEXT DEFAULT '#00F5FF',
  categories   TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_settings (
  event_id               TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  per_team_flags         BOOLEAN DEFAULT TRUE,
  ip_cluster_detection   BOOLEAN DEFAULT TRUE,
  rate_limit_per_min     INT DEFAULT 10,
  honeypot_enabled       BOOLEAN DEFAULT FALSE,
  behavioral_analysis    BOOLEAN DEFAULT TRUE,
  max_wrong_attempts     INT DEFAULT 0,
  freeze_scoreboard      BOOLEAN DEFAULT FALSE,
  freeze_at              TIMESTAMPTZ
);

-- Teams registered for events
CREATE TABLE IF NOT EXISTS event_registrations (
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,
  team_id    TEXT REFERENCES teams(id) ON DELETE CASCADE,
  score      INT DEFAULT 0,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, team_id)
);

-- ── Challenges ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points      INT NOT NULL DEFAULT 500,
  difficulty  INT DEFAULT 3,
  base_flag   TEXT NOT NULL,
  is_visible  BOOLEAN DEFAULT TRUE,
  is_honeypot BOOLEAN DEFAULT FALSE,
  solve_count INT DEFAULT 0,
  first_blood_team TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenge_hints (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  cost        INT DEFAULT 50,
  sort_order  INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS challenge_files (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  size         INT DEFAULT 0,
  uploaded_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Submissions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id      TEXT NOT NULL REFERENCES teams(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  event_id     TEXT NOT NULL REFERENCES events(id),
  flag         TEXT NOT NULL,
  is_correct   BOOLEAN NOT NULL,
  ip_address   TEXT DEFAULT '',
  user_agent   TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent double-solving: one correct per team per challenge
CREATE UNIQUE INDEX IF NOT EXISTS uniq_team_challenge_solve
  ON submissions(team_id, challenge_id)
  WHERE is_correct = TRUE;

-- ── Hints Used ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hints_used (
  team_id     TEXT REFERENCES teams(id),
  hint_id     TEXT REFERENCES challenge_hints(id),
  used_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, hint_id)
);

-- ── Announcements ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  type       TEXT DEFAULT 'info',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Anti-cheat alerts ────────────────────────────────────
CREATE TABLE IF NOT EXISTS anticheat_alerts (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id    TEXT REFERENCES teams(id),
  type       TEXT NOT NULL,
  severity   TEXT DEFAULT 'warning',
  details    JSONB DEFAULT '{}',
  resolved   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Achievements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT REFERENCES achievements(id),
  earned_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_submissions_team     ON submissions(team_id);
CREATE INDEX IF NOT EXISTS idx_submissions_challenge ON submissions(challenge_id);
CREATE INDEX IF NOT EXISTS idx_submissions_event    ON submissions(event_id);
CREATE INDEX IF NOT EXISTS idx_challenges_event     ON challenges(event_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user    ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_event_reg_event      ON event_registrations(event_id);

-- ── Seed: Achievements ───────────────────────────────────
INSERT INTO achievements(id,name,description,icon) VALUES
  ('first_blood',  'FIRST BLOOD',    'First team to solve any challenge',               '🩸'),
  ('speedrun',     'SPEEDRUN',       'Solve a challenge within 10 minutes of release',  '⚡'),
  ('category_king','CATEGORY KING',  'Solve all challenges in one category',            '👑'),
  ('unstoppable',  'UNSTOPPABLE',    'Solve 5 challenges in a row without wrong flag',  '🔥'),
  ('night_owl',    'NIGHT OWL',      'Solve a challenge between 2 and 5 AM',            '🦉'),
  ('purist',       'PURIST',         'Complete an event without using hints',           '🎯'),
  ('podium',       'PODIUM',         'Finish in the top 3',                             '🏆'),
  ('veteran',      'VETERAN',        'Participate in 5 or more events',                 '⭐')
ON CONFLICT(id) DO NOTHING;

-- ── Seed: Demo Event ─────────────────────────────────────
-- (Only inserts if no events exist yet)
DO $$
DECLARE org_id TEXT;
BEGIN
  -- Create demo organizer if not exists
  INSERT INTO users(id,username,email,password_hash,role)
  VALUES('demo-org','arqadex_org','org@arqadex.site',
    '$2b$10$rQnG8GkDv9Ky0t3TM.SHoeCJ5Lq1Vz3Yd1Wp7NomxfNi5Bz7e5Hy','organizer')
  ON CONFLICT(email) DO NOTHING;
  -- password is: arqadex2025

  SELECT id INTO org_id FROM users WHERE email='org@arqadex.site' LIMIT 1;

  INSERT INTO events(id,slug,name,description,organizer_id,status,
    start_time,end_time,max_teams,team_size,prizes,banner,accent_color,categories)
  VALUES(
    'ae25','arqadex-prime-2025','ARQADEX PRIME 2025',
    'The flagship 48-hour CTF event by ARQADEX. Elite challenges across all domains.',
    org_id,'live',
    NOW() - INTERVAL '2 hours', NOW() + INTERVAL '46 hours',
    500,4,
    ARRAY['$5,000','$2,500','$1,000'],
    'linear-gradient(135deg,#020228,#0A0A3A,#02021A)',
    '#00F5FF',
    ARRAY['web','pwn','crypto','re','osint','dfir','stego','misc']
  ) ON CONFLICT(slug) DO NOTHING;

  INSERT INTO event_settings(event_id) VALUES('ae25') ON CONFLICT DO NOTHING;

  INSERT INTO events(id,slug,name,description,organizer_id,status,
    start_time,end_time,max_teams,team_size,prizes,banner,accent_color,categories)
  VALUES(
    'qs4','qualifier-series-iv','QUALIFIER SERIES IV',
    '24-hour qualifying event. Top 20 teams advance to Championship.',
    org_id,'published',
    NOW() + INTERVAL '38 days', NOW() + INTERVAL '39 days',
    200,4,
    ARRAY['Championship Seed','Championship Seed','Championship Seed'],
    'linear-gradient(135deg,#180A28,#280A28)',
    '#FF2DA6',
    ARRAY['web','crypto','re','misc']
  ) ON CONFLICT(slug) DO NOTHING;

  -- Challenges for ae25
  INSERT INTO challenges(id,event_id,name,category,description,points,difficulty,base_flag) VALUES
    ('w1','ae25','JWT_NIGHTMARE','web','The auth panel issues JWT tokens. The algorithm field is trusted from the client header.',350,3,'ARQADEX{alg0_n0ne_byp4ss}'),
    ('w2','ae25','GRAPHQL_INTRUSION','web','A modern API on GraphQL. Introspection is on. One mutation has no auth check.',500,4,'ARQADEX{graphql_secret_mutation}'),
    ('w3','ae25','SSRF_LABYRINTH','web','URL preview service. EC2 with IMDSv1. No SSRF protection.',450,4,'ARQADEX{ssrf_imds_v1_creds}'),
    ('p1','ae25','STACK_PHANTOM','pwn','Full protections. Format string leaks canary+libc. One ROP chain.',600,5,'ARQADEX{rop_chain_shell_landed}'),
    ('p2','ae25','HEAP_LABYRINTH','pwn','UAF + tcache. Poison freelist. Overwrite __free_hook.',700,5,'ARQADEX{tcache_free_hook_pwned}'),
    ('c1','ae25','ORACLE_WHISPERS','crypto','AES-CBC padding oracle. Server leaks one bit per query via status code.',400,3,'ARQADEX{padding_oracle_decrypted}'),
    ('c2','ae25','LATTICE_DREAMS','crypto','LWE-based KEM. q=97, sigma=0.5. Use LLL reduction.',650,5,'ARQADEX{lll_attack_lwe_broken}'),
    ('r1','ae25','BINARY_PHANTOM','re','Anti-debug binary. Patch the ptrace check. Feistel cipher inside.',400,3,'ARQADEX{anti_debug_bypassed}'),
    ('r2','ae25','VM_LABYRINTH','re','Custom stack VM with 32 opcodes. Reverse the bytecode.',650,5,'ARQADEX{vm_bytecode_reversed}'),
    ('o1','ae25','SHADOW_PROFILE','osint','Username from breach dump. Six platforms. Trace the full identity.',300,3,'ARQADEX{osint_pgp_identity}'),
    ('o2','ae25','METADATA_GHOST','osint','One photograph. EXIF GPS stripped. MakerNote was not.',200,2,'ARQADEX{exif_makernote_geo}'),
    ('d1','ae25','PHANTOM_BREACH','dfir','Windows memory dump. DLL injection into lsass. Reconstruct kill chain.',350,3,'ARQADEX{lsass_injection_c2}'),
    ('s1','ae25','FREQUENCY_GHOST','stego','30 seconds of static. Open in spectrogram viewer at 8-16kHz.',250,2,'ARQADEX{spectrogram_decoded}'),
    ('m1','ae25','DARK_PAYLOAD','misc','Python script with 7 obfuscation layers. What does it actually do?',400,3,'ARQADEX{7_layer_deobfuscated}')
  ON CONFLICT(id) DO NOTHING;

  -- Hints for a few challenges
  INSERT INTO challenge_hints(challenge_id,text,cost,sort_order) VALUES
    ('w1','The alg field in the JWT header is trusted by the server without validation.',50,0),
    ('w1','Try setting alg to "none" — what happens to signature verification?',75,1),
    ('c1','HTTP 400 = bad padding, HTTP 403 = valid decryption but wrong role. That is your oracle.',50,0),
    ('c1','Implement POODLE-style byte-by-byte recovery. ~3000 queries per block.',75,1),
    ('p1','%7$p leaks the canary. %21$p leaks a libc address.',80,0),
    ('p1','After leaking libc base, use: pop_rdi gadget → /bin/sh → system()',120,1)
  ON CONFLICT DO NOTHING;

END $$;
