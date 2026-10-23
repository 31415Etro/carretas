-- 227: Chão de fábrica digital (tablets): colaboradores, sessões individuais, esteira de etapas, tarefas por unidade, apontamento de tempo por colaborador,
-- consumo de materiais, checklists, medidas, ocorrências, etapa terceirizada, QR por unidade e liberação da expedição.
-- ADITIVA e idempotente. Requer 217 a 224 (usa a ordem de produção, o consumo e a documentação veicular existentes; a configuração congelada vem do 225, quando instalado).
-- DECISÃO IMPORTANTE: a documentação veicular NÃO bloqueia mais o início/consumo/conclusão física da produção (ela corre em paralelo). A liberação para
-- produzir continua dependendo do pedido confirmado, do pagamento/sinal (ou exceção formal) e da autorização operacional; a documentação passa a ser exigida na EXPEDIÇÃO.
-- Todos os horários oficiais vêm do relógio do servidor (clock_timestamp). Nada aqui apaga ou altera dados financeiros.

-- ================================================================ 1. Regras da empresa e colaboradores
create table if not exists public.shop_settings (
  system_company_id uuid primary key default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  require_vin_before_tasks boolean not null default true,      -- chassi reservado (informado) antes de liberar as tarefas da unidade
  idle_minutes integer not null default 10 check (idle_minutes between 1 and 120),
  max_pin_attempts integer not null default 5 check (max_pin_attempts between 3 and 20),
  lockout_minutes integer not null default 10 check (lockout_minutes between 1 and 240),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_workers (
  id uuid primary key default gen_random_uuid(),
  code text not null,                                  -- matrícula/crachá usado no tablet
  name text not null,
  profile_id uuid references public.profiles(id) on delete set null,   -- ligação opcional com o login do ERP (não duplica cadastro de usuários)
  sectors text[] not null default '{}',                -- setores em que pode apontar (ex.: Soldagem, Montagem)
  shift text,
  hourly_rate numeric(10,2) not null default 0 check (hourly_rate >= 0),
  is_inspector boolean not null default false,
  is_supervisor boolean not null default false,
  pin_hash text,
  pin_set_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (system_company_id, code)
);
create unique index if not exists shop_workers_profile_uidx on public.shop_workers (system_company_id, profile_id) where profile_id is not null;

create table if not exists public.shop_sessions (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.shop_workers(id) on delete restrict,
  token_hash text not null unique,
  device text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create or replace function public.shop_cid() returns uuid language sql stable as $$ select public.request_system_company_id() $$;

create or replace function public.shop_settings_row()
returns public.shop_settings
language plpgsql
stable
as $$
declare
  v public.shop_settings%rowtype;
begin
  select * into v from public.shop_settings where system_company_id = public.shop_cid();
  if not found then
    v.system_company_id := public.shop_cid(); v.require_vin_before_tasks := true; v.idle_minutes := 10; v.max_pin_attempts := 5; v.lockout_minutes := 10;
  end if;
  return v;
end;
$$;

create or replace function public.shop_settings_update(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v public.shop_settings%rowtype := public.shop_settings_row();
begin
  insert into public.shop_settings (system_company_id) values (public.shop_cid()) on conflict do nothing;
  update public.shop_settings set
    require_vin_before_tasks = coalesce((p->>'require_vin_before_tasks')::boolean, v.require_vin_before_tasks),
    idle_minutes = coalesce(nullif(p->>'idle_minutes', '')::integer, v.idle_minutes),
    max_pin_attempts = coalesce(nullif(p->>'max_pin_attempts', '')::integer, v.max_pin_attempts),
    lockout_minutes = coalesce(nullif(p->>'lockout_minutes', '')::integer, v.lockout_minutes),
    updated_by = coalesce(p_user, public.request_actor()), updated_at = now()
  where system_company_id = public.shop_cid();
  return to_jsonb(public.shop_settings_row());
end;
$$;

-- Cadastro/alteração do colaborador. O PIN só é gravado como hash (bcrypt) e nunca volta nas consultas.
create or replace function public.shop_worker_save(p jsonb, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'worker_id', '')::uuid;
  v_pin text := nullif(p->>'pin', '');
  v_sectors text[];
begin
  if v_pin is not null and v_pin !~ '^[0-9]{4,8}$' then
    raise exception 'O PIN deve ter de 4 a 8 números.';
  end if;
  select coalesce(array_agg(x), '{}') into v_sectors from jsonb_array_elements_text(coalesce(p->'sectors', '[]'::jsonb)) x;
  if v_id is null then
    if coalesce(btrim(p->>'code'), '') = '' or coalesce(btrim(p->>'name'), '') = '' then
      raise exception 'Informe a matrícula e o nome do colaborador.';
    end if;
    begin
      insert into public.shop_workers (code, name, profile_id, sectors, shift, hourly_rate, is_inspector, is_supervisor, pin_hash, pin_set_at, created_by)
      values (upper(btrim(p->>'code')), btrim(p->>'name'), nullif(p->>'profile_id', '')::uuid, v_sectors, nullif(btrim(p->>'shift'), ''), coalesce(nullif(p->>'hourly_rate', '')::numeric, 0),
              coalesce((p->>'is_inspector')::boolean, false), coalesce((p->>'is_supervisor')::boolean, false), case when v_pin is not null then crypt(v_pin, gen_salt('bf')) end, case when v_pin is not null then now() end, coalesce(p_user, public.request_actor()))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Já existe um colaborador com esta matrícula (ou este login do ERP já está ligado a outro).';
    end;
  else
    update public.shop_workers set name = coalesce(nullif(btrim(p->>'name'), ''), name), sectors = case when p ? 'sectors' then v_sectors else sectors end, shift = case when p ? 'shift' then nullif(btrim(p->>'shift'), '') else shift end,
      hourly_rate = coalesce(nullif(p->>'hourly_rate', '')::numeric, hourly_rate), is_inspector = coalesce((p->>'is_inspector')::boolean, is_inspector), is_supervisor = coalesce((p->>'is_supervisor')::boolean, is_supervisor),
      active = coalesce((p->>'active')::boolean, active), profile_id = case when p ? 'profile_id' then nullif(p->>'profile_id', '')::uuid else profile_id end,
      pin_hash = case when v_pin is not null then crypt(v_pin, gen_salt('bf')) else pin_hash end, pin_set_at = case when v_pin is not null then now() else pin_set_at end,
      failed_attempts = case when v_pin is not null then 0 else failed_attempts end, locked_until = case when v_pin is not null then null else locked_until end
    where id = v_id;
    if not found then
      raise exception 'Colaborador não encontrado.';
    end if;
    if p ? 'active' and not coalesce((p->>'active')::boolean, true) then
      update public.shop_sessions set ended_at = clock_timestamp() where worker_id = v_id and ended_at is null;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.shop_worker_public(p_worker public.shop_workers)
returns jsonb
language sql
immutable
as $$ select jsonb_build_object('id', p_worker.id, 'code', p_worker.code, 'name', p_worker.name, 'sectors', p_worker.sectors, 'shift', p_worker.shift, 'is_inspector', p_worker.is_inspector, 'is_supervisor', p_worker.is_supervisor) $$;

create or replace function public.shop_open_session(p_worker public.shop_workers, p_device text)
returns jsonb
language plpgsql
as $$
declare
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  -- uma sessão por colaborador e dispositivo: entrar de novo encerra a anterior
  update public.shop_sessions set ended_at = clock_timestamp() where worker_id = p_worker.id and ended_at is null and coalesce(device, '') = coalesce(p_device, '');
  insert into public.shop_sessions (worker_id, token_hash, device, system_company_id) values (p_worker.id, encode(digest(v_token, 'sha256'), 'hex'), p_device, p_worker.system_company_id);
  return jsonb_build_object('token', v_token, 'worker', public.shop_worker_public(p_worker), 'idle_minutes', (public.shop_settings_row()).idle_minutes);
end;
$$;

-- Identificação no tablet por matrícula + PIN, com bloqueio temporário após tentativas erradas.
-- Devolve {ok:false, message} em vez de levantar erro: assim a contagem de tentativas erradas é gravada de verdade (um erro desfaria o registro).
create or replace function public.shop_worker_login(p_code text, p_pin text, p_device text default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers%rowtype;
  v_set public.shop_settings := public.shop_settings_row();
  v_attempts integer;
begin
  select * into v_w from public.shop_workers where system_company_id = public.shop_cid() and code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not v_w.active or v_w.pin_hash is null then
    return jsonb_build_object('ok', false, 'message', 'Matrícula ou PIN inválidos.');
  end if;
  if v_w.locked_until is not null and v_w.locked_until > clock_timestamp() then
    return jsonb_build_object('ok', false, 'locked', true, 'message', 'Acesso bloqueado por tentativas erradas. Tente novamente em alguns minutos ou chame o gestor.');
  end if;
  if v_w.pin_hash <> crypt(coalesce(p_pin, ''), v_w.pin_hash) then
    v_attempts := v_w.failed_attempts + 1;
    update public.shop_workers set failed_attempts = case when v_attempts >= v_set.max_pin_attempts then 0 else v_attempts end,
           locked_until = case when v_attempts >= v_set.max_pin_attempts then clock_timestamp() + make_interval(mins => v_set.lockout_minutes) else locked_until end where id = v_w.id;
    return jsonb_build_object('ok', false, 'message', 'Matrícula ou PIN inválidos.');
  end if;
  update public.shop_workers set failed_attempts = 0, locked_until = null where id = v_w.id;
  return public.shop_open_session(v_w, p_device) || jsonb_build_object('ok', true);
end;
$$;

-- Quem já entrou no ERP com login próprio vinculado ao colaborador não precisa de PIN.
create or replace function public.shop_worker_login_profile(p_profile uuid, p_device text default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers%rowtype;
begin
  select * into v_w from public.shop_workers where system_company_id = public.shop_cid() and profile_id = p_profile and active;
  if not found then
    raise exception 'Seu login do ERP não está ligado a um colaborador da fábrica.';
  end if;
  return public.shop_open_session(v_w, p_device);
end;
$$;

create or replace function public.shop_worker_logout(p_token text)
returns void
language sql
as $$ update public.shop_sessions set ended_at = clock_timestamp() where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and ended_at is null $$;

-- Valida a sessão do tablet (inatividade, empresa, colaborador ativo) e devolve o colaborador. Todo apontamento passa por aqui.
create or replace function public.shop_session_worker(p_token text)
returns public.shop_workers
language plpgsql
as $$
declare
  v_s public.shop_sessions%rowtype;
  v_w public.shop_workers%rowtype;
  v_set public.shop_settings := public.shop_settings_row();
begin
  select * into v_s from public.shop_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and ended_at is null and system_company_id = public.shop_cid();
  if not found or v_s.last_seen_at < clock_timestamp() - make_interval(mins => v_set.idle_minutes) or v_s.created_at < clock_timestamp() - interval '14 hours' then
    if found then update public.shop_sessions set ended_at = clock_timestamp() where id = v_s.id; end if;
    raise exception 'Sessão expirada: identifique-se novamente.';
  end if;
  select * into v_w from public.shop_workers where id = v_s.worker_id;
  if not found or not v_w.active then
    raise exception 'Colaborador inativo.';
  end if;
  update public.shop_sessions set last_seen_at = clock_timestamp() where id = v_s.id;
  return v_w;
end;
$$;

-- ================================================================ 2. Esteira oficial: etapas, checklists e materiais por etapa
create table if not exists public.shop_steps (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{0,29}$'),
  name text not null,
  seq integer not null,
  kind text not null default 'fabricacao' check (kind in ('fabricacao', 'inspecao', 'terceirizada', 'administrativa')),
  sector text,                                         -- setor que executa (casa com shop_workers.sectors)
  depends_on text[] not null default '{}',             -- códigos das etapas que precisam estar concluídas (da mesma unidade)
  allow_multiple boolean not null default false,       -- vários colaboradores ao mesmo tempo
  requires_checklist boolean not null default false,
  requires_measures boolean not null default false,
  kit_match text,                                      -- kits cuja categoria casa com este texto aparecem na tarefa ('*' = os kits não reivindicados por outra etapa)
  standard_minutes numeric(10,2),                      -- tempo previsto por unidade (opcional)
  tolerance_mm numeric(8,2),                           -- tolerância na conferência de medidas (vazio = qualquer diferença é divergência)
  active boolean not null default true,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (system_company_id, code)
);

create table if not exists public.shop_step_kits (
  step_id uuid not null references public.shop_steps(id) on delete cascade,
  kit_id uuid not null references public.materials(id) on delete restrict,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  primary key (step_id, kit_id)
);

create table if not exists public.shop_checklist_items (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.shop_steps(id) on delete cascade,
  position integer not null default 0,
  label text not null,
  mandatory boolean not null default true,
  allow_na boolean not null default false,
  active boolean not null default true,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

-- As etapas do fluxograma oficial da ND Carretas. Os itens de checklist NÃO são inventados: o gestor cadastra os itens de cada inspeção.
create or replace function public.shop_steps_seed(p_user text default null)
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in select * from (values
    ('soldagem', 'Soldagem / produção do chassi', 1, 'fabricacao', 'Soldagem', array[]::text[], true, false, false, 'chassi'),
    ('acabamento', 'Galvanização ou acabamento (terceirizado)', 2, 'terceirizada', 'Acabamento', array['soldagem'], false, false, false, null),
    ('montagem', 'Montagem', 3, 'fabricacao', 'Montagem', array['acabamento'], true, false, false, '*'),
    ('gravacao', 'Impressão/gravação do chassi', 4, 'fabricacao', 'Montagem', array['montagem'], false, true, false, null),
    ('checklist', 'Checklist de inspeção', 5, 'inspecao', 'Qualidade', array['gravacao'], false, true, false, null),
    ('medidas', 'Conferência das medidas', 6, 'inspecao', 'Qualidade', array['checklist'], false, false, true, null),
    ('faixas', 'Faixas reflexivas', 7, 'fabricacao', 'Montagem', array['medidas'], false, true, false, null),
    ('despachante', 'Acionamento do despachante (emplacamento)', 8, 'administrativa', 'Expedição', array['faixas'], false, false, false, null)
  ) as t(code, name, seq, kind, sector, depends_on, allow_multiple, requires_checklist, requires_measures, kit_match) loop
    insert into public.shop_steps (code, name, seq, kind, sector, depends_on, allow_multiple, requires_checklist, requires_measures, kit_match)
    values (v_row.code, v_row.name, v_row.seq, v_row.kind, v_row.sector, v_row.depends_on, v_row.allow_multiple, v_row.requires_checklist, v_row.requires_measures, v_row.kit_match)
    on conflict (system_company_id, code) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.shop_step_save(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'step_id', '')::uuid;
  v_deps text[];
begin
  select coalesce(array_agg(x), '{}') into v_deps from jsonb_array_elements_text(coalesce(p->'depends_on', '[]'::jsonb)) x;
  update public.shop_steps set name = coalesce(nullif(btrim(p->>'name'), ''), name), sector = case when p ? 'sector' then nullif(btrim(p->>'sector'), '') else sector end,
    depends_on = case when p ? 'depends_on' then v_deps else depends_on end, allow_multiple = coalesce((p->>'allow_multiple')::boolean, allow_multiple),
    requires_checklist = coalesce((p->>'requires_checklist')::boolean, requires_checklist), requires_measures = coalesce((p->>'requires_measures')::boolean, requires_measures),
    kit_match = case when p ? 'kit_match' then nullif(btrim(p->>'kit_match'), '') else kit_match end, standard_minutes = case when p ? 'standard_minutes' then nullif(p->>'standard_minutes', '')::numeric else standard_minutes end,
    tolerance_mm = case when p ? 'tolerance_mm' then nullif(p->>'tolerance_mm', '')::numeric else tolerance_mm end, active = coalesce((p->>'active')::boolean, active)
  where id = v_id and system_company_id = public.shop_cid();
  if not found then
    raise exception 'Etapa não encontrada.';
  end if;
  return v_id;
end;
$$;

create or replace function public.shop_checklist_item_save(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'item_id', '')::uuid;
begin
  if v_id is null then
    if not exists (select 1 from public.shop_steps where id = (p->>'step_id')::uuid and system_company_id = public.shop_cid()) then
      raise exception 'Etapa não encontrada.';
    end if;
    insert into public.shop_checklist_items (step_id, position, label, mandatory, allow_na, system_company_id)
    values ((p->>'step_id')::uuid, coalesce(nullif(p->>'position', '')::integer, (select coalesce(max(position), 0) + 1 from public.shop_checklist_items where step_id = (p->>'step_id')::uuid)),
            btrim(p->>'label'), coalesce((p->>'mandatory')::boolean, true), coalesce((p->>'allow_na')::boolean, false), public.shop_cid()) returning id into v_id;
  else
    update public.shop_checklist_items set label = coalesce(nullif(btrim(p->>'label'), ''), label), mandatory = coalesce((p->>'mandatory')::boolean, mandatory),
      allow_na = coalesce((p->>'allow_na')::boolean, allow_na), active = coalesce((p->>'active')::boolean, active), position = coalesce(nullif(p->>'position', '')::integer, position)
    where id = v_id and system_company_id = public.shop_cid();
    if not found then raise exception 'Item não encontrado.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.shop_step_kits_set(p_step uuid, p_kits uuid[])
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from public.shop_steps where id = p_step and system_company_id = public.shop_cid()) then
    raise exception 'Etapa não encontrada.';
  end if;
  delete from public.shop_step_kits where step_id = p_step;
  insert into public.shop_step_kits (step_id, kit_id, system_company_id) select p_step, k, public.shop_cid() from unnest(p_kits) k;
end;
$$;

-- ================================================================ 3. Tarefas por unidade, apontamentos e eventos
create table if not exists public.shop_tasks (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  unit_number integer not null check (unit_number >= 1),
  step_id uuid not null references public.shop_steps(id) on delete restrict,
  step_code text not null,
  step_name text not null,
  seq integer not null,
  kind text not null,
  status text not null default 'Aguardando' check (status in ('Aguardando', 'Pronta', 'Em execucao', 'Pausada', 'Bloqueada', 'Concluida', 'Com pendencia', 'Cancelada')),
  blocked_reason text,
  pending_reason text,
  assigned_worker_id uuid references public.shop_workers(id) on delete set null,
  planned_end date,
  started_at timestamptz,
  finished_at timestamptz,
  finished_by uuid references public.shop_workers(id) on delete set null,
  quantity_done numeric(14,3),
  notes text,
  photos text[] not null default '{}',
  rework_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (production_order_id, unit_number, step_id)
);
create index if not exists shop_tasks_order_idx on public.shop_tasks (production_order_id);
create index if not exists shop_tasks_status_idx on public.shop_tasks (system_company_id, status);

-- Cada trecho de trabalho de UM colaborador numa tarefa. Um colaborador só pode ter um trecho aberto por vez (sem dupla contagem).
create table if not exists public.shop_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.shop_tasks(id) on delete restrict,
  worker_id uuid not null references public.shop_workers(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('pausa', 'fim', 'reatribuicao', 'cancelamento', 'troca')),
  pause_reason text,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists shop_time_entries_open_worker_uidx on public.shop_time_entries (worker_id) where ended_at is null;
create index if not exists shop_time_entries_task_idx on public.shop_time_entries (task_id);

create table if not exists public.shop_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.shop_tasks(id) on delete restrict,
  worker_id uuid references public.shop_workers(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  actor text,
  device text,
  request_key text,
  client_at timestamptz,                               -- horário informado pelo tablet (só para auditoria; nunca usado nos cálculos)
  at timestamptz not null default clock_timestamp(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists shop_task_events_key_uidx on public.shop_task_events (task_id, request_key) where request_key is not null;
create index if not exists shop_task_events_task_idx on public.shop_task_events (task_id, at);

create table if not exists public.shop_task_consumptions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.shop_tasks(id) on delete restrict,
  worker_id uuid references public.shop_workers(id) on delete set null,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  kind text not null default 'Consumo',
  production_consumption_id uuid references public.production_consumptions(id) on delete restrict,
  at timestamptz not null default clock_timestamp(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create table if not exists public.shop_task_checks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.shop_tasks(id) on delete restrict,
  item_id uuid not null references public.shop_checklist_items(id) on delete restrict,
  result text not null check (result in ('conforme', 'nao_conforme', 'na')),
  note text,
  photos text[] not null default '{}',
  worker_id uuid references public.shop_workers(id) on delete set null,
  superseded boolean not null default false,
  at timestamptz not null default clock_timestamp(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists shop_task_checks_task_idx on public.shop_task_checks (task_id, item_id);

create table if not exists public.shop_task_measures (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.shop_tasks(id) on delete restrict,
  param_key text not null,
  expected numeric not null,
  measured numeric not null,
  tolerance numeric,
  divergent boolean not null,
  superseded boolean not null default false,
  worker_id uuid references public.shop_workers(id) on delete set null,
  at timestamptz not null default clock_timestamp(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create table if not exists public.shop_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.shop_tasks(id) on delete restrict,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  unit_number integer not null,
  step_code text not null,
  kind text not null check (kind in ('nao_conformidade', 'divergencia_medida', 'ocorrencia', 'retrabalho')),
  item_id uuid references public.shop_checklist_items(id) on delete set null,
  description text not null,
  photos text[] not null default '{}',
  status text not null default 'Aberta' check (status in ('Aberta', 'Resolvida')),
  decision text check (decision in ('aceito', 'retrabalho', 'cancelado')),
  resolution text,
  opened_by uuid references public.shop_workers(id) on delete set null,
  resolved_by text,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists shop_occurrences_open_idx on public.shop_occurrences (system_company_id, status);

create table if not exists public.shop_task_external (
  task_id uuid primary key references public.shop_tasks(id) on delete restrict,
  finish_type text not null check (finish_type in ('galvanizacao_a_fogo', 'eletrostatica', 'pintura', 'outro')),
  provider_name text not null,
  sent_at timestamptz not null default clock_timestamp(),
  expected_return date,
  returned_at timestamptz,
  cost numeric(14,2),
  notes text,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create table if not exists public.shop_unit_tokens (
  token text primary key,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  unit_number integer not null,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (production_order_id, unit_number)
);

-- Os registros de execução são histórico: eventos, consumos, conferências e trechos de tempo não se apagam.
create or replace function public.shop_history_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'O histórico do chão de fábrica não pode ser apagado.';
  end if;
  if tg_table_name = 'shop_task_events' then
    raise exception 'Eventos do chão de fábrica não podem ser alterados.';
  end if;
  if tg_table_name = 'shop_time_entries' and (old.task_id, old.worker_id, old.started_at) is distinct from (new.task_id, new.worker_id, new.started_at) then
    raise exception 'O início de um trecho de trabalho não pode ser alterado.';
  end if;
  if tg_table_name = 'shop_time_entries' and old.ended_at is not null then
    raise exception 'Um trecho de trabalho encerrado não pode ser alterado.';
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['shop_task_events', 'shop_time_entries', 'shop_task_consumptions', 'shop_task_checks', 'shop_task_measures'] loop
    execute format('drop trigger if exists trg_%I_immutable on public.%I', t, t);
    execute format('create trigger trg_%I_immutable before update or delete on public.%I for each row execute function public.shop_history_immutable()', t, t);
  end loop;
end;
$$;
-- conferências e medidas só mudam a marca "superseded" (refeitas depois de um retrabalho)
drop trigger if exists trg_shop_task_checks_immutable on public.shop_task_checks;
drop trigger if exists trg_shop_task_measures_immutable on public.shop_task_measures;
create or replace function public.shop_checks_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then raise exception 'O histórico do chão de fábrica não pode ser apagado.'; end if;
  if (to_jsonb(new) - 'superseded') is distinct from (to_jsonb(old) - 'superseded') then raise exception 'Conferências registradas não podem ser alteradas: refaça a conferência.'; end if;
  return new;
end;
$$;
create trigger trg_shop_task_checks_immutable before update or delete on public.shop_task_checks for each row execute function public.shop_checks_guard();
create trigger trg_shop_task_measures_immutable before update or delete on public.shop_task_measures for each row execute function public.shop_checks_guard();

create or replace function public.shop_event(p_task uuid, p_worker uuid, p_event text, p_detail jsonb default '{}'::jsonb, p_key text default null, p_actor text default null, p_device text default null, p_client_at timestamptz default null)
returns void
language plpgsql
as $$
begin
  insert into public.shop_task_events (task_id, worker_id, event, detail, request_key, actor, device, client_at, system_company_id)
  values (p_task, p_worker, p_event, coalesce(p_detail, '{}'::jsonb), p_key, p_actor, p_device, p_client_at, public.shop_cid());
end;
$$;

-- ================================================================ 4. Liberação: a documentação NÃO bloqueia a fabricação; vale na expedição
create or replace function public.production_eligibility(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_order public.sales_orders%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_needs_docs integer;
  v_total integer;
  v_approved integer;
  v_cancelled integer;
  v_waived boolean;
  v_auth boolean;
  v_docs_required boolean := public.sales_setting('documentation')::boolean;
  v_pay_required boolean := public.sales_requires_payment();
  v_auth_required boolean := public.sales_setting('authorization')::boolean;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id;
  if not found or v_order.system_company_id is distinct from public.request_system_company_id() then
    return jsonb_build_object('eligible', false, 'blockers', jsonb_build_array(jsonb_build_object('code', 'pedido', 'message', 'Pedido de venda não encontrado.', 'waivable', false)));
  end if;
  if v_order.status in ('Rascunho', 'Aguardando confirmacao') then
    v_blockers := v_blockers || jsonb_build_object('code', 'pedido', 'message', 'O pedido ainda não foi confirmado.', 'waivable', false);
  elsif v_order.status = 'Cancelado' then
    v_blockers := v_blockers || jsonb_build_object('code', 'pedido', 'message', 'O pedido está cancelado.', 'waivable', false);
  end if;
  select count(*) into v_needs_docs from public.sales_order_items i join public.materials m on m.id = i.material_id
  where i.sales_order_id = p_sales_order_id and i.line_type = 'Produto' and m.item_type = 'Produto' and m.requires_vehicle_documentation;
  select count(*), count(*) filter (where status = 'Aprovado para liberacao' and not config_review_required), count(*) filter (where status = 'Cancelado')
  into v_total, v_approved, v_cancelled from public.vehicle_documentation where sales_order_id = p_sales_order_id;
  if v_pay_required and v_order.payment_confirmed_at is null then
    select exists (select 1 from public.production_release_exceptions where sales_order_id = p_sales_order_id and component = 'pagamento' and revoked_at is null) into v_waived;
    if not v_waived then
      v_blockers := v_blockers || jsonb_build_object('code', 'pagamento', 'message', 'Aguardando a confirmação do sinal/pagamento.', 'waivable', public.sales_setting('payment_exception')::boolean);
    end if;
  end if;
  if v_auth_required then
    select exists (select 1 from public.production_authorizations where sales_order_id = p_sales_order_id and revoked_at is null) into v_auth;
    if not v_auth then
      v_blockers := v_blockers || jsonb_build_object('code', 'autorizacao', 'message', 'Falta a autorização operacional da produção.', 'waivable', false);
    end if;
  end if;
  -- a documentação segue em paralelo: informada, mas só exigida na expedição (ver expedition_eligibility)
  return jsonb_build_object('eligible', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers,
    'documentation', jsonb_build_object('required', v_docs_required and v_needs_docs > 0, 'units', v_total, 'approved', v_approved, 'cancelled', v_cancelled, 'items_requiring', v_needs_docs, 'blocks_production', false, 'blocks_expedition', v_docs_required and v_needs_docs > 0));
end;
$$;

create or replace function public.expedition_eligibility(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_info jsonb := public.production_eligibility(p_sales_order_id)->'documentation';
  v_blockers jsonb := '[]'::jsonb;
begin
  if coalesce((v_info->>'blocks_expedition')::boolean, false) then
    if coalesce((v_info->>'units')::integer, 0) = 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'documentacao', 'message', 'A documentação veicular das unidades ainda não foi iniciada.');
    elsif (v_info->>'approved')::integer + (v_info->>'cancelled')::integer < (v_info->>'units')::integer then
      v_blockers := v_blockers || jsonb_build_object('code', 'documentacao', 'message', 'Documentação veicular: ' || (v_info->>'approved') || ' de ' || (v_info->>'units') || ' unidade(s) liberada(s).');
    end if;
  end if;
  return jsonb_build_object('eligible', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers, 'documentation', v_info);
end;
$$;

-- A entrega (expedição) só passa com a documentação exigível em dia.
create or replace function public.sales_order_deliveries_expedition_guard()
returns trigger
language plpgsql
as $$
declare
  v_result jsonb := public.expedition_eligibility(new.sales_order_id);
begin
  if not (v_result->>'eligible')::boolean then
    raise exception 'Expedição bloqueada: %', (select string_agg(b->>'message', ' ') from jsonb_array_elements(v_result->'blockers') b);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sales_order_deliveries_expedition_guard on public.sales_order_deliveries;
create trigger trg_sales_order_deliveries_expedition_guard before insert on public.sales_order_deliveries for each row execute function public.sales_order_deliveries_expedition_guard();

-- ================================================================ 5. Geração e liberação das tarefas
create or replace function public.shop_unit_vin(p_order uuid, p_unit integer)
returns text
language sql
stable
as $$
  select d.vin from public.production_orders po join public.vehicle_documentation d on d.sales_order_item_id = po.sales_order_item_id and d.unit_number = p_unit and d.status <> 'Cancelado'
  where po.id = p_order limit 1
$$;

create or replace function public.shop_tasks_generate(p_order uuid, p_user text default null)
returns integer
language plpgsql
as $$
declare
  v_po public.production_orders%rowtype;
  v_units integer;
  v_unit integer;
  v_step public.shop_steps%rowtype;
  v_needs_plate boolean;
  v_count integer := 0;
  v_rows integer;
begin
  select * into v_po from public.production_orders where id = p_order;
  if not found or v_po.system_company_id is distinct from public.shop_cid() or v_po.status = 'Cancelada' then
    return 0;
  end if;
  if not exists (select 1 from public.shop_steps where system_company_id = v_po.system_company_id and active) then
    return 0;
  end if;
  v_units := greatest(ceil(v_po.quantity)::integer, 1);
  select coalesce(m.requires_vehicle_documentation, false) into v_needs_plate from public.materials m where m.id = v_po.product_id;
  for v_unit in 1..v_units loop
    insert into public.shop_unit_tokens (token, production_order_id, unit_number, system_company_id)
    values (encode(gen_random_bytes(16), 'hex'), p_order, v_unit, v_po.system_company_id) on conflict (production_order_id, unit_number) do nothing;
    for v_step in select * from public.shop_steps where system_company_id = v_po.system_company_id and active and (kind <> 'administrativa' or v_needs_plate) order by seq loop
      insert into public.shop_tasks (production_order_id, unit_number, step_id, step_code, step_name, seq, kind, planned_end, system_company_id)
      values (p_order, v_unit, v_step.id, v_step.code, v_step.name, v_step.seq, v_step.kind, v_po.planned_end, v_po.system_company_id) on conflict (production_order_id, unit_number, step_id) do nothing;
      get diagnostics v_rows = row_count;
      v_count := v_count + v_rows;
    end loop;
  end loop;
  perform public.shop_task_refresh(p_order);
  return v_count;
end;
$$;

create or replace function public.production_orders_shop_tasks()
returns trigger
language plpgsql
as $$
begin
  perform public.shop_tasks_generate(new.id);
  return null;
end;
$$;
drop trigger if exists trg_production_orders_shop_tasks on public.production_orders;
create trigger trg_production_orders_shop_tasks after insert on public.production_orders for each row execute function public.production_orders_shop_tasks();

-- Recalcula Aguardando / Pronta / Bloqueada pelas dependências, pela liberação financeira e pelo chassi. Idempotente; chamada antes de listar e de iniciar.
create or replace function public.shop_task_refresh(p_order uuid)
returns void
language plpgsql
as $$
declare
  v_po public.production_orders%rowtype;
  v_release jsonb;
  v_release_text text := null;
  v_set public.shop_settings := public.shop_settings_row();
  v_needs_vin boolean;
  v_task record;
  v_deps_ok boolean;
  v_new text;
  v_reason text;
begin
  select * into v_po from public.production_orders where id = p_order;
  if not found then return; end if;
  if v_po.sales_order_id is not null then
    v_release := public.production_eligibility(v_po.sales_order_id);
    if not (v_release->>'eligible')::boolean then
      v_release_text := (select string_agg(b->>'message', ' ') from jsonb_array_elements(v_release->'blockers') b);
    end if;
  end if;
  select coalesce(m.requires_vehicle_documentation, false) into v_needs_vin from public.materials m where m.id = v_po.product_id;
  for v_task in select t.*, s.depends_on from public.shop_tasks t join public.shop_steps s on s.id = t.step_id
                where t.production_order_id = p_order and t.status in ('Aguardando', 'Pronta', 'Bloqueada') and (t.blocked_reason is null or t.blocked_reason not like 'Manual:%') order by t.unit_number, t.seq loop
    v_reason := null;
    if v_po.status in ('Cancelada') then
      v_new := 'Cancelada';
    else
      select not exists (select 1 from unnest(v_task.depends_on) d where not exists (
               select 1 from public.shop_tasks x where x.production_order_id = p_order and x.unit_number = v_task.unit_number and x.step_code = d and x.status in ('Concluida', 'Cancelada'))) into v_deps_ok;
      if v_release_text is not null then
        v_new := 'Bloqueada'; v_reason := 'Produção não liberada: ' || v_release_text;
      elsif v_set.require_vin_before_tasks and v_needs_vin and coalesce(btrim(public.shop_unit_vin(p_order, v_task.unit_number)), '') = '' then
        v_new := 'Bloqueada'; v_reason := 'Aguardando a reserva/informação do número de chassi da unidade ' || v_task.unit_number || '.';
      elsif v_deps_ok then
        v_new := 'Pronta';
      else
        v_new := 'Aguardando';
      end if;
    end if;
    if v_new is distinct from v_task.status or v_reason is distinct from v_task.blocked_reason then
      update public.shop_tasks set status = v_new, blocked_reason = v_reason, updated_at = now() where id = v_task.id;
    end if;
  end loop;
end;
$$;

create or replace function public.shop_worker_can(p_worker public.shop_workers, p_task public.shop_tasks)
returns boolean
language sql
stable
as $$
  select coalesce(p_worker.active and (
    p_worker.is_supervisor
    or coalesce(p_task.assigned_worker_id = p_worker.id, false)
    or (p_task.assigned_worker_id is null and exists (select 1 from public.shop_steps s where s.id = p_task.step_id and s.sector is not null and s.sector = any (p_worker.sectors)))
  ), false)
$$;

-- ================================================================ 6. Materiais da tarefa (composição CONGELADA da ordem) e desenho da configuração vendida
create or replace function public.shop_task_materials(p_task uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_t public.shop_tasks%rowtype;
  v_s public.shop_steps%rowtype;
begin
  select * into v_t from public.shop_tasks where id = p_task;
  select * into v_s from public.shop_steps where id = v_t.step_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('material_id', m.id, 'sku', m.internal_code, 'name', m.name, 'description', m.description, 'unit', pom.unit, 'kit', km.name, 'kit_sku', km.internal_code,
      'kit_version', (select kv.version from public.production_order_kits k join public.kit_versions kv on kv.id = k.kit_version_id where k.production_order_id = v_t.production_order_id and k.kit_id = pom.kit_id limit 1),
      'planned', round(pom.required_quantity / greatest(po.quantity, 1), 4), 'planned_order', pom.required_quantity, 'reserved', pom.reserved_quantity, 'consumed', pom.consumed_quantity,
      'consumed_by_task', coalesce((select sum(c.quantity) from public.shop_task_consumptions c where c.task_id = p_task and c.material_id = pom.material_id), 0),
      'available', coalesce((select available from public.material_availability(pom.material_id)), 0)) order by km.name, m.name)
    from public.production_order_materials pom join public.materials m on m.id = pom.material_id join public.materials km on km.id = pom.kit_id join public.production_orders po on po.id = pom.production_order_id
    where pom.production_order_id = v_t.production_order_id
      and (exists (select 1 from public.shop_step_kits sk where sk.step_id = v_s.id and sk.kit_id = pom.kit_id)
           or (v_s.kit_match is not null and v_s.kit_match <> '*' and coalesce(km.category, '') ilike '%' || v_s.kit_match || '%')
           or (v_s.kit_match = '*' and not exists (select 1 from public.shop_steps o where o.system_company_id = v_s.system_company_id and o.id <> v_s.id and o.active and
                (exists (select 1 from public.shop_step_kits sk2 where sk2.step_id = o.id and sk2.kit_id = pom.kit_id) or (o.kit_match is not null and o.kit_match <> '*' and coalesce(km.category, '') ilike '%' || o.kit_match || '%')))))
  ), '[]'::jsonb);
end;
$$;

-- Planta da carreta: a configuração vendida congelada (medidas e desenho), sem recalcular nada no tablet.
create or replace function public.shop_task_drawing(p_task uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_t public.shop_tasks%rowtype;
  v_po public.production_orders%rowtype;
  v_cfg jsonb := null;
begin
  select * into v_t from public.shop_tasks where id = p_task;
  select * into v_po from public.production_orders where id = v_t.production_order_id;
  if to_regclass('public.product_configurations') is not null and (to_jsonb(v_po) ? 'configuration_id') and (to_jsonb(v_po)->>'configuration_id') is not null then
    execute 'select jsonb_build_object(''id'', c.id, ''summary'', c.summary, ''params'', c.params, ''options'', c.options, ''homologated'', c.homologated, ''revision'', c.revision_label, ''status'', c.status, ''drawing_spec'', c.drawing_spec, ''frozen_at'', c.frozen_at) from public.product_configurations c where c.id = $1'
      into v_cfg using ((to_jsonb(v_po)->>'configuration_id')::uuid);
  end if;
  return jsonb_build_object('product', (select jsonb_build_object('name', m.name, 'model', m.product_model, 'sku', m.internal_code) from public.materials m where m.id = v_po.product_id), 'configuration', v_cfg,
    'bom_notes', (select notes from public.product_bom_versions where id = v_po.bom_version_id));
end;
$$;

-- ================================================================ 7. Tempo: cronológico, por colaborador, pausas e externo (sem dupla contagem)
create or replace function public.shop_task_metrics(p_task uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_t public.shop_tasks%rowtype;
  v_now timestamptz := clock_timestamp();
  v_elapsed numeric := 0;
  v_labor numeric := 0;
  v_span numeric := 0;
  v_workers jsonb;
  v_first timestamptz;
  v_last timestamptz;
  v_ext public.shop_task_external%rowtype;
  v_planned numeric;
begin
  select * into v_t from public.shop_tasks where id = p_task;
  select coalesce(sum(extract(epoch from (upper(r) - lower(r))) / 60), 0) into v_elapsed
    from (select unnest(range_agg(tstzrange(started_at, coalesce(ended_at, v_now)))) r from public.shop_time_entries where task_id = p_task) x;
  select coalesce(sum(extract(epoch from (coalesce(ended_at, v_now) - started_at)) / 60), 0), min(started_at), max(coalesce(ended_at, v_now)) into v_labor, v_first, v_last from public.shop_time_entries where task_id = p_task;
  v_span := case when v_first is null then 0 else extract(epoch from (coalesce(v_t.finished_at, v_last) - v_first)) / 60 end;
  select coalesce(jsonb_agg(jsonb_build_object('worker_id', w.id, 'name', w.name, 'minutes', round(x.m, 2)) order by w.name), '[]'::jsonb) into v_workers
    from (select worker_id, sum(extract(epoch from (coalesce(ended_at, v_now) - started_at)) / 60) m from public.shop_time_entries where task_id = p_task group by worker_id) x join public.shop_workers w on w.id = x.worker_id;
  select * into v_ext from public.shop_task_external where task_id = p_task;
  select s.standard_minutes into v_planned from public.shop_steps s where s.id = v_t.step_id;
  return jsonb_build_object('elapsed_productive_minutes', round(v_elapsed, 2), 'labor_minutes', round(v_labor, 2), 'span_minutes', round(greatest(v_span, 0), 2),
    'pause_minutes', round(greatest(v_span - v_elapsed, 0), 2), 'workers', v_workers, 'planned_minutes', v_planned,
    'external_days', case when v_ext.task_id is null then null else round(extract(epoch from (coalesce(v_ext.returned_at, v_now) - v_ext.sent_at)) / 86400, 2) end);
end;
$$;

-- ================================================================ 8. Ações do colaborador no tablet (todas idempotentes por request_key e com horário do servidor)
create or replace function public.shop_load_task(p_token text, p_task uuid, p_lock boolean default true)
returns public.shop_tasks
language plpgsql
as $$
declare
  v_t public.shop_tasks%rowtype;
begin
  if p_lock then
    select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid() for update;
  else
    select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid();
  end if;
  if not found then
    raise exception 'Tarefa não encontrada.';
  end if;
  return v_t;
end;
$$;

create or replace function public.shop_task_start(p_token text, p_task uuid, p_key text default null, p_device text default null, p_client_at timestamptz default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_step public.shop_steps%rowtype;
  v_po public.production_orders%rowtype;
  v_open record;
  v_now timestamptz := clock_timestamp();
begin
  if p_key is not null and exists (select 1 from public.shop_task_events where task_id = p_task and request_key = p_key) then
    return jsonb_build_object('duplicate', true, 'status', v_t.status);
  end if;
  if not public.shop_worker_can(v_w, v_t) then
    raise exception 'Você não está autorizado a apontar esta tarefa.';
  end if;
  perform public.shop_task_refresh(v_t.production_order_id);
  select * into v_t from public.shop_tasks where id = p_task;
  select * into v_step from public.shop_steps where id = v_t.step_id;
  select * into v_po from public.production_orders where id = v_t.production_order_id;
  if v_step.kind = 'terceirizada' then
    raise exception 'Esta etapa é terceirizada: registre o envio e o retorno do prestador.';
  end if;
  if v_t.status = 'Bloqueada' then
    raise exception 'Tarefa bloqueada: %', coalesce(v_t.blocked_reason, 'aguarde a liberação.');
  end if;
  if v_t.status in ('Concluida', 'Cancelada', 'Com pendencia') then
    raise exception 'A tarefa está % e não pode ser iniciada.', lower(replace(v_t.status, 'Com pendencia', 'com pendência'));
  end if;
  if v_t.status = 'Aguardando' then
    raise exception 'A etapa anterior ainda não foi concluída.';
  end if;
  if v_t.status = 'Em execucao' and not v_step.allow_multiple then
    raise exception 'Esta tarefa já está em execução por outro colaborador.';
  end if;
  if v_po.status in ('Cancelada', 'Concluida', 'Pausada') then
    raise exception 'A ordem % está %.', v_po.code, lower(v_po.status);
  end if;
  select t.step_name, t.unit_number, po.code into v_open from public.shop_time_entries e join public.shop_tasks t on t.id = e.task_id join public.production_orders po on po.id = t.production_order_id where e.worker_id = v_w.id and e.ended_at is null;
  if found then
    raise exception 'Você já está executando "%" (unidade %, ordem %). Pause ou finalize antes de iniciar outra.', v_open.step_name, v_open.unit_number, v_open.code;
  end if;
  if v_step.kind <> 'administrativa' and v_po.status = 'Pronta para producao' then
    perform public.production_change_status(v_po.id, 'start', v_w.name);
  elsif v_step.kind <> 'administrativa' and v_po.status in ('Aguardando planejamento', 'Aguardando materiais') then
    raise exception 'A ordem % está "%": reserve os materiais antes de fabricar.', v_po.code, v_po.status;
  end if;
  insert into public.shop_time_entries (task_id, worker_id, started_at, system_company_id) values (p_task, v_w.id, v_now, v_t.system_company_id);
  update public.shop_tasks set status = 'Em execucao', started_at = coalesce(started_at, v_now), updated_at = now() where id = p_task;
  perform public.shop_event(p_task, v_w.id, 'Iniciada', jsonb_build_object('at', v_now), p_key, v_w.name, p_device, p_client_at);
  return jsonb_build_object('duplicate', false, 'status', 'Em execucao', 'started_at', v_now);
end;
$$;

create or replace function public.shop_task_pause(p_token text, p_task uuid, p_reason text, p_note text default null, p_key text default null, p_device text default null, p_client_at timestamptz default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_now timestamptz := clock_timestamp();
  v_entry public.shop_time_entries%rowtype;
begin
  if p_key is not null and exists (select 1 from public.shop_task_events where task_id = p_task and request_key = p_key) then
    return jsonb_build_object('duplicate', true, 'status', v_t.status);
  end if;
  if p_reason not in ('Intervalo', 'Falta de material', 'Aguardando equipamento', 'Aguardando orientação', 'Problema técnico', 'Outro motivo') then
    raise exception 'Escolha o motivo da pausa.';
  end if;
  if p_reason = 'Outro motivo' and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Descreva o motivo da pausa.';
  end if;
  select * into v_entry from public.shop_time_entries where task_id = p_task and worker_id = v_w.id and ended_at is null;
  if not found then
    raise exception 'Você não está executando esta tarefa.';
  end if;
  update public.shop_time_entries set ended_at = v_now, end_reason = 'pausa', pause_reason = case when p_note is null then p_reason else p_reason || ': ' || p_note end where id = v_entry.id;
  update public.shop_tasks set status = case when exists (select 1 from public.shop_time_entries where task_id = p_task and ended_at is null) then 'Em execucao' else 'Pausada' end, updated_at = now() where id = p_task;
  perform public.shop_event(p_task, v_w.id, 'Pausada', jsonb_build_object('reason', p_reason, 'note', p_note), p_key, v_w.name, p_device, p_client_at);
  return jsonb_build_object('duplicate', false, 'status', (select status from public.shop_tasks where id = p_task), 'paused_at', v_now);
end;
$$;

-- Resultado atual (não substituído) de cada item do checklist da tarefa.
create or replace function public.shop_task_check_state(p_task uuid)
returns table (item_id uuid, label text, mandatory boolean, allow_na boolean, result text, note text, pos integer)
language sql
stable
as $$
  select i.id, i.label, i.mandatory, i.allow_na,
         (select c.result from public.shop_task_checks c where c.task_id = p_task and c.item_id = i.id and not c.superseded order by c.at desc limit 1),
         (select c.note from public.shop_task_checks c where c.task_id = p_task and c.item_id = i.id and not c.superseded order by c.at desc limit 1), i.position
  from public.shop_tasks t join public.shop_checklist_items i on i.step_id = t.step_id and i.active where t.id = p_task order by i.position
$$;

create or replace function public.shop_task_finish(p_token text, p_task uuid, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_step public.shop_steps%rowtype;
  v_key text := nullif(p->>'request_key', '');
  v_now timestamptz := clock_timestamp();
  v_qty numeric := coalesce(nullif(p->>'quantity_done', '')::numeric, 1);
  v_photos text[];
  v_missing text;
  v_bad integer;
  v_unmeasured text;
  v_div integer;
  v_status text := 'Concluida';
  v_reason text;
begin
  if v_key is not null and exists (select 1 from public.shop_task_events where task_id = p_task and request_key = v_key) then
    return jsonb_build_object('duplicate', true, 'status', v_t.status);
  end if;
  if v_t.status = 'Concluida' then
    raise exception 'Esta tarefa já foi concluída.';
  end if;
  if v_t.status in ('Cancelada', 'Bloqueada', 'Aguardando') then
    raise exception 'A tarefa está % e não pode ser finalizada.', lower(v_t.status);
  end if;
  select * into v_step from public.shop_steps where id = v_t.step_id;
  if v_step.kind = 'terceirizada' then
    raise exception 'Etapa terceirizada: registre o retorno do prestador.';
  end if;
  if not exists (select 1 from public.shop_time_entries where task_id = p_task and worker_id = v_w.id and ended_at is null) and not v_w.is_supervisor then
    raise exception 'Só quem está executando a tarefa (ou o supervisor) pode finalizá-la.';
  end if;
  if v_qty <= 0 then
    raise exception 'A quantidade executada deve ser maior que zero.';
  end if;
  select coalesce(array_agg(x), '{}') into v_photos from jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb)) x;
  if v_step.requires_checklist then
    if not exists (select 1 from public.shop_checklist_items where step_id = v_step.id and active) then
      raise exception 'O checklist desta etapa ainda não foi configurado pelo gestor.';
    end if;
    select string_agg(label, '; ') into v_missing from public.shop_task_check_state(p_task) where mandatory and result is null;
    if v_missing is not null then
      raise exception 'Faltam itens obrigatórios do checklist: %.', v_missing;
    end if;
    select count(*) into v_bad from public.shop_task_check_state(p_task) where mandatory and result = 'nao_conforme';
    if v_bad > 0 then
      v_status := 'Com pendencia'; v_reason := v_bad || ' item(ns) obrigatório(s) não conforme(s): aguardando decisão do gestor/inspetor.';
    end if;
  end if;
  if v_step.requires_measures then
    select string_agg(k, ', ') into v_unmeasured from (select e.key k from jsonb_each(coalesce((select params from public.product_configurations pc where pc.id = (select (to_jsonb(po)->>'configuration_id')::uuid from public.production_orders po where po.id = v_t.production_order_id)), '{}'::jsonb)) e
      where e.key in ('comprimento', 'largura', 'altura') and not exists (select 1 from public.shop_task_measures m where m.task_id = p_task and m.param_key = e.key and not m.superseded)) q;
    if v_unmeasured is not null then
      raise exception 'Registre as medidas conferidas: %.', v_unmeasured;
    end if;
    select count(*) into v_div from public.shop_task_measures where task_id = p_task and not superseded and divergent;
    if v_div > 0 then
      v_status := 'Com pendencia'; v_reason := coalesce(v_reason || ' ', '') || v_div || ' medida(s) divergente(s): encaminhado para análise.';
    end if;
  end if;
  if exists (select 1 from public.shop_occurrences where task_id = p_task and status = 'Aberta' and kind in ('nao_conformidade', 'divergencia_medida')) then
    v_status := 'Com pendencia'; v_reason := coalesce(v_reason, 'Há ocorrência em aberto nesta tarefa.');
  end if;
  update public.shop_time_entries set ended_at = v_now, end_reason = 'fim' where task_id = p_task and ended_at is null;
  update public.shop_tasks set status = v_status, pending_reason = v_reason, quantity_done = v_qty, notes = coalesce(nullif(btrim(p->>'notes'), ''), notes), photos = photos || v_photos,
         finished_at = case when v_status = 'Concluida' then v_now end, finished_by = case when v_status = 'Concluida' then v_w.id end, updated_at = now() where id = p_task;
  perform public.shop_event(p_task, v_w.id, case when v_status = 'Concluida' then 'Concluída' else 'Concluída com pendência' end, jsonb_build_object('quantity_done', v_qty, 'notes', p->>'notes', 'photos', v_photos, 'pending', v_reason), v_key, v_w.name, p->>'device', nullif(p->>'client_at', '')::timestamptz);
  if nullif(btrim(p->>'occurrence'), '') is not null then
    insert into public.shop_occurrences (task_id, production_order_id, unit_number, step_code, kind, description, photos, opened_by, system_company_id)
    values (p_task, v_t.production_order_id, v_t.unit_number, v_t.step_code, 'ocorrencia', btrim(p->>'occurrence'), v_photos, v_w.id, v_t.system_company_id);
  end if;
  perform public.shop_task_refresh(v_t.production_order_id);
  return jsonb_build_object('duplicate', false, 'status', v_status, 'pending_reason', v_reason, 'finished_at', v_now);
end;
$$;

-- Consumo de material da tarefa: operação própria (nunca implícita em "finalizar"), idempotente, só com materiais da composição congelada da ordem.
create or replace function public.shop_task_consume(p_token text, p_task uuid, p_material uuid, p_quantity numeric, p_key text, p_kind text default 'Consumo', p_notes text default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_res jsonb;
  v_cons uuid;
begin
  if coalesce(btrim(p_key), '') = '' then
    raise exception 'Chave de idempotência obrigatória no apontamento de consumo.';
  end if;
  if exists (select 1 from public.shop_task_events where task_id = p_task and request_key = 'consumo-' || p_key) then
    return jsonb_build_object('duplicate', true);
  end if;
  if not public.shop_worker_can(v_w, v_t) then
    raise exception 'Você não está autorizado a apontar esta tarefa.';
  end if;
  if v_t.status not in ('Em execucao', 'Pausada') then
    raise exception 'Só se aponta consumo em tarefa em execução ou pausada (situação atual: %).', lower(v_t.status);
  end if;
  if p_kind not in ('Consumo', 'Perda', 'Retrabalho') then
    raise exception 'Tipo de consumo inválido.';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.shop_task_materials(p_task)) m where (m->>'material_id')::uuid = p_material) then
    raise exception 'Este material não faz parte da composição desta tarefa.';
  end if;
  v_res := public.record_production_consumption(jsonb_build_object('production_order_id', v_t.production_order_id, 'material_id', p_material, 'quantity', p_quantity, 'kind', p_kind,
            'request_key', 'shop-' || p_task::text || '-' || p_key, 'responsible', v_w.name, 'notes', coalesce(p_notes, 'Tarefa ' || v_t.step_name || ' (unidade ' || v_t.unit_number || ')')));
  select id into v_cons from public.production_consumptions where production_order_id = v_t.production_order_id and request_key = 'shop-' || p_task::text || '-' || p_key;
  insert into public.shop_task_consumptions (task_id, worker_id, material_id, quantity, kind, production_consumption_id, system_company_id) values (p_task, v_w.id, p_material, p_quantity, p_kind, v_cons, v_t.system_company_id);
  perform public.shop_event(p_task, v_w.id, 'Consumo', jsonb_build_object('material_id', p_material, 'quantity', p_quantity, 'kind', p_kind), 'consumo-' || p_key, v_w.name);
  return jsonb_build_object('duplicate', false, 'stock', v_res);
end;
$$;

create or replace function public.shop_task_check(p_token text, p_task uuid, p_item uuid, p_result text, p_note text default null, p_photos text[] default '{}', p_key text default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_item public.shop_checklist_items%rowtype;
  v_occ uuid;
begin
  if p_key is not null and exists (select 1 from public.shop_task_events where task_id = p_task and request_key = p_key) then
    return jsonb_build_object('duplicate', true);
  end if;
  if not public.shop_worker_can(v_w, v_t) then
    raise exception 'Você não está autorizado a apontar esta tarefa.';
  end if;
  if v_t.status not in ('Em execucao', 'Pausada', 'Pronta') then
    raise exception 'A conferência só se registra com a tarefa aberta (situação atual: %).', lower(v_t.status);
  end if;
  select * into v_item from public.shop_checklist_items where id = p_item and step_id = v_t.step_id and active;
  if not found then
    raise exception 'Item de checklist não encontrado nesta etapa.';
  end if;
  if p_result not in ('conforme', 'nao_conforme', 'na') then
    raise exception 'Resultado inválido.';
  end if;
  if p_result = 'na' and not v_item.allow_na then
    raise exception 'Este item não admite "não se aplica".';
  end if;
  if p_result = 'nao_conforme' and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Descreva a não conformidade.';
  end if;
  update public.shop_task_checks set superseded = true where task_id = p_task and item_id = p_item and not superseded;
  insert into public.shop_task_checks (task_id, item_id, result, note, photos, worker_id, system_company_id) values (p_task, p_item, p_result, p_note, coalesce(p_photos, '{}'), v_w.id, v_t.system_company_id);
  if p_result = 'nao_conforme' then
    insert into public.shop_occurrences (task_id, production_order_id, unit_number, step_code, kind, item_id, description, photos, opened_by, system_company_id)
    values (p_task, v_t.production_order_id, v_t.unit_number, v_t.step_code, 'nao_conformidade', p_item, v_item.label || ': ' || p_note, coalesce(p_photos, '{}'), v_w.id, v_t.system_company_id) returning id into v_occ;
  else
    update public.shop_occurrences set status = 'Resolvida', decision = 'aceito', resolution = 'Item refeito e conforme.', resolved_by = v_w.name, resolved_at = clock_timestamp() where task_id = p_task and item_id = p_item and status = 'Aberta';
  end if;
  perform public.shop_event(p_task, v_w.id, 'Checklist', jsonb_build_object('item', v_item.label, 'result', p_result, 'note', p_note), p_key, v_w.name);
  return jsonb_build_object('duplicate', false, 'occurrence_id', v_occ);
end;
$$;

-- Medidas conferidas na etapa de inspeção dimensional: comparadas com a configuração VENDIDA (congelada), nunca com o cadastro atual.
create or replace function public.shop_task_measure(p_token text, p_task uuid, p_measures jsonb, p_key text default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_step public.shop_steps%rowtype;
  v_params jsonb := '{}'::jsonb;
  v_m jsonb;
  v_expected numeric;
  v_measured numeric;
  v_div boolean;
  v_divergent integer := 0;
begin
  if p_key is not null and exists (select 1 from public.shop_task_events where task_id = p_task and request_key = p_key) then
    return jsonb_build_object('duplicate', true);
  end if;
  if not public.shop_worker_can(v_w, v_t) then
    raise exception 'Você não está autorizado a apontar esta tarefa.';
  end if;
  if v_t.status not in ('Em execucao', 'Pausada') then
    raise exception 'Inicie a tarefa antes de registrar as medidas.';
  end if;
  select * into v_step from public.shop_steps where id = v_t.step_id;
  if not v_step.requires_measures then
    raise exception 'Esta etapa não confere medidas.';
  end if;
  if to_regclass('public.product_configurations') is not null then
    execute 'select pc.params from public.product_configurations pc where pc.id = (select (to_jsonb(po)->>''configuration_id'')::uuid from public.production_orders po where po.id = $1)' into v_params using v_t.production_order_id;
  end if;
  if v_params is null or v_params = '{}'::jsonb then
    raise exception 'A ordem não tem configuração dimensional congelada para conferir.';
  end if;
  update public.shop_task_measures set superseded = true where task_id = p_task and not superseded;
  for v_m in select * from jsonb_array_elements(p_measures) loop
    if not (v_params ? (v_m->>'param')) then
      raise exception 'A medida "%" não existe na configuração vendida.', v_m->>'param';
    end if;
    v_expected := (v_params->>(v_m->>'param'))::numeric;
    v_measured := (v_m->>'measured')::numeric;
    v_div := abs(v_measured - v_expected) > coalesce(v_step.tolerance_mm, 0);
    insert into public.shop_task_measures (task_id, param_key, expected, measured, tolerance, divergent, worker_id, system_company_id) values (p_task, v_m->>'param', v_expected, v_measured, v_step.tolerance_mm, v_div, v_w.id, v_t.system_company_id);
    if v_div then
      v_divergent := v_divergent + 1;
      insert into public.shop_occurrences (task_id, production_order_id, unit_number, step_code, kind, description, opened_by, system_company_id)
      values (v_t.id, v_t.production_order_id, v_t.unit_number, v_t.step_code, 'divergencia_medida', 'Medida "' || (v_m->>'param') || '": vendido ' || v_expected || ' mm, conferido ' || v_measured || ' mm.', v_w.id, v_t.system_company_id);
    end if;
  end loop;
  perform public.shop_event(p_task, v_w.id, 'Medidas', jsonb_build_object('measures', p_measures, 'divergent', v_divergent), p_key, v_w.name);
  return jsonb_build_object('duplicate', false, 'divergent', v_divergent);
end;
$$;

create or replace function public.shop_occurrence_open(p_token text, p_task uuid, p_kind text, p_description text, p_photos text[] default '{}')
returns uuid
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task, false);
  v_id uuid := gen_random_uuid();
begin
  if p_kind not in ('ocorrencia', 'nao_conformidade', 'retrabalho') then
    raise exception 'Tipo de ocorrência inválido.';
  end if;
  if length(btrim(coalesce(p_description, ''))) < 3 then
    raise exception 'Descreva a ocorrência.';
  end if;
  insert into public.shop_occurrences (id, task_id, production_order_id, unit_number, step_code, kind, description, photos, opened_by, system_company_id)
  values (v_id, p_task, v_t.production_order_id, v_t.unit_number, v_t.step_code, p_kind, btrim(p_description), coalesce(p_photos, '{}'), v_w.id, v_t.system_company_id);
  perform public.shop_event(p_task, v_w.id, 'Ocorrência', jsonb_build_object('kind', p_kind, 'description', p_description), null, v_w.name);
  return v_id;
end;
$$;

-- ================================================================ 9. Gestão: decisão sobre pendências, reatribuição, bloqueio, cancelamento e etapa terceirizada
create or replace function public.shop_occurrence_resolve(p_occurrence uuid, p_decision text, p_note text, p_actor text)
returns jsonb
language plpgsql
as $$
declare
  v_o public.shop_occurrences%rowtype;
  v_t public.shop_tasks%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_decision not in ('aceito', 'retrabalho', 'cancelado') then
    raise exception 'Decisão inválida.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 or coalesce(btrim(p_actor), '') = '' then
    raise exception 'Informe quem decide e a justificativa.';
  end if;
  select * into v_o from public.shop_occurrences where id = p_occurrence and system_company_id = public.shop_cid() for update;
  if not found or v_o.status <> 'Aberta' then
    raise exception 'Ocorrência não encontrada ou já resolvida.';
  end if;
  select * into v_t from public.shop_tasks where id = v_o.task_id for update;
  update public.shop_occurrences set status = 'Resolvida', decision = p_decision, resolution = p_note, resolved_by = p_actor, resolved_at = v_now where id = p_occurrence;
  if p_decision = 'retrabalho' and v_t.status in ('Com pendencia', 'Concluida') then
    update public.shop_task_checks set superseded = true where task_id = v_t.id and result = 'nao_conforme';
    update public.shop_task_measures set superseded = true where task_id = v_t.id and divergent;
    update public.shop_tasks set status = 'Pronta', pending_reason = null, finished_at = null, finished_by = null, rework_count = rework_count + 1, updated_at = now() where id = v_t.id;
    update public.shop_occurrences set status = 'Resolvida', decision = 'retrabalho', resolution = 'Tarefa reaberta para retrabalho.', resolved_by = p_actor, resolved_at = v_now where task_id = v_t.id and status = 'Aberta' and id <> p_occurrence;
  elsif v_t.status = 'Com pendencia' and not exists (select 1 from public.shop_occurrences where task_id = v_t.id and status = 'Aberta' and kind in ('nao_conformidade', 'divergencia_medida')) then
    update public.shop_tasks set status = 'Concluida', pending_reason = null, finished_at = v_now, updated_at = now() where id = v_t.id;
  end if;
  perform public.shop_event(v_t.id, null, 'Ocorrência resolvida', jsonb_build_object('decision', p_decision, 'note', p_note), null, p_actor);
  perform public.shop_task_refresh(v_t.production_order_id);
  return jsonb_build_object('task_status', (select status from public.shop_tasks where id = v_t.id));
end;
$$;

create or replace function public.shop_task_reassign(p_task uuid, p_worker uuid, p_reason text, p_actor text)
returns void
language plpgsql
as $$
declare
  v_t public.shop_tasks%rowtype;
  v_w public.shop_workers%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 or coalesce(btrim(p_actor), '') = '' then
    raise exception 'Informe quem reatribui e a justificativa.';
  end if;
  select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid() for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if v_t.status in ('Concluida', 'Cancelada') then
    raise exception 'A tarefa está % e não pode ser reatribuída.', lower(v_t.status);
  end if;
  if p_worker is not null then
    select * into v_w from public.shop_workers where id = p_worker and system_company_id = public.shop_cid() and active;
    if not found then raise exception 'Colaborador não encontrado ou inativo.'; end if;
  end if;
  update public.shop_time_entries set ended_at = v_now, end_reason = 'reatribuicao' where task_id = p_task and ended_at is null and worker_id is distinct from p_worker;
  update public.shop_tasks set assigned_worker_id = p_worker, status = case when status = 'Em execucao' and not exists (select 1 from public.shop_time_entries where task_id = p_task and ended_at is null) then 'Pausada' else status end, updated_at = now() where id = p_task;
  perform public.shop_event(p_task, p_worker, 'Reatribuída', jsonb_build_object('to', p_worker, 'reason', p_reason, 'previous', v_t.assigned_worker_id), null, p_actor);
end;
$$;

create or replace function public.shop_task_set_block(p_task uuid, p_blocked boolean, p_reason text, p_actor text)
returns void
language plpgsql
as $$
declare
  v_t public.shop_tasks%rowtype;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid() for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if p_blocked then
    if v_t.status in ('Concluida', 'Cancelada') then raise exception 'A tarefa está %.', lower(v_t.status); end if;
    update public.shop_time_entries set ended_at = clock_timestamp(), end_reason = 'pausa', pause_reason = 'Bloqueio do gestor' where task_id = p_task and ended_at is null;
    update public.shop_tasks set status = 'Bloqueada', blocked_reason = 'Manual: ' || p_reason, updated_at = now() where id = p_task;
  else
    update public.shop_tasks set status = 'Aguardando', blocked_reason = null, updated_at = now() where id = p_task and status = 'Bloqueada';
    perform public.shop_task_refresh(v_t.production_order_id);
  end if;
  perform public.shop_event(p_task, null, case when p_blocked then 'Bloqueada' else 'Desbloqueada' end, jsonb_build_object('reason', p_reason), null, p_actor);
end;
$$;

create or replace function public.shop_task_cancel(p_task uuid, p_reason text, p_actor text)
returns void
language plpgsql
as $$
declare
  v_t public.shop_tasks%rowtype;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 or coalesce(btrim(p_actor), '') = '' then raise exception 'Informe quem cancela e o motivo.'; end if;
  select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid() for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if v_t.status in ('Concluida', 'Cancelada') then raise exception 'A tarefa já está %.', lower(v_t.status); end if;
  update public.shop_time_entries set ended_at = clock_timestamp(), end_reason = 'cancelamento' where task_id = p_task and ended_at is null;
  update public.shop_tasks set status = 'Cancelada', pending_reason = p_reason, updated_at = now() where id = p_task;
  perform public.shop_event(p_task, null, 'Cancelada', jsonb_build_object('reason', p_reason), null, p_actor);
  perform public.shop_task_refresh(v_t.production_order_id);
end;
$$;

create or replace function public.shop_external_send(p_task uuid, p jsonb, p_actor text)
returns void
language plpgsql
as $$
declare
  v_t public.shop_tasks%rowtype;
begin
  select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid() for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if v_t.kind <> 'terceirizada' then raise exception 'Esta etapa não é terceirizada.'; end if;
  perform public.shop_task_refresh(v_t.production_order_id);
  select * into v_t from public.shop_tasks where id = p_task;
  if v_t.status <> 'Pronta' then raise exception 'A etapa está "%": só se envia ao prestador quando a etapa anterior estiver concluída.', v_t.status; end if;
  if coalesce(btrim(p->>'provider_name'), '') = '' then raise exception 'Informe o prestador.'; end if;
  insert into public.shop_task_external (task_id, finish_type, provider_name, expected_return, notes, system_company_id)
  values (p_task, coalesce(nullif(p->>'finish_type', ''), 'outro'), btrim(p->>'provider_name'), nullif(p->>'expected_return', '')::date, nullif(btrim(p->>'notes'), ''), v_t.system_company_id);
  update public.shop_tasks set status = 'Em execucao', started_at = clock_timestamp(), updated_at = now() where id = p_task;
  perform public.shop_event(p_task, null, 'Enviada ao prestador', p, null, p_actor);
end;
$$;

create or replace function public.shop_external_return(p_task uuid, p_cost numeric, p_notes text, p_actor text)
returns void
language plpgsql
as $$
declare
  v_t public.shop_tasks%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid() for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if not exists (select 1 from public.shop_task_external where task_id = p_task and returned_at is null) then
    raise exception 'Esta etapa não está com o prestador.';
  end if;
  update public.shop_task_external set returned_at = v_now, cost = p_cost, notes = coalesce(nullif(btrim(p_notes), ''), notes) where task_id = p_task;
  update public.shop_tasks set status = 'Concluida', finished_at = v_now, quantity_done = 1, updated_at = now() where id = p_task;
  perform public.shop_event(p_task, null, 'Retornou do prestador', jsonb_build_object('cost', p_cost, 'notes', p_notes), null, p_actor);
  perform public.shop_task_refresh(v_t.production_order_id);
end;
$$;

-- Entrada do acabado no estoque (função existente complete_production), uma unidade por vez e idempotente; exige a unidade fabricada.
create or replace function public.shop_unit_receive(p_order uuid, p_unit integer, p_actor text)
returns jsonb
language plpgsql
as $$
declare
  v_pending integer;
begin
  select count(*) into v_pending from public.shop_tasks where production_order_id = p_order and unit_number = p_unit and kind <> 'administrativa' and status not in ('Concluida', 'Cancelada');
  if v_pending > 0 then
    raise exception 'A unidade % ainda tem % etapa(s) de fabricação sem concluir.', p_unit, v_pending;
  end if;
  return public.complete_production(jsonb_build_object('production_order_id', p_order, 'quantity', 1, 'request_key', 'shop-unit-' || p_unit, 'responsible', p_actor));
end;
$$;

-- ================================================================ 10. Consultas: tarefas do colaborador, detalhe, esteira do gestor, QR
create or replace function public.shop_task_card(p_task public.shop_tasks)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('id', p_task.id, 'step_code', p_task.step_code, 'step', p_task.step_name, 'status', p_task.status, 'kind', p_task.kind, 'unit_number', p_task.unit_number, 'planned_end', p_task.planned_end,
    'blocked_reason', p_task.blocked_reason, 'pending_reason', p_task.pending_reason, 'started_at', p_task.started_at, 'finished_at', p_task.finished_at, 'rework_count', p_task.rework_count,
    'order_id', po.id, 'order_code', po.code, 'priority', po.priority, 'quantity', po.quantity, 'order_status', po.status,
    'product', m.name, 'model', m.product_model, 'vin', public.shop_unit_vin(po.id, p_task.unit_number),
    'assigned', (select w.name from public.shop_workers w where w.id = p_task.assigned_worker_id),
    'working', coalesce((select jsonb_agg(jsonb_build_object('worker_id', e.worker_id, 'name', w.name, 'since', e.started_at)) from public.shop_time_entries e join public.shop_workers w on w.id = e.worker_id where e.task_id = p_task.id and e.ended_at is null), '[]'::jsonb))
  from public.production_orders po join public.materials m on m.id = po.product_id where po.id = p_task.production_order_id
$$;

create or replace function public.shop_my_tasks(p_token text)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_order uuid;
  v_today_start timestamptz := date_trunc('day', clock_timestamp());
begin
  for v_order in select distinct production_order_id from public.shop_tasks where system_company_id = v_w.system_company_id and status in ('Aguardando', 'Bloqueada', 'Pronta') loop
    perform public.shop_task_refresh(v_order);
  end loop;
  return jsonb_build_object('worker', public.shop_worker_public(v_w), 'server_time', clock_timestamp(),
    'tasks', coalesce((
      select jsonb_agg(public.shop_task_card(t) || jsonb_build_object('mine_open', exists (select 1 from public.shop_time_entries e where e.task_id = t.id and e.worker_id = v_w.id and e.ended_at is null),
        'worked_by_me', exists (select 1 from public.shop_time_entries e where e.task_id = t.id and e.worker_id = v_w.id))
        order by case t.status when 'Em execucao' then 0 when 'Pausada' then 1 when 'Pronta' then 2 when 'Com pendencia' then 3 when 'Bloqueada' then 4 else 5 end, po.priority, t.planned_end nulls last, t.seq)
      from public.shop_tasks t join public.production_orders po on po.id = t.production_order_id
      where t.system_company_id = v_w.system_company_id and public.shop_worker_can(v_w, t) and t.kind <> 'terceirizada'
        and (t.status in ('Pronta', 'Em execucao', 'Pausada', 'Com pendencia', 'Bloqueada')
             or (t.status = 'Concluida' and t.finished_at >= v_today_start and (t.finished_by = v_w.id or exists (select 1 from public.shop_time_entries e where e.task_id = t.id and e.worker_id = v_w.id))))), '[]'::jsonb));
end;
$$;

create or replace function public.shop_task_detail(p_token text, p_task uuid)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task, false);
  v_s public.shop_steps%rowtype;
begin
  if not public.shop_worker_can(v_w, v_t) then
    raise exception 'Você não está autorizado a ver esta tarefa.';
  end if;
  select * into v_s from public.shop_steps where id = v_t.step_id;
  return jsonb_build_object('task', public.shop_task_card(v_t) || jsonb_build_object('mine_open', exists (select 1 from public.shop_time_entries e where e.task_id = v_t.id and e.worker_id = v_w.id and e.ended_at is null)), 'step', jsonb_build_object('code', v_s.code, 'name', v_s.name, 'requires_checklist', v_s.requires_checklist, 'requires_measures', v_s.requires_measures, 'allow_multiple', v_s.allow_multiple),
    'materials', public.shop_task_materials(p_task), 'drawing', public.shop_task_drawing(p_task),
    'checklist', coalesce((select jsonb_agg(to_jsonb(c)) from public.shop_task_check_state(p_task) c), '[]'::jsonb),
    'measures', coalesce((select jsonb_agg(jsonb_build_object('param', m.param_key, 'expected', m.expected, 'measured', m.measured, 'divergent', m.divergent) order by m.param_key) from public.shop_task_measures m where m.task_id = p_task and not m.superseded), '[]'::jsonb),
    'occurrences', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'description', o.description, 'status', o.status, 'decision', o.decision, 'resolution', o.resolution) order by o.created_at desc) from public.shop_occurrences o where o.task_id = p_task), '[]'::jsonb),
    'metrics', public.shop_task_metrics(p_task), 'server_time', clock_timestamp());
end;
$$;

-- Painel do gestor: carretas por etapa (esteira), colaboradores em atividade, atrasos, paradas, ocorrências e indicadores.
create or replace function public.shop_board()
returns jsonb
language plpgsql
stable
as $$
declare
  v_cid uuid := public.shop_cid();
  v_today date := current_date;
begin
  return jsonb_build_object('server_time', clock_timestamp(),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'seq', s.seq, 'kind', s.kind) order by s.seq) from public.shop_steps s where s.system_company_id = v_cid and s.active), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(u order by (u->>'priority')::int, u->>'order_code', (u->>'unit_number')::int) from (
        select jsonb_build_object('order_id', po.id, 'order_code', po.code, 'unit_number', n.unit_number, 'priority', po.priority, 'product', m.name, 'model', m.product_model, 'vin', public.shop_unit_vin(po.id, n.unit_number),
          'planned_end', po.planned_end, 'token', (select token from public.shop_unit_tokens k where k.production_order_id = po.id and k.unit_number = n.unit_number),
          'current_step', cur.step_code, 'current_status', cur.status, 'current_name', cur.step_name, 'blocked_reason', cur.blocked_reason, 'pending_reason', cur.pending_reason, 'task_id', cur.id,
          'done_tasks', n.done, 'total_tasks', n.total, 'finished', n.done = n.total,
          'late', coalesce(cur.planned_end < v_today and cur.status not in ('Concluida', 'Cancelada'), false),
          'working', coalesce((select jsonb_agg(w.name) from public.shop_time_entries e join public.shop_workers w on w.id = e.worker_id where e.task_id = cur.id and e.ended_at is null), '[]'::jsonb),
          'assigned', (select w.name from public.shop_workers w where w.id = cur.assigned_worker_id)) u
        from (select production_order_id, unit_number, count(*) filter (where status <> 'Cancelada') total, count(*) filter (where status = 'Concluida') done from public.shop_tasks where system_company_id = v_cid group by 1, 2) n
        join public.production_orders po on po.id = n.production_order_id and po.status <> 'Cancelada'
        join public.materials m on m.id = po.product_id
        left join lateral (select t.* from public.shop_tasks t where t.production_order_id = n.production_order_id and t.unit_number = n.unit_number and t.status not in ('Concluida', 'Cancelada') order by t.seq limit 1) cur on true
      ) q), '[]'::jsonb),
    'active_workers', coalesce((select jsonb_agg(jsonb_build_object('worker', w.name, 'task', t.step_name, 'order_code', po.code, 'unit', t.unit_number, 'since', e.started_at) order by e.started_at)
      from public.shop_time_entries e join public.shop_workers w on w.id = e.worker_id join public.shop_tasks t on t.id = e.task_id join public.production_orders po on po.id = t.production_order_id where e.ended_at is null and e.system_company_id = v_cid), '[]'::jsonb),
    'stopped', coalesce((select jsonb_agg(jsonb_build_object('task_id', t.id, 'order_code', po.code, 'unit', t.unit_number, 'step', t.step_name, 'status', t.status, 'reason', coalesce(t.blocked_reason, t.pending_reason,
        (select e.pause_reason from public.shop_time_entries e where e.task_id = t.id and e.end_reason = 'pausa' order by e.ended_at desc limit 1)))) from public.shop_tasks t join public.production_orders po on po.id = t.production_order_id
      where t.system_company_id = v_cid and t.status in ('Pausada', 'Bloqueada', 'Com pendencia') and po.status <> 'Cancelada'), '[]'::jsonb),
    'late_count', (select count(*) from public.shop_tasks t where t.system_company_id = v_cid and t.planned_end < v_today and t.status not in ('Concluida', 'Cancelada')),
    'open_occurrences', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'description', o.description, 'order_code', po.code, 'unit', o.unit_number, 'step', o.step_code, 'created_at', o.created_at) order by o.created_at)
      from public.shop_occurrences o join public.production_orders po on po.id = o.production_order_id where o.system_company_id = v_cid and o.status = 'Aberta'), '[]'::jsonb),
    'rework_count', (select coalesce(sum(rework_count), 0) from public.shop_tasks where system_company_id = v_cid),
    'external', coalesce((select jsonb_agg(jsonb_build_object('task_id', x.task_id, 'provider', x.provider_name, 'finish_type', x.finish_type, 'sent_at', x.sent_at, 'expected_return', x.expected_return, 'returned_at', x.returned_at, 'cost', x.cost,
        'order_code', po.code, 'unit', t.unit_number) order by x.sent_at desc) from public.shop_task_external x join public.shop_tasks t on t.id = x.task_id join public.production_orders po on po.id = t.production_order_id where x.system_company_id = v_cid), '[]'::jsonb));
