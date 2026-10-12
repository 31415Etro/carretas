-- Log do Sistema ERP Carretas: trilha de auditoria.
--  * audit_events: somente inclusão (UPDATE/DELETE/TRUNCATE bloqueados), com cadeia de hash (cada evento
--    carrega o hash do anterior) e acesso restrito (somente a API do servidor, via service role).
--  * Triggers registram criação/edição/exclusão (valores anteriores e posteriores) das tabelas de negócio,
--    com o usuário, IP, sessão e requisição repassados pela aplicação nos cabeçalhos x-audit-*.
--  * Retenção configurável por empresa (mínimo 365 dias) e expurgo controlado por função.
-- Rode no SQL Editor do Supabase depois de 212_relatorios.sql.

create extension if not exists pgcrypto with schema extensions;

create sequence if not exists public.audit_events_seq;

create table if not exists public.audit_events (
  seq bigint not null,
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  system_company_id uuid,
  actor_id uuid,
  actor_email text,
  module text not null,
  action text not null,
  table_name text,
  record_id text,
  description text not null,
  old_values jsonb,
  new_values jsonb,
  changed_fields text[],
  ip_address text,
  session_id text,
  request_id text,
  result text not null default 'Sucesso' check (result in ('Sucesso', 'Falha', 'Negado')),
  reason text,
  origin text not null default 'Sistema' check (origin in ('Usuário', 'API', 'Integração', 'Agendador', 'Sistema')),
  prev_hash text not null,
  hash text not null
);
create unique index if not exists audit_events_seq_uidx on public.audit_events (seq);
create index if not exists audit_events_company_seq_idx on public.audit_events (system_company_id, seq desc);
create index if not exists audit_events_time_idx on public.audit_events (occurred_at desc);
create index if not exists audit_events_module_idx on public.audit_events (module, occurred_at desc);
create index if not exists audit_events_actor_idx on public.audit_events (actor_id, occurred_at desc);
create index if not exists audit_events_record_idx on public.audit_events (record_id);
create index if not exists audit_events_request_idx on public.audit_events (request_id);

