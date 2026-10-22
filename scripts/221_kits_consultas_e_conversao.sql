-- 221: Kits e composições: conversão de unidades, histórico, snapshots de custo, listagem, detalhes, comparação de versões e salvamento atômico.
-- ADITIVA e idempotente. Requer 217 a 220. Não mexe em dados existentes e não cria movimentação de estoque.
-- Hierarquia: matéria-prima -> kit -> produto final. O kit é lógico: não tem saldo e o consumo só acontece na produção.

-- ---------------------------------------------------------------- Conversão de unidades
-- Conversões padrão (valem para qualquer material) e conversões específicas por material (ex.: 1 BARRA = 6 M).
create table if not exists public.unit_conversions (
  from_unit text not null,
  to_unit text not null,
  factor numeric(18,8) not null check (factor > 0),
  primary key (from_unit, to_unit),
  check (from_unit = upper(from_unit) and to_unit = upper(to_unit) and from_unit <> to_unit)
);
insert into public.unit_conversions (from_unit, to_unit, factor) values
  ('M', 'MM', 1000), ('MM', 'M', 0.001), ('M', 'CM', 100), ('CM', 'M', 0.01), ('CM', 'MM', 10), ('MM', 'CM', 0.1),
  ('KG', 'G', 1000), ('G', 'KG', 0.001), ('L', 'ML', 1000), ('ML', 'L', 0.001), ('M2', 'CM2', 10000), ('CM2', 'M2', 0.0001),
  ('M3', 'L', 1000), ('L', 'M3', 0.001), ('PAR', 'UN', 2), ('UN', 'PAR', 0.5)
on conflict do nothing;

create table if not exists public.material_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  unit text not null check (unit = upper(unit)),
  factor_to_base numeric(18,8) not null check (factor_to_base > 0),       -- 1 <unit> = factor_to_base x unidade-base do material
  notes text,
  unique (material_id, unit)
);

-- Converte uma quantidade entre unidades de um material. Passa sempre pela unidade-base (a do cadastro do item).
create or replace function public.convert_quantity(p_material_id uuid, p_quantity numeric, p_from text, p_to text)
returns numeric
language plpgsql
stable
as $$
declare
  v_base text;
  v_from text := upper(btrim(coalesce(p_from, '')));
  v_to text := upper(btrim(coalesce(p_to, '')));
  v_in_base numeric;
  v_factor numeric;
begin
  if v_from = v_to then
    return p_quantity;
  end if;
  select upper(btrim(unit)) into v_base from public.materials where id = p_material_id;
  if v_base is null then
    raise exception 'Item não encontrado para converter unidades.';
  end if;
  -- origem -> base
  if v_from = v_base then
    v_in_base := p_quantity;
  elsif exists (select 1 from public.material_unit_conversions where material_id = p_material_id and unit = v_from) then
    select p_quantity * factor_to_base into v_in_base from public.material_unit_conversions where material_id = p_material_id and unit = v_from;
  elsif exists (select 1 from public.unit_conversions where from_unit = v_from and to_unit = v_base) then
    select p_quantity * factor into v_in_base from public.unit_conversions where from_unit = v_from and to_unit = v_base;
  else
    raise exception 'Não há conversão de % para % neste material. Cadastre a conversão da unidade.', v_from, v_base;
  end if;
  -- base -> destino
  if v_to = v_base then
    return v_in_base;
  elsif exists (select 1 from public.material_unit_conversions where material_id = p_material_id and unit = v_to) then
    select v_in_base / factor_to_base into v_factor from public.material_unit_conversions where material_id = p_material_id and unit = v_to;
    return v_factor;
  elsif exists (select 1 from public.unit_conversions where from_unit = v_base and to_unit = v_to) then
    select v_in_base * factor into v_factor from public.unit_conversions where from_unit = v_base and to_unit = v_to;
    return v_factor;
  end if;
  raise exception 'Não há conversão de % para % neste material. Cadastre a conversão da unidade.', v_base, v_to;
end;
$$;

