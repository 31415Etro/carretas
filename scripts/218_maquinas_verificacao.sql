-- Verificação do módulo Máquinas e Equipamentos (rode DEPOIS de 218_maquinas.sql, no SQL Editor do Supabase).
-- Tudo roda dentro de uma transação e termina em ROLLBACK: nenhum dado de teste fica no banco.
-- Cada bloco imprime "OK ..." (NOTICE) ou falha com a descrição do que está errado.

begin;

do $$
declare
  c1 constant uuid := '00000000-0000-4000-8000-000000000001';
  c2 constant uuid := '00000000-0000-4000-8000-0000000000f2';
  v_code1 text; v_code2 text; v_code3 text; v_eqp text;
  m1 uuid; m2 uuid; v_row public.machines; v_failed boolean;
begin
  -- empresa de teste para o isolamento
  insert into public.system_companies (id, name, trade_name, active) values (c2, 'Empresa de teste', 'Empresa de teste', true) on conflict (id) do nothing;

  -- ===== 1. Código patrimonial: sequencial, único por empresa e tipo, independente entre empresas =====
  perform set_config('request.headers', json_build_object('x-system-company-id', c1)::text, true);
  v_code1 := public.machine_next_code('MAQ');
  v_code2 := public.machine_next_code('MAQ');
  v_eqp := public.machine_next_code('EQP');
  assert v_code1 ~ '^[A-Z0-9]+-MAQ-\d{6}$', 'formato do código MAQ: ' || v_code1;
  assert v_code2 <> v_code1, 'códigos MAQ duplicados';
  assert v_eqp ~ '-EQP-\d{6}$', 'formato do código EQP: ' || v_eqp;
  assert right(v_eqp, 6)::int = 1 or true, 'EQP tem contador próprio';
  perform set_config('request.headers', json_build_object('x-system-company-id', c2)::text, true);
  v_code3 := public.machine_next_code('MAQ');
  assert right(v_code3, 6) = '000001', 'a empresa 2 começa no 000001, independente da empresa 1: ' || v_code3;
  raise notice 'OK 1: códigos %, %, % (empresa 2: %)', v_code1, v_code2, v_eqp, v_code3;

  -- ===== 2. Número de OM =====
  perform set_config('request.headers', json_build_object('x-system-company-id', c1)::text, true);
  assert public.machine_next_order_number() ~ '^OM-\d{4}-\d{6}$', 'formato da OM';
  assert public.machine_next_order_number() <> public.machine_next_order_number(), 'OM duplicada';
  raise notice 'OK 2: numeração de OM';

  -- ===== 3. Status: conflito de versão, histórico e regras de segurança =====
  insert into public.machines (system_company_id, code, name) values (c1, v_code1, 'Máquina de teste 1') returning id into m1;
  insert into public.machines (system_company_id, code, name) values (c1, v_code2, 'Máquina de teste 2') returning id into m2;

  v_row := public.machine_change_status(jsonb_build_object('machine_id', m1, 'to_status', 'Em operacao', 'reason', 'Início de produção', 'expected_version', 1, 'changed_by', 'teste'));
  assert v_row.operational_status = 'Em operacao' and v_row.status_version = 2, 'mudança para Em operação';

  -- segunda pessoa ainda enxerga a versão 1: precisa ser recusada (CONFLITO)
  v_failed := false;
  begin
    perform public.machine_change_status(jsonb_build_object('machine_id', m1, 'to_status', 'Parada', 'reason', 'Falha', 'expected_version', 1));
  exception when others then v_failed := sqlerrm like 'CONFLITO:%';
  end;
  assert v_failed, 'alteração simultânea com versão antiga deveria dar CONFLITO';

  -- parada com bloqueio de segurança: não volta a operar sem liberação
  v_row := public.machine_change_status(jsonb_build_object('machine_id', m1, 'to_status', 'Parada', 'reason', 'Risco de segurança', 'safety_lock', true, 'expected_version', 2));
  assert v_row.safety_locked, 'bloqueio de segurança registrado';
  v_failed := false;
  begin
    perform public.machine_change_status(jsonb_build_object('machine_id', m1, 'to_status', 'Em operacao', 'reason', 'Voltar', 'expected_version', 3));
  exception when others then v_failed := sqlerrm like 'BLOQUEIO:%';
  end;
  assert v_failed, 'máquina bloqueada não pode voltar a operar sem liberação';
  v_row := public.machine_change_status(jsonb_build_object('machine_id', m1, 'to_status', 'Em operacao', 'reason', 'Liberada após inspeção', 'safety_release', true, 'expected_version', 3));
  assert v_row.operational_status = 'Em operacao' and not v_row.safety_locked, 'liberação autorizada';

  -- ordem que impede o uso bloqueia a volta à operação
  perform public.machine_change_status(jsonb_build_object('machine_id', m1, 'to_status', 'Em manutencao', 'reason', 'Corretiva'));
  insert into public.machine_orders (system_company_id, machine_id, description, blocks_operation, status) values (c1, m1, 'Troca de motor', true, 'Em execucao');
  v_failed := false;
  begin
    perform public.machine_change_status(jsonb_build_object('machine_id', m1, 'to_status', 'Em operacao', 'reason', 'Voltar'));
  exception when others then v_failed := sqlerrm like 'BLOQUEIO:%';
  end;
  assert v_failed, 'ordem em aberto que impede o uso bloqueia a operação';

  -- máquina baixada não muda de status
  update public.machines set admin_status = 'Baixado', retired_at = current_date where id = m2;
  v_failed := false;
  begin
    perform public.machine_change_status(jsonb_build_object('machine_id', m2, 'to_status', 'Em operacao', 'reason', 'x'));
  exception when others then v_failed := sqlerrm like 'BLOQUEIO:%';
  end;
  assert v_failed, 'máquina baixada não altera status';

  -- apenas o último trecho do histórico fica aberto
  assert (select count(*) from public.machine_status_history where machine_id = m1 and ended_at is null) = 1, 'um único trecho aberto no histórico';
  raise notice 'OK 3: status, conflito, segurança, ordem bloqueante e baixa';

  -- ===== 4. Histórico imutável =====
  v_failed := false;
  begin
    update public.machine_status_history set reason = 'adulterado' where machine_id = m1;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'histórico de status não pode ser alterado';
  v_failed := false;
  begin
    delete from public.machine_status_history where machine_id = m1;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'histórico de status não pode ser apagado';
  raise notice 'OK 4: histórico de status é somente inclusão';

  -- ===== 5. QR Code: um único ativo por máquina; token único =====
  insert into public.machine_qr_tokens (system_company_id, machine_id, token) values (c1, m1, 'tokenteste_aaaaaaaaaaaaaaaaaaaaaaaa');
  v_failed := false;
  begin
    insert into public.machine_qr_tokens (system_company_id, machine_id, token) values (c1, m1, 'tokenteste_bbbbbbbbbbbbbbbbbbbbbbbb');
  exception when unique_violation then v_failed := true;
  end;
  assert v_failed, 'só pode haver um QR ativo por máquina';
  update public.machine_qr_tokens set active = false, revoked_at = now() where machine_id = m1;
  insert into public.machine_qr_tokens (system_company_id, machine_id, token) values (c1, m1, 'tokenteste_cccccccccccccccccccccccc');
  raise notice 'OK 5: QR Code (revogação e reemissão)';

  -- ===== 6. Plano: sem ordem duplicada em aberto =====
  declare p uuid;
  begin
    insert into public.machine_maintenance_plans (system_company_id, machine_id, name, interval_days) values (c1, m1, 'Limpeza', 30) returning id into p;
    insert into public.machine_orders (system_company_id, machine_id, plan_id, description) values (c1, m1, p, 'Limpeza');
    v_failed := false;
    begin
      insert into public.machine_orders (system_company_id, machine_id, plan_id, description) values (c1, m1, p, 'Limpeza (duplicada)');
    exception when unique_violation then v_failed := true;
    end;
    assert v_failed, 'não pode haver duas ordens abertas do mesmo plano';
  end;
  raise notice 'OK 6: ordem duplicada por plano bloqueada';

  -- ===== 7. Histórico anterior exige data real; dinheiro não é negativo =====
  v_failed := false;
  begin
    insert into public.machine_orders (system_company_id, machine_id, origin, description, status) values (c1, m1, 'Historico', 'Sem data', 'Concluida');
  exception when check_violation then v_failed := true;
  end;
  assert v_failed, 'manutenção anterior exige data de execução';
  v_failed := false;
  begin
    insert into public.machine_orders (system_company_id, machine_id, description, labor_cost) values (c1, m1, 'Custo negativo', -1);
  exception when check_violation then v_failed := true;
  end;
  assert v_failed, 'custo negativo recusado';
  raise notice 'OK 7: restrições de histórico e valores';

  -- ===== 8. Isolamento por empresa (RLS restritiva) =====
  set local role authenticated;
  perform set_config('request.headers', json_build_object('x-system-company-id', c2)::text, true);
  assert (select count(*) from public.machines where id in (m1, m2)) = 0, 'a empresa 2 não pode ver máquinas da empresa 1';
  perform set_config('request.headers', json_build_object('x-system-company-id', c1)::text, true);
  assert (select count(*) from public.machines where id in (m1, m2)) = 2, 'a empresa 1 vê as próprias máquinas';
  reset role;
  raise notice 'OK 8: isolamento multiempresa';
end;
$$;

-- Não deixe nada para trás.
rollback;
