-- Add value breakdown columns to leads table
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS value_parts DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS value_services DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS value_maintenance_contracts DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS value_equipment_sales DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS value_projects DECIMAL(15,2) DEFAULT 0;

-- Add comments to explain each column
COMMENT ON COLUMN leads.value_parts IS 'Valor de Peças';
COMMENT ON COLUMN leads.value_services IS 'Valor de Serviços Avulsos';
COMMENT ON COLUMN leads.value_maintenance_contracts IS 'Valor de Contratos de Manutenção';
COMMENT ON COLUMN leads.value_equipment_sales IS 'Valor de Vendas de Equipamentos';
COMMENT ON COLUMN leads.value_projects IS 'Valor de Projetos';
