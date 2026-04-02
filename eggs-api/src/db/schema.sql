-- Run in Supabase SQL editor

create table if not exists users (
  id text primary key,
  email text not null,
  display_name text,
  default_location_lat numeric,
  default_location_lng numeric,
  default_location_label text,
  default_settings jsonb default '{}',
  avoid_stores text[] default '{}',
  avoid_brands text[] default '{}',
  ai_provider text,
  subscription_tier text not null default 'free',
  subscription_status text default 'active',
  subscription_period_end timestamptz,
  stripe_customer_id text,
  created_at timestamptz default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  name text not null,
  client_name text,
  event_date date,
  headcount integer,
  budget_mode text not null default 'calculate',
  budget_ceiling numeric,
  status text not null default 'planning',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists dishes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  servings integer,
  notes text,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists ingredient_pool (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  clarified_name text,
  quantity numeric not null,
  unit text not null,
  category text,
  sources jsonb not null default '[]',
  created_at timestamptz default now()
);

create table if not exists shopping_plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  user_id text not null references users(id) on delete cascade,
  plan_data jsonb not null,
  model_used text,
  generated_at timestamptz default now()
);

create table if not exists reconcile_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  shopping_plan_id uuid references shopping_plans(id) on delete set null,
  user_id text not null references users(id) on delete cascade,
  mode text not null,
  actual_items jsonb default '[]',
  receipt_totals jsonb default '[]',
  summary jsonb,
  completed_at timestamptz default now()
);

-- Indexes
create index if not exists events_user_id on events(user_id);
create index if not exists events_user_id_created on events(user_id, created_at desc);
create index if not exists dishes_event_id on dishes(event_id);
create index if not exists dishes_user_id on dishes(user_id);
create index if not exists ingredient_pool_event_id on ingredient_pool(event_id);
create index if not exists ingredient_pool_user_id on ingredient_pool(user_id);
create index if not exists shopping_plans_user_id on shopping_plans(user_id);
create index if not exists shopping_plans_user_generated on shopping_plans(user_id, generated_at desc);
create index if not exists shopping_plans_event_id on shopping_plans(event_id);
create index if not exists reconcile_records_event_id on reconcile_records(event_id);
create index if not exists reconcile_records_user_id on reconcile_records(user_id);

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists events_updated_at on events;
create trigger events_updated_at
  before update on events
  for each row execute function update_updated_at();
