-- Script para migrar localizações antigas para nomes de franquias corretos
-- As franquias serão criadas com os nomes exatos da página de franquias

-- 1. Garantir que as franquias estão cadastradas com os nomes corretos
INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'São Paulo', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'Rio de Janeiro', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'Campinas', id, NOW(), NOW()
FROM profiles
WHERE role = 'admin'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO franchises (name, created_by, created_at, updated_at)
SELECT 'Mato Grosso do Sul', id, NOW(), NOW()
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

-- São Paulo e variações (incluindo "sã") → São Paulo
UPDATE leads 
SET location = 'São Paulo' 
WHERE location ILIKE '%são paulo%' 
   OR location ILIKE '%sao paulo%'
   OR location ILIKE 'sã%'
   OR location = 'São Paulo';

-- Rio de Janeiro e variações → Rio de Janeiro
UPDATE leads 
SET location = 'Rio de Janeiro' 
WHERE location ILIKE '%rio de janeiro%'
   OR location = 'Rio de Janeiro';

-- Campinas e variações → Campinas
UPDATE leads 
SET location = 'Campinas'
WHERE location ILIKE '%campinas%'
   OR location = 'Campinas';

-- Mato Grosso ou Mato Grosso do Sul → Mato Grosso do Sul
UPDATE leads 
SET location = 'Mato Grosso do Sul' 
WHERE location IN ('Mato Grosso', 'Mato Grosso do Sul') 
   OR location ILIKE '%mato grosso%';

-- Minas Gerais, Uberlândia e variações → Triangulo Mineiro
UPDATE leads 
SET location = 'Triangulo Mineiro' 
WHERE location ILIKE '%minas gerais%'
   OR location ILIKE '%uberlandia%'
   OR location ILIKE '%uberlândia%'
   OR location IN ('Minas Gerais', 'Uberlandia', 'Uberlândia');

-- 3. Verificar os resultados da migração
SELECT 
    location, 
    COUNT(*) as total_leads
FROM leads
WHERE location IS NOT NULL
GROUP BY location
ORDER BY location;
