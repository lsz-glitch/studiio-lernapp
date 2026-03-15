-- Streak-System (Phase 3, Schritt 13)
-- Einmalig im Supabase SQL Editor ausführen.
-- Voraussetzung: Tabelle "profiles" existiert (z. B. mit id, claude_api_key_encrypted).

-- Spalten für Streak hinzufügen (falls profiles schon existiert)
alter table profiles
  add column if not exists last_activity_date date default null,
  add column if not exists current_streak_days int default 0;

comment on column profiles.last_activity_date is 'Letzter Tag mit mindestens einer Lernaktivität (Streak)';
comment on column profiles.current_streak_days is 'Aktuelle Anzahl aufeinanderfolgender Tage mit Aktivität';

-- RLS: Damit Streak funktioniert, muss der Nutzer seine Zeile lesen, einfügen und aktualisieren können.
-- Falls Streak trotzdem nicht erscheint: Nacheinander die folgenden Zeilen ausführen.
-- (Falls eine Policy schon existiert, erscheint ein Fehler – dann die nächste ausführen.)

-- Nutzer darf eigene Profil-Zeile lesen (falls noch nicht vorhanden):
-- create policy "User can read own profile" on profiles for select using (auth.uid() = id);

-- Nutzer darf eigene Zeile anlegen (für Upsert, wenn noch keine Zeile existiert):
-- create policy "User can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Nutzer darf eigene Zeile aktualisieren:
-- create policy "User can update own profile" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
