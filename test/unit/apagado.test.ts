import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as esperar } from "node:timers/promises";
import { alApagar } from "../../src/compartido/apagado.ts";
import { crearLogger } from "../../src/compartido/logger.ts";

// `node --test` genera un reporte de diagnóstico cada vez que el proceso recibe SIGUSR2
// (aunque sea emitido a mano, sin venir del SO): lo desactivamos para no ensuciar la salida
// ni dejar archivos report.*.json colgando.
process.report.reportOnSignal = false;

const logger = crearLogger("test", "silent");
let quitar: () => void = () => {};

afterEach(() => {
  quitar();
});

test("al recibir la señal corre las tareas una sola vez y sale con 0", async () => {
  let corridas = 0;
  const salidas: number[] = [];
  quitar = alApagar(logger, async () => {
    corridas++;
  }, { senales: ["SIGUSR2"], salir: codigo => salidas.push(codigo) });
  process.emit("SIGUSR2");
  process.emit("SIGUSR2");
  await esperar(20);
  assert.equal(corridas, 1);
  assert.deepEqual(salidas, [0]);
});

test("si una tarea falla sale con 1", async () => {
  const salidas: number[] = [];
  quitar = alApagar(logger, async () => {
    throw new Error("no cerró");
  }, { senales: ["SIGUSR2"], salir: codigo => salidas.push(codigo) });
  process.emit("SIGUSR2");
  await esperar(20);
  assert.deepEqual(salidas, [1]);
});

test("si las tareas no terminan a tiempo sale con 1", async () => {
  const salidas: number[] = [];
  quitar = alApagar(logger, () => new Promise(() => {}), {
    senales: ["SIGUSR2"],
    timeoutMs: 50,
    salir: codigo => salidas.push(codigo),
  });
  process.emit("SIGUSR2");
  await esperar(120);
  assert.deepEqual(salidas, [1]);
});

test("si las tareas terminan tarde, salir() no se llama una segunda vez", async () => {
  const salidas: number[] = [];
  quitar = alApagar(logger, () => esperar(120), {
    senales: ["SIGUSR2"],
    timeoutMs: 50,
    salir: codigo => salidas.push(codigo),
  });
  process.emit("SIGUSR2");
  await esperar(200);
  assert.deepEqual(salidas, [1]);
});
