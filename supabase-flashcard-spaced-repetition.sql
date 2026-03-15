-- Spaced Repetition (Anki-ähnlich): nächste Abfrage + Intervall pro Karte
-- Einmalig im Supabase SQL Editor ausführen (nach supabase-flashcards.sql / flashcard_reviews).

alter table flashcards
  add column if not exists next_review_at timestamptz default null,
  add column if not exists interval_days int default 0;

comment on column flashcards.next_review_at is 'Nächster Abfragetermin (null = sofort fällig)';
comment on column flashcards.interval_days is 'Aktuelles Intervall in Tagen (0 = noch nicht gelernt / wiederholen)';
