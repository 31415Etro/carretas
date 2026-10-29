-- 242 — Chassis: cadastro de chassis que não dependem de nota fiscal (planilha de controle do WhatsApp) + descrição/tamanho dos que já têm nota.
-- Rode no SQL Editor do Supabase. ADITIVA e idempotente: só cria a tabela; não altera nem apaga nada existente.
--
-- A página Chassis continua sendo montada pelas notas de saída (venda). Esta tabela guarda, por número de chassi (VIN):
--   - os chassis que ainda não têm nota no sistema (ex.: 2024 e 2025, ou fabricados e ainda não vendidos);
--   - a descrição / tamanho (ex.: "5 metros viga grossa", "1200x2000 com cesto"), que a nota fiscal não traz.

create table if not exists public.chassis_registry (
  id uuid primary key default gen_random_uuid(),
  vin text not null,                      -- número do chassi, 17 caracteres, em maiúsculas
  group_name text,                        -- grupo como veio da planilha (ex.: "CHASSI FZ 1E")
  model text,                             -- FZ 1E, BC 1E, JET...
  family text,                            -- FZ, BC, JET...
  axles integer,
  description text,                       -- descrição / dimensões (tamanho)
  year_manufacture text,
  year_model text,
  pbt_kg numeric(10,2),
  capacity_kg numeric(10,2),
  tare_kg numeric(10,2),
  axle_capacity_kg numeric(10,2),
  color text,
  client_hint text,                       -- revenda / cliente citado na conversa (não é o cliente da nota)
  first_mention timestamptz,
  last_mention timestamptz,
  mentions integer not null default 1,
  evidence text,                          -- trecho original da mensagem
  alerts text,                            -- divergências apontadas na planilha
  source text not null default 'Planilha Controle de Chassis (WhatsApp)',
  notes text,                             -- conferência manual
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create unique index if not exists chassis_registry_vin_uidx on public.chassis_registry (system_company_id, vin);
create index if not exists chassis_registry_model_idx on public.chassis_registry (model);

drop trigger if exists assign_system_company on public.chassis_registry;
create trigger assign_system_company before insert on public.chassis_registry for each row execute function public.assign_request_system_company();
drop trigger if exists trg_chassis_registry_updated_at on public.chassis_registry;
create trigger trg_chassis_registry_updated_at before update on public.chassis_registry for each row execute function public.set_updated_at();
alter table public.chassis_registry enable row level security;
drop policy if exists tenant_authenticated_access on public.chassis_registry;
drop policy if exists tenant_company_isolation on public.chassis_registry;
create policy tenant_authenticated_access on public.chassis_registry as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.chassis_registry as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

-- conferência: a tabela existe e está vazia até a importação da planilha
select count(*) as chassis_cadastrados from public.chassis_registry;
