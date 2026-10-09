-- Permite fotos de inicio e fim por ponto dentro da mesma Ordem de Servico.
-- Este script desfaz a regra antiga que limitava a tabela a uma unica "Foto Final" por OS.

begin;

drop index if exists public.idx_service_order_files_one_per_os;

alter table public.service_order_files
drop constraint if exists service_order_files_category_final_check;

create index if not exists idx_service_order_files_order_category_notes
on public.service_order_files(service_order_id, category, notes);

commit;
