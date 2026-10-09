-- ============================================
-- Script de Migração: Leads para Franquias
-- ============================================
-- Este script cria as franquias e migra os leads existentes
-- para usar os nomes corretos das franquias cadastradas

-- PASSO 1: Criar as franquias (ignora se já existirem)
INSERT INTO franchises (name, created_by)
SELECT 
  franchise_name,
  (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1)
FROM (
  VALUES 
    ('São Paulo'),
    ('Rio de Janeiro'),
    ('Campinas'),
    ('Mato Grosso do Sul'),
    ('Triangulo Mineiro')
) AS franchise_list(franchise_name)
WHERE NOT EXISTS (
  SELECT 1 FROM franchises WHERE name = franchise_name
);

-- PASSO 2: Migrar leads para as franquias corretas

-- Migrar São Paulo (incluindo "sã" que é São Paulo mal digitado)
UPDATE leads 
SET location = 'São Paulo' 
WHERE location IN ('São Paulo', 'sã', 'SP') 
   OR location ILIKE '%são paulo%'
   OR location ILIKE 'sa%paulo%';

-- Migrar Rio de Janeiro
UPDATE leads 
SET location = 'Rio de Janeiro' 
WHERE location IN ('Rio de Janeiro', 'RJ') 
   OR location ILIKE '%rio de janeiro%'
   OR location ILIKE '%rio%janeiro%';

-- Migrar Campinas
UPDATE leads 
SET location = 'Campinas' 
WHERE location IN ('Campinas') 
   OR location ILIKE '%campinas%';

-- Migrar Mato Grosso do Sul (inclui Mato Grosso também)
UPDATE leads 
SET location = 'Mato Grosso do Sul' 
WHERE location IN ('Mato Grosso', 'Mato Grosso do Sul', 'MS', 'MT') 
   OR location ILIKE '%mato grosso%';

-- Migrar Triangulo Mineiro (inclui Minas Gerais e Uberlândia)
UPDATE leads 
SET location = 'Triangulo Mineiro' 
WHERE location IN ('Minas Gerais', 'Uberlândia', 'Uberaba', 'MG') 
   OR location ILIKE '%minas gerais%'
   OR location ILIKE '%uberlandia%'
   OR location ILIKE '%uberlândia%'
   OR location ILIKE '%triangulo%'
   OR location ILIKE '%uberaba%';

-- PASSO 3: Verificar resultados da migração
SELECT 
  location as "Franquia",
  COUNT(*) as "Total de Leads"
FROM leads
WHERE location IS NOT NULL
GROUP BY location
ORDER BY COUNT(*) DESC;

-- PASSO 4: Verificar se há leads com localizações não mapeadas
SELECT DISTINCT location as "Localizações Não Mapeadas"
FROM leads
WHERE location NOT IN ('São Paulo', 'Rio de Janeiro', 'Campinas', 'Mato Grosso do Sul', 'Triangulo Mineiro')
  AND location IS NOT NULL
ORDER BY location;
