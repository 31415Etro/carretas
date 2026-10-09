-- Medidas de infraestrutura cadastradas no ponto do orcamento e copiadas para a OS de obra.

alter table public.budget_points
  add column if not exists infrastructure_measure text,
  add column if not exists measurement_confirmation text;

alter table public.work_points
  add column if not exists infrastructure_measure text,
  add column if not exists measurement_confirmation text;

comment on column public.budget_points.infrastructure_measure is 'Medida da infraestrutura informada no orcamento.';
comment on column public.budget_points.measurement_confirmation is 'Confirmacao da medida da infraestrutura no orcamento.';
comment on column public.work_points.infrastructure_measure is 'Medida da infraestrutura vinculada ao ponto da OS de obra.';
comment on column public.work_points.measurement_confirmation is 'Confirmacao da medida da infraestrutura vinculada ao ponto da OS de obra.';

notify pgrst, 'reload schema';
