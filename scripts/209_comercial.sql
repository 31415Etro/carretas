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
