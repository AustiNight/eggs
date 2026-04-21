-- Migration 002: add best_basket_total column to shopping_plans.
-- Safe to run once. Apply via Supabase SQL Editor or supabase migration up.

alter table shopping_plans
  add column best_basket_total numeric(10, 2);

-- Backfill: null means "legacy plan, compute at read time via selector".
-- New inserts populate this at write time from computeBestBasketTotal().
