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
