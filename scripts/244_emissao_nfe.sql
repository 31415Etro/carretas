-- 244 — Emissão de NF-e de venda pelo ERP (via NFeMail): histórico das emissões e cancelamentos.
-- Rode no SQL Editor do Supabase. ADITIVA e idempotente: só cria a tabela; não altera nem apaga nada existente.
--
-- Cada emissão pedida no ERP vira uma linha (status: pendente -> emitindo -> emitida | erro; cancelamento: cancelando -> cancelada | emitida com erro de cancelamento).
-- O robô que roda no servidor (scripts/nfemail/emitir.mjs) lê as pendentes, preenche o NFeMail, transmite e devolve número, chave e XML.

create table if not exists public.nf_emissions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pendente',     -- pendente | emitindo | emitida | erro | cancelando | cancelada
  payload jsonb not null,                      -- tudo o que foi digitado/selecionado (cabeçalho, destinatário, itens, impostos, pagamento)
  recipient_name text,
  recipient_document text,
  total_amount numeric(14,2),
  quote_id uuid,
  client_id uuid,
  nf_number text,
  nf_series text,
  access_key text,
  protocol text,
  error text,                                  -- motivo quando deu erro (mensagem do portal/SEFAZ)
  error_seen boolean not null default false,   -- o aviso de erro já foi visto na tela
  attempts integer not null default 0,
  events jsonb not null default '[]'::jsonb,   -- andamento: [{at, text}]
  cancel_reason text,
  cancel_requested_by text,
  cancelled_at timestamptz,
  created_by text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create index if not exists nf_emissions_company_created_idx on public.nf_emissions (system_company_id, created_at desc);
create index if not exists nf_emissions_status_idx on public.nf_emissions (status);
create unique index if not exists nf_emissions_access_key_uidx on public.nf_emissions (system_company_id, access_key) where access_key is not null;

drop trigger if exists trg_nf_emissions_updated_at on public.nf_emissions;
create trigger trg_nf_emissions_updated_at before update on public.nf_emissions for each row execute function public.set_updated_at();

alter table public.nf_emissions enable row level security;
drop policy if exists tenant_authenticated_access on public.nf_emissions;
drop policy if exists tenant_company_isolation on public.nf_emissions;
create policy tenant_authenticated_access on public.nf_emissions as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.nf_emissions as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

-- conferência: a tabela existe e está vazia
select count(*) as emissoes from public.nf_emissions;
