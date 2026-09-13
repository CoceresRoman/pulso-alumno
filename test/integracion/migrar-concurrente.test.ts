import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { migrar } from "../../src/compartido/migrar.ts";
import { abrirBaseDePrueba, CARPETA_MIGRACIONES, type BaseDePrueba } from "../soporte/base.ts";
import { requerirServicios } from "../soporte/servicios.ts";

requerirServicios();
let base: BaseDePrueba;

before(async () => {
  base = await abrirBaseDePrueba({ migrada: false });
});

after(async () => {
  await base.cerrar();
});

test("dos corridas a la vez aplican cada migración una sola vez", async () => {
  const resultados = await Promise.all([migrar(base.pool, CARPETA_MIGRACIONES), migrar(base.pool, CARPETA_MIGRACIONES)]);
  assert.deepEqual(resultados.flat(), ["001_inicial.sql"]);
});
