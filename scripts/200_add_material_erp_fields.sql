-- Cadastro de produtos/materiais no padrão ERP: identificação, dados fiscais,
-- logística, custos/preços e fornecedor padrão.
-- Rode no SQL Editor do Supabase.

alter table if exists public.materials
  add column if not exists barcode text,
  add column if not exists ncm text,
  add column if not exists cest text,
  add column if not exists origin text,
  add column if not exists sped_item_type text,
  add column if not exists maximum_stock numeric(12,3) not null default 0,
  add column if not exists gross_weight numeric(12,3) not null default 0,
  add column if not exists net_weight numeric(12,3) not null default 0,
  add column if not exists height numeric(12,3) not null default 0,
  add column if not exists width numeric(12,3) not null default 0,
  add column if not exists length numeric(12,3) not null default 0,
  add column if not exists location text,
  add column if not exists cost_price numeric(14,4) not null default 0,
  add column if not exists sale_price numeric(14,4) not null default 0,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists supplier_code text;

-- Até aqui o campo internal_code era exibido como "NCM". Copia os valores que
-- parecem NCM (8 dígitos) para a nova coluna, sem apagar o código interno.
update public.materials
  set ncm = regexp_replace(internal_code, '\D', '', 'g')
  where (ncm is null or ncm = '')
    and regexp_replace(coalesce(internal_code, ''), '\D', '', 'g') ~ '^\d{8}$';

comment on column public.materials.internal_code is 'SKU / código interno do item.';
comment on column public.materials.barcode is 'Código de barras GTIN/EAN.';
comment on column public.materials.ncm is 'Nomenclatura Comum do Mercosul (8 dígitos).';
comment on column public.materials.cest is 'Código Especificador da Substituição Tributária (7 dígitos).';
comment on column public.materials.origin is 'Origem da mercadoria (Tabela A do CST: 0 a 8).';
comment on column public.materials.sped_item_type is 'Tipo do item no SPED (registro 0200: 00 a 99).';
comment on column public.materials.location is 'Endereço no depósito (corredor, prateleira, posição).';
comment on column public.materials.supplier_code is 'Código do item no fornecedor padrão.';
