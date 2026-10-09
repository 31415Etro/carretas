-- Adicionar novas colunas na tabela projects
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS subscription_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS pending_subscriptions integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS franchise_location text;

-- Comentários para documentação
COMMENT ON COLUMN projects.subscription_count IS 'Quantidade de assinaturas do projeto';
COMMENT ON COLUMN projects.pending_subscriptions IS 'Número de assinaturas pendentes';
COMMENT ON COLUMN projects.franchise_location IS 'Local da franquia associada ao projeto';
