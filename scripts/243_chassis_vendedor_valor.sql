-- 243 — Chassis: vendedor (da fábrica e externo), valor, NF, consumidor e baixa de pagamento vindos da planilha "Controle de pgtos".
-- Rode no SQL Editor do Supabase DEPOIS do 242. ADITIVA e idempotente: só acrescenta colunas em public.chassis_registry; não altera nem apaga dados.

alter table public.chassis_registry add column if not exists seller text;            -- vendedor da fábrica (aba Fábrica: Anderson, Ellen, Thiago...)
alter table public.chassis_registry add column if not exists external_seller text;   -- vendedor externo (nome da aba da planilha)
alter table public.chassis_registry add column if not exists sale_value numeric(12,2);      -- valor da venda na aba Fábrica
alter table public.chassis_registry add column if not exists external_value numeric(12,2);  -- valor na aba do vendedor externo
alter table public.chassis_registry add column if not exists paid_value numeric(12,2);      -- valor pago, quando a aba traz
alter table public.chassis_registry add column if not exists sale_date date;
alter table public.chassis_registry add column if not exists sale_invoice text;      -- NF como escrita na planilha (pode ter duas: 14067/4945)
alter table public.chassis_registry add column if not exists consumer text;          -- consumidor final (aba Fábrica)
alter table public.chassis_registry add column if not exists payment_note text;      -- baixa de pagamento

create index if not exists chassis_registry_seller_idx on public.chassis_registry (seller);
create index if not exists chassis_registry_external_seller_idx on public.chassis_registry (external_seller);

-- conferência
select count(*) as colunas_novas from information_schema.columns where table_schema = 'public' and table_name = 'chassis_registry' and column_name in ('seller','external_seller','sale_value','external_value','paid_value','sale_date','sale_invoice','consumer','payment_note');
