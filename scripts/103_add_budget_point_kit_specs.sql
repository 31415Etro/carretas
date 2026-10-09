-- Campos adicionais para pontos do orçamento:
-- vínculo opcional com kit do estoque e especificações técnicas do ponto.

alter table public.budget_points
  add column if not exists kit_id uuid,
  add column if not exists kit_name text,
  add column if not exists specifications text,
  add column if not exists service_types jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'stock_kits'
  )
  and not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'budget_points'
      and constraint_name = 'budget_points_kit_id_fkey'
  ) then
    alter table public.budget_points
      add constraint budget_points_kit_id_fkey
      foreign key (kit_id)
      references public.stock_kits(id)
      on delete set null;
  end if;
end $$;
