-- Add SD statuses to the leads table status constraint
-- SD Kanban statuses: Fila de espera, Programação do Time, Aguardando Informações, 
-- Sem Pendências, Projetos Ganhos, Perdidos/Cancelados/No Go

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE leads ADD CONSTRAINT leads_status_check 
CHECK (status IN (
  -- Existing SDR statuses
  'em_atendimento', 'follow_up', 'reuniao_agendada', 'reuniao_remarcada',
  'nao_realizada', 'sem_atendimento', 'outbound', 'no_show',
  -- Existing Closer statuses
  'visita', 'dados_cliente', 'projeto_orcamento', 'revisao', 
  'perdido', 'fechado', 'kickoff',
  -- New SD statuses
  'fila_espera', 'programacao_time', 'aguardando_informacoes', 
  'sem_pendencias', 'projetos_ganhos', 'perdidos_cancelados'
));
