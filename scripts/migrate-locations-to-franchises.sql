-- Script para migrar localizações antigas (estados) para nomes de franquias
-- Este script atualiza todos os leads que têm estados antigos para os novos nomes de franquias

-- IMPORTANTE: Antes de executar este script, certifique-se de que as franquias estão cadastradas na tabela franchises

-- Exemplo de migração: Minas Gerais → Triangulo Mineiro
UPDATE leads 
SET location = 'Triangulo Mineiro' 
WHERE location = 'Minas Gerais';

-- Adicione aqui mais mapeamentos conforme necessário:
-- Exemplo:
-- UPDATE leads SET location = 'Nome da Franquia SP' WHERE location = 'São Paulo';
-- UPDATE leads SET location = 'Nome da Franquia RJ' WHERE location = 'Rio de Janeiro';
-- UPDATE leads SET location = 'Nome da Franquia Campinas' WHERE location = 'Campinas';

-- Para visualizar quais localizações existem atualmente nos leads:
-- SELECT DISTINCT location, COUNT(*) as total 
-- FROM leads 
-- WHERE location IS NOT NULL 
-- GROUP BY location 
-- ORDER BY location;

-- Após criar este script com todos os mapeamentos necessários, execute-o no Supabase
