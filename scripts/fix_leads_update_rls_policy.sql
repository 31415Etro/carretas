-- Drop the existing UPDATE policy
DROP POLICY IF EXISTS "Assigned users can update leads" ON leads;

-- Create a new UPDATE policy with proper with_check clause
-- This allows users to update leads they have access to, even if they change the sdr_id or closer_id
CREATE POLICY "Assigned users can update leads" ON leads
  FOR UPDATE
  USING (
    -- User can update if they are assigned or admin (before the update)
    auth.uid() = sdr_id 
    OR auth.uid() = closer_id 
    OR EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    -- After update, just verify the user still has basic access or is admin
    -- This allows reassigning leads to other users
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'sdr', 'closer')
    )
  );
