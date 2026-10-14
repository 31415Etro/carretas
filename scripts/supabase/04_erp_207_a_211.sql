-- ERP Carretas - arquivo consolidado para o SQL Editor do Supabase.
-- Scripts de origem, nesta ordem: 207_remover_estruturas_herdadas.sql 208_frota_erp.sql 209_comercial.sql 210_orcamentos.sql 211_contratos.sql
-- Nao edite aqui; os originais continuam em scripts/ e scripts/base/.

-- ============================================================
-- >>> INICIO: 207_remover_estruturas_herdadas.sql
-- ============================================================
-- ERP Carretas: remove do banco as estruturas herdadas do sistema anterior
-- (climatização: PMOC, obras, ambientes, equipamentos, kits por metragem, CNO,
-- orçamento por obra, modelos de contrato e o CRM antigo de leads).
--
-- ATENÇÃO: ESTE SCRIPT APAGA TABELAS E DADOS. Rode SOMENTE no banco do ERP de
-- carretas, depois de 200-206 e de conferir que nada dessas tabelas é necessário.
-- Não rode em um banco que ainda guarde dados do sistema anterior.

begin;

-- PMOC
drop table if exists public.pmoc_schedules, public.pmoc_equipment_services, public.pmoc_equipment, public.pmoc_sectors, public.pmoc_plans cascade;

-- Clientes: ambientes e equipamentos climatizados
drop table if exists public.client_equipment, public.client_environments cascade;

-- Obras, estrutura de orçamento por obra e plantas
drop table if exists public.budget_plan_points, public.budget_plans, public.budget_points, public.budget_environments,
  public.budget_service_types, public.budget_floors, public.budget_towers, public.budget_works cascade;
drop table if exists public.point_photos, public.environment_photos, public.work_points, public.work_environments, public.work_floors, public.works cascade;

-- Kits por metragem e OS de estoque
drop table if exists public.stock_service_orders, public.stock_kit_items, public.stock_kits cascade;

-- Prospecção por CNO, funil BANT e pedidos de orçamento por WhatsApp
drop table if exists public.commercial_leads, public.comercial_cno_records, public.whatsapp_budget_request_photos, public.whatsapp_budget_requests cascade;

-- Formulários de campo e configuração do fluxo de OS anterior
drop table if exists public.vehicle_checklists, public.vehicle_usage, public.operational_statuses, public.execution_steps cascade;

-- Contratos e modelos do sistema anterior (o módulo Contratos será recriado com a nova especificação)
drop table if exists public.contract_history, public.contract_templates, public.contracts cascade;

-- CRM antigo de leads/franquias
drop table if exists public.interactions, public.tasks, public.comments, public.sales_targets, public.sd_activities,
  public.sd_closer_metrics, public.leads, public.projects, public.franchises, public.message_templates, public.companies cascade;

-- Colunas de obra/ambiente/ponto/PMOC em tabelas que continuam existindo
alter table if exists public.service_orders
  drop column if exists work_id, drop column if exists floor_id, drop column if exists environment_id, drop column if exists point_id,
  drop column if exists client_environment_id, drop column if exists client_equipment_id, drop column if exists work_structure_id;
alter table if exists public.accounts_payable drop column if exists work_id, drop column if exists environment_id, drop column if exists point_id;
alter table if exists public.accounts_receivable drop column if exists work_id, drop column if exists environment_id, drop column if exists point_id;
alter table if exists public.financial_transactions drop column if exists work_id, drop column if exists environment_id, drop column if exists point_id;
alter table if exists public.credit_card_invoice_items drop column if exists linked_work_id;
alter table if exists public.clients drop column if exists service_contexts, drop column if exists monthly_pmoc_value;
alter table if exists public.service_types
  drop column if exists kit_id, drop column if exists execution_percentage, drop column if exists periodicity_months,
  drop column if exists enabled_contexts, drop column if exists required_photos,
  drop column if exists orientation_video_url, drop column if exists orientation_video_description;
alter table if exists public.materials drop column if exists composes_kit;

-- Empresa padrão do grupo: nome do ERP de carretas
update public.system_companies
  set name = 'Carretas', legal_name = 'Carretas', trade_name = 'Carretas'
  where id = '00000000-0000-4000-8000-000000000001' and name ilike 'M & C%';

