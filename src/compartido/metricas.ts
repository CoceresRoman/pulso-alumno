import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "@prometheus-io/client";

export function crearMetricasApi() {
  const registro = new Registry();
  collectDefaultMetrics({ register: registro });
  const pedidos = new Counter({
    name: "pulso_http_pedidos_total",
    help: "Pedidos HTTP atendidos por la api",
    labelNames: ["metodo", "ruta", "codigo"] as const,
    registers: [registro],
  });
  const duracion = new Histogram({
    name: "pulso_http_duracion_segundos",
    help: "Duración de los pedidos HTTP de la api",
    labelNames: ["metodo", "ruta"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registro],
  });
  return { registro, pedidos, duracion };
}

export type MetricasApi = ReturnType<typeof crearMetricasApi>;

// Si `pendientes()` se cuelga (Valkey caído: ver programador.ts), esperarla sin límite
// dejaría el scrape de /metrics colgado y, con él, el apagado del worker. Competimos
// contra un timeout de 1 s que resuelve NaN; el timer se limpia apenas gana cualquiera.
function conNanSiTarda(promesa: Promise<number>, ms: number): Promise<number> {
  return new Promise<number>(resolve => {
    const limite = setTimeout(() => resolve(Number.NaN), ms);
    limite.unref();
    promesa.then(
      valor => {
        clearTimeout(limite);
        resolve(valor);
      },
      () => {
        clearTimeout(limite);
        resolve(Number.NaN);
      }
    );
  });
}

export function crearMetricasWorker(pendientes: () => Promise<number>) {
  const registro = new Registry();
  collectDefaultMetrics({ register: registro });
  const chequeos = new Counter({
    name: "pulso_chequeos_total",
    help: "Chequeos hechos por el worker, por resultado",
    labelNames: ["resultado"] as const,
    registers: [registro],
  });
  const duracion = new Histogram({
    name: "pulso_chequeo_duracion_segundos",
    help: "Duración de cada chequeo",
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registro],
  });
  new Gauge({
    name: "pulso_cola_pendientes",
    help: "Chequeos listos esperando un worker",
    registers: [registro],
    async collect() {
      // NaN (por timeout o por error) en vez de romper /metrics: Prometheus sigue
      // recibiendo el resto y el hueco se ve.
      this.set(await conNanSiTarda(pendientes(), 1000));
    },
  });
  return { registro, chequeos, duracion };
}

export type MetricasWorker = ReturnType<typeof crearMetricasWorker>;