-- A unidade do componente precisa ser conversível para a unidade do material (senão o custo e o consumo ficariam errados).
create or replace function public.kit_components_check_unit()
returns trigger
language plpgsql
as $$
begin
  perform public.convert_quantity(new.component_id, 1, new.unit, (select unit from public.materials where id = new.component_id));
  new.unit := upper(btrim(new.unit));
  return new;
end;
$$;
drop trigger if exists trg_kit_components_check_unit on public.kit_components;
create trigger trg_kit_components_check_unit before insert or update of unit, component_id on public.kit_components for each row execute function public.kit_components_check_unit();

-- Custo e explosão passam a respeitar a conversão: quantidade do kit (na unidade escolhida) -> unidade do material x (1 + perda) x custo vigente.
create or replace function public.kit_version_cost(p_version_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_row record;
  v_sub uuid;
begin
  for v_row in
    select c.component_id, c.quantity, c.unit, c.loss_percent, m.item_type, m.unit as base_unit
    from public.kit_components c join public.materials m on m.id = c.component_id
    where c.kit_version_id = p_version_id
  loop
    if v_row.item_type = 'Kit' then
      select id into v_sub from public.kit_versions where kit_id = v_row.component_id and status = 'Ativa';
      v_total := v_total + v_row.quantity * (1 + v_row.loss_percent / 100) * coalesce(public.kit_version_cost(v_sub), 0);
    else
      v_total := v_total + public.convert_quantity(v_row.component_id, v_row.quantity, v_row.unit, v_row.base_unit) * (1 + v_row.loss_percent / 100) * public.material_unit_cost(v_row.component_id);
    end if;
  end loop;
  return round(v_total, 4);
end;
$$;

create or replace function public.explode_kit_version(p_version_id uuid, p_quantity numeric, p_depth integer default 0)
returns table (material_id uuid, required_quantity numeric, unit text)
language plpgsql
stable
as $$
declare
  v_row record;
  v_sub uuid;
begin
  if p_depth > 10 then
    raise exception 'Composição de kits com mais de 10 níveis: verifique referências circulares.';
  end if;
  for v_row in
    select c.component_id, c.quantity, c.unit as comp_unit, c.loss_percent, m.item_type, m.name, m.unit as base_unit
    from public.kit_components c join public.materials m on m.id = c.component_id
    where c.kit_version_id = p_version_id order by c.position
  loop
    if v_row.item_type = 'Kit' then
      select id into v_sub from public.kit_versions where kit_id = v_row.component_id and status = 'Ativa';
      if v_sub is null then
        raise exception 'O subkit % não tem versão ativa.', v_row.name;
      end if;
      return query select * from public.explode_kit_version(v_sub, round(v_row.quantity * (1 + v_row.loss_percent / 100) * p_quantity, 4), p_depth + 1);
    else
      -- a necessidade sai na UNIDADE DO MATERIAL (a do estoque), já convertida e com a perda
      return query select v_row.component_id,
        round(public.convert_quantity(v_row.component_id, v_row.quantity, v_row.comp_unit, v_row.base_unit) * (1 + v_row.loss_percent / 100) * p_quantity, 4), v_row.base_unit;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- Histórico de alterações do kit
create table if not exists public.kit_change_log (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.materials(id) on delete cascade,
  kit_version_id uuid references public.kit_versions(id) on delete set null,
  action text not null,
  description text not null,
  detail jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists kit_change_log_kit_idx on public.kit_change_log (kit_id, changed_at desc);

create or replace function public.request_actor()
returns text
language plpgsql
stable
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  return coalesce(nullif(v_headers ->> 'x-audit-actor-email', ''), nullif(v_headers ->> 'x-audit-actor-id', ''), nullif(current_setting('app.actor', true), ''), 'sistema');
end;
$$;

create or replace function public.kit_log_version_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.kit_change_log (kit_id, kit_version_id, action, description, changed_by)
    values (new.kit_id, new.id, 'versao_criada', 'Versão ' || new.version || ' criada em rascunho.', coalesce(new.created_by, public.request_actor()));
  elsif new.status is distinct from old.status then
    insert into public.kit_change_log (kit_id, kit_version_id, action, description, changed_by)
    values (new.kit_id, new.id, case new.status when 'Ativa' then 'versao_ativada' else 'versao_obsoleta' end,
            case new.status when 'Ativa' then 'Versão ' || new.version || ' ativada (passou a ser a vigente).' else 'Versão ' || new.version || ' marcada como obsoleta (continua guardada).' end, public.request_actor());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_kit_versions_log on public.kit_versions;
create trigger trg_kit_versions_log after insert or update of status on public.kit_versions for each row execute function public.kit_log_version_change();

create or replace function public.kit_log_component_change()
returns trigger
language plpgsql
as $$
declare
  v_version public.kit_versions%rowtype;
  v_name text;
begin
  select * into v_version from public.kit_versions where id = coalesce(new.kit_version_id, old.kit_version_id);
  if not found then
    return null;   -- versão apagada em cascata junto com o kit
  end if;
  select name into v_name from public.materials where id = coalesce(new.component_id, old.component_id);
  if tg_op = 'INSERT' then
    insert into public.kit_change_log (kit_id, kit_version_id, action, description, detail, changed_by)
    values (v_version.kit_id, v_version.id, 'componente_adicionado', 'v' || v_version.version || ': adicionado ' || v_name || ' (' || new.quantity || ' ' || new.unit || ').',
            jsonb_build_object('component_id', new.component_id, 'quantity', new.quantity, 'unit', new.unit, 'loss_percent', new.loss_percent), public.request_actor());
  elsif tg_op = 'UPDATE' then
    insert into public.kit_change_log (kit_id, kit_version_id, action, description, detail, changed_by)
    values (v_version.kit_id, v_version.id, 'componente_alterado', 'v' || v_version.version || ': ' || v_name || ' passou de ' || old.quantity || ' ' || old.unit || ' para ' || new.quantity || ' ' || new.unit || '.',
            jsonb_build_object('component_id', new.component_id, 'before', jsonb_build_object('quantity', old.quantity, 'unit', old.unit, 'loss_percent', old.loss_percent),
                               'after', jsonb_build_object('quantity', new.quantity, 'unit', new.unit, 'loss_percent', new.loss_percent)), public.request_actor());
  else
    insert into public.kit_change_log (kit_id, kit_version_id, action, description, detail, changed_by)
    values (v_version.kit_id, v_version.id, 'componente_removido', 'v' || v_version.version || ': removido ' || v_name || '.', jsonb_build_object('component_id', old.component_id, 'quantity', old.quantity, 'unit', old.unit), public.request_actor());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_kit_components_log on public.kit_components;
create trigger trg_kit_components_log after insert or update or delete on public.kit_components for each row execute function public.kit_log_component_change();

create or replace function public.kit_log_header_change()
returns trigger
language plpgsql
as $$
begin
  if new.item_type = 'Kit' and (new.name, new.category, new.description, new.status, new.internal_code, new.photo_url) is distinct from (old.name, old.category, old.description, old.status, old.internal_code, old.photo_url) then
    insert into public.kit_change_log (kit_id, action, description, detail, changed_by)
    values (new.id, 'cadastro_alterado', 'Dados do kit alterados.', jsonb_build_object('before', jsonb_build_object('name', old.name, 'category', old.category, 'status', old.status, 'sku', old.internal_code),
                                                                                     'after', jsonb_build_object('name', new.name, 'category', new.category, 'status', new.status, 'sku', new.internal_code)), public.request_actor());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_kit_header_log on public.materials;
create trigger trg_kit_header_log after update on public.materials for each row execute function public.kit_log_header_change();

-- ---------------------------------------------------------------- Histórico de estimativas de custo
create table if not exists public.kit_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  kit_version_id uuid not null references public.kit_versions(id) on delete cascade,
  total_cost numeric(14,4) not null,
  components jsonb not null,
  computed_at timestamptz not null default now()
);
create index if not exists kit_cost_snapshots_version_idx on public.kit_cost_snapshots (kit_version_id, computed_at desc);

-- Grava a estimativa atual da versão SE o custo mudou desde a última gravada (assim o histórico mostra a evolução real, sem repetir linhas iguais).
create or replace function public.kit_record_cost_snapshot(p_version_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_cost numeric := public.kit_version_cost(p_version_id);
  v_last numeric;
  v_id uuid := gen_random_uuid();
begin
  select total_cost into v_last from public.kit_cost_snapshots where kit_version_id = p_version_id order by computed_at desc limit 1;
  if v_last is not null and abs(v_last - v_cost) < 0.005 then
    return null;
  end if;
  insert into public.kit_cost_snapshots (id, kit_version_id, total_cost, components)
  select v_id, p_version_id, v_cost, coalesce(jsonb_agg(jsonb_build_object('component_id', c.component_id, 'name', m.name, 'quantity', c.quantity, 'unit', c.unit, 'loss_percent', c.loss_percent,
      'unit_cost', public.material_unit_cost(c.component_id),
      'line_cost', round(public.convert_quantity(c.component_id, c.quantity, c.unit, m.unit) * (1 + c.loss_percent / 100) * public.material_unit_cost(c.component_id), 4)) order by c.position), '[]'::jsonb)
  from public.kit_components c join public.materials m on m.id = c.component_id where c.kit_version_id = p_version_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- Regras extras
-- Produto só vincula kit ATIVO (kit inativo continua consultável, mas não entra em estruturas novas).
create or replace function public.product_kits_validate()
returns trigger
language plpgsql
as $$
declare
  v_bom public.product_bom_versions%rowtype;
  v_kit public.materials%rowtype;
  v_kit_version public.kit_versions%rowtype;
begin
  select * into v_bom from public.product_bom_versions where id = coalesce(new.bom_version_id, old.bom_version_id);
  if v_bom.status <> 'Rascunho' then
    raise exception 'A estrutura versão % do produto está % e não pode ser alterada: crie uma nova versão.', v_bom.version, lower(v_bom.status);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  select * into v_kit from public.materials where id = new.kit_id;
  if v_kit.item_type is distinct from 'Kit' then
    raise exception 'Somente kits podem ser vinculados ao produto (o item informado é %).', coalesce(v_kit.item_type, 'inexistente');
  end if;
  if v_kit.status <> 'Ativo' then
    raise exception 'O kit % está inativo e não pode ser vinculado a um produto.', v_kit.name;
  end if;
  if new.kit_version_id is not null then
    select * into v_kit_version from public.kit_versions where id = new.kit_version_id;
    if v_kit_version.kit_id is distinct from new.kit_id then
      raise exception 'A versão informada não pertence ao kit selecionado.';
    end if;
  end if;
  return new;
end;
$$;

-- Uma versão de kit usada por estrutura de produto ou por ordem de produção nunca é apagada.
create or replace function public.kit_versions_protect_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.production_order_kits where kit_version_id = old.id) or exists (select 1 from public.product_kits where kit_version_id = old.id) then
    raise exception 'A versão % do kit já foi usada em produção ou em estrutura de produto e não pode ser apagada.', old.version;
  end if;
  return old;
end;
$$;
drop trigger if exists trg_kit_versions_protect_delete on public.kit_versions;
create trigger trg_kit_versions_protect_delete before delete on public.kit_versions for each row execute function public.kit_versions_protect_delete();

-- ---------------------------------------------------------------- Consultas da tela
-- Unidades aceitas por um material (a do cadastro, as específicas dele e as padrão convertíveis), com o fator para a unidade do cadastro.
create or replace function public.material_units(p_material_id uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('unit', u.unit, 'factor', u.factor) order by u.unit), '[]'::jsonb) from (
    select upper(btrim(m.unit)) as unit, 1::numeric as factor from public.materials m where m.id = p_material_id
    union select mc.unit, mc.factor_to_base from public.material_unit_conversions mc where mc.material_id = p_material_id
    union select uc.from_unit, uc.factor from public.unit_conversions uc join public.materials m on m.id = p_material_id and uc.to_unit = upper(btrim(m.unit))
      where not exists (select 1 from public.material_unit_conversions x where x.material_id = p_material_id and x.unit = uc.from_unit)) u
