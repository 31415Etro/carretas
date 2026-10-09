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
