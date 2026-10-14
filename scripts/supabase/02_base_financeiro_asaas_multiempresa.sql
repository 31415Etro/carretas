-- ERP Carretas - arquivo consolidado para o SQL Editor do Supabase.
-- Scripts de origem, nesta ordem: base/102_financeiro_complete_schema.sql base/103_financeiro_minimo_dre_entradas_saidas.sql base/106_single_final_photo_service_orders.sql base/108_add_suppliers.sql base/110_allow_point_photos_service_orders.sql base/117_add_service_order_total_amount.sql base/118_fix_service_types_supabase_fields.sql base/119_add_service_order_category.sql base/133_add_client_user_scope.sql base/157_add_asaas_dual_account_integration.sql base/158_add_asaas_financial_operations.sql supabase/patch_159_pre.sql base/159_add_multi_company_tenancy.sql base/160_add_supplier_financial_categories.sql base/160_share_master_registries.sql base/161_share_operational_master_registries.sql
-- Nao edite aqui; os originais continuam em scripts/ e scripts/base/.

-- ============================================================
-- >>> INICIO: base/102_financeiro_complete_schema.sql
-- ============================================================
-- ============================================================
-- M & C Climatizacao - Financeiro completo
-- Rode este arquivo no SQL Editor do Supabase.
-- Ele e idempotente: pode executar novamente se alguma coluna faltar.
-- ============================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Cadastros base da DRE / classificacao financeira
-- ------------------------------------------------------------

