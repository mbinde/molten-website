-- Migration 0002: Add moderation columns for two-tier profanity filtering
-- D1-compatible version (simplified syntax)
--
-- Created: 2025-11-14

-- Add moderation columns to rating_submissions
-- Note: D1 doesn't support adding constraints with ALTER TABLE ADD COLUMN
-- The constraint check will be enforced at application level

ALTER TABLE rating_submissions ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE rating_submissions ADD COLUMN moderation_checked_at INTEGER;
ALTER TABLE rating_submissions ADD COLUMN toxicity_score REAL;
ALTER TABLE rating_submissions ADD COLUMN profanity_score REAL;
ALTER TABLE rating_submissions ADD COLUMN severe_toxicity_score REAL;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_rating_submissions_moderation ON rating_submissions(moderation_status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_rating_submissions_approved_item ON rating_submissions(item_stable_id, moderation_status);
