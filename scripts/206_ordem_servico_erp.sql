-- Ordem de Serviço ERP Carretas: novo fluxo de situações, carretas/veículos do
-- cliente, serviços executados, peças com preço, apontamento de horas, desconto
-- autorizado, garantia, histórico de situação e aceite do cliente.
-- Rode no SQL Editor do Supabase depois de 205_catalogo_produtos_servicos.sql.

-- ---------------------------------------------------------------- Carretas / veículos / equipamentos do cliente
create table if not exists public.customer_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_type text not null default 'Carreta' check (asset_type in ('Carreta', 'Semirreboque', 'Reboque', 'Caminhão', 'Cavalo mecânico', 'Veículo', 'Equipamento')),
  identification text not null,
  plate text,
  chassis text,
  renavam text,
  brand text,
  model text,
  manufacture_year integer,
  axles integer,
  notes text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_assets_client_idx on public.customer_assets (client_id);
create unique index if not exists customer_assets_plate_uidx on public.customer_assets (upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))) where plate is not null and plate <> '';
create unique index if not exists customer_assets_chassis_uidx on public.customer_assets (upper(chassis)) where chassis is not null and chassis <> '';

-- ---------------------------------------------------------------- Ordem de serviço
create sequence if not exists public.service_order_erp_seq;

-- Número da OS: OS26-00001 (ano + sequência), sem colidir com a numeração antiga.
create or replace function public.next_service_order_number()
returns text
language sql
as $$ select 'OS' || to_char(current_date, 'YY') || '-' || lpad(nextval('public.service_order_erp_seq')::text, 5, '0') $$;

alter table public.service_orders alter column work_id drop not null;
alter table public.service_orders drop constraint if exists service_orders_status_check;
alter table public.service_orders add constraint service_orders_status_check check (status in (
  'Aberta', 'Em análise', 'Aguardando orçamento', 'Aguardando aprovação', 'Aguardando peças', 'Em execução', 'Em conferência', 'Concluída', 'Entregue', 'Suspensa', 'Cancelada',
  -- situações do sistema anterior, mantidas para OS antigas
  'Criada', 'Agendada', 'A caminho', 'Em execucao', 'Pausada', 'Aguardando material', 'Finalizada', 'Finalizada parcialmente', 'Aguardando retorno'
));

alter table public.service_orders
  add column if not exists order_kind text,
  add column if not exists customer_asset_id uuid references public.customer_assets(id) on delete set null,
  add column if not exists due_date date,
  add column if not exists team_provider_ids uuid[] not null default '{}',
  add column if not exists entry_checklist jsonb not null default '[]'::jsonb,
  add column if not exists services_summary text,
  add column if not exists hours_worked numeric(10,2) not null default 0,
  add column if not exists labor_amount numeric(14,2) not null default 0,
  add column if not exists materials_amount numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0,
  add column if not exists discount_authorized_by text,
  add column if not exists cost_amount numeric(14,2) not null default 0,
  add column if not exists warranty_days integer not null default 0,
  add column if not exists warranty_until date,
  add column if not exists technical_notes text,
  add column if not exists status_reason text,
  add column if not exists suspended_from_status text,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_by text,
  add column if not exists source_budget_id uuid,
  -- OS de fabricação/montagem: carreta (produto do catálogo) produzida ao concluir
  add column if not exists production_product_id uuid references public.materials(id) on delete set null,
  add column if not exists production_quantity numeric(12,3) not null default 1 check (production_quantity > 0),
  add column if not exists production_serial text,
  add column if not exists production_record_id uuid references public.production_records(id) on delete set null;

-- ---------------------------------------------------------------- Serviços executados
create table if not exists public.service_order_services (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  service_type_id uuid references public.service_types(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit text not null default 'Servico',
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  executed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_order_services_order_idx on public.service_order_services (service_order_id);

-- ---------------------------------------------------------------- Peças: preço de venda e custo
alter table public.service_order_materials
  add column if not exists unit_price numeric(14,4) not null default 0,
  add column if not exists unit_cost numeric(14,4) not null default 0;

-- ---------------------------------------------------------------- Apontamento de horas
create table if not exists public.service_order_time_entries (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  work_date date not null default current_date,
  hours numeric(8,2) not null check (hours > 0 and hours <= 24),
  hourly_cost numeric(14,2) not null default 0 check (hourly_cost >= 0),
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists service_order_time_entries_order_idx on public.service_order_time_entries (service_order_id);

-- ---------------------------------------------------------------- Histórico de situações
create table if not exists public.service_order_status_history (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists service_order_status_history_order_idx on public.service_order_status_history (service_order_id, changed_at desc);

-- ---------------------------------------------------------------- Empresa (CNPJ) e compartilhamento
do $$
declare
  table_name text;
begin
  foreach table_name in array array['service_order_services', 'service_order_time_entries', 'service_order_status_history'] loop
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

  -- Carretas do cliente são compartilhadas pelo grupo, como o cadastro de clientes.
  alter table public.customer_assets enable row level security;
  drop policy if exists shared_authenticated_access on public.customer_assets;
  create policy shared_authenticated_access on public.customer_assets for all to authenticated using (true) with check (true);
end;
$$;

drop trigger if exists trg_customer_assets_updated_at on public.customer_assets;
create trigger trg_customer_assets_updated_at before update on public.customer_assets for each row execute function public.set_updated_at();
drop trigger if exists trg_service_order_services_updated_at on public.service_order_services;
create trigger trg_service_order_services_updated_at before update on public.service_order_services for each row execute function public.set_updated_at();
