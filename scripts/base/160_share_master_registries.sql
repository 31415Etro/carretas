-- Clients, suppliers and products are shared by every CNPJ in the group.
-- Employees/profiles/providers were already global and need no schema change.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['clients', 'suppliers', 'materials'] loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format(
      'create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)',
      table_name
    );
  end loop;
end;
$$;
