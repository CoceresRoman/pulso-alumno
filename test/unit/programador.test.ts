import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as esperar } from "node:timers/promises";
import { crearProgramadorBullmq } from "../../src/compartido/programador.ts";
import type { Logger } from "../../src/compartido/logger.ts";

// redis://127.0.0.1:1 conecta a un puerto que nadie escucha: se rechaza sin falta y sin
// depender de TEST_REDIS_URL, así que estos tests no necesitan servicios levantados.
const COLA_INALCANZABLE = "redis://127.0.0.1:1";

test("programar rechaza en menos de 5 s con la cola inalcanzable", async () => {
  const caido = crearProgramadorBullmq(COLA_INALCANZABLE);
  try {
    const inicio = performance.now();
    await assert.rejects(caido.programar({ id: 1, intervaloSegundos: 30 }), /cola no disponible/);
    assert.ok(performance.now() - inicio < 5000, "programar tardó demasiado");
  } finally {
    // Cerramos todas las conexiones: BullMQ no cierra las que le pasamos armadas, y sin esto
    // ioredis las deja reintentando y node --test no termina.
    await caido.cerrar();
  }
});

test("pendientes rechaza en menos de 5 s con la cola inalcanzable", async () => {
  const caido = crearProgramadorBullmq(COLA_INALCANZABLE);
  try {
    const inicio = performance.now();
    await assert.rejects(caido.pendientes(), /cola no disponible/);
    assert.ok(performance.now() - inicio < 5000, "pendientes tardó demasiado");
  } finally {
    await caido.cerrar();
  }
});

test("quitar rechaza en menos de 5 s con la cola inalcanzable", async () => {
  const caido = crearProgramadorBullmq(COLA_INALCANZABLE);
  try {
    const inicio = performance.now();
    await assert.rejects(caido.quitar(1), /cola no disponible/);
    assert.ok(performance.now() - inicio < 5000, "quitar tardó demasiado");
  } finally {
    await caido.cerrar();
  }
});

test("con la cola caída, avisa una sola vez por warn en vez de en cada reintento", async () => {
  const avisos: unknown[] = [];
  const logger = { warn: (...args: unknown[]) => avisos.push(args) } as unknown as Logger;
  const caido = crearProgramadorBullmq(COLA_INALCANZABLE, logger);
  try {
    // ioredis reintenta la conexión varias veces en este lapso (backoff propio, en unos
    // cientos de ms cada intento): un solo warn confirma que se loguea por cambio de
    // estado, no por cada intento fallido.
    await esperar(1500);
    assert.equal(avisos.length, 1);
  } finally {
    await caido.cerrar();
  }
});
