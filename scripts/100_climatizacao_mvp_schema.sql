-- M&C Climatizacao - MVP operational/financial schema
-- Run this file in Supabase SQL Editor.
-- Important: rotate the service_role key if it was shared outside your private environment.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.system_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  phone text,
  profile text not null check (profile in ('Administrador', 'Supervisor', 'Atendimento', 'Tecnico', 'Cliente')),
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('PF', 'PJ')),
  name text not null,
  document text,
  corporate_name text,
  trade_name text,
  state_registration text,
  responsible_name text,
  phone text,
  mobile text,
  email text,
  zip_code text,
  street text,
  number text,
  complement text,
  district text,
  city text,
  state text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo', 'Prospect')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  role text,
  phone text,
  email text,
  main boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- works means Obra/Local.
create table if not exists public.works (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  code text not null unique,
  name text not null,
  type text,
  status text not null default 'Ativa' check (status in ('Ativa', 'Em execucao', 'Pausada', 'Finalizada', 'Inativa')),
  zip_code text,
  street text,
  number text,
  complement text,
  district text,
  city text,
  state text,
  responsible_name text,
  responsible_phone text,
  responsible_email text,
  responsible_role text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_floors (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  name text not null,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_id, name)
);

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  execution_percentage numeric(7,3) not null default 0,
  enabled_contexts text[] not null default array['obra'],
  required_photos text[] not null default '{}',
  orientation_video_url text,
  orientation_video_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_environments (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  floor_id uuid references public.work_floors(id) on delete set null,
  floor text,
  final text,
  environment_name text not null,
  service_type_id uuid references public.service_types(id) on delete set null,
  points_quantity integer not null default 1 check (points_quantity >= 0),
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.environment_photos (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.work_environments(id) on delete cascade,
  file_url text,
  file_name text,
  photo_type text not null check (photo_type in ('Antes', 'Referencia', 'Local de instalacao', 'Problema encontrado', 'Outro')),
  description text,
  uploaded_by uuid references public.system_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.work_points (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  environment_id uuid not null references public.work_environments(id) on delete cascade,
  point_number integer not null check (point_number > 0),
  point_name text not null,
  service_type_id uuid references public.service_types(id) on delete set null,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo', 'Pendente', 'Finalizado')),
  equipment_expected text,
  btus text,
  brand text,
  model text,
  serial_number text,
  evaporator_location text,
  condenser_location text,
  has_drain boolean,
  has_electric_point boolean,
  has_piping boolean,
  infrastructure_measure text,
  measurement_confirmation text,
  technical_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, point_number)
);

create table if not exists public.point_photos (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references public.work_points(id) on delete cascade,
  file_url text,
  file_name text,
  photo_type text not null check (photo_type in ('Antes', 'Referencia', 'Local de instalacao', 'Problema encontrado', 'Outro')),
  description text,
  uploaded_by uuid references public.system_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  cpf text,
  rg text,
  birth_date date,
  phone text,
  email text,
  zip_code text,
  street text,
  number text,
  complement text,
  district text,
  city text,
  state text,
  role text not null,
  relationship_type text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo', 'Em ferias', 'Bloqueado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  type text not null,
  file_url text,
  file_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique,
  model text not null,
  brand text not null,
  year text,
  color text,
  current_km numeric(12,2) not null default 0,
  front_right_tire text default 'Novo' check (front_right_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca')),
  front_left_tire text default 'Novo' check (front_left_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca')),
  rear_right_tire text default 'Novo' check (rear_right_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca')),
  rear_left_tire text default 'Novo' check (rear_left_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca')),
  last_oil_change_date date,
  last_oil_change_km numeric(12,2),
  status text not null default 'Disponivel' check (status in ('Disponivel', 'Em uso', 'Em manutencao', 'Inativo')),
  renavam text,
  licensing_due_date date,
  insurance_info text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  unit text not null,
  internal_code text,
  minimum_stock numeric(12,3) not null default 0,
  current_stock numeric(12,3) not null default 0,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_type_checklist_items (
  id uuid primary key default gen_random_uuid(),
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  task_name text not null,
  required boolean not null default true,
  requires_photo boolean not null default false,
  order_index integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_type_materials (
  id uuid primary key default gen_random_uuid(),
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  quantity numeric(12,3) not null default 0,
  unit text not null,
  required boolean not null default true
);

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  order_type text not null default 'obra',
  service_category text,
  client_id uuid not null references public.clients(id) on delete restrict,
  work_id uuid not null references public.works(id) on delete restrict,
  floor_id uuid references public.work_floors(id) on delete set null,
  environment_id uuid references public.work_environments(id) on delete set null,
  point_id uuid references public.work_points(id) on delete set null,
  service_type_id uuid references public.service_types(id) on delete set null,
  simple_service boolean not null default false,
  priority text not null default 'Media' check (priority in ('Baixa', 'Media', 'Alta', 'Urgente')),
  description text,
  scheduled_date date,
  scheduled_start_time time,
  scheduled_end_time time,
  estimated_duration text,
  allow_reschedule boolean not null default true,
  schedule_notes text,
  main_provider_id uuid references public.providers(id) on delete set null,
  helper_provider_id uuid references public.providers(id) on delete set null,
  supervisor_id uuid references public.providers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  initial_km numeric(12,2),
  final_km numeric(12,2),
  total_amount numeric(12,2) not null default 0,
  status text not null default 'Criada' check (status in ('Criada', 'Agendada', 'A caminho', 'Em execucao', 'Pausada', 'Aguardando material', 'Finalizada', 'Finalizada parcialmente', 'Aguardando retorno', 'Cancelada')),
  customer_responsible_name text,
  customer_responsible_phone text,
  team_notes text,
  notes text,
  pause_reason text,
  cancellation_reason text,
  partial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.service_order_events (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  step_name text not null,
  status text not null,
  provider_id uuid references public.providers(id) on delete set null,
  event_datetime timestamptz not null default now(),
  latitude numeric(10,7),
  longitude numeric(10,7),
  notes text,
  file_id uuid,
  created_at timestamptz not null default now(),
  unique (service_order_id, step_name)
);

create table if not exists public.service_order_checklist_items (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  task_name text not null,
  required boolean not null default true,
  requires_photo boolean not null default false,
  status text not null default 'Pendente' check (status in ('Pendente', 'Em andamento', 'Concluida', 'Nao se aplica')),
  responsible_provider_id uuid references public.providers(id) on delete set null,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_order_materials (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  item_name text not null,
  expected_quantity numeric(12,3) not null default 0,
  used_quantity numeric(12,3) not null default 0,
  unit text not null,
  status text not null default 'Previsto' check (status in ('Previsto', 'Solicitado', 'Separado', 'Retirado', 'Utilizado', 'Devolvido', 'Pendente')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_order_files (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  category text not null,
  file_url text,
  file_name text,
  file_type text,
  uploaded_by uuid references public.providers(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.service_order_signatures (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  responsible_name text not null,
  responsible_document text,
  signature_url text,
  signature_text text,
  rating text,
  customer_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_checklists (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  provider_id uuid references public.providers(id) on delete set null,
  cleanliness_state text not null,
  conservation_state text not null,
  front_right_tire text not null,
  front_left_tire text not null,
  rear_right_tire text not null,
  rear_left_tire text not null,
  mandatory_safety_items boolean not null default false,
  oil_level text not null,
  brakes_test text not null,
  windshield_wipers text not null,
  mirrors text not null,
  lights text not null,
  fuel_level text not null,
  notes text,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_order_id)
);

create table if not exists public.vehicle_usage (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  provider_id uuid references public.providers(id) on delete set null,
  service_order_id uuid references public.service_orders(id) on delete set null,
  date date not null,
  initial_km numeric(12,2) not null default 0,
  final_km numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  type text not null,
  start_date date not null,
  end_date date,
  km numeric(12,2),
  cost numeric(12,2) not null default 0,
  description text,
  next_maintenance date,
  status text not null default 'Programada' check (status in ('Programada', 'Realizada')),
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.operational_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#2563EB',
  order_index integer not null default 1,
  final_status boolean not null default false,
  editable boolean not null default true,
  requires_reason boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.execution_steps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_index integer not null default 1,
  requires_photo boolean not null default false,
  requires_location boolean not null default false,
  requires_notes boolean not null default false,
  changes_status_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Financial module.
create table if not exists public.dre_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.dre_accounts(id) on delete set null,
  type text not null check (type in ('receita', 'deducao', 'custo', 'despesa', 'resultado')),
  order_index integer not null default 1,
  signal text not null default 'positivo' check (signal in ('positivo', 'negativo', 'calculado')),
  formula text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('entrada', 'saida', 'ambos')),
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.financial_categories(id) on delete cascade,
  name text not null,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text,
  card_last_digits text,
  holder_name text,
  card_account text,
  closing_day integer check (closing_day between 1 and 31),
  due_day integer check (due_day between 1 and 31),
  credit_limit numeric(12,2) not null default 0,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_payable (
  id uuid primary key default gen_random_uuid(),
  supplier_name text,
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  work_id uuid references public.works(id) on delete set null,
  environment_id uuid references public.work_environments(id) on delete set null,
  point_id uuid references public.work_points(id) on delete set null,
  service_order_id uuid references public.service_orders(id) on delete set null,
  provider_id uuid references public.providers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  competence_date date,
  due_date date not null,
  payment_date date,
  expected_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  payment_method text,
  bank_account_id uuid,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  credit_card_invoice_id uuid,
  status text not null default 'Aberta' check (status in ('Aberta', 'Paga', 'Vencida', 'Parcialmente paga', 'Cancelada')),
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  work_id uuid references public.works(id) on delete set null,
  environment_id uuid references public.work_environments(id) on delete set null,
  point_id uuid references public.work_points(id) on delete set null,
  service_order_id uuid references public.service_orders(id) on delete set null,
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  competence_date date,
  due_date date not null,
  received_date date,
  expected_amount numeric(12,2) not null default 0,
  received_amount numeric(12,2) not null default 0,
  receipt_method text,
  bank_account_id uuid,
  status text not null default 'Aberta' check (status in ('Aberta', 'Recebida', 'Vencida', 'Parcialmente recebida', 'Cancelada')),
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_card_invoices (
  id uuid primary key default gen_random_uuid(),
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  reference_month integer not null check (reference_month between 1 and 12),
  reference_year integer not null,
  due_date date,
  holder_name text,
  card_account text,
  total_amount numeric(12,2) not null default 0,
  imported_amount numeric(12,2) not null default 0,
  difference_amount numeric(12,2) not null default 0,
  status text not null default 'Importada' check (status in ('Importada', 'Em revisao', 'Conferida', 'Paga', 'Cancelada')),
  pdf_file_url text,
  pdf_file_name text,
  raw_text text,
  accounts_payable_id uuid references public.accounts_payable(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_payable_credit_card_invoice_fk'
  ) then
    alter table public.accounts_payable
      add constraint accounts_payable_credit_card_invoice_fk
      foreign key (credit_card_invoice_id) references public.credit_card_invoices(id) on delete set null
      not valid;
  end if;
end $$;

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('entrada', 'saida')),
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  work_id uuid references public.works(id) on delete set null,
  environment_id uuid references public.work_environments(id) on delete set null,
  point_id uuid references public.work_points(id) on delete set null,
  service_order_id uuid references public.service_orders(id) on delete set null,
  provider_id uuid references public.providers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  supplier_name text,
  competence_date date,
  due_date date,
  realized_date date,
  expected_amount numeric(12,2) not null default 0,
  realized_amount numeric(12,2) not null default 0,
  payment_method text,
  bank_account_id uuid,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  credit_card_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  accounts_payable_id uuid references public.accounts_payable(id) on delete set null,
  accounts_receivable_id uuid references public.accounts_receivable(id) on delete set null,
  status text not null default 'Previsto' check (status in ('Previsto', 'Realizado', 'Vencido', 'Cancelado')),
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  priority integer not null default 100,
  search_text text not null,
  normalized_search_text text not null,
  comparison_type text not null check (comparison_type in ('Contem', 'Comeca com', 'Igual', 'Regex', 'Similaridade')),
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  card_holder text,
  default_confidence text not null default 'Alta' check (default_confidence in ('Alta', 'Media', 'Baixa')),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_card_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.credit_card_invoices(id) on delete cascade,
  purchase_date date,
  original_description text not null,
  normalized_description text,
  current_installment integer,
  total_installments integer,
  city text,
  card_holder text,
  card_last_digits text,
  amount numeric(12,2) not null default 0,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  category_rule_id uuid references public.category_rules(id) on delete set null,
  category_confidence text check (category_confidence in ('Alta', 'Media', 'Baixa', 'Sem categoria')),
  category_status text not null default 'Sem categoria' check (category_status in ('Categorizado automaticamente', 'Categorizado manualmente', 'Sem categoria', 'Baixa confianca')),
  review_status text not null default 'Pendente' check (review_status in ('Pendente', 'Conferido', 'Ignorado', 'Duplicado')),
  linked_transaction_id uuid references public.financial_transactions(id) on delete set null,
  linked_service_order_id uuid references public.service_orders(id) on delete set null,
  linked_work_id uuid references public.works(id) on delete set null,
  linked_environment_id uuid references public.work_environments(id) on delete set null,
  linked_point_id uuid references public.work_points(id) on delete set null,
  linked_vehicle_id uuid references public.vehicles(id) on delete set null,
  linked_provider_id uuid references public.providers(id) on delete set null,
  source_page integer,
  raw_line text,
  extraction_confidence numeric(5,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.system_users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  description text,
  created_at timestamptz not null default now()
);

-- Useful indexes.
create index if not exists idx_clients_document on public.clients(document);
create index if not exists idx_works_client_id on public.works(client_id);
create index if not exists idx_work_floors_work_id on public.work_floors(work_id);
create index if not exists idx_work_environments_work_id on public.work_environments(work_id);
create index if not exists idx_work_points_environment_id on public.work_points(environment_id);
create index if not exists idx_service_orders_client_id on public.service_orders(client_id);
create index if not exists idx_service_orders_work_id on public.service_orders(work_id);
create index if not exists idx_service_orders_point_id on public.service_orders(point_id);
create index if not exists idx_service_orders_status_date on public.service_orders(status, scheduled_date);
create index if not exists idx_service_order_events_order_id on public.service_order_events(service_order_id);
create index if not exists idx_vehicle_checklists_order_id on public.vehicle_checklists(service_order_id);
create index if not exists idx_financial_transactions_dates on public.financial_transactions(competence_date, due_date, realized_date);
create index if not exists idx_financial_transactions_links on public.financial_transactions(client_id, work_id, environment_id, point_id, service_order_id);
create index if not exists idx_credit_card_invoice_items_invoice_id on public.credit_card_invoice_items(invoice_id);
create index if not exists idx_category_rules_search on public.category_rules(normalized_search_text);

-- updated_at triggers.
drop trigger if exists trg_system_users_updated_at on public.system_users;
create trigger trg_system_users_updated_at before update on public.system_users for each row execute function public.set_updated_at();
drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
drop trigger if exists trg_client_contacts_updated_at on public.client_contacts;
create trigger trg_client_contacts_updated_at before update on public.client_contacts for each row execute function public.set_updated_at();
drop trigger if exists trg_works_updated_at on public.works;
create trigger trg_works_updated_at before update on public.works for each row execute function public.set_updated_at();
drop trigger if exists trg_work_floors_updated_at on public.work_floors;
create trigger trg_work_floors_updated_at before update on public.work_floors for each row execute function public.set_updated_at();
drop trigger if exists trg_work_environments_updated_at on public.work_environments;
create trigger trg_work_environments_updated_at before update on public.work_environments for each row execute function public.set_updated_at();
drop trigger if exists trg_work_points_updated_at on public.work_points;
create trigger trg_work_points_updated_at before update on public.work_points for each row execute function public.set_updated_at();
drop trigger if exists trg_providers_updated_at on public.providers;
create trigger trg_providers_updated_at before update on public.providers for each row execute function public.set_updated_at();
drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at before update on public.vehicles for each row execute function public.set_updated_at();
drop trigger if exists trg_materials_updated_at on public.materials;
create trigger trg_materials_updated_at before update on public.materials for each row execute function public.set_updated_at();
drop trigger if exists trg_service_types_updated_at on public.service_types;
create trigger trg_service_types_updated_at before update on public.service_types for each row execute function public.set_updated_at();
drop trigger if exists trg_service_orders_updated_at on public.service_orders;
create trigger trg_service_orders_updated_at before update on public.service_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_vehicle_checklists_updated_at on public.vehicle_checklists;
create trigger trg_vehicle_checklists_updated_at before update on public.vehicle_checklists for each row execute function public.set_updated_at();

-- RLS starts enabled; policies can be tightened per profile in the next migration.
alter table public.system_users enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.works enable row level security;
alter table public.work_floors enable row level security;
alter table public.work_environments enable row level security;
alter table public.environment_photos enable row level security;
alter table public.work_points enable row level security;
alter table public.point_photos enable row level security;
alter table public.providers enable row level security;
alter table public.provider_documents enable row level security;
alter table public.vehicles enable row level security;
alter table public.materials enable row level security;
alter table public.service_types enable row level security;
alter table public.service_type_checklist_items enable row level security;
alter table public.service_type_materials enable row level security;
alter table public.service_orders enable row level security;
alter table public.service_order_events enable row level security;
alter table public.service_order_checklist_items enable row level security;
alter table public.service_order_materials enable row level security;
alter table public.service_order_files enable row level security;
alter table public.service_order_signatures enable row level security;
alter table public.vehicle_checklists enable row level security;
alter table public.vehicle_usage enable row level security;
alter table public.vehicle_maintenance enable row level security;
alter table public.operational_statuses enable row level security;
alter table public.execution_steps enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.accounts_payable enable row level security;
alter table public.accounts_receivable enable row level security;
alter table public.financial_categories enable row level security;
alter table public.financial_subcategories enable row level security;
alter table public.cost_centers enable row level security;
alter table public.dre_accounts enable row level security;
alter table public.credit_cards enable row level security;
alter table public.credit_card_invoices enable row level security;
alter table public.credit_card_invoice_items enable row level security;
alter table public.category_rules enable row level security;
alter table public.audit_logs enable row level security;
