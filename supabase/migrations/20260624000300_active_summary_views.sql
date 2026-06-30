create or replace view public.active_routes_summary as
select
  route,
  route_key,
  route_group,
  route_core,
  route_vehicle,
  route_prefix,
  count(*)::integer as trips
from public.trips_active
group by
  route,
  route_key,
  route_group,
  route_core,
  route_vehicle,
  route_prefix;

create or replace view public.active_customers_summary as
select
  customer,
  count(*)::integer as trips
from public.trips_active
group by customer;
