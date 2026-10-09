begin;

alter table public.clients
  add column if not exists service_contexts text[] not null default '{}';

update public.clients
set service_contexts = '{}'
where service_contexts is null;

alter table public.clients
  drop constraint if exists clients_service_contexts_valid;

alter table public.clients
  add constraint clients_service_contexts_valid
  check (service_contexts <@ array['obra', 'pmoc', 'servicos']::text[]);

create index if not exists idx_clients_service_contexts
  on public.clients using gin (service_contexts);

commit;
