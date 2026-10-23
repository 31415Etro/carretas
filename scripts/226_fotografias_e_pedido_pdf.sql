-- 226: Fotografias persistentes dos produtos e documento do pedido de venda (PDF versionado).
-- ADITIVA e idempotente. Requer 217 a 224 (não depende do 225). Não apaga nada: fotografias antigas só ganham um registro de auditoria
-- (status "Pendente de verificacao") e a coluna materials.photo_url continua como estava até a verificação confirmar que o arquivo existe.
-- Fotografias = catálogo COMPARTILHADO (como materials). Documento do pedido = dado da EMPRESA e IMUTÁVEL (nova emissão = nova versão).

-- ================================================================ 1. Fotografias do produto (caminho definitivo no armazenamento, nunca URL temporária)
create table if not exists public.product_photos (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete restrict,
  bucket text,
  path text,                             -- caminho definitivo no armazenamento (ex.: <produto>/<uuid>.jpg)
  legacy_url text,                       -- URL antiga encontrada no cadastro, guardada só para auditoria
  original_name text,
  mime_type text,
  size_bytes bigint,
  purpose text not null default 'comercial' check (purpose in ('comercial', 'detalhe', 'configuracao')),
  caption text,
  is_main boolean not null default false,
  position integer not null default 0,
  status text not null default 'Disponivel' check (status in ('Pendente de verificacao', 'Disponivel', 'Indisponivel', 'Removida')),
  verify_note text,
  verified_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  removed_by text,
  removed_at timestamptz,
  removed_reason text,
  check (path is not null or legacy_url is not null)
);
create unique index if not exists product_photos_path_uidx on public.product_photos (bucket, path) where path is not null and status <> 'Removida';
create unique index if not exists product_photos_main_uidx on public.product_photos (material_id) where is_main and status in ('Disponivel', 'Pendente de verificacao');
create index if not exists product_photos_material_idx on public.product_photos (material_id, position);

-- URL estável e independente do endereço do armazenamento: a aplicação resolve o arquivo pelo registro.
create or replace function public.product_photo_url(p_photo uuid)
returns text
language sql
immutable
as $$ select '/api/produtos/foto/' || p_photo::text $$;

-- Mantém materials.photo_url (usada pelas listas) apontando para a fotografia principal disponível.
create or replace function public.product_photo_sync(p_material uuid)
returns void
language plpgsql
as $$
declare
  v_main uuid;
  v_pending boolean;
  v_any boolean;
begin
  if not exists (select 1 from public.materials where id = p_material and item_type = 'Produto') then
    return;
  end if;
  select id into v_main from public.product_photos where material_id = p_material and is_main and status = 'Disponivel';
  if v_main is not null then
    update public.materials set photo_url = public.product_photo_url(v_main) where id = p_material and photo_url is distinct from public.product_photo_url(v_main);
    return;
  end if;
  select exists (select 1 from public.product_photos where material_id = p_material and status = 'Pendente de verificacao') into v_pending;
  select exists (select 1 from public.product_photos where material_id = p_material) into v_any;
  -- só limpa a referência quebrada; o registro da foto antiga continua na auditoria
  if v_any and not v_pending then
    update public.materials set photo_url = null where id = p_material and photo_url is not null;
  end if;
end;
$$;

create or replace function public.product_photos_after()
returns trigger
language plpgsql
as $$
begin
  perform public.product_photo_sync(new.material_id);
  return null;
end;
$$;
drop trigger if exists trg_product_photos_after on public.product_photos;
create trigger trg_product_photos_after after insert or update on public.product_photos for each row execute function public.product_photos_after();

