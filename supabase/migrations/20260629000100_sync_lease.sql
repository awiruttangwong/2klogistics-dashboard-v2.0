-- Serialize every staging writer. Repeated deadline recovery is safe only when
-- one worker can reset and promote the shared compact staging table at a time.
create table if not exists public.sync_leases (
  name text primary key,
  owner_id uuid,
  acquired_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.sync_leases enable row level security;

create or replace function public.acquire_sync_lease(
  p_name text,
  p_owner_id uuid,
  p_ttl_seconds integer default 2400
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acquired boolean;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'sync lease name is required';
  end if;
  if p_owner_id is null then
    raise exception 'sync lease owner is required';
  end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 7200 then
    raise exception 'sync lease ttl must be between 60 and 7200 seconds';
  end if;

  insert into public.sync_leases (name)
  values (p_name)
  on conflict (name) do nothing;

  update public.sync_leases
  set owner_id = p_owner_id,
      acquired_at = now(),
      expires_at = now() + make_interval(secs => p_ttl_seconds),
      updated_at = now()
  where name = p_name
    and (
      owner_id is null
      or expires_at is null
      or expires_at <= now()
      or owner_id = p_owner_id
    )
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_sync_lease(
  p_name text,
  p_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released boolean;
begin
  update public.sync_leases
  set owner_id = null,
      acquired_at = null,
      expires_at = null,
      updated_at = now()
  where name = p_name
    and owner_id = p_owner_id
  returning true into v_released;

  return coalesce(v_released, false);
end;
$$;

revoke all on table public.sync_leases from anon, authenticated;
revoke all on function public.acquire_sync_lease(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_sync_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_sync_lease(text, uuid, integer) to service_role;
grant execute on function public.release_sync_lease(text, uuid) to service_role;
