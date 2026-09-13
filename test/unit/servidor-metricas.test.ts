import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import { crearLogger } from "../../src/compartido/logger.ts";
import { crearMetricasWorker } from "../../src/compartido/metricas.ts";
import { crearServidorMetricas } from "../../src/worker/servidor-metricas.ts";
import { crearProgramadorEnMemoria } from "../soporte/programador-en-memoria.ts";

const db = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
const programador = crearProgramadorEnMemoria();
const logger = crearLogger("test", "silent");
let cerrando = false;
let servidor: Server;
let url = "";

before(async () => {
  servidor = crearServidorMetricas({
    db,
    programador,
    metricas: crearMetricasWorker(async () => 3),
    logger,
    cerrando: () => cerrando,
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  servidor.close();
});

const pedir = async (ruta: string) => {
  const r = await fetch(`${url}${ruta}`);
  return { status: r.status, texto: await r.text() };
};

test("healthz, readyz y 404", async () => {
  assert.deepEqual(await pedir("/healthz"), { status: 200, texto: JSON.stringify({ estado: "ok" }) });
  assert.deepEqual(await pedir("/readyz"), { status: 200, texto: JSON.stringify({ estado: "listo", base: true, cola: true }) });
  assert.equal((await pedir("/otra")).status, 404);
});

test("readyz 503 con la cola caída o cerrando", async () => {
  programador.simularCaida(true);
  try {
    assert.deepEqual(await pedir("/readyz"), { status: 503, texto: JSON.stringify({ estado: "no_listo", base: true, cola: false }) });
  } finally {
    programador.simularCaida(false);
  }
  cerrando = true;
  try {
    assert.deepEqual(await pedir("/readyz"), { status: 503, texto: JSON.stringify({ estado: "cerrando" }) });
  } finally {
    cerrando = false;
  }
});

test("metrics publica el largo de la cola", async () => {
  assert.match((await pedir("/metrics")).texto, /^pulso_cola_pendientes 3$/m);
});

test("un error interno no se filtra al cliente", async () => {
  const metricas = crearMetricasWorker(async () => 3);
  metricas.registro.metrics = async () => {
    throw new Error("secreto interno");
  };
  const servidorRoto = crearServidorMetricas({ db, programador, metricas, logger, cerrando: () => false });
  servidorRoto.listen(0, "127.0.0.1");
  await once(servidorRoto, "listening");
  const urlRoto = `http://127.0.0.1:${(servidorRoto.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${urlRoto}/metrics`);
    const texto = await r.text();
    assert.equal(r.status, 500);
    assert.equal(texto, JSON.stringify({ error: "interno" }));
    assert.ok(!texto.includes("secreto interno"));
  } finally {
    servidorRoto.close();
  }
});
