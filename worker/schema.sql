-- Competitor Post Radar — D1 schema

CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  linkedin_url TEXT NOT NULL UNIQUE,
  list_name TEXT NOT NULL DEFAULT 'Default',
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  website_url TEXT, -- public site researched weekly by the OpenRouter-backed research job; NULL skips research
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id),
  post_url TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'text', -- text | image | video | document | poll
  posted_at TEXT, -- ISO date, best-effort (LinkedIn only exposes relative time in the DOM)
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  first_captured_at TEXT NOT NULL,
  last_captured_at TEXT NOT NULL,
  captured_by TEXT,
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(competitor_id, post_url)
);

CREATE INDEX IF NOT EXISTS idx_posts_competitor ON posts(competitor_id);
CREATE INDEX IF NOT EXISTS idx_posts_last_captured ON posts(last_captured_at);
CREATE INDEX IF NOT EXISTS idx_posts_engagement ON posts(likes, comments, reposts);

-- One row per capture event, so engagement growth on a post over time stays visible
-- instead of being overwritten (per PRD data-model note).
CREATE TABLE IF NOT EXISTS post_snapshots (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  likes INTEGER NOT NULL,
  comments INTEGER NOT NULL,
  reposts INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  captured_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_post ON post_snapshots(post_id);

-- One row per digest audience. list_name = 'all' means every active competitor.
CREATE TABLE IF NOT EXISTS digest_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Weekly digest',
  list_name TEXT NOT NULL DEFAULT 'all',
  recipients TEXT NOT NULL DEFAULT '[]', -- JSON array of email addresses
  min_likes INTEGER NOT NULL DEFAULT 25,
  top_n INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1
);

-- One row per weekly research run per competitor (not overwritten, so a history accumulates).
CREATE TABLE IF NOT EXISTS research_notes (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id),
  summary TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_competitor ON research_notes(competitor_id);
CREATE INDEX IF NOT EXISTS idx_research_created ON research_notes(created_at);
