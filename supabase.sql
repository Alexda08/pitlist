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
