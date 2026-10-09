-- Remove o check constraint existente que está causando problemas
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_category_check;

-- Adiciona um novo check constraint com valores mais amplos
ALTER TABLE projects ADD CONSTRAINT projects_category_check 
CHECK (category IN ('vendas', 'marketing', 'desenvolvimento', 'outros', 'sales', 'marketing', 'development', 'other', 'general'));

-- Ou, alternativamente, remove completamente o constraint e torna o campo opcional
-- ALTER TABLE projects ALTER COLUMN category DROP NOT NULL;
-- ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_category_check;
