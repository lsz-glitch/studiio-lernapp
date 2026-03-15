-- Streak-System: eigene Tabelle (unabhängig von profiles)
-- Einmalig im Supabase SQL Editor ausführen: Gesamten Inhalt einfügen und Run klicken.

-- Tabelle nur für Streak-Daten
create table if not exists user_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_activity_date date default null,
  current_streak_days int default 0,
  updated_at timestamptz default now()
);

comment on table user_streaks is 'Streak pro Nutzer: letzter Aktivitätstag und Anzahl aufeinanderfolgender Tage';

-- RLS aktivieren
alter table user_streaks enable row level security;

-- Policies (alter table enable RLS kann mehrfach ausgeführt werden)
drop policy if exists "user_streaks_select_own" on user_streaks;
create policy "user_streaks_select_own"
  on user_streaks for select
  using (auth.uid() = user_id);

drop policy if exists "user_streaks_insert_own" on user_streaks;
create policy "user_streaks_insert_own"
  on user_streaks for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_streaks_update_own" on user_streaks;
create policy "user_streaks_update_own"
  on user_streaks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
