-- Add monthly target columns to sales_targets table
-- Each metric will have 12 monthly columns

ALTER TABLE sales_targets
ADD COLUMN revenue_jan numeric DEFAULT 0,
ADD COLUMN revenue_feb numeric DEFAULT 0,
ADD COLUMN revenue_mar numeric DEFAULT 0,
ADD COLUMN revenue_apr numeric DEFAULT 0,
ADD COLUMN revenue_may numeric DEFAULT 0,
ADD COLUMN revenue_jun numeric DEFAULT 0,
ADD COLUMN revenue_jul numeric DEFAULT 0,
ADD COLUMN revenue_aug numeric DEFAULT 0,
ADD COLUMN revenue_sep numeric DEFAULT 0,
ADD COLUMN revenue_oct numeric DEFAULT 0,
ADD COLUMN revenue_nov numeric DEFAULT 0,
ADD COLUMN revenue_dec numeric DEFAULT 0,

ADD COLUMN leads_jan integer DEFAULT 0,
ADD COLUMN leads_feb integer DEFAULT 0,
ADD COLUMN leads_mar integer DEFAULT 0,
ADD COLUMN leads_apr integer DEFAULT 0,
ADD COLUMN leads_may integer DEFAULT 0,
ADD COLUMN leads_jun integer DEFAULT 0,
ADD COLUMN leads_jul integer DEFAULT 0,
ADD COLUMN leads_aug integer DEFAULT 0,
ADD COLUMN leads_sep integer DEFAULT 0,
ADD COLUMN leads_oct integer DEFAULT 0,
ADD COLUMN leads_nov integer DEFAULT 0,
ADD COLUMN leads_dec integer DEFAULT 0,

ADD COLUMN deals_jan integer DEFAULT 0,
ADD COLUMN deals_feb integer DEFAULT 0,
ADD COLUMN deals_mar integer DEFAULT 0,
ADD COLUMN deals_apr integer DEFAULT 0,
ADD COLUMN deals_may integer DEFAULT 0,
ADD COLUMN deals_jun integer DEFAULT 0,
ADD COLUMN deals_jul integer DEFAULT 0,
ADD COLUMN deals_aug integer DEFAULT 0,
ADD COLUMN deals_sep integer DEFAULT 0,
ADD COLUMN deals_oct integer DEFAULT 0,
ADD COLUMN deals_nov integer DEFAULT 0,
ADD COLUMN deals_dec integer DEFAULT 0;

-- Drop old columns (keeping for backward compatibility initially)
-- The UI will now calculate annual totals from monthly values
COMMENT ON COLUMN sales_targets.revenue_target IS 'Legacy column - Annual total calculated from monthly values';
COMMENT ON COLUMN sales_targets.leads_target IS 'Legacy column - Annual total calculated from monthly values';
COMMENT ON COLUMN sales_targets.closed_deals_target IS 'Legacy column - Annual total calculated from monthly values';
