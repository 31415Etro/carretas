-- Leads comerciais, funil de prospeccao e qualificacao BANT.
-- Execute no SQL Editor do Supabase.

create table if not exists public.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  cno_record_id uuid unique references public.comercial_cno_records(id) on delete set null,
  name text not null,
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  location text not null default '',
  source text not null default 'Manual',
  estimated_value numeric(14,2) not null default 0,
  bant_budget smallint not null default 0 check (bant_budget between 0 and 5),
  bant_authority smallint not null default 0 check (bant_authority between 0 and 5),
  bant_need smallint not null default 0 check (bant_need between 0 and 5),
  bant_timeline smallint not null default 0 check (bant_timeline between 0 and 5),
  bant_stage text not null default 'prospeccao' check (
    bant_stage in ('prospeccao', 'contato', 'qualificacao', 'proposta', 'negociacao', 'ganho', 'perdido')
  ),
  bant_notes text not null default '',
  bant_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_commercial_leads_stage on public.commercial_leads(bant_stage);
create index if not exists idx_commercial_leads_updated_at on public.commercial_leads(updated_at desc);
create index if not exists idx_commercial_leads_bant_updated_at on public.commercial_leads(bant_updated_at desc);

insert into public.commercial_leads (
  cno_record_id, name, company, email, phone, location, source, bant_stage
)
select
  id,
  coalesce(nullif(responsible_name, ''), nullif(company_name, ''), 'Lead CNO'),
  coalesce(company_name, ''),
  coalesce(email, ''),
  coalesce(phone, ''),
  concat_ws(' / ', nullif(address, ''), nullif(city, ''), nullif(state, '')),
  'CNO',
  case when commercial_status = 'Enviado' then 'contato' else 'prospeccao' end
from public.comercial_cno_records
where saved_at is not null
on conflict (cno_record_id) do update set
  name = excluded.name,
  company = excluded.company,
  email = excluded.email,
  phone = excluded.phone,
  location = excluded.location,
  updated_at = now();

alter table public.commercial_leads enable row level security;

drop policy if exists "commercial_leads_service_role_all" on public.commercial_leads;
create policy "commercial_leads_service_role_all"
on public.commercial_leads for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

