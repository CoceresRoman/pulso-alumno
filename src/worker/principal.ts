import { once } from "node:events";
import { Worker } from "bullmq";
import { configOSalir } from "../compartido/arranque.ts";
import { alApagar } from "../compartido/apagado.ts";
import { crearPool } from "../compartido/db.ts";
import { crearLogger } from "../compartido/logger.ts";
import { crearMetricasWorker } from "../compartido/metricas.ts";
import { crearConexionWorker, crearProgramadorBullmq, NOMBRE_COLA, type DatosTrabajo } from "../compartido/programador.ts";
import { procesarChequeo } from "./procesar.ts";
import { crearServidorMetricas } from "./servidor-metricas.ts";

const config = configOSalir(crearLogger("worker"), ["DATABASE_URL", "REDIS_URL"]);
const logger = crearLogger("worker", config.nivelLog);
const db = crearPool(config.databaseUrl, logger);
const programador = crearProgramadorBullmq(config.redisUrl, logger);
const metricas = crearMetricasWorker(() => programador.pendientes());
let cerrando = false;

const conexionWorker = crearConexionWorker(config.redisUrl);
const worker = new Worker<DatosTrabajo>(
  NOMBRE_COLA,
  async trabajo => {
    await procesarChequeo(
      { db, metricas, logger, quitarScheduler: id => programador.quitar(id), fallaSinTimeout: config.fallaSinTimeout },
      trabajo.data.monitorId
    );
  },
  {
    connection: conexionWorker,
    concurrency: config.concurrencia,
    // Sin límite, la cola guarda cada chequeo terminado para siempre y Valkey crece sin freno.
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  }
);
worker.on("failed", (trabajo, error) => logger.error({ err: error, monitorId: trabajo?.data.monitorId }, "falló un chequeo"));
worker.on("error", error => logger.error({ err: error }, "error del worker"));

const servidor = crearServidorMetricas({ db, programador, metricas, logger, cerrando: () => cerrando });
servidor.listen(config.puertoMetricas);
try {
  await once(servidor, "listening");
} catch (error) {
  logger.fatal({ err: error, puerto: config.puertoMetricas }, "no se pudo escuchar en el puerto de métricas");
  process.exit(1);
}
logger.info(
  { concurrencia: config.concurrencia, puertoMetricas: config.puertoMetricas, fallaSinTimeout: config.fallaSinTimeout },
  "worker esperando chequeos"
);

// Igual que en la api: el once() de arriba sólo cubre el arranque del servidor de métricas.
servidor.on("error", error => {
  logger.fatal({ err: error, puerto: config.puertoMetricas }, "error del servidor de métricas");
  process.exit(1);
});

alApagar(
  logger,
  async () => {
    cerrando = true;
    // close() deja de tomar trabajos y espera los que están en curso.
    await worker.close();
    // BullMQ no cierra las conexiones de ioredis que le pasamos armadas (ver programador.ts).
    conexionWorker.disconnect();
    await new Promise<void>(resolve => servidor.close(() => resolve()));
    await programador.cerrar();
    await db.end();
  },
  { timeoutMs: 25_000 }
);
