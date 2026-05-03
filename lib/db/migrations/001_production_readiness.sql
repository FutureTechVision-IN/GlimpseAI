-- Idempotent upgrades for existing PostgreSQL databases.
-- Applied automatically by ./start.sh (native/hybrid) before drizzle-kit push.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premium_trial_ends_at" timestamp with time zone;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'media_jobs'
  ) THEN
    ALTER TABLE "media_jobs" ADD COLUMN IF NOT EXISTS "reference_code" text;
    ALTER TABLE "media_jobs" ADD COLUMN IF NOT EXISTS "media_purged_at" timestamp with time zone;

    -- Clear duplicate reference_code rows (keep lowest id) so UNIQUE can be applied without truncating.
    UPDATE "media_jobs" mj
    SET reference_code = NULL
    FROM (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY reference_code ORDER BY id) AS rn
        FROM "media_jobs"
        WHERE reference_code IS NOT NULL
      ) ranked
      WHERE rn > 1
    ) dup
    WHERE mj.id = dup.id;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'media_jobs'
        AND c.conname = 'media_jobs_reference_code_unique'
    ) THEN
      ALTER TABLE "media_jobs" ADD CONSTRAINT media_jobs_reference_code_unique UNIQUE (reference_code);
    END IF;
  END IF;
END $$;
