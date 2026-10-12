-- Configurações ERP Carretas: cadastro completo da empresa (fiscal, endereço, certificado), filiais, dados dos
-- usuários (departamento, cargo, empresas autorizadas, MFA), parâmetros por área, naturezas de operação,
-- tabelas de preço, modelos de orçamento, documentos centrais e reprocessamento de integrações.
-- Rode no SQL Editor do Supabase depois de 213_auditoria.sql.

-- ===== Empresa =====
alter table public.system_companies
  add column if not exists state_registration text,
  add column if not exists municipal_registration text,
  add column if not exists tax_regime text check (tax_regime in ('Simples Nacional', 'MEI', 'Lucro Presumido', 'Lucro Real')),
  add column if not exists cnae text,
  add column if not exists zip_code text,
  add column if not exists street text,
  add column if not exists number text,
  add column if not exists complement text,
  add column if not exists district text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists certificate_path text,
  add column if not exists certificate_name text,
  add column if not exists certificate_expires_at date,
  add column if not exists certificate_password_enc text,
  add column if not exists fiscal_environment text not null default 'Homologação' check (fiscal_environment in ('Homologação', 'Produção')),
  add column if not exists nfe_series text,
  add column if not exists nfe_next_number integer check (nfe_next_number is null or nfe_next_number >= 1),
  add column if not exists nfse_series text,
  add column if not exists nfse_next_number integer check (nfse_next_number is null or nfse_next_number >= 1),
  add column if not exists fiscal_notes text;

-- ===== Filiais / unidades =====
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.system_companies(id) on delete restrict,
  code text,
  name text not null,
  zip_code text,
  street text,
  number text,
  complement text,
  district text,
  city text,
  state text,
  phone text,
  manager_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists branches_company_idx on public.branches (company_id);
create unique index if not exists branches_company_name_uidx on public.branches (company_id, lower(name));

do $$
begin
  if to_regclass('public.warehouses') is not null then
    alter table public.warehouses add column if not exists branch_id uuid references public.branches(id) on delete set null;
  end if;
end;
$$;

-- ===== Usuários =====
alter table public.profiles
  add column if not exists department text,
  add column if not exists job_title text,
  add column if not exists branch_id uuid references public.branches(id) on delete set null,
  add column if not exists mfa_required boolean not null default false;

-- Empresas em que o usuário pode trabalhar. Perfil sem nenhuma linha continua com acesso a todas (compatibilidade).
create table if not exists public.profile_companies (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.system_companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, company_id)
);
create index if not exists profile_companies_company_idx on public.profile_companies (company_id);

-- ===== Parâmetros por área (JSON validado pela aplicação) =====
create table if not exists public.app_settings (
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (system_company_id, key)
);

create table if not exists public.fiscal_operation_natures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'Venda' check (kind in ('Venda', 'Serviço', 'Remessa', 'Devolução', 'Outra')),
  default_cfop text check (default_cfop is null or default_cfop ~ '^[1-7][0-9]{3}$'),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Tabelas de preço =====
create table if not exists public.price_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references public.clients(id) on delete set null,
  valid_from date not null default current_date,
  valid_until date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

create table if not exists public.price_table_items (
  id uuid primary key default gen_random_uuid(),
  price_table_id uuid not null references public.price_tables(id) on delete cascade,
  material_id uuid references public.materials(id) on delete cascade,
  service_type_id uuid references public.service_types(id) on delete cascade,
  price numeric(14,4) not null check (price >= 0),
  created_at timestamptz not null default now(),
  check ((material_id is not null)::int + (service_type_id is not null)::int = 1)
);
create unique index if not exists price_table_items_material_uidx on public.price_table_items (price_table_id, material_id) where material_id is not null;
create unique index if not exists price_table_items_service_uidx on public.price_table_items (price_table_id, service_type_id) where service_type_id is not null;

-- ===== Modelos de orçamento =====
create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quote_type text check (quote_type in ('Produto', 'Serviço', 'Misto')),
  validity_days integer not null default 15 check (validity_days between 1 and 365),
  payment_condition_id uuid references public.payment_conditions(id) on delete set null,
  delivery_text text,
  warranty_days integer not null default 0 check (warranty_days >= 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Documentos centrais (cada envio é uma nova versão) =====
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null,
  title text not null,
  entity_type text,
  entity_ref text,
  version integer not null default 1,
  file_path text not null,
  file_name text not null,
  visibility text not null default 'Todos' check (visibility in ('Todos', 'Administradores', 'Responsável')),
  responsible_id uuid,
  responsible_name text,
  doc_date date not null default current_date,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists documents_entity_idx on public.documents (entity_type, entity_ref);
create index if not exists documents_title_idx on public.documents (lower(title), version desc);

-- ===== Integrações: tentativas de reprocessamento dos webhooks =====
do $$
begin
  if to_regclass('public.asaas_webhook_events') is not null then
    alter table public.asaas_webhook_events add column if not exists reprocess_attempts integer not null default 0;
  end if;
end;
$$;

insert into storage.buckets (id, name, public) values ('company-files', 'company-files', false) on conflict (id) do nothing;

-- ===== Empresa (CNPJ), updated_at e auditoria =====
do $$
declare
  table_name text;
begin
  foreach table_name in array array['fiscal_operation_natures', 'price_tables', 'price_table_items', 'quote_templates', 'documents'] loop
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
  execute 'alter table public.app_settings enable row level security';
  execute 'drop policy if exists tenant_authenticated_access on public.app_settings';
  execute 'drop policy if exists tenant_company_isolation on public.app_settings';
  execute 'create policy tenant_authenticated_access on public.app_settings as permissive for all to authenticated using (true) with check (true)';
  execute 'create policy tenant_company_isolation on public.app_settings as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())';
  execute 'drop trigger if exists assign_system_company on public.app_settings';
  execute 'create trigger assign_system_company before insert on public.app_settings for each row execute function public.assign_request_system_company()';
  foreach table_name in array array['branches', 'profile_companies'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
  end loop;
  foreach table_name in array array['branches', 'fiscal_operation_natures', 'price_tables', 'quote_templates'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
  -- trilha de auditoria (função criada em 213_auditoria.sql)
  if to_regprocedure('public.audit_row_change()') is not null then
    foreach table_name in array array['branches', 'profile_companies', 'app_settings', 'fiscal_operation_natures', 'price_tables', 'price_table_items', 'quote_templates', 'documents'] loop
      execute format('drop trigger if exists audit_row on public.%I', table_name);
      execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row_change(%L)', table_name, case when table_name in ('price_tables', 'price_table_items', 'quote_templates') then 'comercial' when table_name = 'fiscal_operation_natures' then 'fiscal' else 'configuracoes' end);
    end loop;
  end if;
end;
$$;
