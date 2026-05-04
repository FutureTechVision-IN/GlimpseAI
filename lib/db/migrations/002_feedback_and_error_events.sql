-- ============================================================================
-- 002_feedback_and_error_events.sql
--
-- Adds two tables that turn one-off observability into a feedback loop:
--   1. feedback_entries — durable storage for the floating widget submissions,
--      so admins can triage, trend, and resolve user-reported issues / ideas.
--   2. error_events     — admin-actionable error log surfaced as in-app
--      notifications with deep links to root-cause and resolution steps.
--
-- These are additive only. Safe to run on production; no destructive ops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS feedback_entries (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER,
    user_role       TEXT,
    rating          INTEGER,
    category        TEXT NOT NULL DEFAULT 'other',
    message         TEXT NOT NULL,
    context_path    TEXT,
    context_feature TEXT,
    ip_hash         TEXT,
    user_agent      TEXT,
    status          TEXT NOT NULL DEFAULT 'new',
    assignee_id     INTEGER,
    resolution_note TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_entries_status_created_idx
    ON feedback_entries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_entries_category_created_idx
    ON feedback_entries (category, created_at DESC);

CREATE TABLE IF NOT EXISTS error_events (
    id                    SERIAL PRIMARY KEY,
    code                  TEXT NOT NULL,
    user_message          TEXT NOT NULL,
    admin_detail          TEXT NOT NULL,
    severity              TEXT NOT NULL DEFAULT 'medium',
    surface               TEXT,
    runbook_href          TEXT,
    user_id               INTEGER,
    route_path            TEXT,
    http_status           INTEGER,
    request_id            TEXT,
    suggested_resolution  TEXT,
    metadata              JSONB,
    status                TEXT NOT NULL DEFAULT 'open',
    acknowledged_at       TIMESTAMPTZ,
    resolved_at           TIMESTAMPTZ,
    acknowledged_by       INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS error_events_status_severity_idx
    ON error_events (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS error_events_code_created_idx
    ON error_events (code, created_at DESC);
