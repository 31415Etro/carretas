-- 245 — Renaver (montadora): situação de cada chassi (pendente / sucesso / falha) lida todo dia pelo robô, pedidos de "Entrada de Zero KM" e histórico das verificações.
-- Rode no SQL Editor do Supabase. ADITIVA e idempotente: só cria tabelas; não altera nem apaga nada existente.

create table if not exists public.renaver_chassis (
  id uuid primary key default gen_random_uuid(),
  vin text not null,
  tab text,                                    -- aba do Renaver onde o chassi está: Pendentes de Entrada | Em Estoque | Em Transferência | Saídas
  renaver_status text,                         -- coluna "Status" do Renaver, como veio
  kind text,                                   -- coluna "Tipo" (ACABADO / INACABADO)
  montadora_at text,                           -- coluna "Data/Hora Montadora", como veio
  situation text not null default 'pendente',  -- pendente | sucesso | falha (calculada pelo ERP)
  entry_state text,                            -- null | solicitada | concluida | erro (pedido de Entrada de Zero KM feito pelo ERP)
  entry_message text,
  entry_requested_by text,
  entry_requested_at timestamptz,
  entry_finished_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists renaver_chassis_vin_uidx on public.renaver_chassis (system_company_id, vin);
create index if not exists renaver_chassis_entry_idx on public.renaver_chassis (entry_state) where entry_state = 'solicitada';

create table if not exists public.renaver_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  ok boolean not null default true,
  error text,
  total integer not null default 0,
  pending integer not null default 0,
  success integer not null default 0,
  failure integer not null default 0,
  entries jsonb not null default '[]'::jsonb,  -- entradas de Zero KM feitas nesta rodada: [{vin, ok, message}]
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists renaver_runs_company_idx on public.renaver_runs (system_company_id, finished_at desc);

drop trigger if exists trg_renaver_chassis_updated_at on public.renaver_chassis;
create trigger trg_renaver_chassis_updated_at before update on public.renaver_chassis for each row execute function public.set_updated_at();

do $$
declare table_name text;
begin
  foreach table_name in array array['renaver_chassis', 'renaver_runs'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
end $$;

select count(*) as chassis from public.renaver_chassis;
