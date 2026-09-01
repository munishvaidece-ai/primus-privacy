-- ============================================================================
-- LOCAL/CI TESTING ONLY — DO NOT RUN AGAINST A REAL SUPABASE PROJECT.
-- ============================================================================
-- A real Supabase project already provides everything in this file
-- natively: the `auth` schema, `auth.users`, `auth.uid()`, and the
-- `anon`/`authenticated`/`service_role` Postgres roles. Running this
-- script there would be redundant at best and could conflict with
-- Supabase's own definitions at worst.
--
-- This script exists because, per DECISIONS.md D-03, no Supabase project
-- has been provisioned yet (data residency is unresolved). It stands up
-- the minimum compatible stand-in so migrations 0000/0001 — which are
-- otherwise ordinary, Supabase-deployable SQL — can be exercised against
-- a real PostgreSQL 16 instance for the RLS test suite (tests/rls). See
-- PROGRESS.md for this documented limitation.
--
-- `auth.uid()` here is a byte-for-byte match of Supabase's real
-- implementation (reads the `request.jwt.claim.sub` GUC), so RLS
-- policies written against it behave identically here and in production.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- Real Supabase's service_role has BYPASSRLS; make sure a pre-existing
-- role from an earlier test run has it too.
ALTER ROLE service_role BYPASSRLS;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Matches Supabase's actual posture: auth.users is readable only by
-- service_role, never by anon/authenticated directly (they only ever see
-- their own identity via auth.uid(), not the auth.users table itself).
GRANT SELECT ON auth.users TO service_role;
GRANT INSERT, SELECT, UPDATE ON auth.users TO service_role;
