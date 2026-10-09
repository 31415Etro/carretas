create table if not exists public.pmoc_plans (
  id uuid primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  work_id uuid references public.works(id) on delete set null,
  name text not null,
  frequency text not null default 'Mensal',
  start_month integer not null default 1,
  start_year integer not null default extract(year from now())::integer,
  start_date date,
  end_date date,
  status text not null default 'Ativo',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pmoc_sectors (
  id uuid primary key,
  pmoc_plan_id uuid not null references public.pmoc_plans(id) on delete cascade,
  name text not null,
  floor text,
  status text not null default 'Ativo',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pmoc_equipment (
  id uuid primary key,
  pmoc_plan_id uuid not null references public.pmoc_plans(id) on delete cascade,
  pmoc_sector_id uuid not null references public.pmoc_sectors(id) on delete cascade,
  client_environment_id uuid references public.client_environments(id) on delete set null,
  client_equipment_id uuid references public.client_equipment(id) on delete set null,
  tag text,
  name text not null,
  brand text,
  model text,
  serial_number text,
  capacity text,
  location text,
  status text not null default 'Ativo',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pmoc_equipment_services (
  id uuid primary key,
  pmoc_plan_id uuid not null references public.pmoc_plans(id) on delete cascade,
  pmoc_equipment_id uuid not null references public.pmoc_equipment(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (pmoc_equipment_id, service_type_id)
);

create table if not exists public.pmoc_schedules (
  id uuid primary key,
  pmoc_plan_id uuid not null references public.pmoc_plans(id) on delete cascade,
  pmoc_equipment_id uuid not null references public.pmoc_equipment(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete restrict,
  month integer not null,
  year integer not null,
  scheduled_date date,
  service_order_id uuid references public.service_orders(id) on delete set null,
  status text not null default 'Planejado',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pmoc_plans_client_id on public.pmoc_plans(client_id);
create index if not exists idx_pmoc_plans_work_id on public.pmoc_plans(work_id);
create index if not exists idx_pmoc_sectors_plan_id on public.pmoc_sectors(pmoc_plan_id);
create index if not exists idx_pmoc_equipment_plan_id on public.pmoc_equipment(pmoc_plan_id);
create index if not exists idx_pmoc_equipment_sector_id on public.pmoc_equipment(pmoc_sector_id);
create index if not exists idx_pmoc_schedules_plan_id on public.pmoc_schedules(pmoc_plan_id);
create index if not exists idx_pmoc_schedules_date_status on public.pmoc_schedules(scheduled_date, status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pmoc_plans_updated_at on public.pmoc_plans;
create trigger trg_pmoc_plans_updated_at before update on public.pmoc_plans for each row execute function public.set_updated_at();

drop trigger if exists trg_pmoc_sectors_updated_at on public.pmoc_sectors;
create trigger trg_pmoc_sectors_updated_at before update on public.pmoc_sectors for each row execute function public.set_updated_at();

drop trigger if exists trg_pmoc_equipment_updated_at on public.pmoc_equipment;
create trigger trg_pmoc_equipment_updated_at before update on public.pmoc_equipment for each row execute function public.set_updated_at();

drop trigger if exists trg_pmoc_schedules_updated_at on public.pmoc_schedules;
create trigger trg_pmoc_schedules_updated_at before update on public.pmoc_schedules for each row execute function public.set_updated_at();

alter table public.pmoc_plans enable row level security;
alter table public.pmoc_sectors enable row level security;
alter table public.pmoc_equipment enable row level security;
alter table public.pmoc_equipment_services enable row level security;
alter table public.pmoc_schedules enable row level security;

drop policy if exists "pmoc_plans_service_role_all" on public.pmoc_plans;
create policy "pmoc_plans_service_role_all" on public.pmoc_plans for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "pmoc_sectors_service_role_all" on public.pmoc_sectors;
create policy "pmoc_sectors_service_role_all" on public.pmoc_sectors for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "pmoc_equipment_service_role_all" on public.pmoc_equipment;
create policy "pmoc_equipment_service_role_all" on public.pmoc_equipment for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "pmoc_equipment_services_service_role_all" on public.pmoc_equipment_services;
create policy "pmoc_equipment_services_service_role_all" on public.pmoc_equipment_services for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "pmoc_schedules_service_role_all" on public.pmoc_schedules;
create policy "pmoc_schedules_service_role_all" on public.pmoc_schedules for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
