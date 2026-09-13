import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  actualizarMonitor,
  borrarMonitor,
  crearMonitor,
  listarChequeos,
  listarMonitores,
  obtenerMonitor,
  registrarChequeo,
  resumenEstado,
} from "../../src/compartido/monitores.ts";
import { abrirBaseDePrueba, type BaseDePrueba } from "../soporte/base.ts";

let base: BaseDePrueba;

before(async () => {
  base = await abrirBaseDePrueba();
});

after(async () => {
  await base.cerrar();
});

test("crear, obtener y listar", async () => {
  const creado = await crearMonitor(base.pool, { url: "https://a.example", intervaloSegundos: 30, timeoutMs: 5000 });
  assert.equal(typeof creado.id, "number");
  assert.match(creado.creadoEn, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(await obtenerMonitor(base.pool, creado.id), creado);
  assert.deepEqual((await listarMonitores(base.pool)).map(m => m.url), ["https://a.example"]);
  assert.equal(await obtenerMonitor(base.pool, 999_999), null);
});

test("actualizar cambia solo lo que llega", async () => {
  const monitor = await crearMonitor(base.pool, { url: "https://b.example", intervaloSegundos: 60, timeoutMs: 2000 });
  const cambiado = await actualizarMonitor(base.pool, monitor.id, { timeoutMs: 1000 });
  assert.deepEqual(
    { url: cambiado?.url, intervaloSegundos: cambiado?.intervaloSegundos, timeoutMs: cambiado?.timeoutMs },
    { url: "https://b.example", intervaloSegundos: 60, timeoutMs: 1000 }
  );
  assert.equal(await actualizarMonitor(base.pool, 999_999, { timeoutMs: 1000 }), null);
});

test("la base rechaza intervalos fuera de rango", async () => {
  await assert.rejects(
    crearMonitor(base.pool, { url: "https://c.example", intervaloSegundos: 5, timeoutMs: 5000 }),
    /check constraint/
  );
});

test("resumen de estado: último chequeo y disponibilidad de 24 h", async () => {
  const conDatos = await crearMonitor(base.pool, { url: "https://d.example", intervaloSegundos: 30, timeoutMs: 5000 });
  const sinDatos = await crearMonitor(base.pool, { url: "https://e.example", intervaloSegundos: 30, timeoutMs: 5000 });
  const ahora = new Date("2026-09-13T12:00:00.000Z");
  const hace = (horas: number) => new Date(ahora.getTime() - horas * 3_600_000);
  await registrarChequeo(base.pool, conDatos.id, { ok: false, codigo: null, latenciaMs: 5000, error: "timeout" }, hace(30));
  await registrarChequeo(base.pool, conDatos.id, { ok: true, codigo: 200, latenciaMs: 30, error: null }, hace(3));
  await registrarChequeo(base.pool, conDatos.id, { ok: false, codigo: 503, latenciaMs: 80, error: null }, hace(2));
  await registrarChequeo(base.pool, conDatos.id, { ok: true, codigo: 200, latenciaMs: 40, error: null }, hace(1));

  const estado = await resumenEstado(base.pool, ahora);
  assert.deepEqual(
    estado.find(e => e.id === conDatos.id),
    {
      id: conDatos.id,
      url: "https://d.example",
      estado: "arriba",
      ultimoChequeo: { momento: hace(1).toISOString(), ok: true, codigo: 200, latenciaMs: 40, error: null },
      disponibilidad24h: 66.7,
    }
  );
  assert.deepEqual(estado.find(e => e.id === sinDatos.id), {
    id: sinDatos.id,
    url: "https://e.example",
    estado: "sin_datos",
    ultimoChequeo: null,
    disponibilidad24h: null,
  });
  assert.deepEqual((await listarChequeos(base.pool, conDatos.id, 2)).map(c => c.codigo), [200, 503]);
});

test("borrar un monitor borra sus chequeos", async () => {
  const monitor = await crearMonitor(base.pool, { url: "https://f.example", intervaloSegundos: 30, timeoutMs: 5000 });
  await registrarChequeo(base.pool, monitor.id, { ok: true, codigo: 200, latenciaMs: 10, error: null });
  assert.equal(await borrarMonitor(base.pool, monitor.id), true);
  assert.equal(await borrarMonitor(base.pool, monitor.id), false);
  const { rows } = await base.pool.query("select 1 from chequeos where monitor_id = $1", [monitor.id]);
  assert.equal(rows.length, 0);
});
