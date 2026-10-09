alter table public.service_orders
add column if not exists total_amount numeric(12,2) not null default 0;

create index if not exists idx_service_orders_total_amount
on public.service_orders(total_amount);

comment on column public.service_orders.total_amount
is 'Valor total da ordem de servico. Ao finalizar a OS, gera conta a receber pendente.';
