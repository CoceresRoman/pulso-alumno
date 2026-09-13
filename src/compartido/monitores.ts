import type pg from "pg";

export interface Monitor {
  id: number;
  url: string;
  intervaloSegundos: number;
  timeoutMs: number;
  creadoEn: string;
}

export interface DatosMonitor {
  url: string;
  intervaloSegundos: number;
  timeoutMs: number;
}

export interface ResultadoChequeo {
  ok: boolean;
  codigo: number | null;
  latenciaMs: number;
  error: string | null;
}

export interface Chequeo extends ResultadoChequeo {
  momento: string;
}

export interface EstadoMonitor {
  id: number;
  url: string;
  estado: "arriba" | "abajo" | "sin_datos";
  ultimoChequeo: Chequeo | null;
  disponibilidad24h: number | null;
}

interface FilaMonitor {
  id: number;
  url: string;
  intervalo_segundos: number;
  timeout_ms: number;
  creado_en: Date;
}

interface FilaChequeo {
  momento: Date;
  ok: boolean;
  codigo: number | null;
  latencia_ms: number;
  error: string | null;
}

const COLUMNAS = "id, url, intervalo_segundos, timeout_ms, creado_en";

const aMonitor = (f: FilaMonitor): Monitor => ({
  id: f.id,
  url: f.url,
  intervaloSegundos: f.intervalo_segundos,
  timeoutMs: f.timeout_ms,
  creadoEn: f.creado_en.toISOString(),
});

const aChequeo = (f: FilaChequeo): Chequeo => ({
  momento: f.momento.toISOString(),
  ok: f.ok,
  codigo: f.codigo,
  latenciaMs: f.latencia_ms,
  error: f.error,
});

export async function listarMonitores(db: pg.Pool): Promise<Monitor[]> {
  const { rows } = await db.query<FilaMonitor>(`select ${COLUMNAS} from monitores order by id`);
  return rows.map(aMonitor);
}

export async function obtenerMonitor(db: pg.Pool, id: number): Promise<Monitor | null> {
  const { rows } = await db.query<FilaMonitor>(`select ${COLUMNAS} from monitores where id = $1`, [id]);
  return rows[0] ? aMonitor(rows[0]) : null;
}

export async function crearMonitor(db: pg.Pool, datos: DatosMonitor): Promise<Monitor> {
  const { rows } = await db.query<FilaMonitor>(
    `insert into monitores (url, intervalo_segundos, timeout_ms) values ($1, $2, $3) returning ${COLUMNAS}`,
    [datos.url, datos.intervaloSegundos, datos.timeoutMs]
  );
  return aMonitor(rows[0]);
}

export async function actualizarMonitor(db: pg.Pool, id: number, cambios: Partial<DatosMonitor>): Promise<Monitor | null> {
  const { rows } = await db.query<FilaMonitor>(
    `update monitores
        set url = coalesce($2, url),
            intervalo_segundos = coalesce($3, intervalo_segundos),
            timeout_ms = coalesce($4, timeout_ms)
      where id = $1
      returning ${COLUMNAS}`,
    [id, cambios.url ?? null, cambios.intervaloSegundos ?? null, cambios.timeoutMs ?? null]
  );
  return rows[0] ? aMonitor(rows[0]) : null;
}

export async function borrarMonitor(db: pg.Pool, id: number): Promise<boolean> {
  const resultado = await db.query("delete from monitores where id = $1", [id]);
  return (resultado.rowCount ?? 0) > 0;
}

// Tira si el monitor ya no existe (violación de la foreign key): el worker lo maneja.
export async function registrarChequeo(
  db: pg.Pool,
  monitorId: number,
  resultado: ResultadoChequeo,
  momento: Date = new Date()
): Promise<void> {
  await db.query(
    "insert into chequeos (monitor_id, momento, ok, codigo, latencia_ms, error) values ($1, $2, $3, $4, $5, $6)",
    [monitorId, momento, resultado.ok, resultado.codigo, resultado.latenciaMs, resultado.error]
  );
}

export async function listarChequeos(db: pg.Pool, monitorId: number, limite: number): Promise<Chequeo[]> {
  const { rows } = await db.query<FilaChequeo>(
    "select momento, ok, codigo, latencia_ms, error from chequeos where monitor_id = $1 order by momento desc limit $2",
    [monitorId, limite]
  );
  return rows.map(aChequeo);
}

const SQL_ESTADO = `
select m.id, m.url, u.momento, u.ok, u.codigo, u.latencia_ms, u.error, d.total, d.oks
  from monitores m
  left join lateral (
    select momento, ok, codigo, latencia_ms, error
      from chequeos c
     where c.monitor_id = m.id
     order by momento desc
     limit 1
  ) u on true
  left join lateral (
    select count(*)::int as total, (count(*) filter (where ok))::int as oks
      from chequeos c
     where c.monitor_id = m.id and c.momento > $1::timestamptz - interval '24 hours'
  ) d on true
 order by m.id`;

export async function resumenEstado(db: pg.Pool, ahora: Date = new Date()): Promise<EstadoMonitor[]> {
  const { rows } = await db.query<{
    id: number;
    url: string;
    momento: Date | null;
    ok: boolean | null;
    codigo: number | null;
    latencia_ms: number | null;
    error: string | null;
    total: number;
    oks: number;
  }>(SQL_ESTADO, [ahora]);

  return rows.map(f => {
    const ultimoChequeo =
      f.momento === null
        ? null
        : aChequeo({ momento: f.momento, ok: f.ok === true, codigo: f.codigo, latencia_ms: f.latencia_ms ?? 0, error: f.error });
    return {
      id: f.id,
      url: f.url,
      estado: ultimoChequeo === null ? "sin_datos" : ultimoChequeo.ok ? "arriba" : "abajo",
      ultimoChequeo,
      disponibilidad24h: f.total > 0 ? Math.round((f.oks * 1000) / f.total) / 10 : null,
    };
  });
}