create table if not exists public.dre_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.dre_accounts(id) on delete set null,
  type text not null default 'despesa',
  order_index integer not null default 1,
  signal text not null default 'negativo',
  formula text,
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'saida',
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.financial_categories(id) on delete cascade,
  name text not null,
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Cartoes e faturas
-- ------------------------------------------------------------

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text,
  card_last_digits text,
  holder_name text,
  card_account text,
  closing_day integer,
  due_day integer,
  credit_limit numeric(14,2) not null default 0,
  status text not null default 'Ativo',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_card_invoices (
  id uuid primary key default gen_random_uuid(),
  credit_card_id uuid references public.credit_cards(id) on delete cascade,
  reference_month integer,
  reference_year integer,
  due_date date,
  holder_name text,
  card_account text,
  total_amount numeric(14,2) not null default 0,
  imported_amount numeric(14,2) not null default 0,
  difference_amount numeric(14,2) not null default 0,
  status text not null default 'Importada',
  pdf_file_url text,
  pdf_file_name text,
  raw_text text,
  accounts_payable_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Contas e lancamentos
-- ------------------------------------------------------------

create table if not exists public.accounts_payable (
  id uuid primary key default gen_random_uuid(),
  supplier_name text,
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  work_id uuid,
  environment_id uuid,
  point_id uuid,
  service_order_id uuid,
  provider_id uuid,
  vehicle_id uuid,
  competence_date date,
  due_date date,
  payment_date date,
  expected_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  payment_method text,
  bank_account_id uuid,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  credit_card_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  status text not null default 'Aberta',
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  client_id uuid,
  work_id uuid,
  environment_id uuid,
  point_id uuid,
  service_order_id uuid,
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  competence_date date,
  due_date date,
  received_date date,
  expected_amount numeric(14,2) not null default 0,
  received_amount numeric(14,2) not null default 0,
  receipt_method text,
  bank_account_id uuid,
  status text not null default 'Aberta',
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  client_id uuid,
  work_id uuid,
  environment_id uuid,
  point_id uuid,
  service_order_id uuid,
  provider_id uuid,
  vehicle_id uuid,
  supplier_name text,
  competence_date date,
  due_date date,
  realized_date date,
  expected_amount numeric(14,2) not null default 0,
  realized_amount numeric(14,2) not null default 0,
  payment_method text,
  bank_account_id uuid,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  credit_card_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  accounts_payable_id uuid references public.accounts_payable(id) on delete set null,
  accounts_receivable_id uuid references public.accounts_receivable(id) on delete set null,
  status text not null default 'Previsto',
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Regras de categoria e itens de fatura
-- ------------------------------------------------------------

create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  priority integer not null default 100,
  search_text text not null,
  normalized_search_text text not null,
  comparison_type text not null default 'Contem',
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  card_holder text,
  default_confidence text not null default 'Alta',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_card_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.credit_card_invoices(id) on delete cascade,
  purchase_date date,
  original_description text not null,
  normalized_description text,
  current_installment integer,
  total_installments integer,
  city text,
  card_holder text,
  card_last_digits text,
  amount numeric(14,2) not null default 0,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  category_rule_id uuid references public.category_rules(id) on delete set null,
  category_confidence text,
  category_status text not null default 'Sem categoria',
  review_status text not null default 'Pendente',
  linked_transaction_id uuid references public.financial_transactions(id) on delete set null,
  linked_service_order_id uuid,
  linked_work_id uuid,
  linked_environment_id uuid,
  linked_point_id uuid,
  linked_vehicle_id uuid,
  linked_provider_id uuid,
  source_page integer,
  raw_line text,
  extraction_confidence numeric(8,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Colunas novas caso as tabelas ja existam incompletas
-- ------------------------------------------------------------

alter table public.credit_card_invoices add column if not exists pdf_file_name text;
alter table public.credit_card_invoices add column if not exists pdf_file_url text;
alter table public.credit_card_invoices add column if not exists raw_text text;
alter table public.credit_card_invoices add column if not exists accounts_payable_id uuid;

alter table public.accounts_payable add column if not exists origin text not null default 'Manual';
alter table public.accounts_payable add column if not exists attachment_url text;
alter table public.accounts_payable add column if not exists credit_card_invoice_id uuid;
alter table public.accounts_payable add column if not exists environment_id uuid;
alter table public.accounts_payable add column if not exists point_id uuid;

alter table public.accounts_receivable add column if not exists origin text not null default 'Manual';
alter table public.accounts_receivable add column if not exists attachment_url text;
alter table public.accounts_receivable add column if not exists environment_id uuid;
alter table public.accounts_receivable add column if not exists point_id uuid;

alter table public.financial_transactions add column if not exists environment_id uuid;
alter table public.financial_transactions add column if not exists point_id uuid;
alter table public.financial_transactions add column if not exists accounts_payable_id uuid;
alter table public.financial_transactions add column if not exists accounts_receivable_id uuid;
alter table public.financial_transactions add column if not exists attachment_url text;
alter table public.financial_transactions add column if not exists credit_card_invoice_id uuid;

alter table public.credit_card_invoice_items add column if not exists linked_environment_id uuid;
alter table public.credit_card_invoice_items add column if not exists linked_point_id uuid;
alter table public.credit_card_invoice_items add column if not exists raw_line text;
alter table public.credit_card_invoice_items add column if not exists notes text;

-- ------------------------------------------------------------
-- FKs circulares opcionais
-- ------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'credit_card_invoices_accounts_payable_id_fkey') then
    alter table public.credit_card_invoices
      add constraint credit_card_invoices_accounts_payable_id_fkey
      foreign key (accounts_payable_id) references public.accounts_payable(id) on delete set null
      not valid;
  end if;
exception when others then
  raise notice 'Nao foi possivel criar FK credit_card_invoices -> accounts_payable: %', sqlerrm;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_payable_credit_card_invoice_id_fkey') then
    alter table public.accounts_payable
      add constraint accounts_payable_credit_card_invoice_id_fkey
      foreign key (credit_card_invoice_id) references public.credit_card_invoices(id) on delete set null
      not valid;
  end if;
exception when others then
  raise notice 'Nao foi possivel criar FK accounts_payable -> credit_card_invoices: %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- Indices usados pelas telas do financeiro
-- ------------------------------------------------------------

create index if not exists idx_dre_accounts_name on public.dre_accounts (lower(name));
create index if not exists idx_financial_categories_name on public.financial_categories (lower(name));
create index if not exists idx_cost_centers_name on public.cost_centers (lower(name));
create index if not exists idx_financial_subcategories_category on public.financial_subcategories(category_id);
create index if not exists idx_financial_transactions_dates on public.financial_transactions(competence_date, due_date, realized_date);
create index if not exists idx_financial_transactions_category on public.financial_transactions(category_id, subcategory_id, cost_center_id);
create index if not exists idx_financial_transactions_links on public.financial_transactions(client_id, work_id, environment_id, point_id, service_order_id);
create index if not exists idx_financial_transactions_credit_card_invoice on public.financial_transactions(credit_card_invoice_id);
create index if not exists idx_accounts_payable_due_status on public.accounts_payable(due_date, status);
create index if not exists idx_accounts_receivable_due_status on public.accounts_receivable(due_date, status);
create index if not exists idx_credit_card_invoices_card_ref on public.credit_card_invoices(credit_card_id, reference_year, reference_month);
create index if not exists idx_credit_card_invoice_items_invoice_id on public.credit_card_invoice_items(invoice_id);
create index if not exists idx_credit_card_invoice_items_purchase_date on public.credit_card_invoice_items(purchase_date);
create index if not exists idx_category_rules_search on public.category_rules(normalized_search_text);

-- ------------------------------------------------------------
-- Triggers updated_at
-- ------------------------------------------------------------

drop trigger if exists trg_dre_accounts_updated_at on public.dre_accounts;
create trigger trg_dre_accounts_updated_at before update on public.dre_accounts for each row execute function public.set_updated_at();

drop trigger if exists trg_financial_categories_updated_at on public.financial_categories;
create trigger trg_financial_categories_updated_at before update on public.financial_categories for each row execute function public.set_updated_at();

drop trigger if exists trg_financial_subcategories_updated_at on public.financial_subcategories;
create trigger trg_financial_subcategories_updated_at before update on public.financial_subcategories for each row execute function public.set_updated_at();

drop trigger if exists trg_cost_centers_updated_at on public.cost_centers;
create trigger trg_cost_centers_updated_at before update on public.cost_centers for each row execute function public.set_updated_at();

drop trigger if exists trg_credit_cards_updated_at on public.credit_cards;
create trigger trg_credit_cards_updated_at before update on public.credit_cards for each row execute function public.set_updated_at();

drop trigger if exists trg_credit_card_invoices_updated_at on public.credit_card_invoices;
create trigger trg_credit_card_invoices_updated_at before update on public.credit_card_invoices for each row execute function public.set_updated_at();

drop trigger if exists trg_accounts_payable_updated_at on public.accounts_payable;
create trigger trg_accounts_payable_updated_at before update on public.accounts_payable for each row execute function public.set_updated_at();

drop trigger if exists trg_accounts_receivable_updated_at on public.accounts_receivable;
create trigger trg_accounts_receivable_updated_at before update on public.accounts_receivable for each row execute function public.set_updated_at();

drop trigger if exists trg_financial_transactions_updated_at on public.financial_transactions;
create trigger trg_financial_transactions_updated_at before update on public.financial_transactions for each row execute function public.set_updated_at();

drop trigger if exists trg_category_rules_updated_at on public.category_rules;
create trigger trg_category_rules_updated_at before update on public.category_rules for each row execute function public.set_updated_at();

drop trigger if exists trg_credit_card_invoice_items_updated_at on public.credit_card_invoice_items;
create trigger trg_credit_card_invoice_items_updated_at before update on public.credit_card_invoice_items for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS
-- O sistema salva pelo endpoint Next.js usando SUPABASE_SERVICE_ROLE_KEY.
-- Service role ignora RLS. As politicas abaixo liberam usuarios autenticados
-- caso voce use Supabase Auth diretamente no futuro.
-- ------------------------------------------------------------

alter table public.dre_accounts enable row level security;
alter table public.financial_categories enable row level security;
alter table public.financial_subcategories enable row level security;
alter table public.cost_centers enable row level security;
alter table public.credit_cards enable row level security;
alter table public.credit_card_invoices enable row level security;
alter table public.accounts_payable enable row level security;
alter table public.accounts_receivable enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.category_rules enable row level security;
alter table public.credit_card_invoice_items enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dre_accounts',
    'financial_categories',
    'financial_subcategories',
    'cost_centers',
    'credit_cards',
    'credit_card_invoices',
    'accounts_payable',
    'accounts_receivable',
    'financial_transactions',
    'category_rules',
    'credit_card_invoice_items'
  ]
  loop
    execute format('drop policy if exists "authenticated_manage_%s" on public.%I', table_name, table_name);
    execute format(
      'create policy "authenticated_manage_%s" on public.%I for all to authenticated using (true) with check (true)',
      table_name,
      table_name
    );
  end loop;
end $$;


-- <<< FIM: base/102_financeiro_complete_schema.sql

-- ============================================================
-- >>> INICIO: base/103_financeiro_minimo_dre_entradas_saidas.sql
-- ============================================================
-- ============================================================
-- Financeiro minimo - DRE + Entradas e Saidas + Fatura Cartao
-- Rode no SQL Editor do Supabase se a pagina Financeiro nao salva.
-- Este script e idempotente e nao apaga dados.
-- ============================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.dre_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.dre_accounts(id) on delete set null,
  type text not null default 'despesa',
  order_index integer not null default 1,
  signal text not null default 'negativo',
  formula text,
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'saida',
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.financial_categories(id) on delete cascade,
  name text not null,
  status text not null default 'Ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'Ativo',
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
  closing_day integer,
  due_day integer,
  credit_limit numeric(14,2) not null default 0,
  status text not null default 'Ativo',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_card_invoices (
  id uuid primary key default gen_random_uuid(),
  credit_card_id uuid references public.credit_cards(id) on delete cascade,
  reference_month integer,
  reference_year integer,
  due_date date,
  holder_name text,
  card_account text,
  total_amount numeric(14,2) not null default 0,
  imported_amount numeric(14,2) not null default 0,
  difference_amount numeric(14,2) not null default 0,
  status text not null default 'Importada',
  pdf_file_url text,
  pdf_file_name text,
  raw_text text,
  accounts_payable_id uuid,
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
  work_id uuid,
  environment_id uuid,
  point_id uuid,
  service_order_id uuid,
  provider_id uuid,
  vehicle_id uuid,
  competence_date date,
  due_date date,
  payment_date date,
  expected_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  payment_method text,
  bank_account_id uuid,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  credit_card_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  status text not null default 'Aberta',
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  client_id uuid,
  work_id uuid,
  environment_id uuid,
  point_id uuid,
  service_order_id uuid,
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  competence_date date,
  due_date date,
  received_date date,
  expected_amount numeric(14,2) not null default 0,
  received_amount numeric(14,2) not null default 0,
  receipt_method text,
  bank_account_id uuid,
  status text not null default 'Aberta',
  origin text not null default 'Manual',
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Esta e a tabela de Entradas e Saidas.
create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  description text not null,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  client_id uuid,
  work_id uuid,
  environment_id uuid,
  point_id uuid,
  service_order_id uuid,
  provider_id uuid,
  vehicle_id uuid,
  supplier_name text,
  competence_date date,
  due_date date,
  realized_date date,
  expected_amount numeric(14,2) not null default 0,
  realized_amount numeric(14,2) not null default 0,
  payment_method text,
  bank_account_id uuid,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  credit_card_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  accounts_payable_id uuid references public.accounts_payable(id) on delete set null,
  accounts_receivable_id uuid references public.accounts_receivable(id) on delete set null,
  status text not null default 'Previsto',
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
  comparison_type text not null default 'Contem',
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  card_holder text,
  default_confidence text not null default 'Alta',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_card_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.credit_card_invoices(id) on delete cascade,
  purchase_date date,
  original_description text not null,
  normalized_description text,
  current_installment integer,
  total_installments integer,
  city text,
  card_holder text,
  card_last_digits text,
  amount numeric(14,2) not null default 0,
  category_id uuid references public.financial_categories(id) on delete set null,
  subcategory_id uuid references public.financial_subcategories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  category_rule_id uuid references public.category_rules(id) on delete set null,
  category_confidence text,
  category_status text not null default 'Sem categoria',
  review_status text not null default 'Pendente',
  linked_transaction_id uuid references public.financial_transactions(id) on delete set null,
  linked_service_order_id uuid,
  linked_work_id uuid,
  linked_environment_id uuid,
  linked_point_id uuid,
  linked_vehicle_id uuid,
  linked_provider_id uuid,
  source_page integer,
  raw_line text,
  extraction_confidence numeric(8,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_financial_transactions_competence on public.financial_transactions(competence_date);
create index if not exists idx_financial_transactions_invoice on public.financial_transactions(credit_card_invoice_id);
create index if not exists idx_credit_card_invoice_items_invoice on public.credit_card_invoice_items(invoice_id);
create index if not exists idx_credit_card_invoice_items_transaction on public.credit_card_invoice_items(linked_transaction_id);
create index if not exists idx_category_rules_search on public.category_rules(normalized_search_text);

alter table public.dre_accounts enable row level security;
alter table public.financial_categories enable row level security;
alter table public.financial_subcategories enable row level security;
alter table public.cost_centers enable row level security;
alter table public.credit_cards enable row level security;
alter table public.credit_card_invoices enable row level security;
alter table public.accounts_payable enable row level security;
alter table public.accounts_receivable enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.category_rules enable row level security;
alter table public.credit_card_invoice_items enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dre_accounts',
    'financial_categories',
    'financial_subcategories',
    'cost_centers',
    'credit_cards',
    'credit_card_invoices',
    'accounts_payable',
    'accounts_receivable',
    'financial_transactions',
    'category_rules',
    'credit_card_invoice_items'
  ]
  loop
    execute format('drop policy if exists "service_role_all_%1$s" on public.%1$I', table_name);
    execute format('create policy "service_role_all_%1$s" on public.%1$I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')', table_name);
  end loop;
end $$;



-- <<< FIM: base/103_financeiro_minimo_dre_entradas_saidas.sql

-- ============================================================
-- >>> INICIO: base/106_single_final_photo_service_orders.sql
-- ============================================================
-- Mantem apenas uma foto por Ordem de Serviço.
-- A tabela service_order_files continua existindo porque ela guarda a foto vinculada à OS.
-- Este script remove fotos antigas duplicadas e padroniza tudo como "Foto Final".

begin;

delete from public.service_order_files f
using public.service_order_files newer
where f.service_order_id = newer.service_order_id
  and (
    newer.created_at > f.created_at
    or (newer.created_at = f.created_at and newer.id::text > f.id::text)
  );

update public.service_order_files
set category = 'Foto Final'
where category is distinct from 'Foto Final';

drop index if exists public.idx_service_order_files_one_per_os;

create unique index idx_service_order_files_one_per_os
on public.service_order_files(service_order_id);

alter table public.service_order_files
drop constraint if exists service_order_files_category_final_check;

alter table public.service_order_files
add constraint service_order_files_category_final_check
check (category = 'Foto Final');

commit;


-- <<< FIM: base/106_single_final_photo_service_orders.sql

-- ============================================================
-- >>> INICIO: base/108_add_suppliers.sql
-- ============================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text,
  contact_name text,
  phone text,
  email text,
  category text,
  city text,
  state text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_suppliers_status on public.suppliers(status);
create index if not exists idx_suppliers_name on public.suppliers(name);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_service_role_all" on public.suppliers;
create policy "suppliers_service_role_all"
on public.suppliers
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at
before update on public.suppliers
for each row
execute function public.set_updated_at();


-- <<< FIM: base/108_add_suppliers.sql

-- ============================================================
-- >>> INICIO: base/110_allow_point_photos_service_orders.sql
-- ============================================================
-- Permite fotos de inicio e fim por ponto dentro da mesma Ordem de Servico.
-- Este script desfaz a regra antiga que limitava a tabela a uma unica "Foto Final" por OS.

begin;

drop index if exists public.idx_service_order_files_one_per_os;

alter table public.service_order_files
drop constraint if exists service_order_files_category_final_check;

create index if not exists idx_service_order_files_order_category_notes
on public.service_order_files(service_order_id, category, notes);

commit;


-- <<< FIM: base/110_allow_point_photos_service_orders.sql

-- ============================================================
-- >>> INICIO: base/117_add_service_order_total_amount.sql
-- ============================================================
alter table public.service_orders
add column if not exists total_amount numeric(12,2) not null default 0;

create index if not exists idx_service_orders_total_amount
on public.service_orders(total_amount);

comment on column public.service_orders.total_amount
is 'Valor total da ordem de servico. Ao finalizar a OS, gera conta a receber pendente.';


-- <<< FIM: base/117_add_service_order_total_amount.sql

-- ============================================================
-- >>> INICIO: base/118_fix_service_types_supabase_fields.sql
-- ============================================================
alter table public.service_types
add column if not exists execution_percentage numeric(7,3) not null default 0;

alter table public.service_types
add column if not exists enabled_contexts text[] not null default array['obra'];

alter table public.service_types
add column if not exists required_photos text[] not null default '{}';

alter table public.service_types
add column if not exists orientation_video_url text;

alter table public.service_types
add column if not exists orientation_video_description text;

update public.service_types
set enabled_contexts = array['obra']
where enabled_contexts is null
   or cardinality(enabled_contexts) = 0;

alter table public.service_types
drop constraint if exists service_types_enabled_contexts_check;

alter table public.service_types
add constraint service_types_enabled_contexts_check
check (
  enabled_contexts <@ array['obra', 'pmoc', 'servicos']::text[]
  and cardinality(enabled_contexts) > 0
);


-- <<< FIM: base/118_fix_service_types_supabase_fields.sql

-- ============================================================
-- >>> INICIO: base/119_add_service_order_category.sql
-- ============================================================
alter table public.service_orders
add column if not exists total_amount numeric(12,2) not null default 0;

alter table public.service_orders
add column if not exists service_category text;

alter table public.service_orders
drop constraint if exists service_orders_service_category_check;

alter table public.service_orders
add constraint service_orders_service_category_check
check (
  service_category is null
  or service_category = ''
  or service_category in ('Manutencao Preventiva', 'Instalacao', 'Manutencao Corretiva')
);

comment on column public.service_orders.service_category
is 'Categoria da OS de Servicos Diversos: Manutencao Preventiva, Instalacao ou Manutencao Corretiva.';


-- <<< FIM: base/119_add_service_order_category.sql

-- ============================================================
-- >>> INICIO: base/133_add_client_user_scope.sql
-- ============================================================
-- Vincula usuarios do portal a um cliente e habilita o perfil Cliente.
-- Script idempotente: pode ser executado novamente sem duplicar estruturas.

alter table public.profiles
  add column if not exists client_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_client_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;
end $$;

create index if not exists idx_profiles_client_id on public.profiles(client_id);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array[
    'admin', 'sdr', 'closer', 'representative', 'manager', 'sd', 'user', 'client'
  ]));