commit;


-- <<< FIM: 207_remover_estruturas_herdadas.sql

-- ============================================================
-- >>> INICIO: 208_frota_erp.sql
-- ============================================================
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


-- <<< FIM: 208_frota_erp.sql

-- ============================================================
-- >>> INICIO: 209_comercial.sql
-- ============================================================
-- Comercial ERP Carretas: cadastro único de clientes/fornecedores (com dados fiscais e comerciais),
-- vendedores, oportunidades (funil) e histórico de interações.
-- Rode no SQL Editor do Supabase depois de 208_frota_erp.sql.

-- ===== Vendedores =====
create table if not exists public.salespeople (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Clientes: campos fiscais e comerciais =====
-- "party_id" liga o cliente e o fornecedor quando a mesma pessoa/empresa é os dois (tipo "ambos").
alter table public.clients
  add column if not exists party_id uuid,
  add column if not exists municipal_registration text,
  add column if not exists icms_indicator text not null default '9' check (icms_indicator in ('1', '2', '9')),
  add column if not exists contact_role text,
  add column if not exists salesperson_id uuid references public.salespeople(id) on delete set null,
  add column if not exists credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  add column if not exists payment_condition_id uuid references public.payment_conditions(id) on delete set null,
  add column if not exists commercial_notes text;

-- ===== Fornecedores: mesmo cadastro completo =====
alter table public.suppliers
  add column if not exists party_id uuid,
  add column if not exists person_type text not null default 'PJ' check (person_type in ('PF', 'PJ')),
  add column if not exists trade_name text,
  add column if not exists state_registration text,
  add column if not exists municipal_registration text,
  add column if not exists icms_indicator text not null default '1' check (icms_indicator in ('1', '2', '9')),
  add column if not exists zip_code text,
  add column if not exists street text,
  add column if not exists number text,
  add column if not exists complement text,
  add column if not exists district text,
  add column if not exists contact_role text,
  add column if not exists payment_condition_id uuid references public.payment_conditions(id) on delete set null,
  add column if not exists commercial_notes text;

create index if not exists clients_party_idx on public.clients (party_id) where party_id is not null;
create index if not exists suppliers_party_idx on public.suppliers (party_id) where party_id is not null;
-- CPF/CNPJ não se repete entre clientes nem entre fornecedores (evita cadastrar o mesmo de novo).
-- Se já houver duplicados no banco, o índice não é criado: ajuste os cadastros e rode este trecho de novo.
do $$
begin
  create unique index if not exists clients_document_uidx on public.clients ((regexp_replace(upper(document), '[^0-9A-Z]', '', 'g'))) where coalesce(document, '') <> '';
exception when unique_violation then
  raise notice 'Há clientes com CPF/CNPJ duplicado: unifique-os e crie o índice clients_document_uidx.';
end;
$$;
do $$
begin
  create unique index if not exists suppliers_document_uidx on public.suppliers ((regexp_replace(upper(document), '[^0-9A-Z]', '', 'g'))) where coalesce(document, '') <> '';
exception when unique_violation then
  raise notice 'Há fornecedores com CPF/CNPJ duplicado: unifique-os e crie o índice suppliers_document_uidx.';
end;
$$;

-- ===== Oportunidades =====
create sequence if not exists public.opportunity_number_seq;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  code text not null default ('OP-' || lpad(nextval('public.opportunity_number_seq')::text, 6, '0')),
  title text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  salesperson_id uuid not null references public.salespeople(id) on delete restrict,
  origin text,
  interest text not null,
  material_id uuid references public.materials(id) on delete set null,
  estimated_value numeric(14,2) not null default 0 check (estimated_value >= 0),
  stage text not null default 'Novo lead' check (stage in ('Novo lead', 'Contato realizado', 'Qualificação', 'Orçamento', 'Negociação', 'Ganho', 'Perdido')),
  probability integer not null default 10 check (probability between 0 and 100),
  expected_close_date date,
  next_contact_date date,
  loss_reason text,
  quote_id uuid,
  quote_number text,
  closed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists opportunities_code_uidx on public.opportunities (code);
create index if not exists opportunities_stage_idx on public.opportunities (stage, next_contact_date);
create index if not exists opportunities_client_idx on public.opportunities (client_id);
create index if not exists opportunities_salesperson_idx on public.opportunities (salesperson_id);

create table if not exists public.opportunity_interactions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  kind text not null,
  description text not null,
  interaction_at timestamptz not null default now(),
  automatic boolean not null default false,
  author text,
  created_at timestamptz not null default now()
);
create index if not exists opportunity_interactions_idx on public.opportunity_interactions (opportunity_id, interaction_at desc);

