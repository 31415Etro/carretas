-- Máquinas e Equipamentos ERP Carretas: cadastro patrimonial, status operacional por cor, QR Code,
-- histórico de status, manutenção (planos, ordens, histórico anterior), peças, horímetro e documentos.
-- Rode no SQL Editor do Supabase depois de 217_adiantamentos.sql. Só cria objetos novos (nada é removido ou alterado).
--
-- Regras de modelagem:
--  * Tudo é por empresa (system_company_id + RLS restritiva, igual às demais tabelas do ERP).
--  * Valores em dinheiro: numeric(14,2) (nunca ponto flutuante). Horímetro: numeric(12,1).
--  * Status operacional (Em operacao / Em manutencao / Parada / Nao informado) é separado do status
--    administrativo (Ativo / Inativo / Baixado). Mudança de status só pela função machine_change_status
--    (trava a linha, valida versão, regra de segurança e grava o histórico na mesma transação).
--  * Códigos (patrimônio e OM) vêm de contadores com upsert atômico: sem duplicidade em cadastros simultâneos
--    e nunca reaproveitados (nem de máquinas baixadas).

-- ===== Configurações por empresa =====
create table if not exists public.machine_settings (
  system_company_id uuid primary key default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  code_prefix text not null default 'ND',
  qr_base_url text,
  due_soon_days integer not null default 15 check (due_soon_days between 1 and 120),
  high_cost_percent numeric(6,2) not null default 30 check (high_cost_percent > 0),
  auto_create_orders boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ===== Contadores (código patrimonial e número de OM) =====
create table if not exists public.machine_code_counters (
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  counter_key text not null,
  last_value bigint not null default 0,
  primary key (system_company_id, counter_key)
);

-- ===== Categorias e setores =====
create table if not exists public.machine_categories (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  name text not null,
  code_kind text not null default 'MAQ' check (code_kind in ('MAQ', 'EQP')),
  illustration_key text not null default 'generica',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists machine_categories_name_uidx on public.machine_categories (system_company_id, lower(name));

create table if not exists public.machine_sectors (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  -- reservado para o mapa da fábrica (planta com posicionamento das máquinas)
  map_layout jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists machine_sectors_name_uidx on public.machine_sectors (system_company_id, lower(name));

-- ===== Máquinas e equipamentos =====
create table if not exists public.machines (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  code text not null,
  code_kind text not null default 'MAQ' check (code_kind in ('MAQ', 'EQP')),
  name text not null,
  category_id uuid references public.machine_categories(id) on delete set null,
  equipment_type text,
  manufacturer text,
  brand text,
  model text,
  serial_number text,
  manufacture_year integer check (manufacture_year is null or manufacture_year between 1900 and 2100),
  description text,
  illustration_key text not null default 'generica',
  photo_path text,
  unit_company_id uuid references public.system_companies(id) on delete set null,
  sector_id uuid references public.machine_sectors(id) on delete set null,
  location_detail text,
  responsible_name text,
  -- estado administrativo (separado do operacional)
  admin_status text not null default 'Ativo' check (admin_status in ('Ativo', 'Inativo', 'Baixado')),
  retired_at date,
  retired_reason text,
  -- estado operacional informado por pessoa autorizada (não há sensor/IoT)
  operational_status text not null default 'Nao informado' check (operational_status in ('Em operacao', 'Em manutencao', 'Parada', 'Nao informado')),
  status_since timestamptz not null default now(),
  status_reason text,
  status_version integer not null default 1,
  safety_locked boolean not null default false,
  safety_lock_reason text,
  -- horímetro
  uses_hour_meter boolean not null default false,
  hour_meter numeric(12,1) not null default 0 check (hour_meter >= 0),
  hour_meter_at timestamptz,
  -- consolidados de manutenção
  last_maintenance_at date,
  total_maintenance_cost numeric(14,2) not null default 0,
  -- patrimonial
  acquisition_date date,
  acquisition_value numeric(14,2) not null default 0 check (acquisition_value >= 0),
  supplier_id uuid,
  supplier_name text,
  invoice_number text,
  freight_cost numeric(14,2) not null default 0 check (freight_cost >= 0),
  installation_cost numeric(14,2) not null default 0 check (installation_cost >= 0),
  other_costs numeric(14,2) not null default 0 check (other_costs >= 0),
  residual_value numeric(14,2) not null default 0 check (residual_value >= 0),
  useful_life_months integer check (useful_life_months is null or useful_life_months > 0),
  depreciation_method text not null default 'Linear' check (depreciation_method in ('Linear', 'Nenhum')),
  depreciation_start_date date,
  depreciation_adjustments numeric(14,2) not null default 0,
  market_value numeric(14,2),
  market_value_date date,
  replacement_value numeric(14,2),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machines_retired_check check (admin_status <> 'Baixado' or retired_at is not null)
);
create unique index if not exists machines_code_uidx on public.machines (system_company_id, code);
create index if not exists machines_company_status_idx on public.machines (system_company_id, admin_status, operational_status);
create index if not exists machines_sector_idx on public.machines (sector_id);
create index if not exists machines_category_idx on public.machines (category_id);
create unique index if not exists machines_serial_uidx on public.machines (system_company_id, lower(manufacturer), lower(serial_number)) where serial_number is not null and serial_number <> '' and manufacturer is not null and manufacturer <> '';

-- ===== Histórico de status operacional (auditável, nunca editado) =====
create table if not exists public.machine_status_history (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete restrict,
  from_status text,
  to_status text not null check (to_status in ('Em operacao', 'Em manutencao', 'Parada', 'Nao informado')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason_code text,
  reason text,
  notes text,
  responsible text,
  order_id uuid,
  safety_lock boolean not null default false,
  safety_release boolean not null default false,
  changed_by text,
  created_at timestamptz not null default now()
);
create index if not exists machine_status_history_machine_idx on public.machine_status_history (machine_id, started_at desc);
create index if not exists machine_status_history_company_idx on public.machine_status_history (system_company_id, started_at desc);

create table if not exists public.machine_location_history (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete restrict,
  sector_id uuid references public.machine_sectors(id) on delete set null,
  location_detail text,
  responsible_name text,
  moved_at timestamptz not null default now(),
  moved_by text
);
create index if not exists machine_location_history_machine_idx on public.machine_location_history (machine_id, moved_at desc);

-- ===== Planos de manutenção preventiva =====
create table if not exists public.machine_maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete cascade,
  name text not null,
  description text,
  maintenance_type text not null default 'Preventiva' check (maintenance_type in ('Preventiva', 'Preditiva', 'Inspecao')),
  interval_days integer check (interval_days is null or interval_days > 0),
  interval_months integer check (interval_months is null or interval_months > 0),
  interval_hours numeric(12,1) check (interval_hours is null or interval_hours > 0),
  fixed_date date,
  -- 'Primeiro' vence quando QUALQUER regra vencer; 'Todos' quando todas vencerem
  combine_rule text not null default 'Primeiro' check (combine_rule in ('Primeiro', 'Todos')),
  checklist jsonb not null default '[]'::jsonb,
  auto_create_order boolean not null default false,
  blocks_operation boolean not null default false,
  last_done_date date,
  last_done_hours numeric(12,1),
  next_due_date date,
  next_due_hours numeric(12,1),
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_plan_has_rule check (interval_days is not null or interval_months is not null or interval_hours is not null or fixed_date is not null)
);
create index if not exists machine_plans_machine_idx on public.machine_maintenance_plans (machine_id);
create index if not exists machine_plans_due_idx on public.machine_maintenance_plans (system_company_id, next_due_date) where active;

-- ===== Ordens de manutenção, ocorrências e histórico anterior =====
-- origin: 'Ordem' (fluxo normal), 'Ocorrencia' (problema reportado), 'Historico' (intervenção anterior ao cadastro).
-- performed_at = data real da execução; created_at = data do lançamento no ERP.
create table if not exists public.machine_orders (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  order_number text,
  origin text not null default 'Ordem' check (origin in ('Ordem', 'Ocorrencia', 'Historico')),
  machine_id uuid not null references public.machines(id) on delete restrict,
  plan_id uuid references public.machine_maintenance_plans(id) on delete set null,
  maintenance_type text not null default 'Corretiva' check (maintenance_type in ('Preventiva', 'Corretiva', 'Preditiva', 'Inspecao')),
  priority text not null default 'Media' check (priority in ('Baixa', 'Media', 'Alta', 'Urgente')),
  status text not null default 'Aberta' check (status in ('Aberta', 'Aguardando aprovacao', 'Em execucao', 'Aguardando pecas', 'Suspensa', 'Concluida', 'Cancelada')),
  description text not null,
  problem text,
  solution text,
  responsible text,
  technician text,
  external_company text,
  due_date date,
  started_at timestamptz,
  performed_at date,
  completed_at timestamptz,
  checklist jsonb not null default '[]'::jsonb,
  labor_hours numeric(10,2) not null default 0 check (labor_hours >= 0),
  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  parts_cost numeric(14,2) not null default 0 check (parts_cost >= 0),
  other_cost numeric(14,2) not null default 0 check (other_cost >= 0),
  downtime_hours numeric(10,2) not null default 0 check (downtime_hours >= 0),
  blocks_operation boolean not null default false,
  requires_approval boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  validated_by text,
  validated_at timestamptz,
  supplier_id uuid,
  invoice_number text,
  -- integrações (preenchidas somente por ação explícita e autorizada)
  payable_id uuid,
  purchase_order_id uuid,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_orders_historic_done check (origin <> 'Historico' or (status = 'Concluida' and performed_at is not null))
);
create unique index if not exists machine_orders_number_uidx on public.machine_orders (system_company_id, order_number) where order_number is not null;
create index if not exists machine_orders_machine_idx on public.machine_orders (machine_id, performed_at desc nulls last, created_at desc);
create index if not exists machine_orders_status_idx on public.machine_orders (system_company_id, status);
-- evita ordens duplicadas do mesmo plano enquanto houver uma em aberto
create unique index if not exists machine_orders_open_plan_uidx on public.machine_orders (plan_id) where plan_id is not null and status not in ('Concluida', 'Cancelada');

-- ===== Peças e materiais =====
-- stock_status garante baixa de estoque idempotente: pendente -> postando -> baixado (ou sem_baixa para histórico).
create table if not exists public.machine_order_parts (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  order_id uuid not null references public.machine_orders(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  stock_status text not null default 'pendente' check (stock_status in ('pendente', 'postando', 'baixado', 'sem_baixa')),
  stock_movement_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists machine_order_parts_order_idx on public.machine_order_parts (order_id);

-- ===== Horímetro =====
create table if not exists public.machine_meter_readings (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete cascade,
  reading numeric(12,1) not null check (reading >= 0),
  read_at timestamptz not null default now(),
  is_correction boolean not null default false,
  note text,
  read_by text,
  created_at timestamptz not null default now()
);
create index if not exists machine_meter_machine_idx on public.machine_meter_readings (machine_id, read_at desc);

-- ===== QR Code (identificador público opaco, revogável; o código patrimonial nunca muda) =====
create table if not exists public.machine_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete cascade,
  token text not null,
  active boolean not null default true,
  print_count integer not null default 0,
  last_printed_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  revoked_reason text,
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists machine_qr_token_uidx on public.machine_qr_tokens (token);
create unique index if not exists machine_qr_one_active_uidx on public.machine_qr_tokens (machine_id) where active;

-- ===== Documentos =====
create table if not exists public.machine_documents (
  id uuid primary key default gen_random_uuid(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete cascade,
  order_id uuid references public.machine_orders(id) on delete set null,
  doc_type text not null,
  description text,
  restricted boolean not null default false,
  expiry_date date,
  file_path text not null,
  file_name text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists machine_documents_machine_idx on public.machine_documents (machine_id);

-- ===== Funções =====
create or replace function public.machine_next_counter(p_key text)
returns bigint
language plpgsql
as $$
declare
  v_value bigint;
begin
  -- upsert atômico: a linha fica travada até o fim da transação, então dois cadastros simultâneos nunca recebem o mesmo número
  insert into public.machine_code_counters (system_company_id, counter_key, last_value)
  values (public.request_system_company_id(), p_key, 1)
  on conflict (system_company_id, counter_key) do update set last_value = public.machine_code_counters.last_value + 1
  returning last_value into v_value;
  return v_value;
end;
$$;

-- Código patrimonial: ND-MAQ-000001 / ND-EQP-000001 (único por empresa e tipo; nunca reutilizado).
create or replace function public.machine_next_code(p_kind text)
returns text
language plpgsql
as $$
declare
  v_prefix text;
  v_value bigint;
begin
  if p_kind not in ('MAQ', 'EQP') then
    raise exception 'Tipo de código inválido: %', p_kind;
  end if;
  select code_prefix into v_prefix from public.machine_settings where system_company_id = public.request_system_company_id();
  v_value := public.machine_next_counter('CODE-' || p_kind);
  return coalesce(nullif(v_prefix, ''), 'ND') || '-' || p_kind || '-' || lpad(v_value::text, 6, '0');
end;
$$;

-- Número da ordem de manutenção: OM-2026-000001 (sequência anual por empresa).
create or replace function public.machine_next_order_number()
returns text
language plpgsql
as $$
declare
  v_year text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY');
  v_value bigint;
begin
  v_value := public.machine_next_counter('OM-' || v_year);
  return 'OM-' || v_year || '-' || lpad(v_value::text, 6, '0');
end;
$$;

-- Mudança de status operacional. Mensagens com prefixo CONFLITO: / BLOQUEIO: / INVALIDO: são tratadas pela API.
create or replace function public.machine_change_status(p jsonb)
returns public.machines
language plpgsql
as $$
declare
  v_machine public.machines%rowtype;
  v_to text := p->>'to_status';
  v_at timestamptz := coalesce(nullif(p->>'effective_at', '')::timestamptz, now());
  v_expected integer := nullif(p->>'expected_version', '')::integer;
  v_lock boolean := coalesce((p->>'safety_lock')::boolean, false);
  v_release boolean := coalesce((p->>'safety_release')::boolean, false);
  v_last timestamptz;
  v_blocking integer;
begin
  if v_to is null or v_to not in ('Em operacao', 'Em manutencao', 'Parada') then
    raise exception 'INVALIDO: Status operacional inválido.';
  end if;
  if coalesce(trim(p->>'reason'), '') = '' then
    raise exception 'INVALIDO: Informe o motivo da alteração.';
  end if;

  select * into v_machine from public.machines where id = (p->>'machine_id')::uuid for update;
  if not found then
    raise exception 'INVALIDO: Máquina não encontrada.';
  end if;
  if v_machine.admin_status <> 'Ativo' then
    raise exception 'BLOQUEIO: Máquina % está %: não é possível alterar o status operacional.', v_machine.code, lower(v_machine.admin_status);
  end if;
  if v_expected is not null and v_expected <> v_machine.status_version then
    raise exception 'CONFLITO: O status desta máquina foi alterado por outra pessoa. Atualize a tela e confira antes de salvar.';
  end if;
  if v_to = v_machine.operational_status and not (v_lock and not v_machine.safety_locked) then
    raise exception 'INVALIDO: A máquina já está com este status.';
  end if;
  if v_at > now() + interval '5 minutes' then
    raise exception 'INVALIDO: A data e hora da alteração não pode estar no futuro.';
  end if;
  select max(started_at) into v_last from public.machine_status_history where machine_id = v_machine.id;
  if v_last is not null and v_at < v_last then
    raise exception 'INVALIDO: A data e hora não pode ser anterior à última alteração de status (%).', to_char(v_last at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  end if;

  if v_to = 'Em operacao' then
    if v_machine.safety_locked and not v_release then
      raise exception 'BLOQUEIO: Máquina bloqueada por segurança (%). Só pode voltar a operar com liberação autorizada.', coalesce(v_machine.safety_lock_reason, 'sem motivo informado');
    end if;
    select count(*) into v_blocking from public.machine_orders
      where machine_id = v_machine.id and blocks_operation and status not in ('Concluida', 'Cancelada');
    if v_blocking > 0 then
      raise exception 'BLOQUEIO: Existe(m) % ordem(ns) de manutenção em aberto que impede(m) o uso da máquina. Conclua ou cancele a ordem antes de liberar.', v_blocking;
    end if;
  end if;
  if v_lock and v_to <> 'Parada' then
    raise exception 'INVALIDO: O bloqueio de segurança só se aplica a máquina parada.';
  end if;

  update public.machine_status_history set ended_at = v_at where machine_id = v_machine.id and ended_at is null;
  insert into public.machine_status_history (machine_id, from_status, to_status, started_at, reason_code, reason, notes, responsible, order_id, safety_lock, safety_release, changed_by)
  values (v_machine.id, v_machine.operational_status, v_to, v_at, p->>'reason_code', p->>'reason', p->>'notes', p->>'responsible', nullif(p->>'order_id', '')::uuid, v_lock, v_release and v_machine.safety_locked, p->>'changed_by');

  update public.machines set
    operational_status = v_to,
    status_since = v_at,
    status_reason = p->>'reason',
    status_version = status_version + 1,
    safety_locked = case when v_lock then true when v_to = 'Em operacao' then false else safety_locked end,
    safety_lock_reason = case when v_lock then p->>'reason' when v_to = 'Em operacao' then null else safety_lock_reason end,
    updated_at = now()
  where id = v_machine.id
  returning * into v_machine;
  return v_machine;
end;
$$;

-- ===== Multiempresa, RLS e auditoria =====
do $$
declare
  t text;
  tables text[] := array[
    'machine_settings', 'machine_code_counters', 'machine_categories', 'machine_sectors', 'machines', 'machine_status_history', 'machine_location_history',
    'machine_maintenance_plans', 'machine_orders', 'machine_order_parts', 'machine_meter_readings', 'machine_qr_tokens', 'machine_documents'
  ];
begin
  foreach t in array tables loop
    if to_regprocedure('public.assign_request_system_company()') is not null then
      execute format('drop trigger if exists assign_system_company on public.%I', t);
      execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', t);
    execute format('drop policy if exists tenant_company_isolation on public.%I', t);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', t);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', t);
    -- contadores não entram na trilha (mudam a cada código gerado)
    if t <> 'machine_code_counters' and to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists audit_row on public.%I', t);
      execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row_change(%L)', t, 'maquinas');
    end if;
  end loop;
end;
$$;

-- O histórico de status é somente inclusão (exceto fechar o período anterior pela função machine_change_status).
create or replace function public.machine_status_history_protect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'O histórico de status não pode ser apagado.';
  end if;
  if (to_jsonb(new) - 'ended_at') is distinct from (to_jsonb(old) - 'ended_at') then
    raise exception 'O histórico de status não pode ser alterado.';
  end if;
  return new;
end;
$$;
drop trigger if exists machine_status_history_protect on public.machine_status_history;
create trigger machine_status_history_protect before update or delete on public.machine_status_history for each row execute function public.machine_status_history_protect();

-- ===== Armazenamento privado (fotos, manuais, notas, laudos) =====
insert into storage.buckets (id, name, public) values ('machine-files', 'machine-files', false) on conflict (id) do nothing;
