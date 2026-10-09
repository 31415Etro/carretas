alter table public.service_types
add column if not exists execution_percentage numeric(7,3) not null default 0;

alter table public.service_types
add column if not exists enabled_contexts text[] not null default array['obra'];

alter table public.service_types
add column if not exists required_photos text[] not null default '{}';

alter table public.service_types
add column if not exists orientation_video_url text;

alter table public.service_types
add column if not exists orientation_video_description text;

update public.service_types
set enabled_contexts = array['obra']
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
