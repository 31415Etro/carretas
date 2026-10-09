begin;

alter table public.pmoc_plans
  add column if not exists schedule_day integer,
  add column if not exists main_provider_id uuid references public.providers(id) on delete set null;

update public.pmoc_plans
set schedule_day = greatest(1, least(31, extract(day from coalesce(start_date, make_date(start_year, greatest(1, least(12, start_month)), 10)))::integer))
where schedule_day is null;

alter table public.pmoc_plans
  alter column schedule_day set default 10,
  alter column schedule_day set not null;

alter table public.pmoc_plans
  drop constraint if exists pmoc_plans_schedule_day_valid;

alter table public.pmoc_plans
  add constraint pmoc_plans_schedule_day_valid check (schedule_day between 1 and 31);

create index if not exists idx_pmoc_plans_main_provider_id
  on public.pmoc_plans(main_provider_id);

commit;
