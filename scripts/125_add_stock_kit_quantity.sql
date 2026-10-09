-- Saldo de kits prontos no estoque.
-- Execute no SQL Editor do Supabase antes de usar o campo no cadastro de kits.

alter table if exists public.stock_kits
  add column if not exists stock_quantity integer not null default 0;

update public.stock_kits
set stock_quantity = 0
where stock_quantity is null or stock_quantity < 0;

alter table if exists public.stock_kits
  drop constraint if exists stock_kits_stock_quantity_nonnegative;

alter table if exists public.stock_kits
  add constraint stock_kits_stock_quantity_nonnegative
  check (stock_quantity >= 0);

comment on column public.stock_kits.stock_quantity is
  'Quantidade de unidades prontas do kit disponíveis no estoque.';
