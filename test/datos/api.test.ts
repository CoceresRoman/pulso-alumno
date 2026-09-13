import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearApp, type DependenciasApi } from "../../src/api/app.ts";
import { crearLogger } from "../../src/compartido/logger.ts";
import { crearMetricasApi } from "../../src/compartido/metricas.ts";
import { registrarChequeo } from "../../src/compartido/monitores.ts";
import { abrirBaseDePrueba, type BaseDePrueba } from "../soporte/base.ts";
import { crearProgramadorEnMemoria, type ProgramadorEnMemoria } from "../soporte/programador-en-memoria.ts";

let base: BaseDePrueba;
let programador: ProgramadorEnMemoria;
let servidor: Server;
let url = "";

async function levantar(extra: Partial<DependenciasApi> = {}): Promise<{ servidor: Server; url: string }> {
  const app = crearApp({ db: base.pool, programador, metricas: crearMetricasApi(), logger: crearLogger("test", "silent"), ...extra });
  const s = app.listen(0, "127.0.0.1");
  await once(s, "listening");
  return { servidor: s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}

async function pedir(metodo: string, ruta: string, cuerpo?: unknown, destino = url) {
  const respuesta = await fetch(`${destino}${ruta}`, {
    method: metodo,
    headers: cuerpo === undefined ? undefined : { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: respuesta.status, json: json as any, tipo: respuesta.headers.get("content-type") ?? "" };
}

before(async () => {
  base = await abrirBaseDePrueba();
  programador = crearProgramadorEnMemoria();
  ({ servidor, url } = await levantar());
});

after(async () => {
  servidor.close();
  await base.cerrar();
});

test("healthz y readyz", async () => {
  assert.deepEqual(await pedir("GET", "/healthz"), { status: 200, json: { estado: "ok" }, tipo: "application/json; charset=utf-8" });
  assert.deepEqual((await pedir("GET", "/readyz")).json, { estado: "listo", base: true, cola: true });
  programador.simularCaida(true);
  try {
    const r = await pedir("GET", "/readyz");
    assert.equal(r.status, 503);
    assert.deepEqual(r.json, { estado: "no_listo", base: true, cola: false });
  } finally {
    programador.simularCaida(false);
  }
});

test("después de SIGTERM readyz responde 503", async () => {
  const otra = await levantar({ cerrando: () => true });
  try {
    const r = await pedir("GET", "/readyz", undefined, otra.url);
    assert.deepEqual({ status: r.status, json: r.json }, { status: 503, json: { estado: "cerrando" } });
  } finally {
    otra.servidor.close();
  }
});

test("crear un monitor lo guarda y lo programa", async () => {
  const r = await pedir("POST", "/api/monitores", { url: "https://a.example" });
  assert.equal(r.status, 201);
  assert.equal(r.json.url, "https://a.example");
  assert.equal(r.json.intervaloSegundos, 30);
  assert.equal(programador.programados.get(r.json.id), 30);
  assert.deepEqual((await pedir("GET", `/api/monitores/${r.json.id}`)).json, r.json);
});

test("validación, JSON roto, cuerpo grande e id inválido", async () => {
  const invalido = await pedir("POST", "/api/monitores", { intervaloSegundos: 5 });
  assert.equal(invalido.status, 400);
  assert.equal(invalido.json.error, "validacion");
  assert.ok(invalido.json.detalles.includes("falta url"));
  assert.deepEqual(await pedir("POST", "/api/monitores", "{mal"), { status: 400, json: { error: "json_invalido" }, tipo: "application/json; charset=utf-8" });
  const grande = await pedir("POST", "/api/monitores", { url: `https://example.com/${"x".repeat(20_000)}` });
  assert.deepEqual({ status: grande.status, json: grande.json }, { status: 413, json: { error: "cuerpo_demasiado_grande" } });
  assert.deepEqual((await pedir("GET", "/api/monitores/abc")).json, { error: "no_encontrado" });
  assert.equal((await pedir("GET", "/api/monitores/999999")).status, 404);
});

test("body-parser: content-encoding y charset no soportados dan 415 propio, no 500", async () => {
  const codificacion = await fetch(`${url}/api/monitores`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "rara" },
    body: JSON.stringify({ url: "https://encoding.example" }),
  });
  assert.equal(codificacion.status, 415);
  assert.deepEqual(await codificacion.json(), { error: "tipo_no_soportado" });

  const charset = await fetch(`${url}/api/monitores`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=klingon" },
    body: JSON.stringify({ url: "https://charset.example" }),
  });
  assert.equal(charset.status, 415);
  assert.deepEqual(await charset.json(), { error: "tipo_no_soportado" });
});