$$;

-- Opções de matéria-prima para o seletor da composição: custo vigente, disponibilidade da empresa e as unidades aceitas (com o fator para a unidade do item).
create or replace function public.kit_material_options(p_search text default null, p_limit integer default 20)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.name), '[]'::jsonb) from (
    select m.id, m.internal_code as sku, m.name, m.category, m.unit, public.material_unit_cost(m.id) as unit_cost, av.available,
      public.material_units(m.id) as units
    from public.materials m cross join lateral public.material_availability(m.id) av
    where m.item_type = 'Materia-prima' and m.status = 'Ativo'
      and (p_search is null or btrim(p_search) = '' or m.name ilike '%' || btrim(p_search) || '%' or m.internal_code ilike '%' || btrim(p_search) || '%' or m.category ilike '%' || btrim(p_search) || '%')
    order by (case when lower(m.internal_code) = lower(btrim(coalesce(p_search, ''))) then 0 else 1 end), m.name limit greatest(least(coalesce(p_limit, 20), 100), 1)
  ) t
$$;

-- Componentes de uma versão, com custo e disponibilidade da empresa.
create or replace function public.kit_version_components(p_version_id uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'component_id', c.component_id, 'sku', m.internal_code, 'name', m.name, 'category', m.category, 'item_type', m.item_type, 'status', m.status, 'position', c.position,
    'quantity', c.quantity, 'unit', c.unit, 'loss_percent', c.loss_percent, 'notes', c.notes, 'material_unit', m.unit,
    'quantity_in_material_unit', round(public.convert_quantity(c.component_id, c.quantity, c.unit, m.unit), 6),
    'required_with_loss', round(public.convert_quantity(c.component_id, c.quantity, c.unit, m.unit) * (1 + c.loss_percent / 100), 6),
    'unit_cost', public.material_unit_cost(c.component_id), 'units', public.material_units(c.component_id),
    'line_cost', round(public.convert_quantity(c.component_id, c.quantity, c.unit, m.unit) * (1 + c.loss_percent / 100) * public.material_unit_cost(c.component_id), 4),
    'available', (select available from public.material_availability(c.component_id))) order by c.position, m.name), '[]'::jsonb)
  from public.kit_components c join public.materials m on m.id = c.component_id where c.kit_version_id = p_version_id
