-- Mantem apenas uma foto por Ordem de Serviço.
-- A tabela service_order_files continua existindo porque ela guarda a foto vinculada à OS.
-- Este script remove fotos antigas duplicadas e padroniza tudo como "Foto Final".

begin;

delete from public.service_order_files f
using public.service_order_files newer
where f.service_order_id = newer.service_order_id
  and (
    newer.created_at > f.created_at
    or (newer.created_at = f.created_at and newer.id::text > f.id::text)
  );

update public.service_order_files
set category = 'Foto Final'
where category is distinct from 'Foto Final';

drop index if exists public.idx_service_order_files_one_per_os;

create unique index idx_service_order_files_one_per_os
on public.service_order_files(service_order_id);

alter table public.service_order_files
drop constraint if exists service_order_files_category_final_check;

alter table public.service_order_files
add constraint service_order_files_category_final_check
check (category = 'Foto Final');

commit;
