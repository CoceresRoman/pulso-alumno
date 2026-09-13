import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrar } from "../../src/compartido/migrar.ts";
import { abrirBaseDePrueba, CARPETA_MIGRACIONES, type BaseDePrueba } from "../soporte/base.ts";

let base: BaseDePrueba;

before(async () => {
  base = await abrirBaseDePrueba({ migrada: false });
});

after(async () => {
  await base.cerrar();
});

test("la primera corrida aplica 001 y crea las tablas", async () => {
  assert.deepEqual(await migrar(base.pool, CARPETA_MIGRACIONES), ["001_inicial.sql"]);
  const { rows } = await base.pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  );
  assert.deepEqual(rows.map(r => r.tablename), ["chequeos", "monitores", "schema_migrations"]);
});

test("la segunda corrida no aplica nada", async () => {
  assert.deepEqual(await migrar(base.pool, CARPETA_MIGRACIONES), []);
});

test("una migración rota no queda a medias ni registrada", async () => {
  const carpeta = await mkdtemp(join(tmpdir(), "pulso-migraciones-"));
  try {
    await writeFile(join(carpeta, "001_inicial.sql"), "select 1");
    await writeFile(join(carpeta, "002_rota.sql"), "create table a_medias (id integer); select * from no_existe;");
    await assert.rejects(migrar(base.pool, carpeta), /falló la migración 002_rota\.sql/);
    const tabla = await base.pool.query("select 1 from pg_tables where tablename = 'a_medias'");
    assert.equal(tabla.rows.length, 0);
    const registradas = await base.pool.query<{ nombre: string }>("select nombre from schema_migrations order by nombre");
    assert.deepEqual(registradas.rows.map(r => r.nombre), ["001_inicial.sql"]);
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
});
