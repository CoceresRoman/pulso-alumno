import { createServer, type Server } from "node:http";
import type pg from "pg";
import { dbListo } from "../compartido/db.ts";
import type { Logger } from "../compartido/logger.ts";
import type { MetricasWorker } from "../compartido/metricas.ts";
import type { Programador } from "../compartido/programador.ts";

const JSON_UTF8 = { "content-type": "application/json; charset=utf-8" };

// El worker no atiende HTTP de negocio: este servidor chico es para Prometheus y las probes.
export function crearServidorMetricas(deps: {
  db: pg.Pool;
  programador: Programador;
  metricas: MetricasWorker;
  logger: Logger;
  cerrando?: () => boolean;
}): Server {
  const cerrando = deps.cerrando ?? (() => false);
  return createServer((req, res) => {
    const ruta = new URL(req.url ?? "/", "http://worker").pathname;
    const responder = async () => {
      if (ruta === "/healthz") {
        res.writeHead(200, JSON_UTF8).end(JSON.stringify({ estado: "ok" }));
      } else if (ruta === "/readyz") {
        if (cerrando()) {
          res.writeHead(503, JSON_UTF8).end(JSON.stringify({ estado: "cerrando" }));
          return;
        }
        const [base, cola] = await Promise.all([dbListo(deps.db), deps.programador.listo()]);
        const listo = base && cola;
        res.writeHead(listo ? 200 : 503, JSON_UTF8).end(JSON.stringify({ estado: listo ? "listo" : "no_listo", base, cola }));
      } else if (ruta === "/metrics") {
        const texto = await deps.metricas.registro.metrics();
        res.writeHead(200, { "content-type": deps.metricas.registro.contentType }).end(texto);
      } else {
        res.writeHead(404, JSON_UTF8).end(JSON.stringify({ error: "no_encontrado" }));
      }
    };
    responder().catch(error => {
      deps.logger.error({ err: error, ruta }, "error en el servidor de métricas");
      res.writeHead(500, JSON_UTF8).end(JSON.stringify({ error: "interno" }));
    });
  });
}