alter table public.profiles drop constraint if exists profiles_client_role_requires_client;
alter table public.profiles
  add constraint profiles_client_role_requires_client
  check (role <> 'client' or client_id is not null);

comment on column public.profiles.client_id is
  'Cliente cujos dados podem ser visualizados pelo usuario com role client.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, role, page_permissions, client_id, active
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'page_permissions', '[]'::jsonb))),
      '{}'::text[]
    ),
    nullif(new.raw_user_meta_data->>'client_id', '')::uuid,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    page_permissions = excluded.page_permissions,
    client_id = excluded.client_id,
    updated_at = now();

  return new;
end;
$$;


-- <<< FIM: base/133_add_client_user_scope.sql

-- ============================================================
-- >>> INICIO: base/157_add_asaas_dual_account_integration.sql
-- ============================================================
-- M & C Climatizacao - Integracao financeira Asaas com duas contas.
-- Execute no SQL Editor do Supabase antes de configurar as chaves na Vercel.
-- As chaves de API NAO ficam no banco: use apenas variaveis de ambiente.

create extension if not exists pgcrypto;

create table if not exists public.asaas_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('services', 'materials')),
  name text not null,
  purpose text not null check (purpose in ('service_nfse', 'material_nfe')),
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  enabled boolean not null default true,
  wallet_id text,
  last_statement_sync_at timestamptz,
  last_webhook_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.asaas_accounts (code, name, purpose)
