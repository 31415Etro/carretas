-- 238 — Cadastros sem travas: kit, matéria-prima e produto só precisam de um nome para serem salvos.
--  * Kit: não tem dado fiscal nem preço; pode ser salvo sem matéria-prima (rascunho) e a composição é preenchida depois (ativar continua exigindo ao menos uma matéria-prima).
--  * Matéria-prima: NCM, preço de venda, unidade e fornecedores são opcionais; "disponível para venda" sem preço vira consumo interno e NCM com formato inválido é ignorado (em vez de recusar o cadastro).
--  * Produto: preço, NCM (sem confirmação) e estrutura são opcionais; sem kits o produto fica só cadastrado; kit repetido conta uma vez; quantidade vazia vira 1; kit sem versão ativa pode ser vinculado
--    (quem fecha a venda continua sendo avisado de que o produto precisa de estrutura para ir à produção).
-- Rode no SQL Editor do Supabase. Não apaga dados; só troca funções.

create or replace function public.materials_validate_by_type()
returns trigger
language plpgsql
as $$
begin
  if new.item_type = 'Kit' then
    new.allows_sale := false;
    new.sale_price := 0;
  end if;
  if new.item_type = 'Materia-prima' then
    -- a coluna allows_sale nasce ligada nos cadastros antigos: na criação, sem nenhum dado comercial informado, a matéria-prima nasce como consumo interno
    if tg_op = 'INSERT' and coalesce(new.allows_sale, false) and coalesce(new.sale_price, 0) = 0 and coalesce(btrim(new.ncm), '') = '' then
      new.allows_sale := false;
    end if;
    if coalesce(new.allows_sale, false) then
      -- sem travas: "disponível para venda" só vale quando há preço; sem preço o item segue como consumo interno
      if coalesce(new.sale_price, 0) <= 0 then
        new.allows_sale := false;
        new.sale_price := 0;
      end if;
    else
      new.allows_sale := false;
      new.sale_price := 0;
    end if;
  end if;
  -- NCM é opcional: só é guardado quando tem 8 dígitos
  if new.ncm is not null and btrim(new.ncm) <> '' and regexp_replace(new.ncm, '\D', '', 'g') !~ '^\d{8}$' then
    new.ncm := null;
  end if;
  return new;
end;
$$;

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
  if v_name = '' then
    raise exception 'Informe o nome do kit.';
  end if;
  -- kit sem matéria-prima é aceito (rascunho vazio); a composição pode ser preenchida depois
  if v_has_components and jsonb_array_length(p->'components') = 0 then
    if v_version is not null then
      delete from public.kit_components where kit_version_id = v_version and exists (select 1 from public.kit_versions where id = v_version and kit_id = v_kit and status = 'Rascunho');
    end if;
    v_has_components := false;
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

