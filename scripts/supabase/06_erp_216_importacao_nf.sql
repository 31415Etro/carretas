-- ERP Carretas - arquivo 6: importacao de NF (rode depois dos arquivos 01 a 05).
-- Origem: 216_importacao_nf.sql

-- Importação de notas fiscais (Financeiro): guarda cada NF lida (XML/PDF), quem é a parte contrária
-- e se ela foi cadastrada como cliente ou fornecedor. A mesma NF não entra duas vezes (dedupe_key).
-- Rode no SQL Editor do Supabase depois de 215_clientes_fornecedores.sql.

create table if not exists public.imported_invoices (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  kind text not null check (kind in ('NF-e', 'NFC-e', 'NFS-e', 'PDF')),
  access_key text,
  number text,
  series text,
  issued_at timestamptz,
  nature text,
  total_amount numeric(14,2) not null default 0,
  my_role text not null check (my_role in ('Remetente', 'Destinatário')),
  issuer_document text,
  issuer_name text,
  recipient_document text,
  recipient_name text,
  counterpart_document text not null,
  counterpart_name text,
  counterpart_kind text check (counterpart_kind is null or counterpart_kind in ('Cliente', 'Fornecedor')),
  counterpart_client_id uuid references public.clients(id) on delete set null,
  counterpart_supplier_id uuid references public.suppliers(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  installments jsonb not null default '[]'::jsonb,
  file_name text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.imported_invoices
  add column if not exists system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict;
create unique index if not exists imported_invoices_dedupe_uidx on public.imported_invoices (system_company_id, dedupe_key);
create index if not exists imported_invoices_created_idx on public.imported_invoices (created_at desc);
create index if not exists imported_invoices_counterpart_idx on public.imported_invoices (counterpart_document);

drop trigger if exists assign_system_company on public.imported_invoices;
create trigger assign_system_company before insert on public.imported_invoices for each row execute function public.assign_request_system_company();
alter table public.imported_invoices enable row level security;
drop policy if exists tenant_authenticated_access on public.imported_invoices;
drop policy if exists tenant_company_isolation on public.imported_invoices;
create policy tenant_authenticated_access on public.imported_invoices as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.imported_invoices as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

do $$
begin
  if to_regprocedure('public.audit_row_change()') is not null then
    drop trigger if exists audit_row on public.imported_invoices;
    create trigger audit_row after insert or update or delete on public.imported_invoices for each row execute function public.audit_row_change('financeiro');
  end if;
end;
$$;