-- OS aberta a partir de uma venda ganha
alter table public.service_orders add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
create index if not exists service_orders_opportunity_idx on public.service_orders (opportunity_id) where opportunity_id is not null;

-- ===== Empresa (CNPJ) e permissões =====
do $$
declare
  table_name text;
begin
  foreach table_name in array array['opportunities', 'opportunity_interactions'] loop
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
  execute 'alter table public.salespeople enable row level security';
  execute 'drop policy if exists tenant_authenticated_access on public.salespeople';
  execute 'create policy tenant_authenticated_access on public.salespeople as permissive for all to authenticated using (true) with check (true)';
  foreach table_name in array array['salespeople', 'opportunities'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;


-- <<< FIM: 209_comercial.sql

-- ============================================================
-- >>> INICIO: 210_orcamentos.sql
-- ============================================================
-- Orçamentos ERP Carretas: orçamentos com versões, itens do catálogo com preço negociado
-- (congelado no orçamento), anexos, histórico, aceite e conversão em venda/OS com títulos a receber.
-- Rode no SQL Editor do Supabase depois de 209_comercial.sql.

create sequence if not exists public.quote_number_seq;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null default ('ORC-' || lpad(nextval('public.quote_number_seq')::text, 6, '0')),
  version integer not null default 1 check (version >= 1),
  title text,
  client_id uuid not null references public.clients(id) on delete restrict,
  salesperson_id uuid not null references public.salespeople(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  issue_date date not null default current_date,
  valid_until date not null,
  quote_type text not null check (quote_type in ('Produto', 'Serviço', 'Misto')),
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Expirado', 'Convertido', 'Cancelado', 'Substituído')),
  items_subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  freight_amount numeric(14,2) not null default 0 check (freight_amount >= 0),
  expenses_amount numeric(14,2) not null default 0 check (expenses_amount >= 0),
  tax_percent numeric(6,3) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  taxes_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  estimated_cost numeric(14,2) not null default 0,
  payment_condition_id uuid references public.payment_conditions(id) on delete set null,
  payment_condition_name text,
  payment_condition_snapshot jsonb,
  delivery_text text,
  warranty_days integer not null default 0 check (warranty_days >= 0),
  notes text,
  sent_at timestamptz,
  sent_via text,
  sent_to text,
  approved_at timestamptz,
  accepted_by text,
  accept_notes text,
  refusal_reason text,
  converted_at timestamptz,
  converted_to text check (converted_to in ('Venda', 'OS')),
  receivables_generated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until >= issue_date)
);
create unique index if not exists quotes_number_version_uidx on public.quotes (quote_number, version);
create index if not exists quotes_status_idx on public.quotes (status, valid_until);
create index if not exists quotes_client_idx on public.quotes (client_id);
create index if not exists quotes_opportunity_idx on public.quotes (opportunity_id) where opportunity_id is not null;

-- Itens: o preço unitário e o custo ficam congelados no orçamento (não seguem o cadastro).
create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position integer not null default 0,
  line_type text not null check (line_type in ('Produto', 'Serviço')),
  material_id uuid references public.materials(id) on delete set null,
  service_type_id uuid references public.service_types(id) on delete set null,
  description text not null,
  unit text not null default 'UN',
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  catalog_price numeric(14,4) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  discount_percent numeric(6,3) not null default 0 check (discount_percent between 0 and 100),
  total numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists quote_items_quote_idx on public.quote_items (quote_id, position);

create table if not exists public.quote_attachments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists quote_attachments_quote_idx on public.quote_attachments (quote_id);

-- Histórico: criação, alterações, envio, aceite, versões e conversão.
create table if not exists public.quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  event text not null,
  description text not null,
  author text,
  created_at timestamptz not null default now()
);
create index if not exists quote_events_quote_idx on public.quote_events (quote_id, created_at desc);

