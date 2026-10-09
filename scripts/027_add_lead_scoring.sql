-- Add lead scoring fields to leads table
-- Each checkbox represents a qualification stage worth ~16.67 points (100/6)
-- Total score is calculated automatically based on checked items

ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS score_mql BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS score_oportunidade_validada BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS score_proposta_tecnica BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS score_proposta_comercial BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS score_negociacao BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS score_fechado BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS total_score INTEGER DEFAULT 0;

-- Add comment to explain scoring system
COMMENT ON COLUMN leads.score_mql IS 'Lead qualificado (MQL) - Marketing Qualified Lead';
COMMENT ON COLUMN leads.score_oportunidade_validada IS 'Oportunidade validada (dor, budget, decisor)';
COMMENT ON COLUMN leads.score_proposta_tecnica IS 'Proposta técnica apresentada';
COMMENT ON COLUMN leads.score_proposta_comercial IS 'Proposta comercial apresentada';
COMMENT ON COLUMN leads.score_negociacao IS 'Em processo de negociação';
COMMENT ON COLUMN leads.score_fechado IS 'Fechado (ganho/perdido)';
COMMENT ON COLUMN leads.total_score IS 'Pontuação total calculada (0-100)';

-- Create function to automatically calculate total score
CREATE OR REPLACE FUNCTION calculate_lead_score()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate score: each true checkbox = 16.67 points (rounded to 17 for simplicity)
  -- 6 checkboxes * 17 = 102, so we cap at 100
  NEW.total_score := LEAST(100, (
    (CASE WHEN NEW.score_mql THEN 17 ELSE 0 END) +
    (CASE WHEN NEW.score_oportunidade_validada THEN 17 ELSE 0 END) +
    (CASE WHEN NEW.score_proposta_tecnica THEN 17 ELSE 0 END) +
    (CASE WHEN NEW.score_proposta_comercial THEN 17 ELSE 0 END) +
    (CASE WHEN NEW.score_negociacao THEN 16 ELSE 0 END) +
    (CASE WHEN NEW.score_fechado THEN 16 ELSE 0 END)
  ));
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-calculate score on insert/update
DROP TRIGGER IF EXISTS trigger_calculate_lead_score ON leads;
CREATE TRIGGER trigger_calculate_lead_score
  BEFORE INSERT OR UPDATE OF 
    score_mql, 
    score_oportunidade_validada, 
    score_proposta_tecnica, 
    score_proposta_comercial, 
    score_negociacao, 
    score_fechado
  ON leads
  FOR EACH ROW
  EXECUTE FUNCTION calculate_lead_score();
