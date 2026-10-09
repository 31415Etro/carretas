alter table public.comercial_cno_records
  add column if not exists saved_at timestamptz,
  add column if not exists commercial_status text not null default 'Novo',
  add column if not exists sent_at timestamptz;

create index if not exists comercial_cno_records_saved_at_idx
  on public.comercial_cno_records (saved_at);

create index if not exists comercial_cno_records_commercial_status_idx
  on public.comercial_cno_records (commercial_status);
