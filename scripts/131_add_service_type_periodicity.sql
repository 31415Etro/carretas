alter table public.service_types
add column if not exists periodicity_months integer not null default 1;

update public.service_types
set periodicity_months = 1
where periodicity_months is null
   or periodicity_months not in (1, 2, 3, 6);

alter table public.service_types
drop constraint if exists service_types_periodicity_months_check;

alter table public.service_types
add constraint service_types_periodicity_months_check
check (periodicity_months in (1, 2, 3, 6));

comment on column public.service_types.periodicity_months
is 'Periodicidade do servico em meses: 1, 2, 3 ou 6.';