$$;

-- Lista paginada de kits (versão vigente, quantidade de matérias-primas, custo, produtos que usam e última alteração).
create or replace function public.kit_list(p_search text default null, p_status text default null, p_category text default null, p_order text default 'name', p_desc boolean default false, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, sku text, name text, category text, status text, photo_url text, updated_at timestamptz, version_id uuid, version integer, version_status text,
               components_count integer, cost numeric, products_count integer, last_change timestamptz, total_count bigint)
language sql
stable
as $$
  with base as (
    select m.id, m.internal_code as sku, m.name, m.category, m.status, m.photo_url, m.updated_at,
           cv.id as version_id, cv.version, cv.status as version_status,
           (select count(*)::integer from public.kit_components kc where kc.kit_version_id = cv.id) as components_count,
           case when cv.id is null then 0 else public.kit_version_cost(cv.id) end as cost,
           (select count(distinct bv.product_id)::integer from public.product_kits pk join public.product_bom_versions bv on bv.id = pk.bom_version_id where pk.kit_id = m.id and bv.status = 'Ativa') as products_count,
           greatest(m.updated_at, (select max(l.changed_at) from public.kit_change_log l where l.kit_id = m.id)) as last_change
    from public.materials m
    left join lateral (select v.id, v.version, v.status from public.kit_versions v where v.kit_id = m.id order by (v.status = 'Ativa') desc, v.version desc limit 1) cv on true
    where m.item_type = 'Kit'
      and (p_status is null or p_status = '' or m.status = p_status)
      and (p_category is null or p_category = '' or m.category = p_category)
      and (p_search is null or btrim(p_search) = '' or m.name ilike '%' || btrim(p_search) || '%' or m.internal_code ilike '%' || btrim(p_search) || '%' or m.category ilike '%' || btrim(p_search) || '%')
  )
  select b.id, b.sku, b.name, b.category, b.status, b.photo_url, b.updated_at, b.version_id, b.version, b.version_status, b.components_count, b.cost, b.products_count, b.last_change, count(*) over ()
  from base b
  order by
    case when p_order = 'name' and not p_desc then lower(b.name) end asc, case when p_order = 'name' and p_desc then lower(b.name) end desc,
    case when p_order = 'sku' and not p_desc then lower(b.sku) end asc, case when p_order = 'sku' and p_desc then lower(b.sku) end desc,
    case when p_order = 'cost' and not p_desc then b.cost end asc, case when p_order = 'cost' and p_desc then b.cost end desc,
    case when p_order = 'products' and not p_desc then b.products_count end asc, case when p_order = 'products' and p_desc then b.products_count end desc,
    case when p_order = 'updated' and not p_desc then b.last_change end asc, case when p_order = 'updated' and p_desc then b.last_change end desc,
    lower(b.name)
  limit greatest(least(coalesce(p_limit, 25), 200), 1) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Detalhes do kit: cadastro, versões, componentes da versão escolhida (ou da vigente), produtos que o usam, custos, histórico.
