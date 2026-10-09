alter table public.service_types
add column if not exists enabled_contexts text[] not null
default array['obra', 'pmoc', 'servicos'];

update public.service_types
set enabled_contexts = array['obra', 'pmoc', 'servicos']
where enabled_contexts is null
   or cardinality(enabled_contexts) = 0;

alter table public.service_types
drop constraint if exists service_types_enabled_contexts_check;

alter table public.service_types
add constraint service_types_enabled_contexts_check
check (
  enabled_contexts <@ array['obra', 'pmoc', 'servicos']::text[]
  and cardinality(enabled_contexts) > 0
);

comment on column public.service_types.enabled_contexts
is 'Define onde o tipo de serviço aparece: obra, pmoc, servicos.';
