import { configOSalir } from "../compartido/arranque.ts";
import { crearLogger } from "../compartido/logger.ts";
import { crearSitioLento } from "./app.ts";

const config = configOSalir(crearLogger("sitio-lento"), [], 3001);
const logger = crearLogger("sitio-lento", config.nivelLog);
const servidor = crearSitioLento();

// Sin listener, un error del servidor (puerto ocupado al arrancar, o EMFILE si un lab lo
// satura de conexiones) queda sin manejar y tira abajo el proceso con un dump en vez de un
// log JSON.
servidor.on("error", error => {
  logger.fatal({ err: error, puerto: config.puerto }, "error del servidor http");
  process.exit(1);
});
servidor.listen(config.puerto, () => logger.info({ puerto: config.puerto }, "sitio lento escuchando"));

for (const senal of ["SIGTERM", "SIGINT"] as const) {
  process.once(senal, () => {
    logger.info({ senal }, "apagando");
    // /colgado nunca termina solo: sin esto, close() esperaría para siempre.
    servidor.closeAllConnections();
    servidor.close(() => process.exit(0));
  });
}
