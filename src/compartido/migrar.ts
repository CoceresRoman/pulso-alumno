import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import type { Logger } from "./logger.ts";

// Número fijo del lock: dos `npm run migrar` a la vez (dos réplicas, un Job que se
// reintenta) se ponen en fila en vez de aplicar la misma migración dos veces.
export const LOCK_MIGRACIONES = 7_331_001;

export async function migrar(pool: pg.Pool, carpeta: string, logger?: Logger): Promise<string[]> {
  const cliente = await pool.connect();
  // Mientras el cliente está afuera del pool (todo lo que dura la migración), pg-pool le
  // saca el listener de error que le pone a los clientes ociosos (se lo vuelve a poner
  // recién cuando se libera): sin uno propio acá, una conexión que se corta a mitad de
  // migración emite "error" sin nadie escuchando y tira abajo el proceso, aparte de que la
  // consulta en curso ya rechaza sola (eso lo maneja el catch de abajo).
  cliente.on("error", error => {
    logger?.warn({ err: error }, "se perdió la conexión con la base mientras se migraba");
  });
  try {
    await cliente.query("select pg_advisory_lock($1)", [LOCK_MIGRACIONES]);
    await cliente.query(
      "create table if not exists schema_migrations (nombre text primary key, aplicada_en timestamptz not null default now())"
    );
    const { rows } = await cliente.query<{ nombre: string }>("select nombre from schema_migrations");
    const hechas = new Set(rows.map(r => r.nombre));
    const archivos = (await readdir(carpeta)).filter(a => a.endsWith(".sql")).sort();

    const aplicadas: string[] = [];
    for (const archivo of archivos) {
      if (hechas.has(archivo)) continue;
      const sql = await readFile(join(carpeta, archivo), "utf8");
      try {
        await cliente.query("begin");
        await cliente.query(sql);
        await cliente.query("insert into schema_migrations (nombre) values ($1)", [archivo]);
        await cliente.query("commit");
      } catch (error) {
        await cliente.query("rollback");
        const detalle = error instanceof Error ? error.message : String(error);
        throw new Error(`falló la migración ${archivo}: ${detalle}`, { cause: error });
      }
      aplicadas.push(archivo);
    }
    return aplicadas;
  } finally {
    // Si la conexión se cortó, el unlock falla, pero el lock se libera solo al cerrarse la sesión.
    await cliente.query("select pg_advisory_unlock($1)", [LOCK_MIGRACIONES]).catch(() => undefined);
    cliente.release();
  }
}