create or replace function public.kit_detail(p_kit_id uuid, p_version_id uuid default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_kit jsonb;
  v_current uuid;
  v_shown uuid;
begin
  select to_jsonb(m) into v_kit from public.materials m where m.id = p_kit_id and m.item_type = 'Kit';
  if v_kit is null then
    raise exception 'Kit não encontrado.';
  end if;
  select id into v_current from public.kit_versions where kit_id = p_kit_id order by (status = 'Ativa') desc, version desc limit 1;
  v_shown := coalesce(p_version_id, v_current);
  if v_shown is not null and not exists (select 1 from public.kit_versions where id = v_shown and kit_id = p_kit_id) then
    raise exception 'A versão informada não pertence a este kit.';
  end if;
  return jsonb_build_object(
    'kit', v_kit,
    'current_version_id', v_current,
    'shown_version_id', v_shown,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status, 'composition_kind', v.composition_kind, 'notes', v.notes, 'created_by', v.created_by,
        'created_at', v.created_at, 'activated_at', v.activated_at, 'components_count', (select count(*) from public.kit_components c where c.kit_version_id = v.id),
        'cost', public.kit_version_cost(v.id),
        'used_in_production', exists (select 1 from public.production_order_kits p where p.kit_version_id = v.id),
        'used_by_products', (select count(distinct pk.bom_version_id) from public.product_kits pk where pk.kit_version_id = v.id)) order by v.version desc)
      from public.kit_versions v where v.kit_id = p_kit_id), '[]'::jsonb),
    'components', case when v_shown is null then '[]'::jsonb else public.kit_version_components(v_shown) end,
    'cost', case when v_shown is null then 0 else public.kit_version_cost(v_shown) end,
    'products', coalesce((select jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.internal_code, 'name', p.name, 'status', p.status, 'bom_version_id', bv.id, 'bom_version', bv.version, 'bom_status', bv.status,
        'quantity', pk.quantity, 'pinned_kit_version', kv.version, 'follows_active', pk.kit_version_id is null) order by p.name, bv.version desc)
      from public.product_kits pk join public.product_bom_versions bv on bv.id = pk.bom_version_id join public.materials p on p.id = bv.product_id
      left join public.kit_versions kv on kv.id = pk.kit_version_id where pk.kit_id = p_kit_id and bv.status <> 'Obsoleta'), '[]'::jsonb),
    'cost_history', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'total_cost', s.total_cost, 'computed_at', s.computed_at, 'version', v.version) order by s.computed_at desc)
      from (select * from public.kit_cost_snapshots where kit_version_id in (select id from public.kit_versions where kit_id = p_kit_id) order by computed_at desc limit 40) s
      join public.kit_versions v on v.id = s.kit_version_id), '[]'::jsonb),
    'change_log', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'description', l.description, 'detail', l.detail, 'changed_by', l.changed_by, 'changed_at', l.changed_at,
        'version', (select version from public.kit_versions where id = l.kit_version_id)) order by l.changed_at desc)
      from (select * from public.kit_change_log where kit_id = p_kit_id order by changed_at desc limit 100) l), '[]'::jsonb),
    'used_in_production', exists (select 1 from public.production_order_kits p join public.kit_versions kv on kv.id = p.kit_version_id where kv.kit_id = p_kit_id)
  );
