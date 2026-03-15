-- Tabelle für Vokabeln/Karteikarten (pro Fach)
-- Einmalig in Supabase: Dashboard → SQL Editor → New query → Inhalt einfügen → Run

create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  material_id uuid references materials(id) on delete set null,
  format text not null check (format in ('definition','open','multiple_choice','single_choice')),
  question text not null,
  answer text not null,
  options jsonb default null,
  position int default 0,
  created_at timestamptz default now()
);

create index if not exists flashcards_user_subject on flashcards(user_id, subject_id);
create index if not exists flashcards_material on flashcards(material_id);

alter table flashcards enable row level security;

create policy "User can manage own flashcards"
  on flashcards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Bewertungen (richtig/falsch) pro Karte – für Anki-ähnliches Lernen
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
