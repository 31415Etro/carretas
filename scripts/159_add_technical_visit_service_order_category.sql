alter table public.service_orders
drop constraint if exists service_orders_service_category_check;

alter table public.service_orders
add constraint service_orders_service_category_check
check (
  service_category is null
  or service_category = ''
  or service_category in (
    'Manutencao Preventiva',
    'Instalacao',
    'Manutencao Corretiva',
    'Visita Tecnica'
  )
);

comment on column public.service_orders.service_category
is 'Categoria da OS de Servicos Diversos: Manutencao Preventiva, Instalacao, Manutencao Corretiva ou Visita Tecnica.';