test("con la cola caída el alta no queda", async () => {
  programador.simularCaida(true);
  try {
    const r = await pedir("POST", "/api/monitores", { url: "https://sin-cola.example" });
    assert.deepEqual({ status: r.status, json: r.json }, { status: 503, json: { error: "cola_no_disponible" } });
  } finally {
    programador.simularCaida(false);
  }
  const lista = await pedir("GET", "/api/monitores");
  assert.ok(!lista.json.some((m: { url: string }) => m.url === "https://sin-cola.example"));
});

test("PATCH cambia, valida contra lo guardado y deshace si la cola está caída", async () => {
  const { json: monitor } = await pedir("POST", "/api/monitores", { url: "https://b.example", intervaloSegundos: 60, timeoutMs: 2000 });
  const cambio = await pedir("PATCH", `/api/monitores/${monitor.id}`, { intervaloSegundos: 120 });
  assert.equal(cambio.status, 200);
  assert.equal(programador.programados.get(monitor.id), 120);

  const conflicto = await pedir("PATCH", `/api/monitores/${monitor.id}`, { intervaloSegundos: 10, timeoutMs: 20000 });
  assert.deepEqual(conflicto.json, { error: "validacion", detalles: ["timeoutMs tiene que ser menor que el intervalo (10000 ms)"] });
  assert.equal((await pedir("PATCH", "/api/monitores/999999", { timeoutMs: 1000 })).status, 404);

  programador.simularCaida(true);
  try {
    assert.equal((await pedir("PATCH", `/api/monitores/${monitor.id}`, { url: "https://nueva.example" })).status, 503);
  } finally {
    programador.simularCaida(false);
  }
  assert.equal((await pedir("GET", `/api/monitores/${monitor.id}`)).json.url, "https://b.example");
});

test("DELETE quita el scheduler y el monitor; con la cola caída no borra", async () => {
  const { json: monitor } = await pedir("POST", "/api/monitores", { url: "https://c.example" });
  programador.simularCaida(true);
  try {
    assert.equal((await pedir("DELETE", `/api/monitores/${monitor.id}`)).status, 503);
  } finally {
    programador.simularCaida(false);
  }
  assert.equal((await pedir("GET", `/api/monitores/${monitor.id}`)).status, 200);

  assert.equal((await pedir("DELETE", `/api/monitores/${monitor.id}`)).status, 204);
  assert.equal(programador.programados.has(monitor.id), false);
  assert.equal((await pedir("GET", `/api/monitores/${monitor.id}`)).status, 404);
});

test("chequeos, estado, 404 propia y métricas", async () => {
  const { json: monitor } = await pedir("POST", "/api/monitores", { url: "https://d.example" });
  await registrarChequeo(base.pool, monitor.id, { ok: false, codigo: 503, latenciaMs: 80, error: null }, new Date(Date.now() - 60_000));
  await registrarChequeo(base.pool, monitor.id, { ok: true, codigo: 200, latenciaMs: 40, error: null });

  const chequeos = await pedir("GET", `/api/monitores/${monitor.id}/chequeos?limite=1`);
  assert.deepEqual(chequeos.json.map((c: { codigo: number }) => c.codigo), [200]);
  assert.equal((await pedir("GET", `/api/monitores/${monitor.id}/chequeos?limite=0`)).status, 400);

  const estado = await pedir("GET", "/api/estado");
  const propio = estado.json.find((e: { id: number }) => e.id === monitor.id);
  assert.equal(propio.estado, "arriba");
  assert.equal(propio.disponibilidad24h, 50);

  assert.deepEqual(await pedir("GET", "/no-existe"), { status: 404, json: { error: "no_encontrado" }, tipo: "application/json; charset=utf-8" });

  const metricas = await fetch(`${url}/metrics`);
  assert.match(metricas.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(await metricas.text(), /^pulso_http_pedidos_total\{metodo="POST",ruta="\/api\/monitores",codigo="201"\} \d+$/m);
});

test("la falla de latencia demora /api pero no /healthz", async () => {
  const lenta = await levantar({ fallas: { latenciaMs: 400, fugaMemoria: false } });
  try {
    let inicio = performance.now();
    await pedir("GET", "/api/monitores", undefined, lenta.url);
    assert.ok(performance.now() - inicio >= 390);
    inicio = performance.now();
    await pedir("GET", "/healthz", undefined, lenta.url);
    assert.ok(performance.now() - inicio < 300);
  } finally {
    lenta.servidor.close();
  }
});
