-- Persönliches Monatsbudget für geschätzten KI-Verbrauch
-- Einmalig im Supabase SQL Editor ausführen.

alter table profiles
  add column if not exists ai_monthly_budget_usd numeric(10, 2);

comment on column profiles.ai_monthly_budget_usd is
  'Persönliches Monatsbudget/Guthaben in USD für geschätzte KI-Kosten';
