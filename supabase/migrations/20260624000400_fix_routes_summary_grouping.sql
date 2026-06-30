create or replace view public.active_routes_summary as
select
  min(route) as route,
  route_key,
  min(route_group) as route_group,
  min(route_core) as route_core,
  min(route_vehicle) as route_vehicle,
  min(route_prefix) as route_prefix,
  count(*)::integer as trips
from public.trips_active
group by route_key;
