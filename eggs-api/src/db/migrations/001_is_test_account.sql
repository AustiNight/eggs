-- Migration 001: add is_test_account flag to users table.
-- Safe to run repeatedly. Apply via Supabase SQL Editor.

alter table users
  add column if not exists is_test_account boolean not null default false;

-- Optional: index to quickly filter test accounts out of analytics queries
create index if not exists users_is_test_account on users(is_test_account)
  where is_test_account = true;
