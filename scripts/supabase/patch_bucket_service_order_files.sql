-- PATCH: o app (app/api/operational-files/upload) usa o bucket privado
-- "service-order-files" (fotos/arquivos de OS), que nenhuma migracao cria.
-- Acesso e feito pelo servidor com a service role (sem policies de storage).
insert into storage.buckets (id, name, public)
values ('service-order-files', 'service-order-files', false)
on conflict (id) do nothing;
