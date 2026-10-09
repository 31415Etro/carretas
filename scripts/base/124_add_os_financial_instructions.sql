-- Instrucoes financeiras vinculadas a OS e Plano PMOC.
-- Rode no SQL Editor do Supabase.

alter table if exists public.service_orders
  add column if not exists payment_method text not null default '',
  add column if not exists payment_type text not null default '',
  add column if not exists payment_term text not null default '',
  add column if not exists payment_due_date date,
  add column if not exists financial_notes text not null default '';

alter table if exists public.pmoc_plans
  add column if not exists payment_method text not null default '',
  add column if not exists payment_type text not null default '',
  add column if not exists payment_term text not null default '',
  add column if not exists payment_due_date date,
  add column if not exists financial_notes text not null default '';

comment on column public.service_orders.payment_method is 'Forma de pagamento prevista para a OS.';
comment on column public.service_orders.payment_type is 'Tipo de pagamento previsto para a OS.';
comment on column public.service_orders.payment_term is 'Prazo/condicao de pagamento da OS.';
comment on column public.service_orders.payment_due_date is 'Data prevista de vencimento/recebimento da OS.';
comment on column public.service_orders.financial_notes is 'Instrucoes financeiras adicionais da OS.';

comment on column public.pmoc_plans.payment_method is 'Forma de pagamento padrao das OS geradas pelo PMOC.';
comment on column public.pmoc_plans.payment_type is 'Tipo de pagamento padrao das OS geradas pelo PMOC.';
comment on column public.pmoc_plans.payment_term is 'Prazo/condicao de pagamento padrao das OS geradas pelo PMOC.';
comment on column public.pmoc_plans.payment_due_date is 'Data prevista de vencimento padrao das OS geradas pelo PMOC.';
comment on column public.pmoc_plans.financial_notes is 'Instrucoes financeiras padrao das OS geradas pelo PMOC.';
