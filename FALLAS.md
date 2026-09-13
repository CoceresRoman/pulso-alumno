# Fallas

Pulso puede activar fallas a propósito, apagadas por defecto, para los labs de la ruta DevOps. Cada una es una variable de entorno: se prenden en el proceso que corresponde, no globalmente.

## `FALLA_LATENCIA_MS` (api)

**Qué hace:** suma esa demora, en milisegundos, a cada pedido bajo `/api` (no a `/healthz`, `/readyz` ni `/metrics`).

**Cómo activarla:** `FALLA_LATENCIA_MS=500` al arrancar la api.

**Qué se ve:** el histograma `pulso_http_duracion_segundos` en `/metrics` se corre hacia buckets más altos; en la web, cargar la tabla y dar de alta un monitor se sienten lentos. `/healthz` sigue respondiendo al instante, así que un orquestador que solo mira `/healthz` no se entera.

**Para qué sirve:** practicar autoscaling por latencia (HPA), alertas de latencia y definir un SLO.

## `FALLA_FUGA_MEMORIA` (api)

**Qué hace:** retiene 1 MB por cada pedido bajo `/api`, sin liberarlo nunca.

**Cómo activarla:** `FALLA_FUGA_MEMORIA=1` al arrancar la api.

**Qué se ve:** `process_resident_memory_bytes` en `/metrics` crece en línea recta, un mega por pedido, hasta que el proceso llega al límite de memoria del contenedor y el orquestador lo mata (`OOMKilled`). `/healthz` y `/readyz` responden normal hasta el final: el síntoma está en la métrica de memoria, no en la salud.

**Para qué sirve:** practicar límites de memoria (`resources.limits.memory`), ver un `OOMKilled` real y el reinicio que sigue.

## `FALLA_SIN_TIMEOUT` (worker)

**Qué hace:** el chequeo ignora el `timeoutMs` del monitor: si el sitio no responde, el `fetch` se queda esperando para siempre en vez de cortar.

**Cómo activarla:** `FALLA_SIN_TIMEOUT=1` al arrancar el worker, con un monitor apuntando a `http://sitio-lento:3001/colgado`.

**Qué se ve:** ese chequeo nunca termina, pero no se queda quieto en un solo slot: BullMQ arranca una repetición nueva del scheduler del monitor colgado en cada intervalo, y cada una toma otro de los `WORKER_CONCURRENCIA` slots (nunca libera el que ya tenía). Con los valores por defecto, recién a los `concurrencia × intervalo` (unos 2,5 minutos) se terminan ocupando todos los slots y ahí el resto de los monitores deja de actualizarse en la web (su `ultimoChequeo` se queda viejo). A partir de ese momento `pulso_cola_pendientes` se estabiliza en uno por monitor — no crece sin límite — porque ya no queda ningún worker libre para sacar esos chequeos de la cola. Al mandar SIGTERM, el worker espera los 25 s completos sin terminar de cerrar, porque los chequeos colgados nunca resuelven.

**Para qué sirve:** es el incidente del curso de observabilidad — diagnosticar, con logs y métricas, por qué el sistema dejó de progresar sin haberse caído.