-- Vínculos com OS e logotipo da empresa (usado no PDF)
alter table public.service_orders add column if not exists source_quote_id uuid references public.quotes(id) on delete set null;
create index if not exists service_orders_source_quote_idx on public.service_orders (source_quote_id) where source_quote_id is not null;
alter table public.system_companies add column if not exists logo_path text;

insert into storage.buckets (id, name, public) values ('quote-files', 'quote-files', false) on conflict (id) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['quotes', 'quote_items', 'quote_attachments', 'quote_events'] loop
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
  execute 'drop trigger if exists trg_quotes_updated_at on public.quotes';
  execute 'create trigger trg_quotes_updated_at before update on public.quotes for each row execute function public.set_updated_at()';
end;
$$;


-- <<< FIM: 210_orcamentos.sql

-- ============================================================
-- >>> INICIO: 211_contratos.sql
-- ============================================================
-- Contratos ERP Carretas: contratos de receita (cliente) e de despesa (fornecedor), recorrência financeira
-- sem duplicidade, cronograma de OS de manutenção, obrigações, aditivos e documentos que nunca se sobrescrevem.
-- Rode no SQL Editor do Supabase depois de 210_orcamentos.sql.

-- O sistema anterior tinha uma tabela "contracts" com outra estrutura: ela é removida pelo 207.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contracts')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'direction') then
    raise exception 'Existe uma tabela contracts do sistema anterior. Rode 207_remover_estruturas_herdadas.sql (em banco sem dados a preservar) antes deste script.';
  end if;
end;
$$;

create sequence if not exists public.contract_number_seq;

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null default ('CTR-' || lpad(nextval('public.contract_number_seq')::text, 6, '0')),
  contract_type text not null check (contract_type in ('Prestação de serviços', 'Fornecimento', 'Manutenção recorrente', 'Comercial / venda', 'Outro')),
  -- Receita: a empresa é a contratada e o cliente é o contratante. Despesa: a empresa é a contratante e o fornecedor é a contratada.
  direction text not null default 'Receita' check (direction in ('Receita', 'Despesa')),
  title text not null,
  client_id uuid references public.clients(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  signed_date date,
  start_date date not null,
  end_date date,
  indefinite boolean not null default false,
  total_value numeric(14,2) not null default 0 check (total_value >= 0),
  initial_recurring_value numeric(14,2) not null default 0 check (initial_recurring_value >= 0),
  recurring_value numeric(14,2) not null default 0 check (recurring_value >= 0),
  billing_periodicity text check (billing_periodicity in ('Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual')),
  due_day integer check (due_day between 1 and 31),
  billing_start_date date,
  billing_advance_days integer not null default 10 check (billing_advance_days between 0 and 90),
  payment_method text not null,
  adjustment_index text not null default 'Nenhum' check (adjustment_index in ('Nenhum', 'IPCA', 'IGP-M', 'INPC', 'Percentual fixo', 'Outro')),
  adjustment_percent numeric(7,3),
  next_adjustment_date date,
  notice_days integer not null default 0 check (notice_days >= 0),
  auto_renew boolean not null default false,
  renewal_months integer check (renewal_months > 0),
  penalty_terms text,
  scope text not null,
  sla text,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  responsible_name text not null,
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Aguardando assinatura', 'Vigente', 'Suspenso', 'Encerrado', 'Rescindido', 'Cancelado')),
  status_reason text,
  version integer not null default 1,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((direction = 'Receita' and client_id is not null) or (direction = 'Despesa' and supplier_id is not null)),
  check (end_date is null or end_date >= start_date)
);
create unique index if not exists contracts_number_uidx on public.contracts (contract_number);
create index if not exists contracts_status_idx on public.contracts (status, end_date);
create index if not exists contracts_client_idx on public.contracts (client_id) where client_id is not null;
create index if not exists contracts_supplier_idx on public.contracts (supplier_id) where supplier_id is not null;

