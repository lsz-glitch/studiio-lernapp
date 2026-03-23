# Database (Supabase Schema)

Alle SQL-Skripte für das Supabase-Schema. Sie werden **manuell** im [Supabase SQL Editor](https://supabase.com/dashboard) ausgeführt (kein Migrations-CLI).

## Reihenfolge der Ausführung

1. **Basis-Tabellen** (falls noch nicht vorhanden): `profiles`, `subjects`, `materials` – müssen zuerst existieren, da andere Tabellen darauf verweisen.
2. **Flashcards & Reviews**
   - `supabase-flashcards.sql` – Tabellen `flashcards` und `flashcard_reviews`, RLS
   - `supabase-flashcard-reviews.sql` – ggf. zusätzliche Spalten/Indizes für Reviews
   - `supabase-flashcard-spaced-repetition.sql` – Spaced-Repetition-Felder (z. B. `next_review_at`, Intervalle)
3. **Streak**
   - `supabase-streak.sql` – Streak-Spalten auf `profiles` (z. B. `last_activity_date`, `current_streak_days`)
   - `supabase-user-streaks.sql` – ggf. separate Streak-Tabelle
   - `supabase-streak-rls.sql` – RLS-Policies für Streak
4. **Lernzeit**
   - `supabase-learning-time.sql` – Tabelle für erfasste Lernzeit pro Fach
5. **Lernplan**
   - `supabase-learning-plan.sql` – Tabelle `learning_plan_tasks` (Tutor, Vokabeln, Klausur, manuell)
   - `supabase-learning-plan-description.sql` – ggf. Spalte `description` für Tasks
6. **Optional: PDF-Text-Caching**
   - `supabase-materials-extracted-text.sql` – Spalten in `materials` für extrahierten PDF-Text (`extracted_text`, `extracted_num_pages`, `extracted_at`)
7. **Optional: Seitenkontext (Tutor)**
   - `supabase-material-page-contexts.sql` – speichert Seiten-Zusammenfassungen pro Material und Version (Cache gegen doppelte KI-Kosten)
8. **Tutor-Session-Persistenz**
   - `supabase-tutor-progress.sql` – speichert Tutor-Stand pro Nutzer+Material (Pause/Weiter, Verlauf, Completion)

Abhängigkeiten in den Dateien prüfen (z. B. `subjects`, `materials`, `auth.users`); bei Fehlern zuerst fehlende Tabellen anlegen.

## Kurzbeschreibung der Dateien

| Datei | Inhalt |
|-------|--------|
| `supabase-flashcards.sql` | Tabellen `flashcards`, `flashcard_reviews`; RLS |
| `supabase-flashcard-reviews.sql` | Erweiterungen für Karten-Reviews |
| `supabase-flashcard-spaced-repetition.sql` | Spaced-Repetition (Intervalle, nächste Abfrage) |
| `supabase-streak.sql` | Streak-Spalten auf `profiles` |
| `supabase-user-streaks.sql` | User-Streak-Daten |
| `supabase-streak-rls.sql` | RLS für Streak |
| `supabase-learning-time.sql` | Lernzeit-Tracking pro Fach |
| `supabase-learning-plan.sql` | Tabelle `learning_plan_tasks` |
| `supabase-learning-plan-description.sql` | Beschreibung für Lernplan-Tasks |
| `supabase-materials-extracted-text.sql` | Caching von extrahiertem PDF-Text in `materials` |
| `supabase-material-page-contexts.sql` | Seitenkontext-Cache für Tutor |
| `supabase-tutor-progress.sql` | Persistenter Tutor-Stand inkl. Abschlussstatus |
