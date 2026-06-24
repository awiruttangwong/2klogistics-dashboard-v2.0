create or replace view public.active_dates_summary as
select
  date,
  count(*)::integer as trips
from public.trips_active
group by date;
