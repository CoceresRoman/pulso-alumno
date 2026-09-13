import pg from "pg";
import type { Logger } from "./logger.ts";

export function crearPool(url: string, logger: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Si la conexión ya está abierta y Postgres deja de responder (pausado, cortado por
    // firewall), connectionTimeoutMillis no ayuda: sin esto, una consulta se puede colgar
    // sin límite.
    query_timeout: 5_000,
  });
  // Si Postgres corta una conexión ociosa del pool (reinicio, backend terminado a mano),
  // node-postgres la descarta y emite "error" acá: sin este listener, el evento queda sin
  // manejar y tira abajo el proceso entero. Con el listener, el pool sigue vivo y la
  // próxima consulta abre una conexión nueva.
  pool.on("error", error => {
    logger.warn({ err: error }, "se perdió una conexión ociosa con la base");
  });
  return pool;
}

// Para /readyz: si la conexión ya está abierta pero Postgres no responde, query_timeout
// (5 s, ver crearPool) igual sería una espera larga para una probe. Acotamos acá aparte,
// igual que el chequeo de la cola en programador.ts, y limpiamos el timer apenas gana
// cualquiera de las dos.
export function dbListo(db: pg.Pool, timeoutMs = 1000): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const limite = setTimeout(() => resolve(false), timeoutMs);
    limite.unref();
    db.query("select 1").then(
      () => {
        clearTimeout(limite);
        resolve(true);
      },
      () => {
        clearTimeout(limite);
        resolve(false);
      }
    );
  });
}
