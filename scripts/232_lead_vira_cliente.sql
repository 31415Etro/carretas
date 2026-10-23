-- 232 — Lead vira cliente sozinho quando existe venda.
-- Lead = cadastro de cliente com status 'Prospect' (aba Leads em Clientes & Fornecedores).
-- Qualquer pedido de venda criado para o lead (orçamento aprovado, pedido manual, oportunidade ganha) muda o status para 'Ativo'.
-- Rode no SQL Editor do Supabase. Não apaga nada.

create or replace function public.lead_to_client_on_sale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.clients set status = 'Ativo' where id = new.client_id and status = 'Prospect';
  return new;
end;
$$;

drop trigger if exists trg_lead_to_client_on_sale on public.sales_orders;
create trigger trg_lead_to_client_on_sale after insert or update of client_id on public.sales_orders
  for each row execute function public.lead_to_client_on_sale();

-- Leads que já têm pedido de venda passam a clientes agora.
update public.clients c set status = 'Ativo'
 where c.status = 'Prospect' and exists (select 1 from public.sales_orders o where o.client_id = c.id);
