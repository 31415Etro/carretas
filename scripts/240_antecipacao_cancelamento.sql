-- 240 — Antecipação de reembolso para viagem: motivo, autor e data do cancelamento.
-- Sem este script o cancelamento funciona do mesmo jeito (o motivo fica na observação da antecipação). Não altera dados existentes.
alter table public.travel_advances add column if not exists cancel_reason text;
alter table public.travel_advances add column if not exists cancelled_by text;
alter table public.travel_advances add column if not exists cancelled_at timestamptz;
