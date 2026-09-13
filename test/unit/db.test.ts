import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { levels, pino } from "pino";
import type pg from "pg";
import { crearPool, dbListo } from "../../src/compartido/db.ts";

test("dbListo da false rápido si la consulta se cuelga", async () => {
  const colgada = { query: () => new Promise(() => {}) } as unknown as pg.Pool;
  const inicio = performance.now();
  assert.equal(await dbListo(colgada, 100), false);
  assert.ok(performance.now() - inicio < 500, "dbListo tardó demasiado");
});

test("dbListo da true si la consulta resuelve", async () => {
  const sana = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  assert.equal(await dbListo(sana), true);
});

test("dbListo da false si la consulta rechaza", async () => {
  const rota = {
    query: async () => {
      throw new Error("boom");
    },
  } as unknown as pg.Pool;
  assert.equal(await dbListo(rota), false);
});

test("crearPool loguea a warn una sola vez si el pool pierde una conexión ociosa, sin tirar", async () => {
  const salida = new PassThrough();
  const lineas: string[] = [];
  salida.on("data", chunk => lineas.push(String(chunk)));
  const logger = pino({ level: "warn" }, salida);

  // La URL no se usa: pg.Pool no conecta hasta la primera consulta, así que crear el pool
  // acá no abre ningún socket. Simulamos la caída emitiendo "error" directo, como haría
  // node-postgres cuando Postgres corta una conexión ociosa.
  const pool = crearPool("postgresql://usuario:clave@localhost:5432/no-existe", logger);
  try {
    assert.doesNotThrow(() => pool.emit("error", new Error("conexión terminada por el servidor")));

    assert.equal(lineas.length, 1);
    const registro = JSON.parse(lineas[0]);
    assert.equal(registro.level, levels.values.warn);
    assert.equal(registro.msg, "se perdió una conexión ociosa con la base");
    assert.equal(registro.err.message, "conexión terminada por el servidor");
  } finally {
    await pool.end();
  }
});
