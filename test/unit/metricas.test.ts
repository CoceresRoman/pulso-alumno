import { test } from "node:test";
import assert from "node:assert/strict";
import { crearMetricasApi, crearMetricasWorker } from "../../src/compartido/metricas.ts";

test("la api publica pedidos y duración por ruta", async () => {
  const m = crearMetricasApi();
  m.pedidos.inc({ metodo: "GET", ruta: "/api/monitores", codigo: "200" });
  m.duracion.observe({ metodo: "GET", ruta: "/api/monitores" }, 0.02);
  const texto = await m.registro.metrics();
  assert.match(texto, /^pulso_http_pedidos_total\{metodo="GET",ruta="\/api\/monitores",codigo="200"\} 1$/m);
  assert.match(texto, /^pulso_http_duracion_segundos_count\{metodo="GET",ruta="\/api\/monitores"\} 1$/m);
  assert.match(texto, /^process_cpu_user_seconds_total /m);
});

test("el worker publica chequeos y el largo de la cola", async () => {
  const m = crearMetricasWorker(async () => 7);
  m.chequeos.inc({ resultado: "falla" }, 2);
  m.duracion.observe(0.3);
  const texto = await m.registro.metrics();
  assert.match(texto, /^pulso_chequeos_total\{resultado="falla"\} 2$/m);
  assert.match(texto, /^pulso_chequeo_duracion_segundos_count 1$/m);
  assert.match(texto, /^pulso_cola_pendientes 7$/m);
});

test("si la cola no responde, pendientes es NaN y las métricas igual se publican", async () => {
  const m = crearMetricasWorker(async () => {
    throw new Error("cola caída");
  });
  // @prometheus-io/client 0.16.1 serializa Number.NaN como "Nan" (lib/util.js), no "NaN".
  assert.match(await m.registro.metrics(), /^pulso_cola_pendientes Nan$/m);
});

test("si la cola no responde a tiempo (en vez de rechazar), pendientes es Nan en menos de 2 s", async () => {
  const inicio = performance.now();
  const m = crearMetricasWorker(() => new Promise(() => {}));
  assert.match(await m.registro.metrics(), /^pulso_cola_pendientes Nan$/m);
  assert.ok(performance.now() - inicio < 2000, "collect() tardó demasiado");
});
