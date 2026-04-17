-- Geschätzter KI-Verbrauch pro Nutzer (Token + Kosten-Schaetzung)
-- Einmalig im Supabase SQL Editor ausfuehren.

create table if not exists ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  model text,
  endpoint text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

comment on table ai_usage_logs is 'Geschaetzter KI-Verbrauch pro Request (Tokens + Kosten) fuer App-Statistik';
comment on column ai_usage_logs.estimated_cost_usd is 'Geschaetzte Kosten in USD (nicht identisch mit Anbieter-Rechnung)';

create index if not exists idx_ai_usage_logs_user_created_at
  on ai_usage_logs(user_id, created_at desc);

alter table ai_usage_logs enable row level security;

drop policy if exists "ai_usage_logs_select_own" on ai_usage_logs;
create policy "ai_usage_logs_select_own"
  on ai_usage_logs
  for select
  using (auth.uid() = user_id);

-- Inserts laufen serverseitig mit Service-Role-Key (Backend), daher keine Insert-Policy fuer anon/authenticated notwendig.