end;
$$;

-- Indicadores por etapa e colaborador (horas de mão de obra sem dupla contagem; custo só com taxa configurada; etapa administrativa e terceirizada ficam fora da mão de obra de fabricação).
create or replace function public.shop_productivity(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cid uuid := public.shop_cid();
  v_from timestamptz := coalesce(p_from, current_date - 30)::timestamptz;
  v_to timestamptz := (coalesce(p_to, current_date) + 1)::timestamptz;
begin
  return jsonb_build_object(
    'by_step', coalesce((select jsonb_agg(r order by r->>'seq') from (
      select jsonb_build_object('seq', t.seq, 'step', t.step_name, 'tasks', count(distinct t.id), 'done', count(distinct t.id) filter (where t.status = 'Concluida'),
        'labor_hours', round(coalesce(sum(extract(epoch from (e.ended_at - e.started_at)) / 3600), 0)::numeric, 2),
        'avg_elapsed_minutes', round(avg(extract(epoch from (t.finished_at - t.started_at)) / 60) filter (where t.status = 'Concluida' and t.kind <> 'terceirizada')::numeric, 1),
        'planned_minutes', max(s.standard_minutes), 'rework', coalesce(sum(t.rework_count), 0)) r
      from public.shop_tasks t join public.shop_steps s on s.id = t.step_id left join public.shop_time_entries e on e.task_id = t.id and e.ended_at is not null and e.started_at >= v_from and e.started_at < v_to
      where t.system_company_id = v_cid and t.kind not in ('terceirizada', 'administrativa') group by t.seq, t.step_name) q), '[]'::jsonb),
    'by_worker', coalesce((select jsonb_agg(r order by r->>'name') from (
      select jsonb_build_object('worker_id', w.id, 'name', w.name, 'hours', round(sum(extract(epoch from (e.ended_at - e.started_at)) / 3600)::numeric, 2), 'tasks', count(distinct e.task_id),
        'cost', round(sum(extract(epoch from (e.ended_at - e.started_at)) / 3600 * w.hourly_rate)::numeric, 2)) r
      from public.shop_time_entries e join public.shop_workers w on w.id = e.worker_id join public.shop_tasks t on t.id = e.task_id
      where e.system_company_id = v_cid and e.ended_at is not null and e.started_at >= v_from and e.started_at < v_to and t.kind not in ('terceirizada', 'administrativa') group by w.id, w.name) q), '[]'::jsonb));
end;
$$;

create or replace function public.shop_workers_list()
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name, 'sectors', w.sectors, 'shift', w.shift, 'hourly_rate', w.hourly_rate, 'is_inspector', w.is_inspector, 'is_supervisor', w.is_supervisor,
    'active', w.active, 'has_pin', w.pin_hash is not null, 'profile_id', w.profile_id, 'locked', w.locked_until is not null and w.locked_until > clock_timestamp()) order by w.name), '[]'::jsonb)
  from public.shop_workers w where w.system_company_id = public.shop_cid()
