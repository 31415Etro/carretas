-- Migration: Update lead scoring from checkboxes to weighted criteria system
-- New scoring system: 9 criteria with weights and notes (0-5), resulting in score 0-100

-- First, drop old triggers and functions that depend on old columns
DROP TRIGGER IF EXISTS trigger_calculate_lead_score ON leads;
DROP TRIGGER IF EXISTS trigger_calculate_lead_weighted_score ON leads;
DROP FUNCTION IF EXISTS calculate_lead_score();

-- Add new scoring columns (9 criteria with notes 0-5)
-- 1. Autoridade de decisão mapeada (Peso 20%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_autoridade INTEGER DEFAULT 0 CHECK (score_autoridade >= 0 AND score_autoridade <= 5);

-- 2. Dor estratégica / urgência (Peso 15%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_dor_urgencia INTEGER DEFAULT 0 CHECK (score_dor_urgencia >= 0 AND score_dor_urgencia <= 5);

-- 3. Business case financeiro (Peso 15%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_business_case INTEGER DEFAULT 0 CHECK (score_business_case >= 0 AND score_business_case <= 5);

-- 4. Aderência técnica da solução (Peso 10%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_aderencia_tecnica INTEGER DEFAULT 0 CHECK (score_aderencia_tecnica >= 0 AND score_aderencia_tecnica <= 5);

-- 5. Diferenciação vs concorrência (Peso 10%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_diferenciacao INTEGER DEFAULT 0 CHECK (score_diferenciacao >= 0 AND score_diferenciacao <= 5);

-- 6. Gestão de riscos clara (Peso 10%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_gestao_riscos INTEGER DEFAULT 0 CHECK (score_gestao_riscos >= 0 AND score_gestao_riscos <= 5);

-- 7. Cronograma e timing (Peso 8%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_cronograma INTEGER DEFAULT 0 CHECK (score_cronograma >= 0 AND score_cronograma <= 5);

-- 8. Modelo comercial / contrato (Peso 7%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_modelo_comercial INTEGER DEFAULT 0 CHECK (score_modelo_comercial >= 0 AND score_modelo_comercial <= 5);

-- 9. Patrocinador interno (Peso 5%)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_patrocinador INTEGER DEFAULT 0 CHECK (score_patrocinador >= 0 AND score_patrocinador <= 5);

-- total_score column already exists from previous migration

-- Create or replace the function to calculate weighted score
CREATE OR REPLACE FUNCTION calculate_lead_weighted_score()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate weighted score: (sum of weight * note) / 5 to get 0-100
  -- Weights: autoridade=20, dor=15, business=15, aderencia=10, diferenciacao=10, riscos=10, cronograma=8, comercial=7, patrocinador=5
  NEW.total_score := ROUND((
    (COALESCE(NEW.score_autoridade, 0) * 20) +
    (COALESCE(NEW.score_dor_urgencia, 0) * 15) +
    (COALESCE(NEW.score_business_case, 0) * 15) +
    (COALESCE(NEW.score_aderencia_tecnica, 0) * 10) +
    (COALESCE(NEW.score_diferenciacao, 0) * 10) +
    (COALESCE(NEW.score_gestao_riscos, 0) * 10) +
    (COALESCE(NEW.score_cronograma, 0) * 8) +
    (COALESCE(NEW.score_modelo_comercial, 0) * 7) +
    (COALESCE(NEW.score_patrocinador, 0) * 5)
  )::NUMERIC / 5);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create new trigger for weighted scoring
CREATE TRIGGER trigger_calculate_lead_weighted_score
BEFORE INSERT OR UPDATE ON leads
FOR EACH ROW
EXECUTE FUNCTION calculate_lead_weighted_score();

-- Update existing leads to recalculate scores with new system
UPDATE leads SET total_score = ROUND((
  (COALESCE(score_autoridade, 0) * 20) +
  (COALESCE(score_dor_urgencia, 0) * 15) +
  (COALESCE(score_business_case, 0) * 15) +
  (COALESCE(score_aderencia_tecnica, 0) * 10) +
  (COALESCE(score_diferenciacao, 0) * 10) +
  (COALESCE(score_gestao_riscos, 0) * 10) +
  (COALESCE(score_cronograma, 0) * 8) +
  (COALESCE(score_modelo_comercial, 0) * 7) +
  (COALESCE(score_patrocinador, 0) * 5)
)::NUMERIC / 5);

-- Note: Old boolean scoring columns (score_mql, score_oportunidade_validada, etc.) are kept for backwards compatibility
-- They can be manually dropped later if needed: ALTER TABLE leads DROP COLUMN score_mql; etc.
