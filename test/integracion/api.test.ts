import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { crearApp } from "../../src/api/app.ts";
import { crearLogger } from "../../src/compartido/logger.ts";
import { crearMetricasApi } from "../../src/compartido/metricas.ts";
import { crearProgramadorBullmq, NOMBRE_COLA, type Programador } from "../../src/compartido/programador.ts";
import { abrirBaseDePrueba, type BaseDePrueba } from "../soporte/base.ts";
import { requerirServicios } from "../soporte/servicios.ts";

const { redisUrl } = requerirServicios();
let base: BaseDePrueba;
let programador: Programador;
let conexionCola: Redis;
let cola: Queue;
let servidor: Server;
let url = "";

before(async () => {
  const admin = new Redis(redisUrl);
  await admin.flushall();
  admin.disconnect();
  base = await abrirBaseDePrueba();
  programador = crearProgramadorBullmq(redisUrl);
  conexionCola = new Redis(redisUrl, { maxRetriesPerRequest: null });
  cola = new Queue(NOMBRE_COLA, { connection: conexionCola });
  servidor = crearApp({ db: base.pool, programador, metricas: crearMetricasApi(), logger: crearLogger("test", "silent") }).listen(0, "127.0.0.1");
  await once(servidor, "listening");
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(async () => {
  servidor.close();
  // BullMQ no cierra las conexiones de ioredis que le pasamos armadas (ver programador.ts):
  // cola.close() con esta conexión es un no-op y, sin desconectarla a mano, el proceso queda
  // colgado esperando que se cierre solo.
  await cola.close();
  conexionCola.disconnect();
  await programador.cerrar();
  await base.cerrar();
});

test("readyz con Postgres y Valkey reales", async () => {
  const r = await fetch(`${url}/readyz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { estado: "listo", base: true, cola: true });
});

test("alta y baja se reflejan en los schedulers de BullMQ", async () => {
  const alta = await fetch(`${url}/api/monitores`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com", intervaloSegundos: 45, timeoutMs: 1000 }),
  });
  assert.equal(alta.status, 201);
  const monitor = (await alta.json()) as { id: number };
  const schedulers = await cola.getJobSchedulers();
  assert.deepEqual(schedulers.map(s => ({ key: s.key, every: Number(s.every) })), [{ key: `monitor-${monitor.id}`, every: 45_000 }]);

  assert.equal((await fetch(`${url}/api/monitores/${monitor.id}`, { method: "DELETE" })).status, 204);
  assert.deepEqual(await cola.getJobSchedulers(), []);
});