create or replace function public.product_save(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_product uuid := nullif(p->>'product_id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_sku text;
  v_specs jsonb := coalesce(p->'specs', '{}'::jsonb);
  v_structure jsonb := p->'structure';
  v_has_structure boolean := p ? 'structure' and jsonb_typeof(p->'structure') = 'object';
  v_version uuid;
  v_new_version boolean := false;
  v_item jsonb;
  v_kit public.materials%rowtype;
  v_kit_version uuid;
  v_position integer := 0;
  v_next integer;
  v_seen uuid[] := '{}';
  v_created boolean := false;
  v_ncm text := regexp_replace(coalesce(p->>'ncm', ''), '\D', '', 'g');
  v_confirmed boolean := coalesce((p->>'ncm_confirmed')::boolean, false);
  v_old_ncm text;
  v_price numeric := coalesce(nullif(p->>'sale_price', '')::numeric, 0);
  v_allows_sale boolean := coalesce((p->>'allows_sale')::boolean, true);
  v_ver public.product_bom_versions%rowtype;
  v_has_versions boolean := false;
  v_status text;
  v_attrs jsonb := coalesce(p->'attributes', '{}'::jsonb);
  v_unit text := upper(btrim(coalesce(nullif(p->>'unit', ''), 'UN')));
begin
  if v_name = '' then
    raise exception 'Informe o nome comercial do produto.';
  end if;
  if v_price < 0 then
    raise exception 'O preço de venda não pode ser negativo.';
  end if;
  -- sem travas: sem preço o produto não fica disponível para venda (continua cadastrado) e NCM inválido é ignorado
  v_allows_sale := v_allows_sale and v_price > 0;
  if v_ncm !~ '^\d{8}$' then
    v_ncm := '';
  end if;

  if v_product is null then
    v_sku := case when coalesce((p->>'auto_sku')::boolean, true) or coalesce(btrim(p->>'sku'), '') = '' then public.next_item_sku('Produto') else btrim(p->>'sku') end;
    insert into public.materials (name, unit, item_type, internal_code, status, controls_stock, allows_sale, sale_price) values (v_name, v_unit, 'Produto', v_sku, coalesce(nullif(p->>'status', ''), 'Ativo'), true, v_allows_sale, v_price)
    returning id into v_product;
    v_created := true;
  else
    select ncm into v_old_ncm from public.materials where id = v_product and item_type = 'Produto';
    if not found then
      raise exception 'Produto não encontrado.';
    end if;
    if nullif(btrim(p->>'sku'), '') is not null then
      update public.materials set internal_code = btrim(p->>'sku') where id = v_product and internal_code is distinct from btrim(p->>'sku');
    end if;
  end if;

  update public.materials set
    name = v_name, unit = v_unit, status = coalesce(nullif(p->>'status', ''), status), category = nullif(btrim(p->>'category'), ''), product_model = nullif(btrim(p->>'model'), ''),
    product_line = nullif(btrim(p->>'product_line'), ''), description = nullif(btrim(p->>'description'), ''), photo_url = nullif(p->>'photo_url', ''), technical_sheet_url = nullif(p->>'technical_sheet_url', ''),
    internal_ref = nullif(btrim(p->>'internal_ref'), ''),
    length = coalesce(nullif(v_specs->>'length', '')::numeric, 0), width = coalesce(nullif(v_specs->>'width', '')::numeric, 0), height = coalesce(nullif(v_specs->>'height', '')::numeric, 0),
    net_weight = coalesce(nullif(v_specs->>'net_weight', '')::numeric, 0), gross_weight = coalesce(nullif(v_specs->>'gross_weight', '')::numeric, 0),
    payload_capacity = nullif(v_specs->>'payload_capacity', '')::numeric, axle_count = nullif(v_specs->>'axle_count', '')::integer, finish_type = nullif(btrim(v_specs->>'finish_type'), ''),
    structural_notes = nullif(btrim(v_specs->>'structural_notes'), ''), engineering_notes = nullif(btrim(v_specs->>'engineering_notes'), ''), product_attributes = v_attrs,
    sale_price = v_price, allows_sale = v_allows_sale, lead_time_days = nullif(p->>'lead_time_days', '')::integer, warranty_months = coalesce(nullif(p->>'warranty_months', '')::integer, 0),
    available_for_quote = coalesce((p->>'available_for_quote')::boolean, true), make_to_order = coalesce((p->>'make_to_order')::boolean, false), updated_at = now()
  where id = v_product;

  -- NCM do produto final: próprio, confirmado por uma pessoa; nunca copiado das matérias-primas
  if v_ncm = '' then
    update public.materials set ncm = null, ncm_description = null, ncm_source = null, ncm_valid_from = null, ncm_confirmed_by = null, ncm_confirmed_at = null where id = v_product;
  elsif v_created or coalesce(regexp_replace(v_old_ncm, '\D', '', 'g'), '') is distinct from v_ncm then
    update public.materials set ncm = v_ncm, ncm_description = nullif(p->>'ncm_description', ''), ncm_source = coalesce(nullif(p->>'ncm_source', ''), 'Informado manualmente'),
           ncm_valid_from = nullif(p->>'ncm_valid_from', '')::date, ncm_confirmed_by = coalesce(nullif(p->>'user', ''), public.request_actor()), ncm_confirmed_at = now() where id = v_product;
  end if;

  if p ? 'documents' and jsonb_typeof(p->'documents') = 'array' then
    delete from public.product_documents where product_id = v_product;
    insert into public.product_documents (product_id, name, url, kind, uploaded_by)
    select v_product, btrim(d->>'name'), d->>'url', coalesce(nullif(d->>'kind', ''), 'Outro'), coalesce(nullif(p->>'user', ''), public.request_actor()) from jsonb_array_elements(p->'documents') d where coalesce(btrim(d->>'url'), '') <> '';
  end if;

  -- produto sem kits é aceito (a estrutura é preenchida depois); kit repetido conta uma vez só
  if v_has_structure and (jsonb_typeof(v_structure->'kits') <> 'array' or jsonb_array_length(v_structure->'kits') = 0) then
    v_has_structure := false;
  end if;
  if v_has_structure then
    v_structure := jsonb_set(v_structure, '{kits}', coalesce((select jsonb_agg(e.item order by e.pos) from (select distinct on (t.item->>'kit_id') t.item, t.pos from jsonb_array_elements(v_structure->'kits') with ordinality t(item, pos) order by t.item->>'kit_id', t.pos) e), '[]'::jsonb));
    select exists (select 1 from public.product_bom_versions where product_id = v_product) into v_has_versions;
    v_version := nullif(v_structure->>'version_id', '')::uuid;
    if v_version is not null then
      select * into v_ver from public.product_bom_versions where id = v_version and product_id = v_product;
      if not found then
        raise exception 'A versão informada não pertence a este produto.';
      end if;
      if v_ver.status <> 'Rascunho' then
        raise exception 'A estrutura versão % está % e não pode ser alterada: salve como nova versão.', v_ver.version, lower(v_ver.status);
      end if;
      delete from public.product_kits where bom_version_id = v_version;
      update public.product_bom_versions set labor_cost = coalesce(nullif(v_structure->>'labor_cost', '')::numeric, 0), labor_minutes = coalesce(nullif(v_structure->>'labor_minutes', '')::integer, 0),
        overhead_cost = coalesce(nullif(v_structure->>'overhead_cost', '')::numeric, 0), other_cost = coalesce(nullif(v_structure->>'other_cost', '')::numeric, 0),
        estimated_production_days = coalesce(nullif(v_structure->>'estimated_days', '')::integer, 0), notes = nullif(btrim(v_structure->>'notes'), ''),
        change_reason = coalesce(nullif(btrim(v_structure->>'change_reason'), ''), change_reason) where id = v_version;
    else
      select coalesce(max(version), 0) + 1 into v_next from public.product_bom_versions where product_id = v_product;
      insert into public.product_bom_versions (product_id, version, status, labor_cost, labor_minutes, overhead_cost, other_cost, estimated_production_days, notes, change_reason, created_by)
      values (v_product, v_next, 'Rascunho', coalesce(nullif(v_structure->>'labor_cost', '')::numeric, 0), coalesce(nullif(v_structure->>'labor_minutes', '')::integer, 0),
              coalesce(nullif(v_structure->>'overhead_cost', '')::numeric, 0), coalesce(nullif(v_structure->>'other_cost', '')::numeric, 0), coalesce(nullif(v_structure->>'estimated_days', '')::integer, 0),
              nullif(btrim(v_structure->>'notes'), ''), coalesce(nullif(btrim(v_structure->>'change_reason'), ''), 'Estrutura inicial'), coalesce(nullif(p->>'user', ''), public.request_actor()))
      returning id into v_version;
      v_new_version := true;
    end if;
    for v_item in select * from jsonb_array_elements(v_structure->'kits') loop
      select * into v_kit from public.materials where id = (v_item->>'kit_id')::uuid;
      if not found or v_kit.item_type <> 'Kit' then
        raise exception 'Somente kits cadastrados podem compor a estrutura do produto.';
      end if;
      v_kit_version := null;
      if coalesce((v_item->>'pin_version')::boolean, false) then
        select id into v_kit_version from public.kit_versions where kit_id = v_kit.id and status = 'Ativa';
      end if;
      insert into public.product_kits (bom_version_id, kit_id, kit_version_id, quantity, position, notes)
      values (v_version, v_kit.id, v_kit_version, case when coalesce(nullif(v_item->>'quantity', '')::numeric, 0) > 0 then (v_item->>'quantity')::numeric else 1 end, v_position, nullif(v_item->>'notes', ''));
      v_position := v_position + 1;
    end loop;
    if coalesce((v_structure->>'activate')::boolean, false) then
      perform public.product_activate_version(v_version, nullif(p->>'user', ''));
    else
      perform public.product_record_cost_snapshot(v_version);
    end if;
    select status into v_status from public.product_bom_versions where id = v_version;
  end if;

  return jsonb_build_object('product_id', v_product, 'created', v_created, 'sku', (select internal_code from public.materials where id = v_product), 'version_id', v_version,
                            'version', (select version from public.product_bom_versions where id = v_version), 'version_status', v_status);
end;
$$;