$$;

create or replace function public.shop_steps_list()
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'seq', s.seq, 'kind', s.kind, 'sector', s.sector, 'depends_on', s.depends_on, 'allow_multiple', s.allow_multiple,
    'requires_checklist', s.requires_checklist, 'requires_measures', s.requires_measures, 'kit_match', s.kit_match, 'standard_minutes', s.standard_minutes, 'tolerance_mm', s.tolerance_mm, 'active', s.active,
    'kits', coalesce((select jsonb_agg(sk.kit_id) from public.shop_step_kits sk where sk.step_id = s.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'mandatory', i.mandatory, 'allow_na', i.allow_na, 'position', i.position) order by i.position) from public.shop_checklist_items i where i.step_id = s.id and i.active), '[]'::jsonb)) order by s.seq), '[]'::jsonb)
  from public.shop_steps s where s.system_company_id = public.shop_cid()
$$;

-- Página do QR Code: identificador opaco; só mostra o que a fábrica precisa (nenhum dado do cliente).
create or replace function public.shop_unit_view(p_token text)
returns jsonb
language plpgsql
as $$
declare
  v_k public.shop_unit_tokens%rowtype;
  v_po public.production_orders%rowtype;
begin
  select * into v_k from public.shop_unit_tokens where token = p_token and system_company_id = public.shop_cid();
  if not found then
    raise exception 'QR Code não encontrado para esta empresa.';
  end if;
  select * into v_po from public.production_orders where id = v_k.production_order_id;
  return jsonb_build_object('order_code', v_po.code, 'order_status', v_po.status, 'unit_number', v_k.unit_number, 'units', ceil(v_po.quantity),
    'product', (select jsonb_build_object('name', m.name, 'model', m.product_model, 'sku', m.internal_code) from public.materials m where m.id = v_po.product_id), 'vin', public.shop_unit_vin(v_po.id, v_k.unit_number),
    'current_step', (select t.step_name from public.shop_tasks t where t.production_order_id = v_po.id and t.unit_number = v_k.unit_number and t.status not in ('Concluida', 'Cancelada') order by t.seq limit 1),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'step', t.step_name, 'status', t.status, 'finished_at', t.finished_at, 'started_at', t.started_at) order by t.seq) from public.shop_tasks t where t.production_order_id = v_po.id and t.unit_number = v_k.unit_number), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'event', e.event, 'step', t.step_name, 'worker', (select name from public.shop_workers where id = e.worker_id)) order by e.at desc)
      from (select * from public.shop_task_events where task_id in (select id from public.shop_tasks where production_order_id = v_po.id and unit_number = v_k.unit_number) order by at desc limit 60) e join public.shop_tasks t on t.id = e.task_id), '[]'::jsonb),
    'drawing', (select public.shop_task_drawing(t.id) from public.shop_tasks t where t.production_order_id = v_po.id and t.unit_number = v_k.unit_number order by t.seq limit 1));
end;
$$;

-- ================================================================ 11. Acesso (todas as tabelas são da EMPRESA)
do $$
declare
  t text;
begin
  foreach t in array array['shop_settings', 'shop_workers', 'shop_sessions', 'shop_steps', 'shop_step_kits', 'shop_checklist_items', 'shop_tasks', 'shop_time_entries', 'shop_task_events', 'shop_task_consumptions',
                           'shop_task_checks', 'shop_task_measures', 'shop_occurrences', 'shop_task_external', 'shop_unit_tokens'] loop
    execute format('create index if not exists %I on public.%I (system_company_id)', t || '_system_company_idx', t);
    execute format('drop trigger if exists assign_system_company on public.%I', t);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', t);
    execute format('drop policy if exists tenant_company_isolation on public.%I', t);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', t);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', t);
  end loop;
end;
$$;
-- O hash do PIN e o token de sessão nunca são lidos pelo navegador: as telas só usam as funções acima, pelo servidor.
revoke all on public.shop_workers, public.shop_sessions from anon;

insert into storage.buckets (id, name, public) values ('shop-photos', 'shop-photos', false) on conflict (id) do nothing;
