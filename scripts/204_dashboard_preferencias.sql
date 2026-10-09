-- Dashboard ERP Carretas: configuração do painel por usuário (período, filtros,
-- indicadores visíveis, tipo de gráfico e frequência de atualização).
-- A visibilidade das seções segue as permissões de página do usuário.

create table if not exists public.dashboard_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_preferences enable row level security;
drop policy if exists dashboard_preferences_owner on public.dashboard_preferences;
create policy dashboard_preferences_owner on public.dashboard_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
