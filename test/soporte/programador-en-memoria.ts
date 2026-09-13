import type { Programador } from "../../src/compartido/programador.ts";

export interface ProgramadorEnMemoria extends Programador {
  programados: Map<number, number>;
  simularCaida(caida: boolean): void;
}

export function crearProgramadorEnMemoria(): ProgramadorEnMemoria {
  const programados = new Map<number, number>();
  let caida = false;
  const exigirArriba = () => {
    if (caida) throw new Error("cola no disponible");
  };
  return {
    programados,
    simularCaida(valor) {
      caida = valor;
    },
    async programar(monitor) {
      exigirArriba();
      programados.set(monitor.id, monitor.intervaloSegundos);
    },
    async quitar(monitorId) {
      exigirArriba();
      programados.delete(monitorId);
    },
    async pendientes() {
      exigirArriba();
      return 0;
    },
    async listo() {
      return !caida;
    },
    async cerrar() {},
  };
}