create or replace function public.product_photos_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Fotografias não são apagadas do cadastro: use a remoção controlada.';
  end if;
  if (to_jsonb(new) - 'is_main' - 'position' - 'status' - 'caption' - 'purpose' - 'verify_note' - 'verified_at' - 'removed_by' - 'removed_at' - 'removed_reason')
     is distinct from (to_jsonb(old) - 'is_main' - 'position' - 'status' - 'caption' - 'purpose' - 'verify_note' - 'verified_at' - 'removed_by' - 'removed_at' - 'removed_reason') then
    raise exception 'O arquivo e a origem da fotografia não podem ser alterados: envie uma nova fotografia.';
  end if;
  if old.status = 'Removida' and new.status <> 'Removida' then
    raise exception 'Fotografia removida não volta: envie novamente.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_product_photos_guard on public.product_photos;
create trigger trg_product_photos_guard before update or delete on public.product_photos for each row execute function public.product_photos_guard();

-- O formulário do produto pode reenviar a foto antiga: com uma principal disponível, a coluna sempre aponta para ela.
create or replace function public.materials_photo_guard()
returns trigger
language plpgsql
as $$
declare
  v_main uuid;
begin
  if new.item_type = 'Produto' and new.photo_url is distinct from old.photo_url then
    select id into v_main from public.product_photos where material_id = new.id and is_main and status = 'Disponivel';
    if v_main is not null then
      new.photo_url := public.product_photo_url(v_main);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_materials_photo_guard on public.materials;
create trigger trg_materials_photo_guard before update of photo_url on public.materials for each row execute function public.materials_photo_guard();

