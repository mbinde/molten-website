-- Migration 0002: Add moderation columns for two-tier profanity filtering
--
-- This migration adds columns to support batch moderation with Perspective API:
-- - moderation_status: pending/approved/rejected
-- - moderation_checked_at: When batch moderation last ran
-- - toxicity_score: Perspective API toxicity score (0.0-1.0)
-- - profanity_score: Perspective API profanity score (0.0-1.0)
-- - severe_toxicity_score: Perspective API severe toxicity score (0.0-1.0)
--
-- Created: 2025-11-14

-- Add moderation columns to rating_submissions
ALTER TABLE rating_submissions
  ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK(moderation_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE rating_submissions
  ADD COLUMN moderation_checked_at INTEGER; -- Unix timestamp, NULL if never checked

ALTER TABLE rating_submissions
  ADD COLUMN toxicity_score REAL; -- 0.0-1.0 from Perspective API

ALTER TABLE rating_submissions
  ADD COLUMN profanity_score REAL; -- 0.0-1.0 from Perspective API

ALTER TABLE rating_submissions
  ADD COLUMN severe_toxicity_score REAL; -- 0.0-1.0 from Perspective API

-- Create index for efficient batch moderation queries
-- (fetch pending submissions ordered by submission time)
CREATE INDEX IF NOT EXISTS idx_rating_submissions_moderation
  ON rating_submissions(moderation_status, submitted_at);

-- Create index for approved ratings aggregation
CREATE INDEX IF NOT EXISTS idx_rating_submissions_approved_item
  ON rating_submissions(item_stable_id, moderation_status);
