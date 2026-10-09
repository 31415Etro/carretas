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
