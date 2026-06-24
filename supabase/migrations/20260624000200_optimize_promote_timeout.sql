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
      finished_at = coalesce(finished_at, now()),
      error_message = null
  where id = p_sync_run_id;
end;
$$;
