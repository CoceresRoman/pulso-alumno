import { once } from "node:events";
import { configOSalir } from "../compartido/arranque.ts";
import { alApagar } from "../compartido/apagado.ts";
import { crearPool } from "../compartido/db.ts";
import { crearLogger } from "../compartido/logger.ts";
import { crearMetricasApi } from "../compartido/metricas.ts";
import { listarMonitores } from "../compartido/monitores.ts";
import { crearProgramadorBullmq } from "../compartido/programador.ts";
import { crearApp } from "./app.ts";

const config = configOSalir(crearLogger("api"), ["DATABASE_URL", "REDIS_URL"]);
const logger = crearLogger("api", config.nivelLog);
const db = crearPool(config.databaseUrl, logger);
const programador = crearProgramadorBullmq(config.redisUrl, logger);
let cerrando = false;

try {
  // Si la cola perdió sus datos (Valkey sin persistencia), al arrancar se vuelven a programar:
  // upsert no duplica nada si ya estaban.
  const monitores = await listarMonitores(db);
  for (const monitor of monitores) await programador.programar(monitor);
  logger.info({ monitores: monitores.length }, "chequeos programados");
} catch (error) {
  logger.fatal({ err: error }, "no se pudieron programar los chequeos al arrancar (¿la base y la cola están arriba?)");
  process.exit(1);
}

const app = crearApp({
  db,
  programador,
  metricas: crearMetricasApi(),
  logger,
  fallas: { latenciaMs: config.fallaLatenciaMs, fugaMemoria: config.fallaFugaMemoria },
  cerrando: () => cerrando,
});

const servidor = app.listen(config.puerto);
try {
  await once(servidor, "listening");
} catch (error) {
  logger.fatal({ err: error, puerto: config.puerto }, "no se pudo escuchar en el puerto");
  process.exit(1);
}
logger.info(
  { puerto: config.puerto, fallaLatenciaMs: config.fallaLatenciaMs, fallaFugaMemoria: config.fallaFugaMemoria },
  "api escuchando"
);

// El once() de arriba sólo cubre el arranque: una vez que empezó a escuchar, ese listener
// se saca solo. Sin uno propio acá, un error del servidor en producción (por ejemplo
// EMFILE si se agotan los file descriptors aceptando conexiones) queda sin manejar y tira
// abajo el proceso con un dump en vez de un log JSON.
servidor.on("error", error => {
  logger.fatal({ err: error }, "error del servidor http");
  process.exit(1);
});

alApagar(logger, async () => {
  cerrando = true;
  await new Promise<void>((resolve, reject) => servidor.close(error => (error ? reject(error) : resolve())));
  await programador.cerrar();
  await db.end();
});
