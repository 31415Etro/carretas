-- Add client workflow statuses to the leads table constraint

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE leads ADD CONSTRAINT leads_status_check 
CHECK (status = ANY (ARRAY[
  'em_atendimento'::text,
  'follow_up'::text,
  'reuniao_agendada'::text,
  'reuniao_remarcada'::text,
  'nao_realizada'::text,
  'sem_atendimento'::text,
  'outbound'::text,
  'reuniao_realizada'::text,
  'em_negociacao'::text,
  'fechado'::text,
  'perdido'::text,
  'reuniao_marcada'::text,
  'no_show'::text,
  'visita'::text,
  'dados_cliente'::text,
  'projeto_orcamento'::text,
  'revisao'::text,
  'kickoff'::text,
  'fila_espera'::text,
  'programacao_time'::text,
  'aguardando_informacoes'::text,
  'sem_pendencias'::text,
  'projetos_ganhos'::text,
  'perdidos_cancelados'::text,
  -- New client workflow statuses
  'cliente'::text,
  'desenvolvimento_proposta'::text,
  'negociacao'::text,
  'ganho'::text,
  'perdido_cliente'::text,
  'hold'::text
]));

COMMENT ON CONSTRAINT leads_status_check ON leads IS 'Valid lead statuses including SDR, Closer, SD, and Client workflows';
