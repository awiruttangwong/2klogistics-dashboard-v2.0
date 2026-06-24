-- Supabase shadow migration schema for the V3 dashboard migration.
-- This schema is intentionally staging-first:
--   1. write one sync run into trips_staging
--   2. validate parity against Apps Script TRIPS_CACHE/SUMMARY_CACHE
--   3. promote the run into trips_active only after parity passes

create extension if not exists pgcrypto;

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial_failed', 'failed', 'parity_failed', 'promoted')),
  is_active boolean not null default false,
  promoted_at timestamptz,
  superseded_at timestamptz,
  source_months jsonb not null default '[]'::jsonb,
  rows_read integer not null default 0,
  rows_written integer not null default 0,
  rows_failed integer not null default 0,
  error_message text,
  app_version text,
  created_at timestamptz not null default now()
);

create unique index if not exists sync_runs_one_active_idx
  on public.sync_runs (is_active)
  where is_active;

create table if not exists public.source_month_imports (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  source_month text not null,
  source_url text,
  source_sheet_name text,
  old_rows integer not null default 0,
  new_rows integer not null default 0,
  total_rows integer not null default 0,
  skipped boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  unique (sync_run_id, source_month)
);

create table if not exists public.trips_staging (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  row_identity_key text not null,
  identity_base_key text not null,
  identity_ordinal integer not null default 1 check (identity_ordinal > 0),
  payload_hash text not null,
  source_month text,

  date date not null,
  customer text not null,
  vtype text,
  route_desc text,
  route text not null,

  route_key text not null,
  route_core text,
  route_vehicle text,
  route_prefix text,
  route_group text,
  is_flash_route boolean not null default false,

  driver text,
  plate text,
  payee text,

  oil numeric(14, 2) not null default 0,
  recv numeric(14, 2) not null default 0,
  pay numeric(14, 2) not null default 0,
  margin numeric(14, 2) not null default 0,
  pct numeric(10, 4),

  reason text,
  anomalies jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,

  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sync_run_id, row_identity_key)
);

create table if not exists public.trips_active (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id),
  row_identity_key text not null unique,
  identity_base_key text not null,
  identity_ordinal integer not null default 1 check (identity_ordinal > 0),
  payload_hash text not null,
  source_month text,

  date date not null,
  customer text not null,
  vtype text,
  route_desc text,
  route text not null,

  route_key text not null,
  route_core text,
  route_vehicle text,
  route_prefix text,
  route_group text,
  is_flash_route boolean not null default false,

  driver text,
  plate text,
  payee text,

  oil numeric(14, 2) not null default 0,
  recv numeric(14, 2) not null default 0,
  pay numeric(14, 2) not null default 0,
  margin numeric(14, 2) not null default 0,
  pct numeric(10, 4),

  reason text,
  anomalies jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,

  imported_at timestamptz not null,
  activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.summary_snapshots (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  payload_hash text not null,
  payload jsonb not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (sync_run_id)
);

create unique index if not exists summary_snapshots_one_active_idx
  on public.summary_snapshots (is_active)
  where is_active;

