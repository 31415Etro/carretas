-- 236 — LIMPEZA DO CATÁLOGO E DAS VENDAS/PRODUÇÃO (IRREVERSÍVEL). Rode manualmente no SQL Editor do Supabase.
--
-- APAGA (de TODAS as empresas): produtos finais, kits e matérias-primas (tabela materials) e tudo que depende deles:
--   versões e composições, configurações, fotos, estoque (saldos, movimentos, reservas), oportunidades, orçamentos, pedidos de venda (itens, entregas,
--   documentos PDF), ordens de produção (kits, materiais, consumos, tarefas da esteira, apontamentos, ocorrências, QR), documentação veicular,
--   pedidos e solicitações de compra com seus recebimentos.
-- NÃO APAGA: clientes, fornecedores, vendedores, colaboradores da fábrica, etapas da esteira, depósitos, condições de pagamento, usuários, empresas,
--   NENHUM dado do Financeiro (lançamentos, contas a pagar/receber, conciliação) nem a contabilidade (notas importadas).
--   Tabelas que apenas citam o que foi apagado (ex.: ordens de serviço e contratos que apontam para um orçamento) ficam, com o vínculo zerado.
--
-- Tudo roda numa transação só: se qualquer passo falhar, NADA é apagado. Para executar, troque 'NAO' por 'SIM' na linha v_confirmar.

do $$
declare
  v_confirmar text := 'NAO';                      -- <<< troque para 'SIM' para apagar de verdade
  v_roots oid[];
  v_all oid[];
  v_level oid[];
  v_new oid[];
  v_rel oid;
  v_fk record;
  v_deleted bigint;
  v_total bigint;
  v_pass integer := 0;
  v_name text;
  v_summary text := '';
begin
  if v_confirmar is distinct from 'SIM' then
    raise exception 'Nada foi apagado. Para executar a limpeza, troque v_confirmar de ''NAO'' para ''SIM'' no início do script e rode de novo.';
  end if;
  perform set_config('search_path', 'public, pg_catalog', true);
  -- desliga gatilhos (imutabilidade de histórico, auditoria) e a checagem de chave estrangeira SÓ nesta transação; a limpeza de órfãos abaixo garante a integridade
  perform set_config('session_replication_role', 'replica', true);

  -- raízes: o que o usuário quer apagar por inteiro
  select array_agg(oid) into v_roots from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
    and relname in ('materials', 'opportunities', 'quotes', 'sales_orders', 'production_orders', 'purchase_orders', 'purchase_requests', 'vehicle_documentation');
  if v_roots is null then
    raise exception 'Tabelas não encontradas: este script é para o banco do ERP.';
  end if;

  -- fecho das tabelas dependentes: quem tem coluna OBRIGATÓRIA (not null) apontando para o que será apagado também perde as linhas órfãs
  v_all := v_roots;
  v_level := v_roots;
  loop
    select array_agg(distinct c.conrelid) into v_new
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confrelid = any (v_level) and a.attnotnull and c.conrelid <> all (v_all);
    exit when v_new is null;
    v_all := v_all || v_new;
    v_level := v_new;
  end loop;

  if exists (select 1 from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) > 1 and (c.confrelid = any (v_all))) then
    raise exception 'Há chave estrangeira composta apontando para as tabelas a apagar: revise o script antes de continuar (nada foi apagado).';
  end if;

  -- 1) apaga TODAS as linhas das raízes
  foreach v_rel in array v_roots loop
    execute format('delete from %s', v_rel::regclass);
    get diagnostics v_deleted = row_count;
    v_summary := v_summary || format('%s: %s; ', v_rel::regclass, v_deleted);
  end loop;

  -- 2) limpa órfãos até não sobrar nenhum (obrigatórios: apaga a linha; opcionais: zera o vínculo), repetindo porque um nível alimenta o seguinte
  loop
    v_pass := v_pass + 1;
    v_total := 0;
    for v_fk in
      select c.conrelid::regclass::text child, a.attname child_col, c.confrelid::regclass::text parent, pa.attname parent_col, a.attnotnull as mandatory, c.conrelid as child_oid
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confrelid = any (v_all) and array_length(c.conkey, 1) = 1
    loop
      if v_fk.mandatory and v_fk.child_oid = any (v_all) then
        execute format('delete from %s c where c.%I is not null and not exists (select 1 from %s p where p.%I = c.%I)', v_fk.child, v_fk.child_col, v_fk.parent, v_fk.parent_col, v_fk.child_col);
      elsif v_fk.mandatory then
        -- tabela fora do fecho com coluna obrigatória apontando para linha apagada: seria deixar órfão, então aborta (nada é apagado)
        execute format('select count(*) from %s c where c.%I is not null and not exists (select 1 from %s p where p.%I = c.%I)', v_fk.child, v_fk.child_col, v_fk.parent, v_fk.parent_col, v_fk.child_col) into v_deleted;
        if v_deleted > 0 then
          raise exception 'A tabela % ainda aponta (campo obrigatório %) para registros que seriam apagados; revise o script.', v_fk.child, v_fk.child_col;
        end if;
        v_deleted := 0;
      else
        execute format('update %s c set %I = null where c.%I is not null and not exists (select 1 from %s p where p.%I = c.%I)', v_fk.child, v_fk.child_col, v_fk.child_col, v_fk.parent, v_fk.parent_col, v_fk.child_col);
      end if;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      if v_deleted > 0 then v_summary := v_summary || format('%s(%s): %s; ', v_fk.child, v_fk.child_col, v_deleted); end if;
    end loop;
    exit when v_total = 0 or v_pass >= 25;
  end loop;

  -- 3) conferência final: nenhuma chave estrangeira do banco pode ter ficado órfã
  for v_fk in
    select c.conrelid::regclass::text child, a.attname child_col, c.confrelid::regclass::text parent, pa.attname parent_col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
  loop
    execute format('select count(*) from %s c where c.%I is not null and not exists (select 1 from %s p where p.%I = c.%I)', v_fk.child, v_fk.child_col, v_fk.parent, v_fk.parent_col, v_fk.child_col) into v_deleted;
    if v_deleted > 0 then
      raise exception 'Conferência final: % registro(s) de % ficaram sem o vínculo %. Nada foi apagado.', v_deleted, v_fk.child, v_fk.child_col;
    end if;
  end loop;

  raise notice 'Limpeza concluída. %', v_summary;
end;
$$;
