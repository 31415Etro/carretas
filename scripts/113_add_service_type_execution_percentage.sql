-- Adiciona percentual de execução aos tipos de serviço.
-- Rode este SQL no Supabase antes de usar o campo na página Serviços.

alter table public.service_types
add column if not exists execution_percentage numeric(7,3) not null default 0;

comment on column public.service_types.execution_percentage
is 'Percentual de execução usado no cadastro do tipo de serviço.';
