import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chequear } from "../../src/worker/chequear.ts";

let servidor: Server;
let base = "";

before(async () => {
  servidor = createServer((req, res) => {
    if (req.url === "/ok") {
      res.end("ok");
    } else if (req.url === "/error") {
      res.writeHead(503).end();
    } else if (req.url === "/redirige") {
      res.writeHead(301, { location: "/ok" }).end();
    }
    // /colgado: nunca responde
  }).listen(0, "127.0.0.1");
  await once(servidor, "listening");
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

test("un 200 es ok", async () => {
  const r = await chequear(`${base}/ok`, 1000);
  assert.equal(r.ok, true);
  assert.equal(r.codigo, 200);
  assert.equal(r.error, null);
  assert.ok(r.latenciaMs >= 0);
});

test("un 503 no es ok y guarda el código", async () => {
  assert.deepEqual({ ...(await chequear(`${base}/error`, 1000)), latenciaMs: 0 }, { ok: false, codigo: 503, latenciaMs: 0, error: null });
});

test("una redirección cuenta como arriba y no se sigue", async () => {
  const r = await chequear(`${base}/redirige`, 1000);
  assert.equal(r.ok, true);
  assert.equal(r.codigo, 301);
});

test("un sitio colgado corta por timeout", async () => {
  const r = await chequear(`${base}/colgado`, 200);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, null);
  assert.equal(r.error, "timeout");
  assert.ok(r.latenciaMs >= 190 && r.latenciaMs < 2000, `latencia ${r.latenciaMs}`);
});

test("sin timeout, el chequeo sigue colgado", async () => {
  const r = await Promise.race([
    chequear(`${base}/colgado`, 200, { ignorarTimeout: true }),
    new Promise(resolve => setTimeout(() => resolve("sigue colgado"), 500)),
  ]);
  assert.equal(r, "sigue colgado");
});

test("una conexión rechazada guarda el código del error", async () => {
  const libre = createServer().listen(0, "127.0.0.1");
  await once(libre, "listening");
  const puerto = (libre.address() as AddressInfo).port;
  libre.close();
  await once(libre, "close");
  const r = await chequear(`http://127.0.0.1:${puerto}/`, 1000);
  assert.deepEqual({ ok: r.ok, codigo: r.codigo, error: r.error }, { ok: false, codigo: null, error: "ECONNREFUSED" });
});
