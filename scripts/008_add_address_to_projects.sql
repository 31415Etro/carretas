-- Add address fields to projects table
-- 
-- ESTRUTURA DO ENDEREÇO:
-- Este endereço completo será utilizado para:
-- 1. Geolocalização de projetos em mapas
-- 2. Análises regionais de performance
-- 3. Documentação e contratos
-- 4. Planejamento logístico
--
-- FORMATO ESPERADO:
-- - CEP: Apenas números, 8 dígitos (ex: 01310100)
-- - Street (Logradouro): Rua, Avenida, etc (ex: "Avenida Paulista")
-- - Number (Número): Número do imóvel (ex: "1578")
-- - Complement (Complemento): Sala, apartamento, bloco (ex: "Sala 101, Bloco A")
-- - Neighborhood (Bairro): Nome do bairro (ex: "Bela Vista")
-- - City (Cidade): Nome da cidade (ex: "São Paulo")
-- - State (Estado): Sigla do estado com 2 letras maiúsculas (ex: "SP")
--
-- EXEMPLO COMPLETO DE ENDEREÇO:
-- CEP: 01310100
-- Logradouro: Avenida Paulista
-- Número: 1578
-- Complemento: 15º andar
-- Bairro: Bela Vista
-- Cidade: São Paulo
-- Estado: SP
--
-- Este formato será usado posteriormente para integração com APIs de mapas,
-- cálculo de rotas, análises geográficas e relatórios regionais.

-- Add address columns to projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS number TEXT,
  ADD COLUMN IF NOT EXISTS complement TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT;

-- Add comments to document the fields
COMMENT ON COLUMN public.projects.cep IS 'CEP do projeto (apenas números, 8 dígitos). Ex: 01310100';
COMMENT ON COLUMN public.projects.street IS 'Logradouro (Rua, Avenida, etc). Ex: Avenida Paulista';
COMMENT ON COLUMN public.projects.number IS 'Número do imóvel. Ex: 1578';
COMMENT ON COLUMN public.projects.complement IS 'Complemento (Sala, apartamento, bloco). Ex: Sala 101';
COMMENT ON COLUMN public.projects.neighborhood IS 'Bairro. Ex: Bela Vista';
COMMENT ON COLUMN public.projects.city IS 'Cidade. Ex: São Paulo';
COMMENT ON COLUMN public.projects.state IS 'Estado (UF - 2 letras). Ex: SP';

-- Create indexes for common queries by location
CREATE INDEX IF NOT EXISTS idx_projects_city ON public.projects(city);
CREATE INDEX IF NOT EXISTS idx_projects_state ON public.projects(state);
CREATE INDEX IF NOT EXISTS idx_projects_cep ON public.projects(cep);

-- Create a composite index for city + state queries
CREATE INDEX IF NOT EXISTS idx_projects_location ON public.projects(city, state);
