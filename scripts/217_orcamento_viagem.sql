-- Orçamento de viagem: orçamento de gasto para um funcionário, prestado de contas por um link público
-- (sem login) onde ele sobe fotos das notinhas, lidas por OCR. Rode no SQL Editor do Supabase.

-- Dados bancários do funcionário (reaproveitados ao criar orçamentos de viagem; preenchidos uma vez, ficam salvos no perfil).
alter table public.profiles add column if not exists bank_name text;
alter table public.profiles add column if not exists bank_agency text;
alter table public.profiles add column if not exists bank_account text;
alter table public.profiles add column if not exists bank_account_type text;
alter table public.profiles add column if not exists pix_key text;

create table if not exists public.travel_advances (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  employee_id uuid references public.profiles(id) on delete set null,
  employee_name text not null,
  employee_email text,
  reason text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  category_budgets jsonb not null default '{}'::jsonb,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'Aberto' check (status in ('Aberto', 'Finalizado', 'Concluido', 'Cancelado')),
  own_pocket_justification text not null default '',
  settlement_action text check (settlement_action is null or settlement_action in ('devolver', 'desconto_folha')),
  settlement_resolved boolean not null default false,
  settlement_note text not null default '',
  bank_snapshot jsonb not null default '{}'::jsonb,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table if not exists public.travel_advance_receipts (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.travel_advances(id) on delete cascade,
  photo_url text not null,
  amount numeric(14,2) not null default 0,
  establishment text not null default '',
  category text not null default 'Outros' check (category in ('Alimentacao', 'Combustivel', 'Hospedagem', 'Transporte', 'Estacionamento', 'Pedagio', 'Outros')),
  occurred_at date,
  status text not null default 'Enviado' check (status in ('Enviado', 'Aprovado', 'Contestado')),
  review_note text not null default '',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.travel_advances
  add column if not exists system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict;
alter table public.travel_advance_receipts
  add column if not exists system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict;

create index if not exists travel_advances_status_idx on public.travel_advances (system_company_id, status);
create index if not exists travel_advances_employee_idx on public.travel_advances (employee_id);
create unique index if not exists travel_advances_token_uidx on public.travel_advances (token);
create index if not exists travel_advance_receipts_advance_idx on public.travel_advance_receipts (advance_id);
create index if not exists travel_advance_receipts_status_idx on public.travel_advance_receipts (system_company_id, status);

do $$
begin
  if to_regprocedure('public.assign_request_system_company()') is not null then
    drop trigger if exists assign_system_company on public.travel_advances;
    create trigger assign_system_company before insert on public.travel_advances for each row execute function public.assign_request_system_company();
    drop trigger if exists assign_system_company on public.travel_advance_receipts;
    create trigger assign_system_company before insert on public.travel_advance_receipts for each row execute function public.assign_request_system_company();
  end if;
end;
$$;

alter table public.travel_advances enable row level security;
drop policy if exists tenant_authenticated_access on public.travel_advances;
drop policy if exists tenant_company_isolation on public.travel_advances;
create policy tenant_authenticated_access on public.travel_advances as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.travel_advances as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

alter table public.travel_advance_receipts enable row level security;
drop policy if exists tenant_authenticated_access on public.travel_advance_receipts;
drop policy if exists tenant_company_isolation on public.travel_advance_receipts;
create policy tenant_authenticated_access on public.travel_advance_receipts as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.travel_advance_receipts as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

do $$
begin
  if to_regprocedure('public.audit_row_change()') is not null then
    drop trigger if exists audit_row on public.travel_advances;
    create trigger audit_row after insert or update or delete on public.travel_advances for each row execute function public.audit_row_change('financeiro');
    drop trigger if exists audit_row on public.travel_advance_receipts;
    create trigger audit_row after insert or update or delete on public.travel_advance_receipts for each row execute function public.audit_row_change('financeiro');
  end if;
end;
$$;
