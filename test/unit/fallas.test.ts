import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { crearMiddlewareFallas } from "../../src/api/fallas.ts";

const correr = async (middleware: ReturnType<typeof crearMiddlewareFallas>) => {
  let llamado = false;
  await middleware({} as Request, {} as Response, (() => {
    llamado = true;
  }) as NextFunction);
  return llamado;
};

test("la fuga retiene 1 MB por pedido", async () => {
  const retenido: Buffer[] = [];
  const middleware = crearMiddlewareFallas({ latenciaMs: 0, fugaMemoria: true, retenido });
  assert.equal(await correr(middleware), true);
  await correr(middleware);
  assert.equal(retenido.length, 2);
  assert.equal(retenido[0].length, 1024 * 1024);
});

test("la latencia demora el pedido", async () => {
  const inicio = performance.now();
  assert.equal(await correr(crearMiddlewareFallas({ latenciaMs: 100, fugaMemoria: false })), true);
  assert.ok(performance.now() - inicio >= 95);
});