values
  ('services', 'Conta Asaas - Servicos', 'service_nfse'),
  ('materials', 'Conta Asaas - Materiais', 'material_nfe')
on conflict (code) do update set
  name = excluded.name,
  purpose = excluded.purpose,
  updated_at = now();

create table if not exists public.asaas_customers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  asaas_customer_id text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, client_id),
  unique (account_id, asaas_customer_id)
);

create table if not exists public.asaas_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete restrict,
  asaas_payment_id text not null,
  asaas_customer_id text,
  service_order_id uuid references public.service_orders(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  work_id uuid references public.works(id) on delete set null,
  accounts_receivable_id uuid references public.accounts_receivable(id) on delete set null,
  external_reference text,
  billing_type text,
  status text not null default 'PENDING',
  value numeric(14,2) not null default 0,
  net_value numeric(14,2) not null default 0,
  due_date date,
  payment_date date,
  invoice_url text,
  bank_slip_url text,
  pix_payload jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, asaas_payment_id)
);

create table if not exists public.asaas_transfers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete restrict,
  asaas_transfer_id text not null,
  service_order_id uuid references public.service_orders(id) on delete set null,
  accounts_payable_id uuid references public.accounts_payable(id) on delete set null,
  external_reference text,
  status text not null default 'PENDING',
  value numeric(14,2) not null default 0,
  effective_date date,
  operation_type text,
  receipt_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, asaas_transfer_id)
);

