import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { levels, pino } from "pino";
import pg from "pg";
import { crearPool } from "../../src/compartido/db.ts";
import { requerirServicios } from "../soporte/servicios.ts";

const { databaseUrl } = requerirServicios();

// Dejamos un cliente ocioso en el pool y lo matamos desde otra conexión: así se ve, en los
// labs, un reinicio de Postgres o un `pg_terminate_backend` a mano mientras el pool tiene
// conexiones sin usar.
async function matarConexionOciosa(pool: pg.Pool): Promise<void> {
  const cliente = await pool.connect();
  const { rows } = await cliente.query<{ pid: number }>("select pg_backend_pid() as pid");
  cliente.release();

  const otra = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await otra.query("select pg_terminate_backend($1)", [rows[0].pid]);
  } finally {
    await otra.end();
  }
}

test("una conexión ociosa cortada por el servidor no tira el proceso: el pool avisa por 'error'", async () => {
  const salida = new PassThrough();
  const lineas: string[] = [];
  salida.on("data", chunk => lineas.push(String(chunk)));
  const logger = pino({ level: "warn" }, salida);
  const pool = crearPool(databaseUrl, logger);
  try {
    const eventoError = once(pool, "error");
    await matarConexionOciosa(pool);

    // Si esto no resuelve es porque nadie escucha "error" en el pool: con la corrección,
    // se resuelve solo (y, sin ella, el proceso ya se habría caído antes de llegar acá).
    const [error] = await eventoError;
    assert.ok(error instanceof Error);

    assert.equal(lineas.length, 1, "tiene que haber logueado exactamente una vez");
    const registro = JSON.parse(lineas[0]);
    assert.equal(registro.level, levels.values.warn);
    assert.equal(registro.msg, "se perdió una conexión ociosa con la base");
  } finally {
    await pool.end();
  }
});

test("después de perder una conexión ociosa, el pool se recupera solo", async () => {
  const logger = pino({ level: "silent" });
  const pool = crearPool(databaseUrl, logger);
  try {
    const eventoError = once(pool, "error");
    await matarConexionOciosa(pool);
    await eventoError;

    // El pool descartó el cliente muerto: esta consulta tiene que abrir una conexión nueva.
    const { rows } = await pool.query<{ uno: number }>("select 1 as uno");
    assert.equal(rows[0].uno, 1);
  } finally {
    await pool.end();
  }
});
