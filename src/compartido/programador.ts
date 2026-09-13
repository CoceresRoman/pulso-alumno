import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "./logger.ts";

export const NOMBRE_COLA = "chequeos";
export const NOMBRE_TRABAJO = "chequear";

export interface DatosTrabajo {
  monitorId: number;
}

export interface Programador {
  programar(monitor: { id: number; intervaloSegundos: number }): Promise<void>;
  quitar(monitorId: number): Promise<void>;
  pendientes(): Promise<number>;
  listo(): Promise<boolean>;
  cerrar(): Promise<void>;
}

export const idScheduler = (monitorId: number) => `monitor-${monitorId}`;

// BullMQ espera "ready" sin límite mientras ioredis reintenta la conexión (waitUntilReady):
// con Valkey caído, `programar`/`quitar`/`pendientes` se quedan colgados para siempre. Acá
// los acotamos para que la api falle fuerte en vez de colgarse. El timer se limpia apenas
// la llamada original termina (gane o pierda la carrera), para no dejarlo corriendo de más.
function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error("cola no disponible")), ms);
    promesa.then(
      valor => {
        clearTimeout(limite);
        resolve(valor);
      },
      error => {
        clearTimeout(limite);
        reject(error);
      }
    );
  });
}

// Los workers de BullMQ exigen maxRetriesPerRequest: null en su conexión.
export function crearConexionWorker(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function crearProgramadorBullmq(redisUrl: string, logger?: Logger): Programador {
  const conexionCola = new Redis(redisUrl);
  // BullMQ no cierra las conexiones de ioredis que le pasamos armadas: si no la desconectamos
  // nosotros en cerrar(), sigue reintentando para siempre (y, sin este listener, cada intento
  // fallido tira un error no manejado).
  conexionCola.on("error", () => {});

  // La Queue reemite los errores de su conexión: sin un listener acá, cada reintento de
  // ioredis termina en un console.error con stack trace multilínea (no JSON) en vez de un
  // log de pino. Avisamos una sola vez por caída (no en cada reintento) y de nuevo cuando
  // se recupera, para no inundar los logs mientras Valkey sigue abajo.
  let colaCaida = false;
  conexionCola.on("ready", () => {
    colaCaida = false;
  });
  const cola = new Queue<DatosTrabajo>(NOMBRE_COLA, { connection: conexionCola });
  cola.on("error", error => {
    if (colaCaida) return;
    colaCaida = true;
    logger?.warn({ err: error }, "la cola perdió la conexión");
  });

  // Conexión aparte para el chequeo de salud. Con la cola offline (enableOfflineQueue en su
  // valor por defecto) el primer ping espera a que termine de conectar en vez de fallar
  // apenas se crea el cliente; maxRetriesPerRequest: 1 igual la hace fallar rápido si Redis
  // no está.
  const salud = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  salud.on("error", () => {
    // Los errores de conexión se ven en listo(): sin este listener ioredis los tira como no manejados.
  });

  return {
    async programar(monitor) {
      // upsert: varias réplicas de la api pueden programar el mismo monitor sin duplicarlo.
      await conTimeout(
        cola.upsertJobScheduler(
          idScheduler(monitor.id),
          { every: monitor.intervaloSegundos * 1000 },
          { name: NOMBRE_TRABAJO, data: { monitorId: monitor.id } }
        ),
        3000
      );
    },
    async quitar(monitorId) {
      await conTimeout(cola.removeJobScheduler(idScheduler(monitorId)), 3000);
    },
    async pendientes() {
      const cuentas = await conTimeout(cola.getJobCounts("waiting"), 3000);
      return cuentas.waiting ?? 0;
    },
    async listo() {
      return new Promise<boolean>(resolve => {
        const limite = setTimeout(() => resolve(false), 1000);
        limite.unref();
        salud.ping().then(
          respuesta => {
            clearTimeout(limite);
            resolve(respuesta === "PONG");
          },
          () => {
            clearTimeout(limite);
            resolve(false);
          }
        );
      });
    },
    async cerrar() {
      await cola.close();
      conexionCola.disconnect();
      salud.disconnect();
    },
  };
}
