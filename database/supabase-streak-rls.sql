-- RLS-Policies für Streak (profiles)
-- Nur ausführen, wenn der Streak weiterhin nicht erscheint.
-- Einmalig im Supabase SQL Editor ausführen.
-- Wenn eine Policy schon existiert, erscheint eine Fehlermeldung – dann die nächste ausführen.

-- 1) Nutzer darf eigene Profil-Zeile lesen
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

-- 2) Nutzer darf eigene Zeile anlegen (für Upsert bei neuem Nutzer)
create policy "profiles_insert_own"
  on profiles for insert
  with check (auth.uid() = id);

-- 3) Nutzer darf eigene Zeile aktualisieren (Streak, API-Key etc.)
create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