create table if not exists public.asaas_statement_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete cascade,
  asaas_transaction_id text not null,
  transaction_type text not null,
  direction text not null check (direction in ('entrada', 'saida')),
  value numeric(14,2) not null default 0,
  transaction_date date not null,
  description text,
  external_reference text,
  service_order_id uuid references public.service_orders(id) on delete set null,
  financial_transaction_id uuid references public.financial_transactions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, asaas_transaction_id)
);

create table if not exists public.asaas_fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete restrict,
  service_order_id uuid references public.service_orders(id) on delete set null,
  payment_id uuid references public.asaas_payments(id) on delete set null,
  document_kind text not null check (document_kind in ('service', 'material')),
  provider text not null check (provider in ('asaas_nfse', 'base_nfe')),
  asaas_invoice_id text,
  external_document_id text,
  external_reference text,
  status text not null default 'PENDING',
  value numeric(14,2) not null default 0,
  effective_date date,
  document_number text,
  validation_code text,
  pdf_url text,
  xml_url text,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists asaas_fiscal_documents_invoice_uidx
  on public.asaas_fiscal_documents(account_id, asaas_invoice_id)
  where asaas_invoice_id is not null;

create table if not exists public.asaas_webhook_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  resource_type text not null default 'unknown',
  resource_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (account_id, event_id)
);

alter table public.accounts_receivable add column if not exists asaas_payment_id uuid references public.asaas_payments(id) on delete set null;
alter table public.accounts_receivable add column if not exists external_reference text;
alter table public.accounts_payable add column if not exists asaas_transfer_id uuid references public.asaas_transfers(id) on delete set null;
alter table public.accounts_payable add column if not exists external_reference text;
alter table public.financial_transactions add column if not exists asaas_account_id uuid references public.asaas_accounts(id) on delete set null;
alter table public.financial_transactions add column if not exists asaas_statement_entry_id uuid references public.asaas_statement_entries(id) on delete set null;
alter table public.financial_transactions add column if not exists external_reference text;

create unique index if not exists financial_transactions_asaas_statement_uidx
  on public.financial_transactions(asaas_statement_entry_id)
  where asaas_statement_entry_id is not null;
