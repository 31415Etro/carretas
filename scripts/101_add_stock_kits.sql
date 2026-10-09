-- Estoque e kits do MVP operacional.
-- Rode este arquivo no SQL Editor do Supabase antes de usar a página Estoque em produção.

alter table if exists public.materials
  add column if not exists composes_kit boolean not null default false;

create table if not exists public.stock_kits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  unit_value numeric(12,2) not null default 0,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.stock_kits
  add column if not exists unit_value numeric(12,2) not null default 0;

alter table if exists public.stock_kits
  add column if not exists stock_quantity integer not null default 0;

create table if not exists public.stock_kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.stock_kits(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(12,3) not null default 0,
  unit text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_kit_items_kit_id on public.stock_kit_items(kit_id);
create index if not exists idx_stock_kit_items_material_id on public.stock_kit_items(material_id);

drop trigger if exists trg_stock_kits_updated_at on public.stock_kits;
create trigger trg_stock_kits_updated_at
before update on public.stock_kits
for each row execute function public.set_updated_at();

alter table public.stock_kits enable row level security;
alter table public.stock_kit_items enable row level security;

drop policy if exists "stock_kits_service_role_all" on public.stock_kits;
create policy "stock_kits_service_role_all" on public.stock_kits
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "stock_kit_items_service_role_all" on public.stock_kit_items;
create policy "stock_kit_items_service_role_all" on public.stock_kit_items
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
