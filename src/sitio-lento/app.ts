import { createServer, type Server } from "node:http";

const MAX_MS = 60_000;
const TEXTO = { "content-type": "text/plain; charset=utf-8" };

// Sitio de prueba para los labs y los tests: responde bien, lento, con error o nunca.
export function crearSitioLento(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://sitio-lento");
    switch (url.pathname) {
      case "/ok":
      case "/healthz":
        res.writeHead(200, TEXTO).end("ok");
        return;
      case "/lento": {
        const ms = Number(url.searchParams.get("ms") ?? "1000");
        if (!Number.isInteger(ms) || ms < 0 || ms > MAX_MS) {
          res.writeHead(400, TEXTO).end(`ms debe ser un entero entre 0 y ${MAX_MS}`);
          return;
        }
        const temporizador = setTimeout(() => res.writeHead(200, TEXTO).end(`ok después de ${ms} ms`), ms);
        res.on("close", () => clearTimeout(temporizador));
        return;
      }
      case "/error": {
        const pedido = Number(url.searchParams.get("codigo"));
        const codigo = Number.isInteger(pedido) && pedido >= 400 && pedido <= 599 ? pedido : 500;
        res.writeHead(codigo, TEXTO).end(`error ${codigo}`);
        return;
      }
      case "/colgado":
        // No responde nunca: sirve para ver qué le pasa a un cliente sin timeout.
        return;
      default:
        res.writeHead(404, TEXTO).end("no existe");
    }
  });
}
