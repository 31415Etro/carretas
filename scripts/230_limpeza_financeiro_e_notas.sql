-- 230 — LIMPEZA DO FINANCEIRO E DAS NOTAS (irreversível; rode manualmente no SQL Editor do Supabase)
-- Apaga: contas a pagar, contas a receber, lançamentos (entradas e saídas), faturas de cartão, regras de categorização
-- aprendidas, conciliação/espelhos do Asaas (pagamentos, repasses, extrato, pagamentos de contas, notas fiscais emitidas,
-- eventos de webhook, saldos) e as notas fiscais importadas.
-- NÃO apaga: contas bancárias, contas/credenciais do Asaas, categorias, subcategorias, centros de custo, plano de contas (DRE),
-- cartões, condições de pagamento, clientes, fornecedores, produtos, estoque, produção, vendas.
-- Para limpar só uma empresa, troque v_company por o id dela (ex.: '00000000-0000-4000-8000-000000000001'); null = todas.

do $$
declare
  v_company uuid := null;
  v_table text;
  v_count bigint;
  -- ordem: filhos antes dos pais
  v_tables text[] := array[
    'credit_card_invoice_items',
    'credit_card_invoices',
    'category_rules',
    'asaas_webhook_events',
    'asaas_balance_snapshots',
    'asaas_bill_payments',
    'asaas_fiscal_documents',
    'asaas_statement_entries',
    'asaas_transfers',
    'asaas_payments',
    'asaas_customers',
    'financial_transactions',
    'accounts_payable',
    'accounts_receivable',
    'imported_invoices'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then
      raise notice '% não existe — ignorada', v_table;
      continue;
    end if;
    if v_company is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v_table and column_name = 'system_company_id') then
      execute format('delete from public.%I where system_company_id = $1', v_table) using v_company;
    else
      execute format('delete from public.%I', v_table);
    end if;
    get diagnostics v_count = row_count;
    raise notice '% : % linha(s) apagada(s)', v_table, v_count;
  end loop;
end $$;