end;
$$;

-- Comparação entre duas versões do mesmo kit: o que entrou, saiu ou mudou (quantidade, unidade ou perda) e o efeito no custo.
create or replace function public.kit_compare_versions(p_version_a uuid, p_version_b uuid)
returns table (material_id uuid, sku text, name text, qty_a numeric, unit_a text, loss_a numeric, qty_b numeric, unit_b text, loss_b numeric, cost_a numeric, cost_b numeric, change text)
language sql
stable
as $$
  with a as (
    select c.component_id, c.quantity, c.unit, c.loss_percent,
           round(public.convert_quantity(c.component_id, c.quantity, c.unit, m.unit) * (1 + c.loss_percent / 100) * public.material_unit_cost(c.component_id), 4) as cost
    from public.kit_components c join public.materials m on m.id = c.component_id where c.kit_version_id = p_version_a
  ), b as (
    select c.component_id, c.quantity, c.unit, c.loss_percent,
           round(public.convert_quantity(c.component_id, c.quantity, c.unit, m.unit) * (1 + c.loss_percent / 100) * public.material_unit_cost(c.component_id), 4) as cost
    from public.kit_components c join public.materials m on m.id = c.component_id where c.kit_version_id = p_version_b
  )
  select coalesce(a.component_id, b.component_id), m.internal_code, m.name, a.quantity, a.unit, a.loss_percent, b.quantity, b.unit, b.loss_percent, coalesce(a.cost, 0), coalesce(b.cost, 0),
         case when a.component_id is null then 'adicionado' when b.component_id is null then 'removido'
              when (a.quantity, a.unit, a.loss_percent) is distinct from (b.quantity, b.unit, b.loss_percent) then 'alterado' else 'igual' end
  from a full join b on b.component_id = a.component_id join public.materials m on m.id = coalesce(a.component_id, b.component_id)
  order by m.name
