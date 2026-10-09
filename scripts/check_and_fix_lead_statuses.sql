-- First, let's see what status values exist in the database
SELECT DISTINCT status, COUNT(*) as count
FROM public.leads
GROUP BY status
ORDER BY count DESC;

-- Migrate any "vendido" or "vendidos" status to "fechado" (Ganho)
UPDATE public.leads
SET status = 'fechado',
    updated_at = NOW()
WHERE status IN ('vendido', 'vendidos', 'vend', 'Vendido', 'Vendidos', 'VENDIDO', 'VENDIDOS')
  OR status ILIKE '%vendid%';

-- Log the changes
SELECT 
  'Migration complete' as message,
  COUNT(*) as leads_migrated
FROM public.leads
WHERE status = 'fechado';