-- ===== Proteção: nada de alterar, apagar ou truncar (exceto o expurgo por retenção) =====
create or replace function public.audit_protect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('audit.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'A trilha de auditoria não pode ser alterada nem apagada.';
end;
$$;
drop trigger if exists audit_protect_rows on public.audit_events;
create trigger audit_protect_rows before update or delete on public.audit_events for each row execute function public.audit_protect();
drop trigger if exists audit_protect_truncate on public.audit_events;
create trigger audit_protect_truncate before truncate on public.audit_events for each statement execute function public.audit_protect();

-- ===== Cadeia de hash =====
create or replace function public.audit_hash_payload(r public.audit_events)
returns text
language sql
immutable
as $$
  select concat_ws('|', to_char(r.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), r.seq::text, r.actor_id::text, r.module, r.action, r.table_name, r.record_id, r.description, r.old_values::text, r.new_values::text, r.result, r.request_id)
$$;

create or replace function public.audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_prev text;
  v_key text := coalesce(new.system_company_id::text, 'global');
begin
  perform pg_advisory_xact_lock(hashtextextended('audit_chain:' || v_key, 0));
  select hash into v_prev from public.audit_events where coalesce(system_company_id::text, 'global') = v_key order by seq desc limit 1;
  new.seq := nextval('public.audit_events_seq');
  new.occurred_at := coalesce(new.occurred_at, clock_timestamp());
  new.prev_hash := coalesce(v_prev, 'GENESIS');
  new.hash := encode(digest(new.prev_hash || '|' || public.audit_hash_payload(new), 'sha256'), 'hex');
  return new;
end;
$$;
drop trigger if exists audit_chain_insert on public.audit_events;
create trigger audit_chain_insert before insert on public.audit_events for each row execute function public.audit_chain();

-- Verifica a integridade da cadeia de uma empresa (p_company nulo = eventos sem empresa).
create or replace function public.verify_audit_chain(p_company uuid default null)
returns table (ok boolean, checked bigint, broken_seq bigint)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r public.audit_events%rowtype;
  v_prev text := null;
  v_count bigint := 0;
begin
  for r in select * from public.audit_events where (p_company is null and system_company_id is null) or system_company_id = p_company order by seq loop
    v_count := v_count + 1;
    if v_prev is not null and r.prev_hash <> v_prev then
      return query select false, v_count, r.seq;
      return;
    end if;
    if r.hash <> encode(digest(r.prev_hash || '|' || public.audit_hash_payload(r), 'sha256'), 'hex') then
      return query select false, v_count, r.seq;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, v_count, null::bigint;
end;
$$;

-- ===== Retenção =====
create table if not exists public.audit_settings (
  system_company_id uuid primary key,
  retention_days integer not null default 1825 check (retention_days >= 365),
  updated_by text,
  updated_at timestamptz not null default now()
);

create or replace function public.purge_audit_events()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_days integer;
  v_removed bigint;
  v_total bigint := 0;
begin
  for r in select id from public.system_companies union all select null::uuid loop
    select coalesce((select retention_days from public.audit_settings where system_company_id = r.id), 1825) into v_days;
    perform set_config('audit.purge', 'on', true);
    delete from public.audit_events where system_company_id is not distinct from r.id and occurred_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('audit.purge', 'off', true);
    if v_removed > 0 then
      insert into public.audit_events (system_company_id, module, action, description, origin, request_id)
      values (r.id, 'auditoria', 'Expurgo por retenção', v_removed || ' evento(s) com mais de ' || v_days || ' dias removidos pela política de retenção.', 'Agendador', 'purge-' || gen_random_uuid()::text);
    end if;
    v_total := v_total + v_removed;
  end loop;
  return v_total;
end;
$$;

-- ===== Acesso restrito: só o servidor (service role) lê e grava =====
alter table public.audit_events enable row level security;
alter table public.audit_settings enable row level security;
revoke all on public.audit_events from anon, authenticated;
revoke all on public.audit_settings from anon, authenticated;
revoke all on function public.verify_audit_chain(uuid) from public, anon, authenticated;
revoke all on function public.purge_audit_events() from public, anon, authenticated;

-- ===== Mascaramento: nunca guardar senhas, tokens ou dados sigilosos desnecessários =====
create or replace function public.audit_redact(j jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  k text;
  v jsonb;
  s text;
  result jsonb := '{}'::jsonb;
begin
  if j is null then
    return null;
  end if;
  for k, v in select key, value from jsonb_each(j) loop
    if k = 'updated_at' or k ~* '(pass|senha|token|secret|api_?key|authorization|credential|signature|private)' then
      continue;
    end if;
    if jsonb_typeof(v) = 'string' then
      s := v #>> '{}';
      if s like 'data:%' then
        v := to_jsonb('[arquivo]'::text);
      elsif k ~* '(^|_)(document|cpf|cnpj|cnh|renavam|pix|account_number|agency)(_|$)' and length(s) > 4 then
        v := to_jsonb('••••' || right(s, 4));
      elsif length(s) > 500 then
        v := to_jsonb(left(s, 500) || '…');
      end if;
    elsif jsonb_typeof(v) in ('object', 'array') and length(v::text) > 1000 then
      v := to_jsonb('[dados extensos]'::text);
    end if;
    result := result || jsonb_build_object(k, v);
  end loop;
  return result;
end;
$$;

-- ===== Trigger genérico das tabelas de negócio =====
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_module text := coalesce(tg_argv[0], 'sistema');
  hdr jsonb;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_action text;
  v_id text;
  v_ref text;
  v_company uuid;
  v_reason text;
  v_actor uuid;
begin
  begin
    begin
      hdr := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      hdr := null;
    end;
    v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_id := v_row ->> 'id';
    if v_id is null then
      select value #>> '{}' into v_id from jsonb_each(v_row) limit 1;
    end if;

    if tg_op = 'UPDATE' then
      select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
      from jsonb_each(to_jsonb(new)) n
      where n.key <> 'updated_at' and n.value is distinct from (to_jsonb(old) -> n.key);
      if cardinality(v_changed) = 0 then
        return null;
      end if;
      select jsonb_object_agg(k, to_jsonb(old) -> k) into v_old from unnest(v_changed) k;
      select jsonb_object_agg(k, to_jsonb(new) -> k) into v_new from unnest(v_changed) k;
      v_old := public.audit_redact(v_old);
      v_new := public.audit_redact(v_new);
    elsif tg_op = 'INSERT' then
      v_new := public.audit_redact(v_row);
    else
      v_old := public.audit_redact(v_row);
    end if;

    v_action := case tg_op when 'INSERT' then 'Criação' when 'DELETE' then 'Exclusão' else 'Edição' end;
    if tg_op = 'UPDATE' then
      if 'status' = any (v_changed) and (v_row ->> 'status') in ('Cancelada', 'Cancelado') then
        v_action := 'Cancelamento';
      elsif tg_table_name in ('accounts_payable', 'accounts_receivable') and v_changed && array['paid_amount', 'received_amount', 'payment_date', 'received_date'] then
        v_action := 'Baixa de título';
      elsif tg_table_name in ('accounts_payable', 'accounts_receivable') then
        v_action := 'Alteração de título';
      elsif tg_table_name in ('profiles', 'system_users') and v_changed && array['role', 'page_permissions', 'active', 'permissions', 'profile'] then
        v_action := 'Alteração de permissões';
      elsif v_module = 'fiscal' then
        v_action := 'Alteração fiscal';
      elsif tg_table_name = 'system_companies' then
        v_action := 'Alteração de configuração';
      elsif v_changed && array['sale_price', 'cost_price', 'default_price', 'unit_price', 'catalog_price', 'discount_amount', 'discount_percent', 'estimated_cost', 'recurring_value', 'total_value', 'tax_percent', 'freight_amount'] then
        v_action := 'Alteração de preço/desconto';
      end if;
    elsif tg_op = 'INSERT' then
      if tg_table_name = 'stock_movements' then
        v_action := case when (v_row ->> 'movement_type') in ('Ajuste de inventario', 'Perda') then 'Ajuste de estoque' else 'Movimentação de estoque' end;
      elsif tg_table_name in ('profiles', 'system_users') then
        v_action := 'Criação de usuário';
      elsif v_module = 'fiscal' then
        v_action := 'Alteração fiscal';
      end if;
    else
      if v_module = 'fiscal' then
        v_action := 'Alteração fiscal';
      elsif tg_table_name in ('profiles', 'system_users') then
        v_action := 'Exclusão de usuário';
      end if;
    end if;

    v_ref := coalesce(nullif(v_row ->> 'order_number', ''), nullif(v_row ->> 'quote_number', ''), nullif(v_row ->> 'contract_number', ''), nullif(v_row ->> 'code', ''),
                      nullif(v_row ->> 'name', ''), nullif(v_row ->> 'title', ''), nullif(v_row ->> 'fleet_number', ''), nullif(v_row ->> 'plate', ''), nullif(v_row ->> 'description', ''), nullif(v_row ->> 'email', ''), v_id);

    if tg_op = 'UPDATE' and (v_action = 'Cancelamento' or v_changed && array['status_reason', 'refusal_reason', 'loss_reason', 'closed_reason', 'reason']) then
      v_reason := coalesce(nullif(v_row ->> 'status_reason', ''), nullif(v_row ->> 'refusal_reason', ''), nullif(v_row ->> 'loss_reason', ''), nullif(v_row ->> 'closed_reason', ''), nullif(v_row ->> 'reason', ''));
    end if;

    v_company := coalesce(nullif(v_row ->> 'system_company_id', '')::uuid, nullif(hdr ->> 'x-system-company-id', '')::uuid);
    begin
      v_actor := nullif(hdr ->> 'x-audit-actor-id', '')::uuid;
    exception when others then
      v_actor := null;
    end;

    insert into public.audit_events (system_company_id, actor_id, actor_email, module, action, table_name, record_id, description, old_values, new_values, changed_fields, ip_address, session_id, request_id, result, reason, origin)
    values (
      v_company, v_actor, nullif(hdr ->> 'x-audit-actor-email', ''), v_module, v_action, tg_table_name, v_id,
      left(v_action || ' em ' || tg_table_name || ' (' || coalesce(v_ref, v_id) || ')' || case when tg_op = 'UPDATE' then ': ' || array_to_string(v_changed, ', ') else '' end, 300),
      v_old, v_new, case when tg_op = 'UPDATE' then v_changed else null end,
      nullif(hdr ->> 'x-audit-ip', ''), nullif(hdr ->> 'x-audit-session', ''), coalesce(nullif(hdr ->> 'x-audit-request', ''), 'tx-' || txid_current()::text),
      'Sucesso', left(v_reason, 500),
      case coalesce(hdr ->> 'x-audit-origin', 'Sistema') when 'Usuário' then 'Usuário' when 'API' then 'API' when 'Integração' then 'Integração' when 'Agendador' then 'Agendador' else 'Sistema' end
    );
  exception when others then
    -- a auditoria nunca deve derrubar a operação de negócio; a falha fica no log do banco
    raise warning 'audit_row_change(%): %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

-- ===== Tabelas auditadas (só as que existem no banco) =====
do $$
declare
  item text[];
  items text[][] := array[
    ['accounts_payable', 'financeiro'], ['accounts_receivable', 'financeiro'], ['financial_transactions', 'financeiro'], ['bank_accounts', 'financeiro'],
    ['payment_conditions', 'financeiro'], ['financial_categories', 'financeiro'], ['financial_subcategories', 'financeiro'], ['cost_centers', 'financeiro'],
    ['dre_accounts', 'financeiro'], ['category_rules', 'financeiro'], ['credit_cards', 'financeiro'], ['credit_card_invoices', 'financeiro'],
    ['stock_movements', 'estoque'], ['stock_reservations', 'estoque'], ['warehouses', 'estoque'],
    ['materials', 'produtos'], ['service_types', 'produtos'], ['product_compositions', 'produtos'], ['product_composition_items', 'produtos'], ['production_records', 'produtos'],
    ['product_fiscal_rules', 'fiscal'],
    ['service_orders', 'os'], ['service_order_services', 'os'], ['service_order_materials', 'os'], ['service_order_time_entries', 'os'], ['customer_assets', 'os'],
    ['purchase_orders', 'compras'], ['purchase_order_items', 'compras'], ['purchase_receipts', 'compras'],
    ['clients', 'comercial'], ['suppliers', 'comercial'], ['opportunities', 'comercial'], ['salespeople', 'comercial'],
    ['quotes', 'orcamentos'], ['quote_items', 'orcamentos'], ['quote_attachments', 'orcamentos'],
    ['contracts', 'contratos'], ['contract_amendments', 'contratos'], ['contract_obligations', 'contratos'], ['contract_os_plans', 'contratos'], ['contract_documents', 'contratos'], ['contract_billings', 'contratos'],
    ['vehicles', 'frota'], ['fleet_drivers', 'frota'], ['vehicle_maintenance', 'frota'], ['fuel_entries', 'frota'], ['trips', 'frota'], ['vehicle_documents', 'frota'], ['vehicle_tires', 'frota'], ['fleet_settings', 'frota'],
    ['profiles', 'usuarios'], ['system_users', 'usuarios'], ['system_companies', 'configuracoes'], ['providers', 'configuracoes'],
    ['saved_reports', 'relatorios'], ['audit_settings', 'configuracoes']
  ];
begin
  foreach item slice 1 in array items loop
    if to_regclass('public.' || item[1]) is not null then
      execute format('drop trigger if exists audit_row on public.%I', item[1]);
      execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row_change(%L)', item[1], item[2]);
    end if;
  end loop;
end;
$$;
