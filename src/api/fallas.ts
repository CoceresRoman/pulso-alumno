import { setTimeout as esperar } from "node:timers/promises";
import type { RequestHandler } from "express";

// Fallas para los labs del curso (FALLAS.md). Apagadas por defecto.
export function crearMiddlewareFallas(opciones: { latenciaMs: number; fugaMemoria: boolean; retenido?: Buffer[] }): RequestHandler {
  const retenido = opciones.retenido ?? [];
  return async (_req, _res, next) => {
    // 1 MB por pedido que nunca se libera; se llena con unos para que ocupe memoria real.
    if (opciones.fugaMemoria) retenido.push(Buffer.alloc(1024 * 1024, 1));
    if (opciones.latenciaMs > 0) await esperar(opciones.latenciaMs);
    next();
  };
}