create or replace function public.product_photo_add(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_material uuid := (p->>'material_id')::uuid;
  v_id uuid := gen_random_uuid();
  v_has_main boolean;
  v_make_main boolean := coalesce((p->>'make_main')::boolean, false);
  v_position integer;
begin
  if not exists (select 1 from public.materials where id = v_material and item_type = 'Produto') then
    raise exception 'Produto não encontrado.';
  end if;
  if coalesce(btrim(p->>'path'), '') = '' or coalesce(btrim(p->>'bucket'), '') = '' then
    raise exception 'Informe o caminho do arquivo no armazenamento.';
  end if;
  if (p->>'path') ~* '^(blob:|data:|file:|[a-z]:\\)' or (p->>'path') ~* '^https?://' then
    raise exception 'Guarde o caminho do arquivo no armazenamento, não uma URL temporária ou local.';
  end if;
  select exists (select 1 from public.product_photos where material_id = v_material and is_main and status in ('Disponivel', 'Pendente de verificacao')) into v_has_main;
  select coalesce(max(position), 0) + 1 into v_position from public.product_photos where material_id = v_material and status <> 'Removida';
  if v_make_main and v_has_main then
    update public.product_photos set is_main = false where material_id = v_material and is_main;
    v_has_main := false;
  end if;
  insert into public.product_photos (id, material_id, bucket, path, original_name, mime_type, size_bytes, purpose, caption, is_main, position, status, verified_at, verify_note, created_by)
  values (v_id, v_material, p->>'bucket', p->>'path', nullif(btrim(p->>'original_name'), ''), nullif(p->>'mime_type', ''), nullif(p->>'size_bytes', '')::bigint,
          coalesce(nullif(p->>'purpose', ''), 'comercial'), nullif(btrim(p->>'caption'), ''), not v_has_main, v_position, 'Disponivel', now(), 'Envio confirmado no armazenamento.', coalesce(p_user, public.request_actor()));
  return jsonb_build_object('id', v_id, 'url', public.product_photo_url(v_id), 'is_main', not v_has_main, 'position', v_position);
end;
$$;

create or replace function public.product_photo_set_main(p_photo uuid, p_user text default null)
returns void
language plpgsql
as $$
declare
  v_photo public.product_photos%rowtype;
begin
  select * into v_photo from public.product_photos where id = p_photo for update;
  if not found then
    raise exception 'Fotografia não encontrada.';
  end if;
  if v_photo.status <> 'Disponivel' then
    raise exception 'Só uma fotografia disponível pode ser a principal (situação: %).', v_photo.status;
  end if;
  update public.product_photos set is_main = false where material_id = v_photo.material_id and is_main and id <> p_photo;
  update public.product_photos set is_main = true where id = p_photo;
end;
$$;

create or replace function public.product_photo_reorder(p_material uuid, p_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_active uuid[];
  v_i integer;
begin
  select coalesce(array_agg(id order by id), '{}') into v_active from public.product_photos where material_id = p_material and status <> 'Removida';
  if (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) is distinct from v_active then
    raise exception 'A nova ordem precisa conter exatamente as fotografias atuais do produto.';
  end if;
  for v_i in 1..coalesce(array_length(p_ids, 1), 0) loop
    update public.product_photos set position = v_i where id = p_ids[v_i];
  end loop;
end;
$$;

create or replace function public.product_photo_update(p_photo uuid, p jsonb)
returns void
language plpgsql
as $$
begin
  update public.product_photos set caption = case when p ? 'caption' then nullif(btrim(p->>'caption'), '') else caption end,
         purpose = coalesce(nullif(p->>'purpose', ''), purpose) where id = p_photo and status <> 'Removida';
  if not found then
    raise exception 'Fotografia não encontrada.';
  end if;
end;
$$;

-- Remoção controlada: o registro e o arquivo ficam guardados (nada é apagado); a foto só deixa de aparecer. Se era a principal, a próxima disponível assume.
create or replace function public.product_photo_remove(p_photo uuid, p_reason text, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_photo public.product_photos%rowtype;
  v_next uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo da remoção.';
  end if;
  select * into v_photo from public.product_photos where id = p_photo for update;
  if not found or v_photo.status = 'Removida' then
    raise exception 'Fotografia não encontrada.';
  end if;
  update public.product_photos set status = 'Removida', is_main = false, removed_by = coalesce(p_user, public.request_actor()), removed_at = now(), removed_reason = p_reason where id = p_photo;
  if v_photo.is_main then
    select id into v_next from public.product_photos where material_id = v_photo.material_id and status = 'Disponivel' order by position, created_at limit 1;
    if v_next is not null then
      update public.product_photos set is_main = true where id = v_next;
    end if;
  end if;
  perform public.product_photo_sync(v_photo.material_id);
  return jsonb_build_object('removed', p_photo, 'new_main', v_next);
end;
$$;

-- Resultado da verificação do arquivo (feita pela aplicação, que consulta o armazenamento).
create or replace function public.product_photo_mark(p_photo uuid, p_status text, p_note text default null)
returns void
language plpgsql
as $$
declare
  v_photo public.product_photos%rowtype;
  v_next uuid;
begin
  if p_status not in ('Disponivel', 'Indisponivel') then
    raise exception 'Situação inválida.';
  end if;
  select * into v_photo from public.product_photos where id = p_photo for update;
  if not found or v_photo.status = 'Removida' then
    raise exception 'Fotografia não encontrada.';
  end if;
  update public.product_photos set status = p_status, verify_note = p_note, verified_at = now(), is_main = case when p_status = 'Indisponivel' then false else is_main end where id = p_photo;
  if p_status = 'Indisponivel' and v_photo.is_main then
    select id into v_next from public.product_photos where material_id = v_photo.material_id and status = 'Disponivel' order by position, created_at limit 1;
    if v_next is not null then
      update public.product_photos set is_main = true where id = v_next;
    end if;
    perform public.product_photo_sync(v_photo.material_id);
  end if;
end;
$$;

create or replace function public.product_photo_list(p_material uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'url', public.product_photo_url(f.id), 'purpose', f.purpose, 'caption', f.caption, 'is_main', f.is_main, 'position', f.position,
    'status', f.status, 'original_name', f.original_name, 'verify_note', f.verify_note, 'legacy', f.path is null or f.bucket = 'catalog-files', 'created_at', f.created_at, 'created_by', f.created_by)
    order by f.is_main desc, f.position, f.created_at), '[]'::jsonb)
  from public.product_photos f where f.material_id = p_material and f.status <> 'Removida'
$$;

-- Fotografia a usar em documentos: a escolhida (se for deste produto e estiver disponível) ou a principal.
create or replace function public.product_photo_for_document(p_material uuid, p_photo uuid default null)
returns jsonb
language sql
stable
as $$
  select to_jsonb(f) - 'legacy_url' from public.product_photos f
  where f.material_id = p_material and f.status = 'Disponivel' and f.path is not null and (p_photo is null and f.is_main or f.id = p_photo)
  order by f.is_main desc limit 1
$$;

-- Auditoria: cataloga as referências antigas SEM alterar o cadastro. Foto em área pública do armazenamento vira registro "Pendente de verificacao"
-- (a aplicação confere se o arquivo existe); referência temporária/local (blob:, data:, arquivo do computador) é marcada como indisponível.
create or replace function public.product_photos_backfill_legacy()
returns jsonb
language plpgsql
as $$
declare
  v_row record;
  v_match text[];
  v_created integer := 0;
begin
  for v_row in select m.id, m.photo_url from public.materials m
               where m.item_type = 'Produto' and coalesce(btrim(m.photo_url), '') <> '' and m.photo_url not like '/api/produtos/foto/%'
                 and not exists (select 1 from public.product_photos f where f.material_id = m.id) loop
    v_match := regexp_match(v_row.photo_url, '/storage/v1/object/(?:public|sign)/([^/]+)/([^?]+)');
    if v_row.photo_url ~* '^(blob:|data:|file:|[a-z]:\\)' then
      insert into public.product_photos (material_id, legacy_url, purpose, is_main, status, verify_note, created_by)
      values (v_row.id, left(v_row.photo_url, 300), 'comercial', false, 'Indisponivel', 'Referência temporária ou local: o arquivo não está no armazenamento.', 'auditoria 226');
    elsif v_match is not null then
      insert into public.product_photos (material_id, bucket, path, legacy_url, purpose, is_main, status, verify_note, created_by)
      values (v_row.id, v_match[1], v_match[2], left(v_row.photo_url, 300), 'comercial', true, 'Pendente de verificacao', 'Aguardando conferência do arquivo no armazenamento.', 'auditoria 226');
    else
      insert into public.product_photos (material_id, legacy_url, purpose, is_main, status, verify_note, created_by)
      values (v_row.id, left(v_row.photo_url, 300), 'comercial', true, 'Pendente de verificacao', 'Endereço externo: aguardando conferência.', 'auditoria 226');
    end if;
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('catalogued', v_created);
end;
$$;

-- ================================================================ 2. Documento do pedido (PDF) versionado e imutável
create table if not exists public.sales_order_documents (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  version integer not null check (version >= 1),
  kind text not null default 'pedido_pdf' check (kind in ('pedido_pdf')),
  trigger_source text not null default 'manual' check (trigger_source in ('conversao', 'manual', 'revisao')),
  reason text,
  file_bucket text not null,
  file_path text not null,
  file_name text not null,
  size_bytes bigint,
  sha256 text,
  photo_refs jsonb not null default '[]'::jsonb,       -- por item: produto, fotografia usada (id, arquivo) ou o motivo de ter ficado sem
  configuration_refs jsonb not null default '[]'::jsonb, -- por item: configuração congelada, medidas, revisão técnica, grau do desenho
  summary jsonb not null default '{}'::jsonb,
  emitted_by text,
  emitted_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (sales_order_id, version)
);
create index if not exists sales_order_documents_order_idx on public.sales_order_documents (sales_order_id, version desc);

create or replace function public.sales_order_documents_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception 'O PDF emitido não pode ser alterado nem apagado: emita uma nova versão.';
end;
$$;
drop trigger if exists trg_sales_order_documents_guard on public.sales_order_documents;
create trigger trg_sales_order_documents_guard before update or delete on public.sales_order_documents for each row execute function public.sales_order_documents_guard();

create or replace function public.sales_order_document_register(p_order uuid, p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_version integer;
  v_id uuid := gen_random_uuid();
  v_source text := coalesce(nullif(p->>'trigger_source', ''), 'manual');
begin
  select * into v_order from public.sales_orders where id = p_order for update;
  if not found or v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.sales_order_documents where sales_order_id = p_order;
  if v_source = 'conversao' and v_version > 1 then
    return (select jsonb_build_object('id', d.id, 'version', d.version, 'duplicate', true) from public.sales_order_documents d where d.sales_order_id = p_order order by version limit 1);
  end if;
  if v_version > 1 and length(btrim(coalesce(p->>'reason', ''))) < 5 then
    raise exception 'Uma nova versão do pedido exige o motivo da emissão.';
  end if;
  if coalesce(btrim(p->>'file_path'), '') = '' or coalesce(btrim(p->>'file_bucket'), '') = '' then
    raise exception 'O PDF precisa estar gravado no armazenamento antes do registro.';
  end if;
  insert into public.sales_order_documents (id, sales_order_id, version, trigger_source, reason, file_bucket, file_path, file_name, size_bytes, sha256, photo_refs, configuration_refs, summary, emitted_by, system_company_id)
  values (v_id, p_order, v_version, v_source, nullif(btrim(p->>'reason'), ''), p->>'file_bucket', p->>'file_path', coalesce(nullif(p->>'file_name', ''), 'pedido.pdf'), nullif(p->>'size_bytes', '')::bigint, nullif(p->>'sha256', ''),
          coalesce(p->'photo_refs', '[]'::jsonb), coalesce(p->'configuration_refs', '[]'::jsonb), coalesce(p->'summary', '{}'::jsonb), coalesce(p_user, public.request_actor()), v_order.system_company_id);
  perform public.sales_order_log(p_order, 'PDF emitido', 'Pedido em PDF emitido (versão ' || v_version || ')' || case when v_version > 1 then ': ' || btrim(p->>'reason') else '' end || '.', p_user);
  return jsonb_build_object('id', v_id, 'version', v_version, 'duplicate', false);
end;
$$;

create or replace function public.sales_order_document_list(p_order uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'version', d.version, 'trigger_source', d.trigger_source, 'reason', d.reason, 'file_name', d.file_name, 'size_bytes', d.size_bytes, 'sha256', d.sha256,
    'photo_refs', d.photo_refs, 'configuration_refs', d.configuration_refs, 'summary', d.summary, 'emitted_by', d.emitted_by, 'emitted_at', d.emitted_at) order by d.version desc), '[]'::jsonb)
  from public.sales_order_documents d where d.sales_order_id = p_order and d.system_company_id = public.request_system_company_id()
