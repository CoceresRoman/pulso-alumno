import type pg from "pg";
import type { Logger } from "../compartido/logger.ts";
import type { MetricasWorker } from "../compartido/metricas.ts";
import { obtenerMonitor, registrarChequeo, type ResultadoChequeo } from "../compartido/monitores.ts";
import { sanitizarUrl } from "../compartido/url.ts";
import { chequear } from "./chequear.ts";

export interface DependenciasProceso {
  db: pg.Pool;
  metricas: MetricasWorker;
  logger: Logger;
  quitarScheduler: (monitorId: number) => Promise<void>;
  fallaSinTimeout: boolean;
}

const esViolacionDeForeignKey = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23503";

export async function procesarChequeo(deps: DependenciasProceso, monitorId: number): Promise<ResultadoChequeo | null> {
  const monitor = await obtenerMonitor(deps.db, monitorId);
  if (!monitor) {
    // Quedó un scheduler de un monitor borrado (por ejemplo, si la baja falló a medias).
    await deps.quitarScheduler(monitorId);
    deps.logger.warn({ monitorId }, "el monitor ya no existe: se quita su scheduler");
    return null;
  }

  const resultado = await chequear(monitor.url, monitor.timeoutMs, { ignorarTimeout: deps.fallaSinTimeout });
  deps.metricas.chequeos.inc({ resultado: resultado.ok ? "ok" : "falla" });
  deps.metricas.duracion.observe(resultado.latenciaMs / 1000);

  try {
    await registrarChequeo(deps.db, monitor.id, resultado);
  } catch (error) {
    if (!esViolacionDeForeignKey(error)) throw error;
    deps.logger.warn({ monitorId }, "el monitor se borró durante el chequeo: no se guarda");
    return null;
  }

  const datos = { monitorId, url: sanitizarUrl(monitor.url), ...resultado };
  if (resultado.ok) deps.logger.debug(datos, "chequeo");
  else deps.logger.warn(datos, "chequeo con falla");
  return resultado;
}
