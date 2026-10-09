alter table public.client_environments
add column if not exists activity_type text not null default '',
add column if not exists equipment_description text not null default '',
add column if not exists thermal_load text not null default '',
add column if not exists occupants_total integer not null default 0,
add column if not exists occupants_fixed integer not null default 0,
add column if not exists occupants_floating integer not null default 0,
add column if not exists air_conditioned_area numeric(12,2) not null default 0;

alter table public.client_environments
drop constraint if exists client_environments_occupants_nonnegative_check;

alter table public.client_environments
add constraint client_environments_occupants_nonnegative_check
check (
  occupants_total >= 0
  and occupants_fixed >= 0
  and occupants_floating >= 0
);

alter table public.client_environments
drop constraint if exists client_environments_air_conditioned_area_nonnegative_check;

alter table public.client_environments
add constraint client_environments_air_conditioned_area_nonnegative_check
check (air_conditioned_area >= 0);
