-- Migrate leads from 'vendido' status to 'fechado' (Ganho)
-- This ensures all sold leads use the correct status in the system

UPDATE leads
SET status = 'fechado'
WHERE status = 'vendido';

-- Log the number of affected rows
SELECT 'Migrated ' || COUNT(*) || ' leads from vendido to fechado' AS result
FROM leads
WHERE status = 'fechado';
