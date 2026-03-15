-- Nur die Tabelle für Bewertungen (richtig/falsch) – Anki-ähnlich
-- Falls du supabase-flashcards.sql schon ausgeführt hast: nur DIESE Datei im SQL Editor ausführen.

create table if not exists flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid not null references flashcards(id) on delete cascade,
  correct boolean not null,
  created_at timestamptz default now()
);

create index if not exists flashcard_reviews_user on flashcard_reviews(user_id);
create index if not exists flashcard_reviews_flashcard on flashcard_reviews(flashcard_id);

alter table flashcard_reviews enable row level security;

create policy "User can manage own flashcard_reviews"
  on flashcard_reviews for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
