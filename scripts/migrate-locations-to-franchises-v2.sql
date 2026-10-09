-- Script para migrar localizações antigas (estados) para nomes de franquias
-- Este script primeiro garante que as franquias existem e depois atualiza todos os leads

-- 1. Garantir que as franquias estão cadastradas
INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'São Paulo', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'Franquia Rio de Janeiro', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'Campinas Franquia', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'Franquia Mato Grosso do Sul', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'Triangulo Mineiro', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

-- 2. Atualizar leads com os novos nomes de franquias

-- São Paulo permanece São Paulo
UPDATE leads 
SET location = 'São Paulo' 
WHERE location = 'São Paulo' OR location ILIKE '%são paulo%';

-- Rio de Janeiro → Franquia Rio de Janeiro
UPDATE leads 
SET location = 'Franquia Rio de Janeiro' 
WHERE location = 'Rio de Janeiro' OR location ILIKE '%rio de janeiro%';

-- Campinas → Campinas Franquia
UPDATE leads 
SET location = 'Campinas Franquia' 
WHERE location = 'Campinas' OR location ILIKE '%campinas%';

-- Mato Grosso ou Mato Grosso do Sul → Franquia Mato Grosso do Sul
UPDATE leads 
SET location = 'Franquia Mato Grosso do Sul' 
WHERE location IN ('Mato Grosso', 'Mato Grosso do Sul') 
   OR location ILIKE '%mato grosso%';

-- Minas Gerais → Triangulo Mineiro
UPDATE leads 
SET location = 'Triangulo Mineiro' 
WHERE location = 'Minas Gerais' OR location ILIKE '%minas gerais%';

-- 3. Verificar os resultados
SELECT 
    location, 
    COUNT(*) as total_leads
FROM leads
WHERE location IS NOT NULL
GROUP BY location
ORDER BY location;
