import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as esperar } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { crearLogger } from "../../src/compartido/logger.ts";
import { crearMetricasWorker } from "../../src/compartido/metricas.ts";
import { crearMonitor, listarChequeos } from "../../src/compartido/monitores.ts";
import { crearConexionWorker, NOMBRE_COLA, NOMBRE_TRABAJO, type DatosTrabajo } from "../../src/compartido/programador.ts";
import { crearSitioLento } from "../../src/sitio-lento/app.ts";
import { procesarChequeo } from "../../src/worker/procesar.ts";
import { abrirBaseDePrueba, type BaseDePrueba } from "../soporte/base.ts";
import { requerirServicios } from "../soporte/servicios.ts";

const { redisUrl } = requerirServicios();
let base: BaseDePrueba;
let cola: Queue<DatosTrabajo>;
let conexionCola: Redis;
let sitio: Server;
let sitioUrl = "";
// BullMQ no cierra las conexiones de ioredis que le pasamos armadas (ver programador.ts):
// worker.close() con esta conexión es un no-op y, sin desconectarla a mano, node --test
// queda colgado esperando que se cierre solo.
const conexionesWorker: Redis[] = [];

function crearWorker(fallaSinTimeout: boolean, concurrencia: number) {
  const deps = {
    db: base.pool,
    metricas: crearMetricasWorker(async () => 0),
    logger: crearLogger("test", "silent"),
    quitarScheduler: async () => {},
    fallaSinTimeout,
  };
  const conexion = crearConexionWorker(redisUrl);
  conexionesWorker.push(conexion);
  return new Worker<DatosTrabajo>(NOMBRE_COLA, async trabajo => {
    await procesarChequeo(deps, trabajo.data.monitorId);
  }, { connection: conexion, concurrency: concurrencia });
}

async function esperarChequeos(monitorId: number, cantidad: number, maxMs: number) {
  const limite = Date.now() + maxMs;
  while (Date.now() < limite) {
    const chequeos = await listarChequeos(base.pool, monitorId, 10);
    if (chequeos.length >= cantidad) return chequeos;
    await esperar(100);
  }
  return listarChequeos(base.pool, monitorId, 10);
}

before(async () => {
  const admin = new Redis(redisUrl);
  await admin.flushall();
  admin.disconnect();
  base = await abrirBaseDePrueba();
  conexionCola = new Redis(redisUrl, { maxRetriesPerRequest: null });
  cola = new Queue(NOMBRE_COLA, { connection: conexionCola });
  sitio = crearSitioLento().listen(0, "127.0.0.1");
  await once(sitio, "listening");
  sitioUrl = `http://127.0.0.1:${(sitio.address() as AddressInfo).port}`;
});

after(async () => {
  await cola.close();
  conexionCola.disconnect();
  for (const conexion of conexionesWorker) conexion.disconnect();
  sitio.closeAllConnections();
  sitio.close();
  await base.cerrar();
});

test("el worker toma un trabajo de la cola y guarda el chequeo", async () => {
  const worker = crearWorker(false, 2);
  try {
    const monitor = await crearMonitor(base.pool, { url: `${sitioUrl}/ok`, intervaloSegundos: 30, timeoutMs: 1000 });
    await cola.add(NOMBRE_TRABAJO, { monitorId: monitor.id });
    const chequeos = await esperarChequeos(monitor.id, 1, 10_000);
    assert.deepEqual(chequeos.map(c => c.codigo), [200]);
  } finally {
    await worker.close(true);
  }
});

test("con FALLA_SIN_TIMEOUT un sitio colgado frena la cola", async () => {
  const worker = crearWorker(true, 1);
  try {
    const colgado = await crearMonitor(base.pool, { url: `${sitioUrl}/colgado`, intervaloSegundos: 30, timeoutMs: 200 });
    const sano = await crearMonitor(base.pool, { url: `${sitioUrl}/ok`, intervaloSegundos: 30, timeoutMs: 1000 });
    await cola.add(NOMBRE_TRABAJO, { monitorId: colgado.id });
    await esperar(500);
    await cola.add(NOMBRE_TRABAJO, { monitorId: sano.id });
    await esperar(2000);
    assert.equal((await listarChequeos(base.pool, sano.id, 10)).length, 0, "el chequeo sano no debería haber corrido");
    assert.equal((await cola.getJobCounts("waiting")).waiting, 1);
  } finally {
    sitio.closeAllConnections();
    await worker.close(true);
  }
});
