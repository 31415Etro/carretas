begin;

alter table public.clients
  add column if not exists monthly_pmoc_value numeric(14,2) not null default 0;

alter table public.clients
  drop constraint if exists clients_monthly_pmoc_value_nonnegative;

alter table public.clients
  add constraint clients_monthly_pmoc_value_nonnegative
  check (monthly_pmoc_value >= 0);

comment on column public.clients.monthly_pmoc_value is
  'Valor mensal em reais pago pelo cliente pelo contrato PMOC.';

commit;