create index if not exists asaas_payments_order_idx on public.asaas_payments(service_order_id);
create index if not exists asaas_payments_status_idx on public.asaas_payments(status);
create index if not exists asaas_transfers_status_idx on public.asaas_transfers(status);
create index if not exists asaas_fiscal_documents_order_idx on public.asaas_fiscal_documents(service_order_id);
create index if not exists asaas_webhook_events_received_idx on public.asaas_webhook_events(received_at desc);

-- Cria conta a receber + previsao no DRE + vinculo da cobranca atomicamente.
create or replace function public.create_asaas_receivable(
  p_payment_row_id uuid,
  p_receivable_id uuid,
  p_transaction_id uuid,
  p_client_id uuid,
  p_work_id uuid,
  p_service_order_id uuid,
  p_description text,
  p_competence_date date,
  p_due_date date,
  p_amount numeric,
  p_payment_method text,
  p_account_id uuid,
  p_external_reference text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts_receivable (
    id, client_id, work_id, service_order_id, description, competence_date, due_date,
    expected_amount, received_amount, receipt_method, status, origin, notes,
    asaas_payment_id, external_reference
  ) values (
    p_receivable_id, p_client_id, p_work_id, p_service_order_id, p_description,
    p_competence_date, p_due_date, p_amount, 0, p_payment_method, 'Aberta', 'Asaas',
    p_notes, p_payment_row_id, p_external_reference
  ) on conflict (id) do nothing;

  insert into public.financial_transactions (
    id, type, description, client_id, work_id, service_order_id, competence_date,
    due_date, expected_amount, realized_amount, payment_method, status, origin, notes,
    accounts_receivable_id, asaas_account_id, external_reference
  ) values (
    p_transaction_id, 'entrada', p_description, p_client_id, p_work_id,
    p_service_order_id, p_competence_date, p_due_date, p_amount, 0,
    p_payment_method, 'Previsto', 'Asaas', p_notes, p_receivable_id, p_account_id,
    p_external_reference
  ) on conflict (id) do nothing;

  update public.asaas_payments
     set accounts_receivable_id = p_receivable_id,
         updated_at = now()
   where id = p_payment_row_id;
end;
$$;

revoke all on function public.create_asaas_receivable(uuid,uuid,uuid,uuid,uuid,uuid,text,date,date,numeric,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_asaas_receivable(uuid,uuid,uuid,uuid,uuid,uuid,text,date,date,numeric,text,uuid,text,text) to service_role;

create or replace function public.touch_asaas_row()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'asaas_accounts', 'asaas_customers', 'asaas_payments', 'asaas_transfers',
    'asaas_statement_entries', 'asaas_fiscal_documents'
  ] loop
    execute format('drop trigger if exists touch_%I on public.%I', table_name, table_name);
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_asaas_row()', table_name, table_name);
  end loop;
end $$;

alter table public.asaas_accounts enable row level security;
alter table public.asaas_customers enable row level security;
alter table public.asaas_payments enable row level security;
alter table public.asaas_transfers enable row level security;
alter table public.asaas_statement_entries enable row level security;
alter table public.asaas_fiscal_documents enable row level security;
alter table public.asaas_webhook_events enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'asaas_accounts', 'asaas_customers', 'asaas_payments', 'asaas_transfers',
    'asaas_statement_entries', 'asaas_fiscal_documents', 'asaas_webhook_events'
  ] loop
    execute format('drop policy if exists "Authenticated staff read %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "Authenticated staff read %s" on public.%I for select to authenticated using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.active is not false and profiles.role <> ''client''))',
      table_name, table_name
    );
  end loop;
end $$;

-- Atualizacoes em tempo real para a tela financeira. Webhooks escrevem via service_role.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'asaas_accounts', 'asaas_payments', 'asaas_transfers', 'asaas_statement_entries',
    'asaas_fiscal_documents', 'financial_transactions', 'accounts_payable', 'accounts_receivable'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
exception when undefined_object then
  null;
end $$;

comment on table public.asaas_accounts is 'Contas logicas Asaas; credenciais ficam exclusivamente nas variaveis de ambiente.';
comment on table public.asaas_webhook_events is 'Caixa de entrada idempotente dos eventos Asaas (at-least-once).';
comment on column public.asaas_fiscal_documents.provider is 'asaas_nfse para servicos; base_nfe para produtos e materiais.';


-- <<< FIM: base/157_add_asaas_dual_account_integration.sql

-- ============================================================
-- >>> INICIO: base/158_add_asaas_financial_operations.sql
-- ============================================================
-- M & C Climatizacao - operacoes financeiras completas nas duas contas Asaas.
-- Execute depois do script 157.

create extension if not exists pgcrypto;

alter table public.asaas_payments add column if not exists idempotency_key text;
alter table public.asaas_payments add column if not exists created_by uuid;
alter table public.asaas_payments add column if not exists requester_ip inet;

create unique index if not exists asaas_payments_idempotency_uidx
  on public.asaas_payments(account_id, idempotency_key)
  where idempotency_key is not null;

alter table public.asaas_transfers add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.asaas_transfers add column if not exists idempotency_key text;
alter table public.asaas_transfers add column if not exists created_by uuid;
alter table public.asaas_transfers add column if not exists requester_ip inet;

create unique index if not exists asaas_transfers_idempotency_uidx
  on public.asaas_transfers(account_id, idempotency_key)
  where idempotency_key is not null;

alter table public.accounts_payable add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create table if not exists public.asaas_bill_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  accounts_payable_id uuid references public.accounts_payable(id) on delete set null,
  asaas_bill_id text not null,
  idempotency_key text,
  external_reference text,
  status text not null default 'PENDING',
  value numeric(14,2) not null default 0,
  due_date date,
  schedule_date date,
  payment_date date,
  description text,
  receipt_url text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  requester_ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, asaas_bill_id)
);

