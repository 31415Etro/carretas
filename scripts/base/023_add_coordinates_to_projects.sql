-- Add latitude and longitude columns to projects table for caching geocoded coordinates
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_coordinates ON projects(latitude, longitude);
