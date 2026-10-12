-- Frota ERP Carretas: veículos/implementos, motoristas, documentos, manutenção,
-- abastecimento e (opcional, transporte rodoviário) pneus por posição, engate e viagens.
-- Rode no SQL Editor do Supabase depois de 206_ordem_servico_erp.sql.

-- ===== Veículos (cadastro ampliado; tabela compartilhada entre empresas) =====
alter table public.vehicles alter column plate drop not null;
alter table public.vehicles alter column model drop not null;
alter table public.vehicles alter column brand drop not null;
alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check check (status in ('Disponivel', 'Em uso', 'Em manutencao', 'Parado', 'Vendido', 'Inativo'));

create sequence if not exists public.vehicle_code_seq;

create table if not exists public.fleet_drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cpf text not null,
  phone text,
  cnh_number text not null,
  cnh_category text not null,
  cnh_expiry date not null,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fleet_drivers_cpf_uidx on public.fleet_drivers (cpf);

alter table public.vehicles
  add column if not exists internal_code text not null default ('VEI-' || lpad(nextval('public.vehicle_code_seq')::text, 5, '0')),
  add column if not exists vehicle_type text not null default 'Caminhao',
  add column if not exists fleet_number text,
  add column if not exists chassis text,
  add column if not exists manufacture_year integer,
  add column if not exists model_year integer,
  add column if not exists owner_name text,
  add column if not exists owner_document text,
  add column if not exists unit_company_id uuid references public.system_companies(id) on delete set null,
  add column if not exists body_type text,
  add column if not exists load_capacity_kg numeric(12,2) not null default 0,
  add column if not exists tare_kg numeric(12,2) not null default 0,
  add column if not exists axles integer not null default 0,
  add column if not exists current_hours numeric(12,1) not null default 0,
  add column if not exists driver_id uuid references public.fleet_drivers(id) on delete set null,
  add column if not exists acquisition_date date,
  add column if not exists acquisition_value numeric(14,2) not null default 0,
  add column if not exists insurer text,
  add column if not exists policy_number text,
  add column if not exists policy_expiry date,
  add column if not exists coupled_vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists photo_path text;

create unique index if not exists vehicles_internal_code_uidx on public.vehicles (internal_code);
create unique index if not exists vehicles_fleet_number_uidx on public.vehicles (lower(fleet_number)) where fleet_number is not null;
create unique index if not exists vehicles_chassis_uidx on public.vehicles (upper(chassis)) where chassis is not null and chassis <> '';

create table if not exists public.vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  doc_type text not null,
  description text,
  expiry_date date,
  file_path text,
  file_name text,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_documents_vehicle_idx on public.vehicle_documents (vehicle_id);

-- ===== Manutenção (amplia a tabela existente) =====
alter table public.vehicle_maintenance
  add column if not exists maintenance_type text not null default 'Corretiva',
  add column if not exists odometer numeric(12,2),
  add column if not exists hours numeric(12,1),
  add column if not exists service_description text,
  add column if not exists service_order_id uuid references public.service_orders(id) on delete set null,
  add column if not exists parts_replaced text,
  add column if not exists workshop text,
  add column if not exists parts_cost numeric(14,2) not null default 0,
  add column if not exists labor_cost numeric(14,2) not null default 0,
  add column if not exists next_date date,
  add column if not exists next_km numeric(12,2),
  add column if not exists next_hours numeric(12,1),
  add column if not exists stopped_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists downtime_hours numeric(10,2),
  add column if not exists released_by text;
alter table public.vehicle_maintenance alter column type drop not null;
alter table public.vehicle_maintenance alter column start_date drop not null;
alter table public.vehicle_maintenance drop constraint if exists vehicle_maintenance_status_check;
alter table public.vehicle_maintenance add constraint vehicle_maintenance_status_check check (status in ('Programada', 'Em andamento', 'Realizada', 'Cancelada'));
alter table public.vehicle_maintenance drop constraint if exists vehicle_maintenance_maintenance_type_check;
alter table public.vehicle_maintenance add constraint vehicle_maintenance_maintenance_type_check check (maintenance_type in ('Preventiva', 'Corretiva'));

-- ===== Abastecimento =====
create table if not exists public.fuel_entries (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_id uuid references public.fleet_drivers(id) on delete set null,
  fuel_date date not null,
  station text,
  fuel_type text not null,
  liters numeric(12,3) not null check (liters > 0),
  price_per_liter numeric(10,4) not null check (price_per_liter > 0),
  total_amount numeric(14,2) not null default 0,
  odometer numeric(12,2),
  receipt_path text,
  receipt_name text,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists fuel_entries_vehicle_idx on public.fuel_entries (vehicle_id, fuel_date desc);

-- ===== Transporte rodoviário (opcional) =====
create table if not exists public.vehicle_tires (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  position text not null,
  serial_number text,
  brand text,
  size text,
  fitted_date date,
  fitted_km numeric(12,2),
  condition text not null default 'Novo' check (condition in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca')),
  notes text,
  updated_at timestamptz not null default now(),
  unique (vehicle_id, position)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  trailer_id uuid references public.vehicles(id) on delete set null,
  driver_id uuid references public.fleet_drivers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  origin text,
  destination text,
  start_date date not null,
  end_date date,
  start_km numeric(12,2) not null default 0,
  end_km numeric(12,2),
  freight_amount numeric(14,2) not null default 0,
  tolls_amount numeric(14,2) not null default 0,
  allowance_amount numeric(14,2) not null default 0,
  other_costs numeric(14,2) not null default 0,
  status text not null default 'Planejada' check (status in ('Planejada', 'Em andamento', 'Concluída', 'Cancelada')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists trips_vehicle_idx on public.trips (vehicle_id, start_date desc);

-- ===== Configuração: a empresa opera transporte rodoviário? =====
create table if not exists public.fleet_settings (
  id boolean primary key default true check (id),
  road_transport boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.fleet_settings (id) values (true) on conflict do nothing;

-- ===== Arquivos (fotos, documentos, comprovantes) =====
insert into storage.buckets (id, name, public) values ('fleet-files', 'fleet-files', false) on conflict (id) do nothing;

-- ===== Empresa (CNPJ): abastecimento e viagens são por empresa; o resto é compartilhado =====
do $$
declare
  table_name text;
begin
  foreach table_name in array array['fuel_entries', 'trips'] loop
    execute format('alter table public.%I add column if not exists system_company_id uuid not null default %L::uuid references public.system_companies(id) on delete restrict', table_name, '00000000-0000-4000-8000-000000000001');
    execute format('create index if not exists %I on public.%I (system_company_id)', table_name || '_system_company_idx', table_name);
    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
  foreach table_name in array array['fleet_drivers', 'vehicle_documents', 'vehicle_tires', 'fleet_settings'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
  end loop;
  foreach table_name in array array['fleet_drivers', 'vehicle_tires', 'trips', 'fleet_settings'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;
