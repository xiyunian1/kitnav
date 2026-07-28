UPDATE "Setting"
SET
  "value" = 'KitNav AI',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "key" = 'site_name'
  AND "value" = 'AI 聚合站';
