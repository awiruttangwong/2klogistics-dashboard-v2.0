-- Compact sync storage for the production read model.
--
-- The first Supabase shadow design kept every full sync run in trips_staging and
-- copied raw_payload jsonb into both staging and active. That was useful during
-- migration review, but it is not a sustainable production storage model.
--
-- Production flow after this migration:
--   1. reset_sync_staging() truncates trips_staging before each write.
--   2. sync writes one normalized candidate snapshot into trips_staging.
--   3. promote_sync_run() atomically replaces trips_active from staging.
--   4. promote_sync_run() truncates trips_staging immediately after promotion.

alter table if exists public.trips_staging
  alter column raw_payload drop not null,
  alter column raw_payload drop default;

alter table if exists public.trips_active
  alter column raw_payload drop not null,
  alter column raw_payload drop default;

drop index if exists public.trips_staging_payload_hash_idx;
drop index if exists public.trips_active_payload_hash_idx;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'trips_staging'
      and c.relpersistence <> 'u'
  ) then
    alter table public.trips_staging set unlogged;
  end if;
end;
$$;

create or replace function public.reset_sync_staging()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.trips_staging;
end;
$$;

create or replace function public.promote_sync_run(p_sync_run_id uuid)
returns void
language plpgsql
set statement_timeout = '120s'
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

  update public.summary_snapshots
  set is_active = false
  where is_active = true;

  truncate table public.trips_active;

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
    imported_at
  from public.trips_staging
  where sync_run_id = p_sync_run_id
  order by date, row_identity_key;

  update public.summary_snapshots
  set is_active = true
  where sync_run_id = p_sync_run_id;

  update public.sync_runs
  set status = 'promoted',
      is_active = true,
      promoted_at = now(),
      finished_at = coalesce(finished_at, now()),
      error_message = null
  where id = p_sync_run_id;

  truncate table public.trips_staging;
end;
$$;