$$;

create or replace function public.sales_order_document_get(p_order uuid, p_version integer default null)
returns jsonb
language sql
stable
as $$
  select to_jsonb(d) from public.sales_order_documents d
  where d.sales_order_id = p_order and d.system_company_id = public.request_system_company_id() and (p_version is null or d.version = p_version) order by d.version desc limit 1
$$;

-- ================================================================ 3. Acesso
alter table public.product_photos enable row level security;
drop policy if exists shared_authenticated_access on public.product_photos;
create policy shared_authenticated_access on public.product_photos for all to authenticated using (true) with check (true);

create index if not exists sales_order_documents_system_company_idx on public.sales_order_documents (system_company_id);
drop trigger if exists assign_system_company on public.sales_order_documents;
create trigger assign_system_company before insert on public.sales_order_documents for each row execute function public.assign_request_system_company();
alter table public.sales_order_documents enable row level security;
drop policy if exists tenant_authenticated_access on public.sales_order_documents;
drop policy if exists tenant_company_isolation on public.sales_order_documents;
create policy tenant_authenticated_access on public.sales_order_documents as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.sales_order_documents as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

-- Buckets privados (fotos de produto e PDFs de pedido). O acesso é sempre pela aplicação (URL assinada ou leitura no servidor).
insert into storage.buckets (id, name, public) values ('product-photos', 'product-photos', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('sales-documents', 'sales-documents', false) on conflict (id) do nothing;
