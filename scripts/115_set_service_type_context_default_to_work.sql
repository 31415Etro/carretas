alter table public.service_types
alter column enabled_contexts set default array['obra'];

update public.service_types
set enabled_contexts = array['obra']
where enabled_contexts @> array['obra', 'pmoc', 'servicos']::text[]
  and enabled_contexts <@ array['obra', 'pmoc', 'servicos']::text[];
