-- Seitenkontext pro Material (mit Cache/Fingerprint), um doppelte KI-Kosten zu vermeiden.
create table if not exists material_page_contexts (
  id bigserial primary key,
  material_id uuid not null references materials(id) on delete cascade,
  page_number integer not null,
  context_version integer not null default 1,
  fingerprint text not null,
  source_type text not null default 'text_only',
  text_excerpt text,
  combined_summary text,
  updated_at timestamptz not null default now(),
  unique (material_id, page_number, context_version)
);

create index if not exists idx_material_page_contexts_material
  on material_page_contexts(material_id, context_version);
