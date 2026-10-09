create table if not exists public.whatsapp_budget_requests (
  id uuid primary key default gen_random_uuid(),
  service_type text not null check (service_type in ('instalacao', 'corretiva', 'preventiva')),
  customer_name text,
  customer_phone text,
  customer_document text,
  customer_email text,
  address text,
  city text,
  state text,
  source text not null default 'whatsapp',
  status text not null default 'Novo',
  raw_payload jsonb not null default '{}'::jsonb,
  agent_notes text,
  internal_notes text,
  equipment_capacity text,
  property_type text,
  apartment_floor text,
  has_technical_area text,
  has_guardrail text,
  house_floor text,
  ceiling_height text,
  has_infrastructure text,
  installation_type text,
  infrastructure_meters_included numeric(12,2),
  additional_infrastructure_meter_value numeric(12,2),
  command_cable_meter_value numeric(12,2) default 2,
  equipment_used boolean,
  brand text,
  loses_extended_warranty_notice boolean default false,
  warranty_notice text,
  issue_description text,
  error_code text,
  corrective_brand text,
  corrective_capacity text,
  corrective_environment text,
  contract_customer boolean,
  schedule_priority text,
  technical_visit_fee numeric(12,2),
  accepted_extended_schedule boolean,
  equipment_quantity integer,
  preventive_capacities text,
  preventive_ceiling_height text,
  condenser_access text,
  wants_uninstall boolean,
  needs_cleaning_certificate boolean,
  needs_art boolean,
  art_value numeric(12,2),
  preventive_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_budget_request_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.whatsapp_budget_requests(id) on delete cascade,
  file_url text not null,
  file_name text,
  file_type text,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_budget_requests_service_type on public.whatsapp_budget_requests(service_type);
create index if not exists idx_whatsapp_budget_requests_status on public.whatsapp_budget_requests(status);
create index if not exists idx_whatsapp_budget_requests_created_at on public.whatsapp_budget_requests(created_at desc);
create index if not exists idx_whatsapp_budget_request_photos_request_id on public.whatsapp_budget_request_photos(request_id);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
  ) then
    drop trigger if exists trg_whatsapp_budget_requests_updated_at on public.whatsapp_budget_requests;
    create trigger trg_whatsapp_budget_requests_updated_at
      before update on public.whatsapp_budget_requests
      for each row
      execute function public.set_updated_at();
  end if;
end $$;

alter table public.whatsapp_budget_requests enable row level security;
alter table public.whatsapp_budget_request_photos enable row level security;

drop policy if exists "Service role manages whatsapp budget requests" on public.whatsapp_budget_requests;
create policy "Service role manages whatsapp budget requests"
  on public.whatsapp_budget_requests
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Service role manages whatsapp budget request photos" on public.whatsapp_budget_request_photos;
create policy "Service role manages whatsapp budget request photos"
  on public.whatsapp_budget_request_photos
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
