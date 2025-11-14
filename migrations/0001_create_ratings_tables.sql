-- Migration 0001: Create ratings tables
--
-- This migration creates the rating system database schema:
-- - rating_submissions: Individual user ratings (star + CloudKit user ID)
-- - word_submissions: Individual words from ratings (5 per rating)
-- - rate_limits: Track submission rate limits per user
--
-- Created: 2025-11-13

-- Table: rating_submissions
-- Stores individual star ratings from users
CREATE TABLE IF NOT EXISTS rating_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_stable_id TEXT NOT NULL,
  cloudkit_user_id_hash TEXT NOT NULL,
  star_rating INTEGER NOT NULL CHECK(star_rating >= 1 AND star_rating <= 5),
  submitted_at INTEGER NOT NULL, -- Unix timestamp
  app_attest_token TEXT NOT NULL,

  -- Ensure one rating per user per item
  UNIQUE(item_stable_id, cloudkit_user_id_hash)
);

-- Indexes for rating_submissions
CREATE INDEX IF NOT EXISTS idx_rating_submissions_item
  ON rating_submissions(item_stable_id);

CREATE INDEX IF NOT EXISTS idx_rating_submissions_user
  ON rating_submissions(cloudkit_user_id_hash);

CREATE INDEX IF NOT EXISTS idx_rating_submissions_submitted
  ON rating_submissions(submitted_at);

-- Table: word_submissions
-- Stores individual words from ratings (5 words per rating)
CREATE TABLE IF NOT EXISTS word_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_stable_id TEXT NOT NULL,
  cloudkit_user_id_hash TEXT NOT NULL,
  word TEXT NOT NULL COLLATE NOCASE, -- Case-insensitive for aggregation
  position INTEGER NOT NULL CHECK(position >= 1 AND position <= 5),
  submitted_at INTEGER NOT NULL, -- Unix timestamp

  -- Ensure one word per position per user per item
  UNIQUE(item_stable_id, cloudkit_user_id_hash, position)
);

-- Indexes for word_submissions
CREATE INDEX IF NOT EXISTS idx_word_submissions_item
  ON word_submissions(item_stable_id);

CREATE INDEX IF NOT EXISTS idx_word_submissions_item_word
  ON word_submissions(item_stable_id, word);

CREATE INDEX IF NOT EXISTS idx_word_submissions_user
  ON word_submissions(cloudkit_user_id_hash);

-- Table: rate_limits
-- Tracks submission rate limits per user (60 per hour)
CREATE TABLE IF NOT EXISTS rate_limits (
  cloudkit_user_id_hash TEXT PRIMARY KEY,
  submission_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL -- Unix timestamp (hourly window)
);

-- Index for rate_limits cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON rate_limits(window_start);

-- Table: aggregation_log
-- Tracks when aggregations were last run (for cron job)
CREATE TABLE IF NOT EXISTS aggregation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  items_aggregated INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('running', 'completed', 'failed')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_aggregation_log_started
  ON aggregation_log(started_at);
