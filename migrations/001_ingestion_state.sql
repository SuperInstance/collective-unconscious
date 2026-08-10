-- Collective Unconscious: Ingestion State Tracking
-- Migration 001: Ingestion pipeline state

CREATE TABLE IF NOT EXISTS ingestion_state (
  source TEXT PRIMARY KEY,
  last_timestamp TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_source ON ingestion_state(source);
