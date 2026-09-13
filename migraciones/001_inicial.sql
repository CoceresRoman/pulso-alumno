create table monitores (
  id integer generated always as identity primary key,
  url text not null,
  intervalo_segundos integer not null default 30 check (intervalo_segundos between 10 and 3600),
  timeout_ms integer not null default 5000 check (timeout_ms between 100 and 30000),
  creado_en timestamptz not null default now()
);

create table chequeos (
  id bigint generated always as identity primary key,
  monitor_id integer not null references monitores (id) on delete cascade,
  momento timestamptz not null default now(),
  ok boolean not null,
  codigo integer,
  latencia_ms integer not null,
  error text
);

create index chequeos_monitor_momento on chequeos (monitor_id, momento desc);
