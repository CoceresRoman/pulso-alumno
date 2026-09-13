import express, { type NextFunction, type Request, type Response } from "express";
import type pg from "pg";
import { dbListo } from "../compartido/db.ts";
import type { Logger } from "../compartido/logger.ts";
import type { MetricasApi } from "../compartido/metricas.ts";
import {
  actualizarMonitor,
  borrarMonitor,
  crearMonitor,
  listarChequeos,
  listarMonitores,
  obtenerMonitor,
  resumenEstado,
} from "../compartido/monitores.ts";
import type { Programador } from "../compartido/programador.ts";
import { crearMiddlewareFallas } from "./fallas.ts";
import { detalleTimeout, leerId, leerLimite, validarCambios, validarNuevoMonitor } from "./validar.ts";

export interface DependenciasApi {
  db: pg.Pool;
  programador: Programador;
  metricas: MetricasApi;
  logger: Logger;
  fallas?: { latenciaMs: number; fugaMemoria: boolean };
  cerrando?: () => boolean;
}

const tipoDeError = (error: unknown) => (typeof error === "object" && error !== null ? (error as { type?: unknown }).type : undefined);

const estadoDeError = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const estado = (error as { status?: unknown }).status;
  return typeof estado === "number" ? estado : undefined;
};

export function crearApp(deps: DependenciasApi) {
  const { db, programador, metricas, logger } = deps;
  const cerrando = deps.cerrando ?? (() => false);
  const app = express();
  app.disable("x-powered-by");

  // Métricas y log de cada pedido, con la ruta declarada (no la URL) para no crear una serie por id.
  app.use((req, res, next) => {
    const inicio = performance.now();
    res.on("finish", () => {
      const ruta: string = req.route?.path ?? "sin_ruta";
      const segundos = (performance.now() - inicio) / 1000;
      metricas.pedidos.inc({ metodo: req.method, ruta, codigo: String(res.statusCode) });
      metricas.duracion.observe({ metodo: req.method, ruta }, segundos);
      const datos = { metodo: req.method, ruta, codigo: res.statusCode, ms: Math.round(segundos * 1000) };
      if (res.statusCode >= 500) logger.error(datos, "pedido");
      else logger.debug(datos, "pedido");
    });
    next();
  });

  app.use(express.json({ limit: "10kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ estado: "ok" });
  });

  app.get("/readyz", async (_req, res) => {
    if (cerrando()) {
      res.status(503).json({ estado: "cerrando" });
      return;
    }
    const [base, cola] = await Promise.all([dbListo(db), programador.listo()]);
    const listo = base && cola;
    res.status(listo ? 200 : 503).json({ estado: listo ? "listo" : "no_listo", base, cola });
  });

  app.get("/metrics", async (_req, res) => {
    res.type(metricas.registro.contentType).send(await metricas.registro.metrics());
  });

  if (deps.fallas && (deps.fallas.latenciaMs > 0 || deps.fallas.fugaMemoria)) {
    app.use("/api", crearMiddlewareFallas(deps.fallas));
  }

  app.get("/api/estado", async (_req, res) => {
    res.json(await resumenEstado(db));
  });

  app.get("/api/monitores", async (_req, res) => {
    res.json(await listarMonitores(db));
  });

  app.post("/api/monitores", async (req, res) => {
    const validacion = validarNuevoMonitor(req.body);
    if (!validacion.ok) {
      res.status(400).json({ error: "validacion", detalles: validacion.detalles });
      return;
    }
    const monitor = await crearMonitor(db, validacion.valor);
    try {
      await programador.programar(monitor);
    } catch (error) {
      // Sin cola el monitor nunca se chequearía: se deshace el alta.
      await borrarMonitor(db, monitor.id);
      logger.error({ err: error, monitorId: monitor.id }, "no se pudo programar el monitor");
      res.status(503).json({ error: "cola_no_disponible" });
      return;
    }
    res.status(201).json(monitor);
  });

  app.get("/api/monitores/:id", async (req, res) => {
    const id = leerId(req.params.id);
    const monitor = id === null ? null : await obtenerMonitor(db, id);
    if (!monitor) {
      res.status(404).json({ error: "no_encontrado" });
      return;
    }
    res.json(monitor);
  });

  app.patch("/api/monitores/:id", async (req, res) => {
    const id = leerId(req.params.id);
    const actual = id === null ? null : await obtenerMonitor(db, id);
    if (!actual) {
      res.status(404).json({ error: "no_encontrado" });
      return;
    }
    const validacion = validarCambios(req.body);
    if (!validacion.ok) {
      res.status(400).json({ error: "validacion", detalles: validacion.detalles });
      return;
    }
    const conflicto = detalleTimeout(
      validacion.valor.intervaloSegundos ?? actual.intervaloSegundos,
      validacion.valor.timeoutMs ?? actual.timeoutMs
    );
    if (conflicto) {
      res.status(400).json({ error: "validacion", detalles: [conflicto] });
      return;
    }
    const monitor = await actualizarMonitor(db, actual.id, validacion.valor);
    if (!monitor) {
      res.status(404).json({ error: "no_encontrado" });
      return;
    }
    try {
      await programador.programar(monitor);
    } catch (error) {
      await actualizarMonitor(db, actual.id, { url: actual.url, intervaloSegundos: actual.intervaloSegundos, timeoutMs: actual.timeoutMs });
      logger.error({ err: error, monitorId: actual.id }, "no se pudo reprogramar el monitor");
      res.status(503).json({ error: "cola_no_disponible" });
      return;
    }
    res.json(monitor);
  });

  app.delete("/api/monitores/:id", async (req, res) => {
    const id = leerId(req.params.id);
    const monitor = id === null ? null : await obtenerMonitor(db, id);
    if (!monitor) {
      res.status(404).json({ error: "no_encontrado" });
      return;
    }
    try {
      await programador.quitar(monitor.id);
    } catch (error) {
      logger.error({ err: error, monitorId: monitor.id }, "no se pudo quitar el scheduler");
      res.status(503).json({ error: "cola_no_disponible" });
      return;
    }
    await borrarMonitor(db, monitor.id);
    res.status(204).end();
  });

  app.get("/api/monitores/:id/chequeos", async (req, res) => {
    const id = leerId(req.params.id);
    const monitor = id === null ? null : await obtenerMonitor(db, id);
    if (!monitor) {
      res.status(404).json({ error: "no_encontrado" });
      return;
    }
    const limite = leerLimite(req.query.limite);
    if (limite === null) {
      res.status(400).json({ error: "validacion", detalles: ["limite tiene que ser un entero entre 1 y 500"] });
      return;
    }
    res.json(await listarChequeos(db, monitor.id, limite));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "no_encontrado" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (tipoDeError(error) === "entity.parse.failed") {
      res.status(400).json({ error: "json_invalido" });
      return;
    }
    if (tipoDeError(error) === "entity.too.large") {
      res.status(413).json({ error: "cuerpo_demasiado_grande" });
      return;
    }
    // El resto de los errores de body-parser (content-encoding o charset no soportado,
    // pedido abortado a medio camino, etc.) traen su propio status 4xx: lo respetamos con
    // un código propio en vez de convertirlo en 500, para no inflar la tasa de errores del
    // servidor con pedidos mal formados de un cliente.
    const estado = estadoDeError(error);
    if (estado !== undefined && estado >= 400 && estado < 500) {
      logger.warn({ err: error, estado }, "pedido rechazado por body-parser");
      res.status(estado).json({ error: estado === 415 ? "tipo_no_soportado" : "cuerpo_invalido" });
      return;
    }
    logger.error({ err: error }, "error no manejado");
    res.status(500).json({ error: "interno" });
  });

  return app;
}
