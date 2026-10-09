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