create table if not exists public.oil_prices (
  period_no text primary key,
  period_name date not null,
  year_en integer not null,
  update_date timestamptz not null,
  price numeric(10, 2) not null,
  source text not null default 'PTTOR',
  source_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.parity_reports (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  ok boolean not null default false,
  trip_count_diff integer not null default 0,
  recv_diff numeric(14, 2) not null default 0,
  pay_diff numeric(14, 2) not null default 0,
  oil_diff numeric(14, 2) not null default 0,
  margin_diff numeric(14, 2) not null default 0,
  daily_diff jsonb not null default '[]'::jsonb,
  route_diff jsonb not null default '[]'::jsonb,
  missing_rows jsonb not null default '[]'::jsonb,
  extra_rows jsonb not null default '[]'::jsonb,
  contract_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_audit_changes (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  change_type text not null check (change_type in ('ADDED', 'REMOVED', 'CHANGED')),
  row_identity_key text,
  before_data jsonb,
  after_data jsonb,
  changed_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trips_staging_sync_run_idx on public.trips_staging(sync_run_id);
create index if not exists trips_staging_date_idx on public.trips_staging(date);
create index if not exists trips_staging_route_key_idx on public.trips_staging(route_key);
create index if not exists trips_staging_payload_hash_idx on public.trips_staging(payload_hash);

create index if not exists trips_active_date_idx on public.trips_active(date);
create index if not exists trips_active_customer_idx on public.trips_active(customer);
create index if not exists trips_active_route_key_idx on public.trips_active(route_key);
create index if not exists trips_active_vtype_idx on public.trips_active(vtype);
create index if not exists trips_active_date_route_key_idx on public.trips_active(date, route_key);
create index if not exists trips_active_payload_hash_idx on public.trips_active(payload_hash);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trips_staging_set_updated_at on public.trips_staging;
create trigger trips_staging_set_updated_at
before update on public.trips_staging
for each row execute function public.set_updated_at();

drop trigger if exists trips_active_set_updated_at on public.trips_active;
create trigger trips_active_set_updated_at
before update on public.trips_active
for each row execute function public.set_updated_at();

create or replace function public.promote_sync_run(p_sync_run_id uuid)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.parity_reports
    where sync_run_id = p_sync_run_id
      and ok = true
  ) then
    raise exception 'Cannot promote sync_run %, parity report has not passed', p_sync_run_id;
  end if;

  if not exists (
    select 1
    from public.trips_staging
    where sync_run_id = p_sync_run_id
  ) then
    raise exception 'Cannot promote sync_run %, trips_staging has no rows', p_sync_run_id;
  end if;

  if not exists (
    select 1
    from public.summary_snapshots
    where sync_run_id = p_sync_run_id
  ) then
    raise exception 'Cannot promote sync_run %, summary snapshot is missing', p_sync_run_id;
  end if;

  update public.sync_runs
  set is_active = false,
      superseded_at = now()
  where is_active = true;

  delete from public.trips_active;

  insert into public.trips_active (
    sync_run_id,
    row_identity_key,
    identity_base_key,
    identity_ordinal,
    payload_hash,
    source_month,
    date,
    customer,
    vtype,
    route_desc,
    route,
    route_key,
    route_core,
    route_vehicle,
    route_prefix,
    route_group,
    is_flash_route,
    driver,
    plate,
    payee,
    oil,
    recv,
    pay,
    margin,
    pct,
    reason,
    anomalies,
    raw_payload,
    imported_at
  )
  select
    sync_run_id,
    row_identity_key,
    identity_base_key,
    identity_ordinal,
    payload_hash,
    source_month,
    date,
    customer,
    vtype,
    route_desc,
    route,
    route_key,
    route_core,
    route_vehicle,
    route_prefix,
    route_group,
    is_flash_route,
    driver,
    plate,
    payee,
    oil,
    recv,
    pay,
    margin,
    pct,
    reason,
    anomalies,
    raw_payload,
    imported_at
  from public.trips_staging
  where sync_run_id = p_sync_run_id
  order by date, row_identity_key;

  update public.summary_snapshots
  set is_active = false
  where is_active = true;

  update public.summary_snapshots
  set is_active = true
  where sync_run_id = p_sync_run_id;

  update public.sync_runs
  set status = 'promoted',
      is_active = true,
      promoted_at = now(),
      finished_at = coalesce(finished_at, now())
  where id = p_sync_run_id;
end;
$$;

create or replace function public.get_staging_parity_summary(p_sync_run_id uuid)
returns jsonb
language sql
stable
as $$
  with base as (
    select *
    from public.trips_staging
    where sync_run_id = p_sync_run_id
  ),
  totals as (
    select
      count(*)::integer as trip_count,
      coalesce(sum(recv), 0)::numeric(14, 2) as recv_sum,
      coalesce(sum(pay), 0)::numeric(14, 2) as pay_sum,
      coalesce(sum(oil), 0)::numeric(14, 2) as oil_sum,
      coalesce(sum(margin), 0)::numeric(14, 2) as margin_sum
    from base
  ),
  daily_group as (
    select
      date,
      count(*)::integer as trip_count,
      coalesce(sum(recv), 0)::numeric(14, 2) as recv_sum,
      coalesce(sum(pay), 0)::numeric(14, 2) as pay_sum,
      coalesce(sum(oil), 0)::numeric(14, 2) as oil_sum,
      coalesce(sum(margin), 0)::numeric(14, 2) as margin_sum
    from base
    group by date
  ),
  route_group as (
    select
      route_key,
      count(*)::integer as trip_count,
      coalesce(sum(recv), 0)::numeric(14, 2) as recv_sum,
      coalesce(sum(pay), 0)::numeric(14, 2) as pay_sum,
      coalesce(sum(oil), 0)::numeric(14, 2) as oil_sum,
      coalesce(sum(margin), 0)::numeric(14, 2) as margin_sum
    from base
    group by route_key
  ),
  daily_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', date,
          'trip_count', trip_count,
          'recv_sum', recv_sum,
          'pay_sum', pay_sum,
          'oil_sum', oil_sum,
          'margin_sum', margin_sum
        )
        order by date
      ),
      '[]'::jsonb
    ) as rows
    from daily_group
  ),
  route_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'route_key', route_key,
          'trip_count', trip_count,
          'recv_sum', recv_sum,
          'pay_sum', pay_sum,
          'oil_sum', oil_sum,
          'margin_sum', margin_sum
        )
        order by route_key
      ),
      '[]'::jsonb
    ) as rows
    from route_group
  )
  select jsonb_build_object(
    'trip_count', totals.trip_count,
    'recv_sum', totals.recv_sum,
    'pay_sum', totals.pay_sum,
    'oil_sum', totals.oil_sum,
    'margin_sum', totals.margin_sum,
    'daily', daily_json.rows,
    'route', route_json.rows
  )
  from totals, daily_json, route_json;
$$;

alter table public.sync_runs enable row level security;
alter table public.source_month_imports enable row level security;
alter table public.trips_staging enable row level security;
alter table public.trips_active enable row level security;
alter table public.summary_snapshots enable row level security;
alter table public.oil_prices enable row level security;
alter table public.parity_reports enable row level security;
alter table public.sync_audit_changes enable row level security;
