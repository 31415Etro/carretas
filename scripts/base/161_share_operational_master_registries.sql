-- Master registries belong to the business group and are shared by every CNPJ.
-- Writes remain behind the application's authorized server APIs. Operational
-- records such as orders, stock production, vehicle usage, maintenance and
-- checklists remain isolated by system_company_id.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'client_contacts', 'client_environments', 'client_equipment',
    'suppliers', 'materials', 'profiles', 'providers', 'provider_documents',
    'service_types', 'service_type_checklist_items', 'service_type_materials',
    'stock_kits', 'stock_kit_items', 'system_users', 'vehicles'
  ] loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
  end loop;
end;
$$;
