-- 241 — Central de Produção: toda ordem de produção aberta passa a ter o passo a passo (esteira) lançado na Central.
-- Requer o 227 (chão de fábrica). ADITIVA e idempotente: não apaga nem altera nada que já existe; pode ser rodada mais de uma vez.
--
-- O que faz:
--   1) Para cada empresa com ordem de produção aberta: cria as 8 etapas oficiais da esteira, se a empresa ainda não tem nenhuma.
--   2) Gera as tarefas (passo a passo de cada carreta) das ordens abertas que estão sem tarefa.
--   3) Daqui para frente, ao criar uma ordem de produção o gatilho cria as etapas (se faltarem) e as tarefas, sem passo manual.

do $$
begin
  if to_regprocedure('public.shop_tasks_generate(uuid,text)') is null or to_regprocedure('public.shop_steps_seed(text)') is null then
    raise exception 'Rode antes o script 227_chao_de_fabrica.sql: ele cria a esteira do chão de fábrica.';
  end if;
end;
$$;

-- 3) gatilho: a ordem já nasce com etapas e tarefas
create or replace function public.production_orders_shop_tasks()
returns trigger
language plpgsql
as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-system-company-id', new.system_company_id)::text, true);
  if not exists (select 1 from public.shop_steps where system_company_id = new.system_company_id and active) then
    perform public.shop_steps_seed('automático');
  end if;
  perform public.shop_tasks_generate(new.id, 'automático');
  return null;
end;
$$;
drop trigger if exists trg_production_orders_shop_tasks on public.production_orders;
create trigger trg_production_orders_shop_tasks after insert on public.production_orders for each row execute function public.production_orders_shop_tasks();

-- 1 e 2) ordens que já existem
do $$
declare
  v_company record;
  v_order record;
  v_steps integer;
  v_tasks integer;
begin
  for v_company in
    select distinct po.system_company_id as id from public.production_orders po
    where po.status not in ('Concluida', 'Cancelada') and not exists (select 1 from public.shop_tasks t where t.production_order_id = po.id)
  loop
    -- as funções da esteira leem a empresa pelo cabeçalho da requisição: aponta para a empresa da vez
    perform set_config('request.headers', jsonb_build_object('x-system-company-id', v_company.id)::text, true);
    v_steps := 0;
    if not exists (select 1 from public.shop_steps where system_company_id = v_company.id and active) then
      v_steps := public.shop_steps_seed('automático');
    end if;
    v_tasks := 0;
    for v_order in
      select po.id from public.production_orders po
      where po.system_company_id = v_company.id and po.status not in ('Concluida', 'Cancelada') and not exists (select 1 from public.shop_tasks t where t.production_order_id = po.id)
    loop
      v_tasks := v_tasks + coalesce(public.shop_tasks_generate(v_order.id, 'automático'), 0);
    end loop;
    raise notice 'Empresa %: % etapa(s) criada(s), % tarefa(s) gerada(s).', v_company.id, v_steps, v_tasks;
  end loop;
end;
$$;

-- conferência: ordens abertas e quantas tarefas cada uma tem agora
select po.code as ordem, so.order_number as pedido, po.status, (select count(*) from public.shop_tasks t where t.production_order_id = po.id) as tarefas
from public.production_orders po left join public.sales_orders so on so.id = po.sales_order_id
where po.status not in ('Concluida', 'Cancelada') order by po.created_at desc;
