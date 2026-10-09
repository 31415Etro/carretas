-- Check all leads and their current status
SELECT id, name, company, status, updated_at
FROM leads
WHERE closer_id IS NOT NULL
ORDER BY updated_at DESC
LIMIT 20;

-- Check if there are leads that were recently changed to 'em_atendimento'
SELECT id, name, company, status, updated_at
FROM leads
WHERE status = 'em_atendimento'
  AND updated_at > NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC;
