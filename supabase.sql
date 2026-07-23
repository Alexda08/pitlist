-- Ejecutar en Supabase > SQL Editor (una sola vez)

create table if not exists garages (
  code text primary key,
  data jsonb not null default '{"projects":[],"parts":{},"updatedAt":0}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table garages enable row level security;

-- Modelo de confianza v1: quien tiene el código, lee y escribe.
-- (El código no es enumerable; no metas datos sensibles.)
create policy "read garages"   on garages for select using (true);
create policy "create garages" on garages for insert with check (true);
create policy "update garages" on garages for update using (true);
-- Nota: sin policy de DELETE a propósito — nadie puede borrar salas desde el cliente.

-- Realtime para las suscripciones del frontend
alter publication supabase_realtime add table garages;


-- ============================================================
-- Chat de sala + comentarios en piezas
-- Fuera del blob a propósito: el blob se reescribe entero en cada mutación
-- (last-write-wins) y un chat lo convertiría en pérdida de datos.
-- Re-ejecutable. No toca garages ni sus datos.
-- ============================================================

create table if not exists garage_messages (
  id          uuid primary key,                    -- lo genera el navegador (crypto.randomUUID)
  seq         bigint generated always as identity, -- orden, cursor y no leídos
  garage_code text not null references garages(code) on delete cascade,
  kind        text not null check (kind in ('chat','comment')),
  part_id     text,                                -- solo en comentarios
  project_id  text,                                -- para limpiar al borrar un build
  author      text not null check (char_length(author) between 1 and 16),
  client_id   text not null,                       -- token opaco de navegador
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  constraint comment_needs_part check (kind = 'chat' or part_id is not null)
);

create index if not exists garage_messages_room_idx
  on garage_messages (garage_code, kind, seq desc);

create index if not exists garage_messages_part_idx
  on garage_messages (part_id, seq) where kind = 'comment';

alter table garage_messages enable row level security;

-- Mismo modelo de confianza que garages: quien tiene el código, entra.
drop policy if exists "read messages"   on garage_messages;
drop policy if exists "post messages"   on garage_messages;
drop policy if exists "delete messages" on garage_messages;

create policy "read messages"   on garage_messages for select using (true);
create policy "post messages"   on garage_messages for insert with check (true);
create policy "delete messages" on garage_messages for delete using (true);
-- Sin policy de UPDATE a propósito: un mensaje enviado es inmutable.

-- Realtime, idempotente (añadir dos veces la misma tabla revienta)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'garage_messages'
  ) then
    alter publication supabase_realtime add table garage_messages;
  end if;
end $$;
