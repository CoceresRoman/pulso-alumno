import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearSitioLento } from "../../src/sitio-lento/app.ts";

let servidor: Server;
let base = "";

before(async () => {
  servidor = crearSitioLento().listen(0, "127.0.0.1");
  await once(servidor, "listening");
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

test("/ok y /healthz responden 200", async () => {
  for (const ruta of ["/ok", "/healthz"]) {
    const r = await fetch(`${base}${ruta}`);
    assert.equal(r.status, 200, ruta);
    assert.equal(await r.text(), "ok");
  }
});

test("/lento tarda lo que se le pide", async () => {
  const inicio = performance.now();
  const r = await fetch(`${base}/lento?ms=150`);
  assert.equal(r.status, 200);
  await r.text();
  assert.ok(performance.now() - inicio >= 140);
});

test("/lento con ms inválido da 400", async () => {
  for (const ms of ["abc", "-1", "60001"]) {
    const r = await fetch(`${base}/lento?ms=${ms}`);
    assert.equal(r.status, 400, ms);
    await r.text();
  }
});

test("/error devuelve el código pedido si está entre 400 y 599", async () => {
  const pedidos: [string, number][] = [["503", 503], ["404", 404], ["200", 500], ["nada", 500]];
  for (const [codigo, esperado] of pedidos) {
    const r = await fetch(`${base}/error?codigo=${codigo}`);
    assert.equal(r.status, esperado, codigo);
    await r.text();
  }
});

test("/colgado no responde nunca", async () => {
  await assert.rejects(fetch(`${base}/colgado`, { signal: AbortSignal.timeout(300) }), { name: "TimeoutError" });
});

test("una ruta desconocida da 404", async () => {
  const r = await fetch(`${base}/otra`);
  assert.equal(r.status, 404);
  await r.text();
});
