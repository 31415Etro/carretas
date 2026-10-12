-- Relatórios ERP Carretas: relatórios salvos (filtros, colunas, agrupamento, formato, usuários autorizados e
-- agendamento) e o registro das gerações/exportações.
-- Rode no SQL Editor do Supabase depois de 211_contratos.sql.

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  module text not null,
  report_id text not null,
  period_kind text not null default 'Mês atual',
  start_date date,
  end_date date,
  filters jsonb not null default '{}'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  group_by text,
  sort_key text,
  sort_dir text check (sort_dir in ('asc', 'desc')),
  show_totals boolean not null default true,
  format text not null default 'PDF' check (format in ('PDF', 'Excel', 'CSV')),
  authorized_user_ids uuid[] not null default '{}',
  frequency text not null default 'Sob demanda' check (frequency in ('Sob demanda', 'Diária', 'Semanal', 'Mensal')),
  weekday integer check (weekday between 0 and 6),
  day_of_month integer check (day_of_month between 1 and 31),
  next_run_date date,
  last_run_at timestamptz,
  active boolean not null default true,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_reports_next_run_idx on public.saved_reports (next_run_date) where active and frequency <> 'Sob demanda';

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  saved_report_id uuid references public.saved_reports(id) on delete set null,
  report_id text not null,
  report_name text not null,
  origin text not null check (origin in ('Manual', 'Exportação', 'Agendado')),
  format text,
  period_start date,
  period_end date,
  row_count integer not null default 0,
  user_id uuid,
  user_name text,
  delivered_to text[] not null default '{}',
  status text not null default 'OK' check (status in ('OK', 'Falha')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists report_runs_created_idx on public.report_runs (created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['saved_reports', 'report_runs'] loop
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
  execute 'drop trigger if exists trg_saved_reports_updated_at on public.saved_reports';
  execute 'create trigger trg_saved_reports_updated_at before update on public.saved_reports for each row execute function public.set_updated_at()';
end;
$$;
