create table if not exists public.stock_service_orders (
  id uuid primary key default gen_random_uuid(),
  budget_work_id uuid not null references public.budget_works(id) on delete cascade,
  budget_point_id uuid not null references public.budget_points(id) on delete cascade,
  kit_id uuid references public.stock_kits(id) on delete set null,
  linked_service_order_id uuid references public.service_orders(id) on delete set null,
  status text not null default 'Aberto'
    check (status in ('Aberto', 'Produção', 'Pronta para uso', 'Usada')),
  work_name text not null default '',
  tower_name text not null default '',
  floor_name text not null default '',
  final_name text not null default '',
  environment_name text not null default '',
  point_name text not null default '',
  kit_name text not null default '',
  infrastructure_measure text not null default '',
  has_welding boolean,
  guide_passage boolean,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_point_id)
);

create index if not exists stock_service_orders_status_idx
  on public.stock_service_orders(status);
create index if not exists stock_service_orders_work_idx
  on public.stock_service_orders(budget_work_id);

insert into public.stock_service_orders (
  id,
  budget_work_id,
  budget_point_id,
  kit_id,
  work_name,
  tower_name,
  floor_name,
  final_name,
  environment_name,
  point_name,
  kit_name,
  infrastructure_measure
)
select
  gen_random_uuid(),
  work.id,
  point.id,
  point.kit_id,
  coalesce(work.name, ''),
  coalesce(tower.name, ''),
  coalesce(floor.name, ''),
  coalesce(final.name, ''),
  coalesce(environment.name, ''),
  coalesce(point.name, ''),
  coalesce(point.kit_name, kit.name, ''),
  coalesce(point.infrastructure_measure, '')
from public.budget_points point
join public.budget_environments environment on environment.id = point.budget_environment_id
join public.budget_service_types final on final.id = environment.budget_service_type_id
join public.budget_floors floor on floor.id = final.budget_floor_id
join public.budget_towers tower on tower.id = floor.budget_tower_id
join public.budget_works work on work.id = tower.budget_work_id
left join public.stock_kits kit on kit.id = point.kit_id
where point.kit_id is not null or nullif(trim(point.kit_name), '') is not null
on conflict (budget_point_id) do update set
  budget_work_id = excluded.budget_work_id,
  kit_id = excluded.kit_id,
  work_name = excluded.work_name,
  tower_name = excluded.tower_name,
  floor_name = excluded.floor_name,
  final_name = excluded.final_name,
  environment_name = excluded.environment_name,
  point_name = excluded.point_name,
  kit_name = excluded.kit_name,
  infrastructure_measure = excluded.infrastructure_measure,
  updated_at = now();

alter table public.stock_service_orders enable row level security;

drop policy if exists "Authenticated users can read stock service orders" on public.stock_service_orders;
create policy "Authenticated users can read stock service orders"
  on public.stock_service_orders for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.active is not false
        and profiles.role <> 'client'
    )
  );

drop policy if exists "Authenticated users can update stock service orders" on public.stock_service_orders;
create policy "Authenticated users can update stock service orders"
  on public.stock_service_orders for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.active is not false
        and profiles.role <> 'client'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.active is not false
        and profiles.role <> 'client'
    )
  );

create or replace function public.touch_stock_service_order()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_stock_service_orders on public.stock_service_orders;
create trigger touch_stock_service_orders
before update on public.stock_service_orders
for each row execute function public.touch_stock_service_order();

create or replace function public.use_stock_order_when_work_order_finishes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_type = 'obra'
     and new.status = 'Finalizada'
     and new.point_id is not null then
    update public.stock_service_orders
       set status = 'Usada',
           linked_service_order_id = new.id,
           used_at = coalesce(new.finished_at, now()),
           updated_at = now()
     where budget_point_id = new.point_id;
  end if;
  return new;
end;
$$;

drop trigger if exists use_stock_order_after_service_order on public.service_orders;
create trigger use_stock_order_after_service_order
after insert or update of status, point_id on public.service_orders
for each row execute function public.use_stock_order_when_work_order_finishes();

update public.stock_service_orders stock_order
   set status = 'Usada',
       linked_service_order_id = service_order.id,
       used_at = coalesce(service_order.finished_at, now()),
       updated_at = now()
  from public.service_orders service_order
 where service_order.order_type = 'obra'
   and service_order.status = 'Finalizada'
   and service_order.point_id = stock_order.budget_point_id;