$$;

-- ---------------------------------------------------------------- Salvar kit (cadastro + composição) de uma vez, atômico
-- p: { kit_id?, name, sku?, auto_sku, category, description, status, photo_url, version_id? (rascunho a editar), base_version_id? (copiar de), notes,
--      components: [{ component_id, quantity, unit, loss_percent, notes }] (omitido = só o cadastro), activate: boolean }
-- Nunca altera versão ativa/obsoleta: editar a composição de um kit com versão vigente cria uma NOVA versão em rascunho. Nenhuma movimentação de estoque é criada.
create or replace function public.kit_save(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_kit uuid := nullif(p->>'kit_id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_sku text;
  v_version uuid := nullif(p->>'version_id', '')::uuid;
  v_status text;
  v_next integer;
  v_item jsonb;
  v_position integer := 0;
  v_activate boolean := coalesce((p->>'activate')::boolean, false);
  v_has_components boolean := p ? 'components' and jsonb_typeof(p->'components') = 'array';
  v_created boolean := false;
  v_seen uuid[] := '{}';
  v_component uuid;
  v_ver public.kit_versions%rowtype;
begin
  if length(v_name) < 3 then
    raise exception 'Informe o nome do kit (mínimo 3 letras).';
  end if;
  if v_has_components and jsonb_array_length(p->'components') = 0 then
    raise exception 'Adicione ao menos uma matéria-prima à composição do kit.';
  end if;

  if v_kit is null then
    v_sku := case when coalesce((p->>'auto_sku')::boolean, true) or coalesce(btrim(p->>'sku'), '') = '' then public.next_item_sku('Kit') else btrim(p->>'sku') end;
    insert into public.materials (name, unit, item_type, internal_code, category, description, status, photo_url, controls_stock, allows_sale, sale_price)
    values (v_name, 'UN', 'Kit', v_sku, nullif(btrim(p->>'category'), ''), nullif(btrim(p->>'description'), ''), coalesce(nullif(p->>'status', ''), 'Ativo'), nullif(p->>'photo_url', ''), false, false, 0)
    returning id into v_kit;
    v_created := true;
  else
    if not exists (select 1 from public.materials where id = v_kit and item_type = 'Kit') then
      raise exception 'Kit não encontrado.';
    end if;
    update public.materials set name = v_name, category = nullif(btrim(p->>'category'), ''), description = nullif(btrim(p->>'description'), ''),
           status = coalesce(nullif(p->>'status', ''), status), photo_url = nullif(p->>'photo_url', ''), updated_at = now()
    where id = v_kit;
    if nullif(btrim(p->>'sku'), '') is not null then
      update public.materials set internal_code = btrim(p->>'sku') where id = v_kit and internal_code is distinct from btrim(p->>'sku');
    end if;
  end if;

  if v_has_components then
    -- componentes repetidos são erro de digitação: a mesma matéria-prima aparece uma única vez por versão
    for v_item in select * from jsonb_array_elements(p->'components') loop
      v_component := (v_item->>'component_id')::uuid;
      if v_component = any(v_seen) then
        raise exception 'A matéria-prima % aparece mais de uma vez na composição.', (select name from public.materials where id = v_component);
      end if;
      v_seen := v_seen || v_component;
    end loop;
    if v_version is not null then
      select * into v_ver from public.kit_versions where id = v_version and kit_id = v_kit;
      if not found then
        raise exception 'A versão informada não pertence a este kit.';
      end if;
      if v_ver.status <> 'Rascunho' then
        raise exception 'A versão % está % e não pode ser alterada: salve como nova versão.', v_ver.version, lower(v_ver.status);
      end if;
      delete from public.kit_components where kit_version_id = v_version;
      update public.kit_versions set notes = nullif(btrim(p->>'notes'), '') where id = v_version;
    else
      select coalesce(max(version), 0) + 1 into v_next from public.kit_versions where kit_id = v_kit;
      insert into public.kit_versions (kit_id, version, status, notes, created_by)
      values (v_kit, v_next, 'Rascunho', nullif(btrim(p->>'notes'), ''), public.request_actor()) returning id into v_version;
    end if;
    for v_item in select * from jsonb_array_elements(p->'components') loop
      insert into public.kit_components (kit_version_id, component_id, position, quantity, unit, loss_percent, notes)
      values (v_version, (v_item->>'component_id')::uuid, v_position, (v_item->>'quantity')::numeric, coalesce(nullif(v_item->>'unit', ''), (select unit from public.materials where id = (v_item->>'component_id')::uuid)),
              coalesce(nullif(v_item->>'loss_percent', '')::numeric, 0), nullif(v_item->>'notes', ''));
      v_position := v_position + 1;
    end loop;
    if v_activate then
      perform public.kit_activate_version(v_version);
    end if;
    perform public.kit_record_cost_snapshot(v_version);
    select status into v_status from public.kit_versions where id = v_version;
  end if;

  return jsonb_build_object('kit_id', v_kit, 'created', v_created, 'version_id', v_version, 'version_status', v_status,
                            'sku', (select internal_code from public.materials where id = v_kit), 'version', (select version from public.kit_versions where id = v_version));
end;
$$;

-- ---------------------------------------------------------------- Acesso (catálogo compartilhado, como `materials`)
do $$
declare
  table_name text;
begin
  foreach table_name in array array['unit_conversions', 'material_unit_conversions', 'kit_change_log', 'kit_cost_snapshots'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format('create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end;
$$;
