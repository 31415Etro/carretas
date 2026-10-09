-- Financeiro ERP Carretas: contas bancárias, condições de pagamento, parcelas,
-- juros/multa/desconto, documento, origem do lançamento e auditoria.
-- Rode no SQL Editor do Supabase depois de 159_add_multi_company_tenancy.sql.

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text,
  bank_code text,
  agency text,
  account_number text,
  account_type text not null default 'Corrente' check (account_type in ('Corrente', 'Poupanca', 'Pagamento', 'Caixa', 'Investimento')),
  holder_name text,
  holder_document text,
  pix_key text,
  initial_balance numeric(14,2) not null default 0,
  initial_balance_date date,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_conditions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  installments integer not null default 1 check (installments between 1 and 120),
  first_due_days integer not null default 0 check (first_due_days >= 0),
  interval_days integer not null default 30 check (interval_days >= 0),
  payment_method text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.financial_categories
  add column if not exists code text,
  add column if not exists "group" text;

alter table if exists public.cost_centers
  add column if not exists code text,
  add column if not exists responsible text,
  add column if not exists unit text;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['accounts_payable', 'accounts_receivable'] loop
    execute format('alter table public.%I
      add column if not exists document_number text,
      add column if not exists installment_number integer,
      add column if not exists installment_count integer,
      add column if not exists installment_group_id uuid,
      add column if not exists payment_condition_id uuid references public.payment_conditions(id) on delete set null,
      add column if not exists interest_amount numeric(14,2) not null default 0,
      add column if not exists fine_amount numeric(14,2) not null default 0,
      add column if not exists discount_amount numeric(14,2) not null default 0,
      add column if not exists source_type text not null default ''Manual'',
      add column if not exists source_reference text,
      add column if not exists created_by text,
      add column if not exists updated_by text', table_name);
    execute format('create index if not exists %I on public.%I (installment_group_id)', table_name || '_installment_group_idx', table_name);
  end loop;
end;
$$;

-- bank_account_id (já existente) guarda o id de bank_accounts. Fica sem FK para
-- não apagar valores antigos digitados como texto livre.

-- Mesmo isolamento por empresa (CNPJ) das demais tabelas financeiras.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['bank_accounts', 'payment_conditions'] loop
    execute format('alter table public.%I add column if not exists system_company_id uuid not null default %L::uuid references public.system_companies(id) on delete restrict', table_name, '00000000-0000-4000-8000-000000000001');
    execute format('create index if not exists %I on public.%I (system_company_id)', table_name || '_system_company_idx', table_name);
    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', table_name);
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
end;
$$;
