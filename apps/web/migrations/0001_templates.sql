-- Create templates table for community submissions
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  schema_xml TEXT NOT NULL,
  variables TEXT,              -- JSON object
  tags TEXT,                   -- JSON array
  wizard_config TEXT,          -- JSON object

  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_github TEXT,

  status TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/rejected
  github_pr_number INTEGER,
  github_pr_url TEXT,

  submitted_at TEXT NOT NULL,
  approved_at TEXT,
  download_count INTEGER DEFAULT 0
);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);

-- Index for filtering by tags (will need full-text search for better performance)
CREATE INDEX IF NOT EXISTS idx_templates_submitted ON templates(submitted_at DESC);
