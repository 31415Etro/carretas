begin;

create table if not exists public.client_environments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  location text not null default '',
  floor text not null default '',
  notes text not null default '',
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_equipment (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  client_environment_id uuid not null references public.client_environments(id) on delete cascade,
  tag text not null default '',
  name text not null,
  type text not null default '',
  brand text not null default '',
  model text not null default '',
  serial_number text not null default '',
  capacity text not null default '',
  notes text not null default '',
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_orders add column if not exists order_type text not null default 'obra';
alter table public.service_orders add column if not exists client_environment_id uuid references public.client_environments(id) on delete set null;
alter table public.service_orders add column if not exists client_equipment_id uuid references public.client_equipment(id) on delete set null;

create index if not exists idx_client_environments_client_id on public.client_environments(client_id);
create index if not exists idx_client_equipment_client_id on public.client_equipment(client_id);
create index if not exists idx_client_equipment_environment_id on public.client_equipment(client_environment_id);
create index if not exists idx_service_orders_order_type on public.service_orders(order_type);
create index if not exists idx_service_orders_client_environment_id on public.service_orders(client_environment_id);
create index if not exists idx_service_orders_client_equipment_id on public.service_orders(client_equipment_id);

drop trigger if exists trg_client_environments_updated_at on public.client_environments;
create trigger trg_client_environments_updated_at before update on public.client_environments for each row execute function public.set_updated_at();

drop trigger if exists trg_client_equipment_updated_at on public.client_equipment;
create trigger trg_client_equipment_updated_at before update on public.client_equipment for each row execute function public.set_updated_at();

alter table public.client_environments enable row level security;
alter table public.client_equipment enable row level security;

drop policy if exists "client_environments_authenticated_all" on public.client_environments;
create policy "client_environments_authenticated_all" on public.client_environments for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "client_equipment_authenticated_all" on public.client_equipment;
create policy "client_equipment_authenticated_all" on public.client_equipment for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

commit;
