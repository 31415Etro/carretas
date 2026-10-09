-- Orçamento e Contratos.
-- Rode este arquivo no SQL Editor do Supabase para criar as tabelas usadas pelas páginas /orcamento e /contratos.

create table if not exists public.budget_works (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  name text not null,
  notes text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_towers (
  id uuid primary key default gen_random_uuid(),
  budget_work_id uuid not null references public.budget_works(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_floors (
  id uuid primary key default gen_random_uuid(),
  budget_tower_id uuid not null references public.budget_towers(id) on delete cascade,
  name text not null,
  level text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_service_types (
  id uuid primary key default gen_random_uuid(),
  budget_floor_id uuid not null references public.budget_floors(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_environments (
  id uuid primary key default gen_random_uuid(),
  budget_service_type_id uuid not null references public.budget_service_types(id) on delete cascade,
  name text not null,
  points_quantity integer not null default 0,
  notes text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_points (
  id uuid primary key default gen_random_uuid(),
  budget_environment_id uuid not null references public.budget_environments(id) on delete cascade,
  name text not null,
  point_number integer not null,
  service_type text,
  infrastructure_measure text,
  measurement_confirmation text,
  notes text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null unique,
  client_name text not null,
  work_name text,
  budget_work_id uuid references public.budget_works(id) on delete set null,
  title text not null,
  start_date date,
  end_date date,
  value numeric(15,2) not null default 0,
  status text not null default 'Em elaboração' check (status in ('Em elaboração', 'Enviado', 'Assinado', 'Cancelado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text,
  description text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contract_history (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id) on delete cascade,
  action text not null,
  description text,
  status text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_budget_towers_work_id on public.budget_towers(budget_work_id);
create index if not exists idx_budget_floors_tower_id on public.budget_floors(budget_tower_id);
create index if not exists idx_budget_service_types_floor_id on public.budget_service_types(budget_floor_id);
create index if not exists idx_budget_environments_type_id on public.budget_environments(budget_service_type_id);
create index if not exists idx_budget_points_environment_id on public.budget_points(budget_environment_id);
create index if not exists idx_contracts_budget_work_id on public.contracts(budget_work_id);
create index if not exists idx_contract_history_contract_id on public.contract_history(contract_id);

drop trigger if exists trg_budget_works_updated_at on public.budget_works;
create trigger trg_budget_works_updated_at before update on public.budget_works for each row execute function public.set_updated_at();

drop trigger if exists trg_budget_towers_updated_at on public.budget_towers;
create trigger trg_budget_towers_updated_at before update on public.budget_towers for each row execute function public.set_updated_at();

drop trigger if exists trg_budget_floors_updated_at on public.budget_floors;
create trigger trg_budget_floors_updated_at before update on public.budget_floors for each row execute function public.set_updated_at();

drop trigger if exists trg_budget_service_types_updated_at on public.budget_service_types;
create trigger trg_budget_service_types_updated_at before update on public.budget_service_types for each row execute function public.set_updated_at();

drop trigger if exists trg_budget_environments_updated_at on public.budget_environments;
create trigger trg_budget_environments_updated_at before update on public.budget_environments for each row execute function public.set_updated_at();

drop trigger if exists trg_budget_points_updated_at on public.budget_points;
create trigger trg_budget_points_updated_at before update on public.budget_points for each row execute function public.set_updated_at();

drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at before update on public.contracts for each row execute function public.set_updated_at();

drop trigger if exists trg_contract_templates_updated_at on public.contract_templates;
create trigger trg_contract_templates_updated_at before update on public.contract_templates for each row execute function public.set_updated_at();

alter table public.budget_works enable row level security;
alter table public.budget_towers enable row level security;
alter table public.budget_floors enable row level security;
alter table public.budget_service_types enable row level security;
alter table public.budget_environments enable row level security;
alter table public.budget_points enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contract_history enable row level security;

drop policy if exists "budget_works_service_role_all" on public.budget_works;
create policy "budget_works_service_role_all" on public.budget_works for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "budget_towers_service_role_all" on public.budget_towers;
create policy "budget_towers_service_role_all" on public.budget_towers for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "budget_floors_service_role_all" on public.budget_floors;
create policy "budget_floors_service_role_all" on public.budget_floors for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "budget_service_types_service_role_all" on public.budget_service_types;
create policy "budget_service_types_service_role_all" on public.budget_service_types for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "budget_environments_service_role_all" on public.budget_environments;
create policy "budget_environments_service_role_all" on public.budget_environments for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "budget_points_service_role_all" on public.budget_points;
create policy "budget_points_service_role_all" on public.budget_points for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "contracts_service_role_all" on public.contracts;
create policy "contracts_service_role_all" on public.contracts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "contract_templates_service_role_all" on public.contract_templates;
create policy "contract_templates_service_role_all" on public.contract_templates for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "contract_history_service_role_all" on public.contract_history;
create policy "contract_history_service_role_all" on public.contract_history for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
