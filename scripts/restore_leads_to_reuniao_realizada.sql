-- This script will help restore leads that were accidentally moved
-- You should manually identify the lead IDs that need to be restored

-- Example: Restore specific leads to 'reuniao_realizada' status
-- UPDATE leads
-- SET status = 'reuniao_realizada',
--     updated_at = NOW()
-- WHERE id IN ('lead-id-1', 'lead-id-2');

-- Or restore all leads that were recently changed to 'em_atendimento'
-- Only uncomment if you're sure this is what you want:
-- UPDATE leads
-- SET status = 'reuniao_realizada',
--     updated_at = NOW()
-- WHERE status = 'em_atendimento'
--   AND closer_id IS NOT NULL
--   AND updated_at > NOW() - INTERVAL '10 minutes';
