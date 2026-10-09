-- Plantas vinculadas aos orcamentos e posicoes normalizadas dos pontos.
-- Execute no SQL Editor do Supabase.

create table if not exists public.budget_plans (
  id uuid primary key default gen_random_uuid(),
  budget_work_id uuid not null references public.budget_works(id) on delete cascade,
  budget_tower_id uuid references public.budget_towers(id) on delete set null,
  name text not null,
  file_url text not null,
  file_name text not null,
  storage_path text not null,
  page_count integer not null default 1 check (page_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_plan_points (
  id uuid primary key default gen_random_uuid(),
  budget_plan_id uuid not null references public.budget_plans(id) on delete cascade,
  budget_point_id uuid not null references public.budget_points(id) on delete cascade,
  page_number integer not null default 1 check (page_number > 0),
  x numeric(9,8) not null check (x >= 0 and x <= 1),
  y numeric(9,8) not null check (y >= 0 and y <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_plan_id, budget_point_id)
);

create index if not exists idx_budget_plans_work on public.budget_plans(budget_work_id);
create index if not exists idx_budget_plans_tower on public.budget_plans(budget_tower_id);
create index if not exists idx_budget_plan_points_plan on public.budget_plan_points(budget_plan_id);
create index if not exists idx_budget_plan_points_point on public.budget_plan_points(budget_point_id);

drop trigger if exists trg_budget_plans_updated_at on public.budget_plans;
create trigger trg_budget_plans_updated_at before update on public.budget_plans for each row execute function public.set_updated_at();
drop trigger if exists trg_budget_plan_points_updated_at on public.budget_plan_points;
create trigger trg_budget_plan_points_updated_at before update on public.budget_plan_points for each row execute function public.set_updated_at();

alter table public.budget_plans enable row level security;
alter table public.budget_plan_points enable row level security;

drop policy if exists "budget_plans_service_role_all" on public.budget_plans;
create policy "budget_plans_service_role_all" on public.budget_plans for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "budget_plan_points_service_role_all" on public.budget_plan_points;
create policy "budget_plan_points_service_role_all" on public.budget_plan_points for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
