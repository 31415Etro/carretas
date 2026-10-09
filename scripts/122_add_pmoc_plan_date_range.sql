alter table public.pmoc_plans
  add column if not exists start_date date,
  add column if not exists end_date date;

update public.pmoc_plans
set start_date = make_date(start_year, greatest(1, least(12, start_month)), 10)
where start_date is null;

update public.pmoc_plans
set end_date = make_date(start_year, 12, 31)
where end_date is null;

create index if not exists idx_pmoc_plans_date_range on public.pmoc_plans(start_date, end_date);
