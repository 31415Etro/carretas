-- Valor manual dos kits do estoque.
-- Rode no SQL Editor do Supabase para habilitar o campo de valor no cadastro de kits.

alter table if exists public.stock_kits
  add column if not exists unit_value numeric(12,2) not null default 0;

comment on column public.stock_kits.unit_value is 'Valor manual informado no cadastro do kit.';