create unique index if not exists asaas_bill_payments_idempotency_uidx
  on public.asaas_bill_payments(account_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists asaas_bill_payments_status_idx on public.asaas_bill_payments(status);

alter table public.accounts_payable add column if not exists asaas_bill_payment_id uuid references public.asaas_bill_payments(id) on delete set null;

create table if not exists public.asaas_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.asaas_accounts(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists asaas_balance_snapshots_account_idx
  on public.asaas_balance_snapshots(account_id, fetched_at desc);

alter table public.asaas_fiscal_documents add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.asaas_fiscal_documents add column if not exists item_code text;
alter table public.asaas_fiscal_documents add column if not exists item_name text;
alter table public.asaas_fiscal_documents add column if not exists created_by uuid;
alter table public.asaas_fiscal_documents add column if not exists requester_ip inet;

drop trigger if exists touch_asaas_bill_payments on public.asaas_bill_payments;
create trigger touch_asaas_bill_payments
before update on public.asaas_bill_payments
for each row execute function public.touch_asaas_row();

alter table public.asaas_bill_payments enable row level security;
alter table public.asaas_balance_snapshots enable row level security;

drop policy if exists "Authenticated staff read asaas_bill_payments" on public.asaas_bill_payments;
create policy "Authenticated staff read asaas_bill_payments"
on public.asaas_bill_payments for select to authenticated
using (exists (
  select 1 from public.profiles
  where profiles.id = auth.uid() and profiles.active is not false and profiles.role <> 'client'
));

drop policy if exists "Authenticated staff read asaas_balance_snapshots" on public.asaas_balance_snapshots;
create policy "Authenticated staff read asaas_balance_snapshots"
on public.asaas_balance_snapshots for select to authenticated
using (exists (
  select 1 from public.profiles
  where profiles.id = auth.uid() and profiles.active is not false and profiles.role <> 'client'
));

do $$
declare table_name text;
begin
  foreach table_name in array array['asaas_bill_payments', 'asaas_balance_snapshots'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
exception when undefined_object then
  null;
end $$;

comment on table public.asaas_bill_payments is 'Pagamentos de boletos feitos com saldo das contas Asaas.';
comment on table public.asaas_balance_snapshots is 'Historico de consultas do saldo real das duas contas Asaas.';


-- <<< FIM: base/158_add_asaas_financial_operations.sql

-- ============================================================
-- >>> INICIO: supabase/patch_159_pre.sql
-- ============================================================
-- PATCH (instalacao em banco vazio): o script base/159 cria indices unicos
-- (system_company_id, name/plate) em service_types e vehicles, mas essas tabelas
-- nao estao na lista de tabelas com escopo de empresa do proprio 159 (no sistema
-- antigo a coluna ja existia). Em banco vazio o 159 falharia com
-- 'column "system_company_id" does not exist'. Este patch roda ANTES do 159.
alter table public.service_types add column if not exists system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid;
alter table public.vehicles      add column if not exists system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid;


-- <<< FIM: supabase/patch_159_pre.sql

-- ============================================================
-- >>> INICIO: base/159_add_multi_company_tenancy.sql
-- ============================================================
-- Multi-CNPJ tenancy. Users/profiles remain shared by every company in the group.
create extension if not exists pgcrypto;

create table if not exists public.system_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text not null default '',
  trade_name text not null default '',
  cnpj text,
  email text,
  phone text,
  address text,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists system_companies_cnpj_uidx
  on public.system_companies (regexp_replace(cnpj, '[^0-9]', '', 'g'))
  where cnpj is not null and cnpj <> '';
create unique index if not exists system_companies_single_default_uidx
  on public.system_companies (is_default) where is_default;

insert into public.system_companies (id, name, legal_name, trade_name, active, is_default)
values (
  '00000000-0000-4000-8000-000000000001',
  'M & C Climatizacao',
  'M & C Climatizacao',
  'M & C Climatizacao',
  true,
  true
)
on conflict (id) do update set is_default = true, active = true;

create or replace function public.request_system_company_id()
returns uuid
language plpgsql
stable
as $$
declare
  headers jsonb;
  selected_id uuid;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
    selected_id := nullif(headers ->> 'x-system-company-id', '')::uuid;
  exception when others then
    selected_id := null;
  end;
  return coalesce(selected_id, '00000000-0000-4000-8000-000000000001'::uuid);
end;
$$;

create or replace function public.assign_request_system_company()
returns trigger
language plpgsql
as $$
begin
  new.system_company_id := public.request_system_company_id();
  return new;
end;
$$;

do $$
declare
  table_name text;
  scoped_tables text[] := array[
    'accounts_payable','accounts_receivable','asaas_accounts','asaas_balance_snapshots',
    'asaas_bill_payments','asaas_customers','asaas_fiscal_documents','asaas_payments',
    'asaas_statement_entries','asaas_transfers','asaas_webhook_events','audit_logs',
    'budget_environments','budget_floors','budget_plan_points','budget_plans','budget_points',
    'budget_service_types','budget_towers','budget_works','category_rules','comments','commercial_leads',
    'comercial_cno_records','companies','contract_history','contract_templates','contracts',
    'cost_centers','credit_card_invoice_items','credit_card_invoices','credit_cards','dre_accounts',
    'environment_photos','execution_steps','financial_categories','financial_subcategories',
    'financial_transactions','franchises','genes_tickets','interactions','leads',
    'message_templates','operational_statuses','pmoc_equipment','pmoc_equipment_services',
    'pmoc_plans','pmoc_schedules','pmoc_sectors','point_photos','projects','sales_targets',
    'sd_activities','sd_closer_metrics','service_order_checklist_items',
    'service_order_events','service_order_files','service_order_materials','service_order_signatures',
    'service_orders','stock_service_orders','tasks','vehicle_checklists',
    'vehicle_maintenance','vehicle_usage','whatsapp_budget_request_photos',
    'whatsapp_budget_requests','work_environments','work_floors','work_points','works'
  ];
begin
  foreach table_name in array scoped_tables loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    execute format('alter table public.%I add column if not exists system_company_id uuid', table_name);
    execute format(
      'update public.%I set system_company_id = $1 where system_company_id is null',
      table_name
    ) using '00000000-0000-4000-8000-000000000001'::uuid;
    execute format(
      'alter table public.%I alter column system_company_id set default %L::uuid',
      table_name,
      '00000000-0000-4000-8000-000000000001'
    );
    execute format('alter table public.%I alter column system_company_id set not null', table_name);
    if not exists (
      select 1 from pg_constraint
      where conrelid = ('public.' || table_name)::regclass
        and conname = table_name || '_system_company_id_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (system_company_id) references public.system_companies(id) on delete restrict',
        table_name,
        table_name || '_system_company_id_fkey'
      );
    end if;
    execute format(
      'create index if not exists %I on public.%I (system_company_id)',
      table_name || '_system_company_idx',
      table_name
    );

    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format(
      'create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()',
      table_name
    );

    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format(
      'create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)',
      table_name
    );
    execute format(
      'create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())',
      table_name
    );
  end loop;
end;
$$;

-- Shared master data for the whole group. Ownership is retained for auditing,
-- but these records are visible and editable regardless of the active CNPJ.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'client_contacts', 'client_environments', 'client_equipment',
    'suppliers', 'materials', 'profiles', 'providers', 'provider_documents',
    'service_types', 'service_type_checklist_items', 'service_type_materials',
    'stock_kits', 'stock_kit_items', 'system_users', 'vehicles'
  ] loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
  end loop;
end;
$$;

-- Business identifiers may repeat in different CNPJs.
alter table if exists public.works drop constraint if exists works_code_key;
alter table if exists public.service_types drop constraint if exists service_types_name_key;
alter table if exists public.vehicles drop constraint if exists vehicles_plate_key;
alter table if exists public.service_orders drop constraint if exists service_orders_order_number_key;
alter table if exists public.cost_centers drop constraint if exists cost_centers_name_key;
alter table if exists public.contracts drop constraint if exists contracts_contract_number_key;
alter table if exists public.companies drop constraint if exists companies_cnpj_key;
alter table if exists public.comercial_cno_records drop constraint if exists comercial_cno_records_cno_key;
alter table if exists public.asaas_accounts drop constraint if exists asaas_accounts_code_key;

do $$
declare
  item text[];
begin
  foreach item slice 1 in array array[
    array['works','code','works_company_code_uidx'],
    array['service_types','name','service_types_company_name_uidx'],
    array['vehicles','plate','vehicles_company_plate_uidx'],
    array['service_orders','order_number','service_orders_company_number_uidx'],
    array['cost_centers','name','cost_centers_company_name_uidx'],
    array['contracts','contract_number','contracts_company_number_uidx'],
    array['companies','cnpj','companies_company_cnpj_uidx'],
    array['comercial_cno_records','cno','comercial_cno_company_cno_uidx'],
    array['asaas_accounts','code','asaas_accounts_company_code_uidx']
  ] loop
    if to_regclass('public.' || item[1]) is not null then
      execute format(
        'create unique index if not exists %I on public.%I(system_company_id, %I)',
        item[3], item[1], item[2]
      );
    end if;
  end loop;
end;
$$;

alter table public.system_companies enable row level security;
drop policy if exists system_companies_authenticated_read on public.system_companies;
create policy system_companies_authenticated_read on public.system_companies
  for select to authenticated using (active = true);

grant select on public.system_companies to authenticated;
grant execute on function public.request_system_company_id() to authenticated;


-- <<< FIM: base/159_add_multi_company_tenancy.sql

-- ============================================================
-- >>> INICIO: base/160_add_supplier_financial_categories.sql
-- ============================================================
alter table public.suppliers
  add column if not exists category_ids uuid[] not null default '{}';

create index if not exists idx_suppliers_category_ids
  on public.suppliers using gin (category_ids);

comment on column public.suppliers.category_ids is
  'Categorias financeiras de saida vinculadas ao fornecedor.';


-- <<< FIM: base/160_add_supplier_financial_categories.sql

-- ============================================================
-- >>> INICIO: base/160_share_master_registries.sql
-- ============================================================
-- Clients, suppliers and products are shared by every CNPJ in the group.
-- Employees/profiles/providers were already global and need no schema change.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['clients', 'suppliers', 'materials'] loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format(
      'create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)',
      table_name
    );
  end loop;
end;
$$;


-- <<< FIM: base/160_share_master_registries.sql

-- ============================================================
-- >>> INICIO: base/161_share_operational_master_registries.sql
-- ============================================================
-- Master registries belong to the business group and are shared by every CNPJ.
-- Writes remain behind the application's authorized server APIs. Operational
-- records such as orders, stock production, vehicle usage, maintenance and
-- checklists remain isolated by system_company_id.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'client_contacts', 'client_environments', 'client_equipment',
    'suppliers', 'materials', 'profiles', 'providers', 'provider_documents',
    'service_types', 'service_type_checklist_items', 'service_type_materials',
    'stock_kits', 'stock_kit_items', 'system_users', 'vehicles'
  ] loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
  end loop;
end;
$$;


-- <<< FIM: base/161_share_operational_master_registries.sql

