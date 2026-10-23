-- 231 — Contabilidade: notas fiscais com todos os campos e impostos destacados (aba Financeiro > Contabilidade).
-- Rode no SQL Editor do Supabase. Não mexe em dados existentes.

create table if not exists public.accounting_invoices (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  operation text not null check (operation in ('Entrada', 'Saída')),
  kind text not null,
  model text,
  access_key text,
  number text,
  series text,
  issued_at timestamptz,
  nature text,
  issuer_document text,
  issuer_name text,
  issuer_state text,
  recipient_document text,
  recipient_name text,
  recipient_state text,
  total_products numeric(14,2) not null default 0,
  total_invoice numeric(14,2) not null default 0,
  total_icms_base numeric(14,2) not null default 0,
  total_icms numeric(14,2) not null default 0,
  total_icms_st numeric(14,2) not null default 0,
  total_ipi numeric(14,2) not null default 0,
  total_pis numeric(14,2) not null default 0,
  total_cofins numeric(14,2) not null default 0,
  total_iss numeric(14,2) not null default 0,
  total_freight numeric(14,2) not null default 0,
  total_discount numeric(14,2) not null default 0,
  total_taxes numeric(14,2) not null default 0,
  data jsonb not null default '{}'::jsonb,   -- leitura completa: partes, itens com impostos, totais, transporte, pagamento, cobrança
  fields jsonb not null default '[]'::jsonb, -- todos os campos do XML (caminho, valor)
  xml text,
  file_name text,
  created_by text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create unique index if not exists accounting_invoices_dedupe_uidx on public.accounting_invoices (system_company_id, dedupe_key);
create index if not exists accounting_invoices_issued_idx on public.accounting_invoices (issued_at desc);
create index if not exists accounting_invoices_issuer_idx on public.accounting_invoices (issuer_document);

drop trigger if exists assign_system_company on public.accounting_invoices;
create trigger assign_system_company before insert on public.accounting_invoices for each row execute function public.assign_request_system_company();
alter table public.accounting_invoices enable row level security;
drop policy if exists tenant_authenticated_access on public.accounting_invoices;
drop policy if exists tenant_company_isolation on public.accounting_invoices;
create policy tenant_authenticated_access on public.accounting_invoices as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.accounting_invoices as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());
