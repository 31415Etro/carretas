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
