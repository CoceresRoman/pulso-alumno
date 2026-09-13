import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { crearProgramadorBullmq, NOMBRE_COLA, type Programador } from "../../src/compartido/programador.ts";
import { requerirServicios } from "../soporte/servicios.ts";

const { redisUrl } = requerirServicios();
let admin: Redis;
let conexionCola: Redis;
let cola: Queue;
let programador: Programador;

before(async () => {
  admin = new Redis(redisUrl);
  await admin.flushall();
  conexionCola = new Redis(redisUrl, { maxRetriesPerRequest: null });
  cola = new Queue(NOMBRE_COLA, { connection: conexionCola });
  programador = crearProgramadorBullmq(redisUrl);
});

after(async () => {
  await programador.cerrar();
  // BullMQ no cierra las instancias de ioredis que le pasamos armadas (ver programador.ts):
  // cola.close() con esta conexión es un no-op y, sin desconectarla a mano, el proceso queda
  // colgado esperando que se cierre solo.
  await cola.close();
  conexionCola.disconnect();
  admin.disconnect();
});

test("programar el mismo monitor varias veces a la vez deja un solo scheduler", async () => {
  await programador.programar({ id: 1, intervaloSegundos: 30 });
  await Promise.all([
    programador.programar({ id: 1, intervaloSegundos: 60 }),
    programador.programar({ id: 1, intervaloSegundos: 60 }),
    programador.programar({ id: 1, intervaloSegundos: 60 }),
  ]);
  const schedulers = await cola.getJobSchedulers();
  assert.deepEqual(
    schedulers.map(s => ({ key: s.key, every: Number(s.every) })),
    [{ key: "monitor-1", every: 60_000 }]
  );
});

test("quitar borra el scheduler y es idempotente", async () => {
  await programador.programar({ id: 2, intervaloSegundos: 30 });
  await programador.quitar(2);
  await programador.quitar(2);
  assert.deepEqual((await cola.getJobSchedulers()).map(s => s.key), ["monitor-1"]);
});

test("listo responde true con la cola arriba y pendientes cuenta los trabajos esperando", async () => {
  assert.equal(await programador.listo(), true);
  // No un número fijo: los schedulers de los tests anteriores ya dejaron trabajos
  // esperando (upsertJobScheduler con `every` encola la primera repetición de una),
  // así que medimos la diferencia en vez de asumir que la cola arranca en cero.
  const antes = await programador.pendientes();
  await cola.add("chequear", { monitorId: 99 });
  assert.equal(await programador.pendientes(), antes + 1);
});

test("listo responde false rápido si la cola no existe", async () => {
  const caido = crearProgramadorBullmq("redis://127.0.0.1:1");
  try {
    const inicio = performance.now();
    assert.equal(await caido.listo(), false);
    assert.ok(performance.now() - inicio < 2500, "listo() tardó demasiado");
  } finally {
    await caido.cerrar();
  }
});
