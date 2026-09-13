import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearLogger } from "../../src/compartido/logger.ts";
import { crearMetricasWorker, type MetricasWorker } from "../../src/compartido/metricas.ts";
import { borrarMonitor, crearMonitor, listarChequeos } from "../../src/compartido/monitores.ts";
import { crearSitioLento } from "../../src/sitio-lento/app.ts";
import { procesarChequeo, type DependenciasProceso } from "../../src/worker/procesar.ts";
import { abrirBaseDePrueba, type BaseDePrueba } from "../soporte/base.ts";

let base: BaseDePrueba;
let sitio: Server;
let sitioUrl = "";
let metricas: MetricasWorker;
let quitados: number[];

const deps = (extra: Partial<DependenciasProceso> = {}): DependenciasProceso => ({
  db: base.pool,
  metricas,
  logger: crearLogger("test", "silent"),
  quitarScheduler: async id => {
    quitados.push(id);
  },
  fallaSinTimeout: false,
  ...extra,
});

before(async () => {
  base = await abrirBaseDePrueba();
  sitio = crearSitioLento().listen(0, "127.0.0.1");
  await once(sitio, "listening");
  sitioUrl = `http://127.0.0.1:${(sitio.address() as AddressInfo).port}`;
  metricas = crearMetricasWorker(async () => 0);
  quitados = [];
});

after(async () => {
  sitio.closeAllConnections();
  sitio.close();
  await base.cerrar();
});

test("un sitio arriba guarda un chequeo ok y lo cuenta", async () => {
  const monitor = await crearMonitor(base.pool, { url: `${sitioUrl}/ok`, intervaloSegundos: 30, timeoutMs: 1000 });
  const resultado = await procesarChequeo(deps(), monitor.id);
  assert.equal(resultado?.ok, true);
  const chequeos = await listarChequeos(base.pool, monitor.id, 10);
  assert.deepEqual(chequeos.map(c => ({ ok: c.ok, codigo: c.codigo })), [{ ok: true, codigo: 200 }]);
  assert.match(await metricas.registro.metrics(), /^pulso_chequeos_total\{resultado="ok"\} 1$/m);
});

test("un sitio con error guarda la falla con su código", async () => {
  const monitor = await crearMonitor(base.pool, { url: `${sitioUrl}/error?codigo=503`, intervaloSegundos: 30, timeoutMs: 1000 });
  await procesarChequeo(deps(), monitor.id);
  assert.deepEqual((await listarChequeos(base.pool, monitor.id, 10)).map(c => c.codigo), [503]);
  assert.match(await metricas.registro.metrics(), /^pulso_chequeos_total\{resultado="falla"\} 1$/m);
});

test("un monitor que ya no existe quita su scheduler y no guarda nada", async () => {
  assert.equal(await procesarChequeo(deps(), 999_999), null);
  assert.deepEqual(quitados, [999_999]);
});

test("si borran el monitor durante el chequeo no tira", async () => {
  const monitor = await crearMonitor(base.pool, { url: `${sitioUrl}/lento?ms=300`, intervaloSegundos: 30, timeoutMs: 2000 });
  const enCurso = procesarChequeo(deps(), monitor.id);
  await new Promise(resolve => setTimeout(resolve, 100));
  await borrarMonitor(base.pool, monitor.id);
  assert.equal(await enCurso, null);
});

test("con timeout corta un sitio colgado; con FALLA_SIN_TIMEOUT queda colgado", async () => {
  const monitor = await crearMonitor(base.pool, { url: `${sitioUrl}/colgado`, intervaloSegundos: 30, timeoutMs: 200 });
  const conTimeout = await procesarChequeo(deps(), monitor.id);
  assert.equal(conTimeout?.error, "timeout");
  const sinTimeout = await Promise.race([
    procesarChequeo(deps({ fallaSinTimeout: true }), monitor.id),
    new Promise(resolve => setTimeout(() => resolve("sigue colgado"), 600)),
  ]);
  assert.equal(sinTimeout, "sigue colgado");
});
