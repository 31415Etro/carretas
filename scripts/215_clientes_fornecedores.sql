-- Clientes & Fornecedores ERP Carretas: código automático, dados da consulta de CNPJ (Receita Federal),
-- endereços, dados comerciais e bancários.
-- Rode no SQL Editor do Supabase depois de 214_configuracoes.sql (precisa do 209_comercial.sql).

create sequence if not exists public.client_code_seq;
create sequence if not exists public.supplier_code_seq;

-- ===== Clientes =====
alter table public.clients
  add column if not exists code text,
  add column if not exists whatsapp text,
  add column if not exists country text not null default 'Brasil',
  add column if not exists cnpj_status text,
  add column if not exists cnpj_status_date date,
  add column if not exists opened_at date,
  add column if not exists cnae_main text,
  add column if not exists cnae_secondary text,
  add column if not exists legal_nature text,
  add column if not exists company_size text,
  add column if not exists branch_type text,
  add column if not exists cnpj_partners jsonb,
  add column if not exists cnpj_source text,
  add column if not exists cnpj_consulted_at timestamptz,
  add column if not exists billing_address text,
  add column if not exists delivery_address text,
  add column if not exists segment text,
  add column if not exists origin text,
  add column if not exists price_table_id uuid references public.price_tables(id) on delete set null,
  add column if not exists default_discount numeric(5,2) not null default 0 check (default_discount >= 0 and default_discount <= 100),
  add column if not exists created_by text;

-- ===== Fornecedores =====
alter table public.suppliers
  add column if not exists code text,
  add column if not exists whatsapp text,
  add column if not exists email_financial text,
  add column if not exists country text not null default 'Brasil',
  add column if not exists cnpj_status text,
  add column if not exists cnpj_status_date date,
  add column if not exists opened_at date,
  add column if not exists cnae_main text,
  add column if not exists cnae_secondary text,
  add column if not exists legal_nature text,
  add column if not exists company_size text,
  add column if not exists branch_type text,
  add column if not exists cnpj_partners jsonb,
  add column if not exists cnpj_source text,
  add column if not exists cnpj_consulted_at timestamptz,
  add column if not exists supplied_items text,
  add column if not exists brands text,
  add column if not exists delivery_days integer check (delivery_days is null or delivery_days >= 0),
  add column if not exists min_order numeric(14,2) not null default 0 check (min_order >= 0),
  add column if not exists bank_name text,
  add column if not exists bank_agency text,
  add column if not exists bank_account text,
  add column if not exists bank_account_type text,
  add column if not exists pix_key text,
  add column if not exists holder_name text,
  add column if not exists holder_document text,
  add column if not exists tax_withholdings text,
  add column if not exists rating integer check (rating is null or rating between 1 and 5),
  add column if not exists documents_notes text,
  add column if not exists created_by text;

-- ===== Código automático (CLI-000001 / FOR-000001) =====
alter table public.clients alter column code set default 'CLI-' || lpad(nextval('public.client_code_seq')::text, 6, '0');
alter table public.suppliers alter column code set default 'FOR-' || lpad(nextval('public.supplier_code_seq')::text, 6, '0');

update public.clients set code = 'CLI-' || lpad(nextval('public.client_code_seq')::text, 6, '0') where code is null;
update public.suppliers set code = 'FOR-' || lpad(nextval('public.supplier_code_seq')::text, 6, '0') where code is null;

create unique index if not exists clients_code_uidx on public.clients (code);
create unique index if not exists suppliers_code_uidx on public.suppliers (code);