-- Cada competência é cobrada uma única vez: a linha é "reservada" aqui antes de criar o título.
create table if not exists public.contract_billings (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  competence_date date not null,
  period_end date not null,
  due_date date not null,
  amount numeric(14,2) not null,
  receivable_id uuid,
  payable_id uuid,
  created_at timestamptz not null default now(),
  unique (contract_id, competence_date)
);

create table if not exists public.contract_amendments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  amendment_number integer not null,
  kind text not null check (kind in ('Aditivo de valor', 'Aditivo de prazo', 'Reajuste', 'Renovação', 'Alteração de escopo', 'Outro')),
  description text not null,
  effective_date date not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  new_recurring_value numeric(14,2),
  created_by text,
  created_at timestamptz not null default now(),
  unique (contract_id, amendment_number)
);

-- Documentos: somente inclusão. Versões novas entram como novas linhas; nada é sobrescrito nem apagado.
create table if not exists public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  amendment_id uuid references public.contract_amendments(id) on delete restrict,
  kind text not null check (kind in ('Contrato assinado', 'Aditivo', 'Evidência de aceite', 'Rescisão', 'Outro')),
  title text not null,
  version integer not null default 1,
  is_original boolean not null default false,
  file_path text not null,
  file_name text not null,
  signed_at date,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists contract_documents_contract_idx on public.contract_documents (contract_id, kind, version);

create or replace function public.protect_contract_documents()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Documentos de contrato não podem ser alterados nem apagados: envie uma nova versão.';
end;
$$;
drop trigger if exists protect_contract_documents on public.contract_documents;
create trigger protect_contract_documents before update or delete on public.contract_documents for each row execute function public.protect_contract_documents();

create table if not exists public.contract_obligations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  kind text not null default 'Obrigação' check (kind in ('Obrigação', 'Documento')),
  title text not null,
  description text,
  party text not null default 'Contratada' check (party in ('Contratante', 'Contratada')),
  responsible_name text,
  due_date date,
  status text not null default 'Pendente' check (status in ('Pendente', 'Cumprida', 'Cancelada')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contract_obligations_contract_idx on public.contract_obligations (contract_id, status, due_date);

-- Cronograma de OS de manutenção
create table if not exists public.contract_os_plans (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  title text not null,
  periodicity text not null check (periodicity in ('Semanal', 'Quinzenal', 'Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual')),
  order_kind text not null default 'Manutenção preventiva',
  service_type_id uuid not null references public.service_types(id) on delete restrict,
  technician_id uuid not null references public.providers(id) on delete restrict,
  customer_asset_id uuid references public.customer_assets(id) on delete set null,
  priority text not null default 'Media',
  description text,
  lead_days integer not null default 3 check (lead_days between 0 and 60),
  next_run_date date not null,
  last_run_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contract_os_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.contract_os_plans(id) on delete cascade,
  scheduled_date date not null,
  service_order_id uuid,
  created_at timestamptz not null default now(),
  unique (plan_id, scheduled_date)
);

create table if not exists public.contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  event text not null,
  description text not null,
  author text,
  created_at timestamptz not null default now()
);
create index if not exists contract_events_contract_idx on public.contract_events (contract_id, created_at desc);

-- Alertas já enviados por e-mail (cada alerta é avisado uma vez)
create table if not exists public.contract_alert_log (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  alert_key text not null,
  recipient text,
  notified_at timestamptz not null default now(),
  unique (contract_id, alert_key)
);

-- Vínculos: OS gerada por contrato, orçamento convertido em contrato, bucket de arquivos
alter table public.service_orders add column if not exists contract_id uuid references public.contracts(id) on delete set null;
create index if not exists service_orders_contract_idx on public.service_orders (contract_id) where contract_id is not null;
alter table public.quotes drop constraint if exists quotes_converted_to_check;
alter table public.quotes add constraint quotes_converted_to_check check (converted_to in ('Venda', 'OS', 'Contrato'));
insert into storage.buckets (id, name, public) values ('contract-files', 'contract-files', false) on conflict (id) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['contracts', 'contract_billings', 'contract_amendments', 'contract_documents', 'contract_obligations', 'contract_os_plans', 'contract_os_runs', 'contract_events', 'contract_alert_log'] loop
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
  foreach table_name in array array['contracts', 'contract_obligations', 'contract_os_plans'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;


-- <<< FIM: 211_contratos.sql

