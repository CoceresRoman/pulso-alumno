# Pulso

Monitor de uptime hecho para practicar DevOps en la [ruta DevOps](https://curso.romancoceres.com/rutas/devops) del curso.

## Qué hace

Pulso guarda URLs a monitorear, las chequea a intervalos y expone su estado por HTTP. Son cuatro procesos que corren la misma imagen con distinto comando, más una status page estática:

| Proceso | Comando | Qué hace |
|---|---|---|
| api | `npm run api` | HTTP para dar de alta/baja monitores, consultar su estado y las métricas propias |
| worker | `npm run worker` | toma los chequeos de la cola, pega el `GET` a cada URL y guarda el resultado |
| sitio-lento | `npm run sitio-lento` | sitio de prueba: responde bien, lento, con error o nunca (para los labs) |
| migrar | `npm run migrar` | aplica las migraciones de `migraciones/` una sola vez, con lock |
| `web/` | archivos estáticos | status page: lista los monitores y permite agregar o quitar |

```text
navegador → reverse proxy → web/ (estáticos)
                          → /api → api → Postgres
                                       → cola (Valkey/Redis)

worker → cola (Valkey/Redis)
       → Postgres
       → los sitios monitoreados
```

## Requisitos

- Node 24 (fijado en `.nvmrc`).
- Postgres 18.
- Valkey 9 (o Redis 6.2+, que es con lo que habla BullMQ).

Este repo no trae `Dockerfile`, `compose.yaml` ni manifests a propósito: esa infraestructura se escribe en los cursos, no acá.

## Usar esta plantilla

Este repo es una plantilla de GitHub. Para tener tu propia copia con historia propia (no un fork): botón **Use this template** en GitHub → **Create a new repository**, elegí que sea público (los cursos leen el código ahí) y cloná tu copia.

## Correr sin Docker

```bash
npm ci
npm run build

export DATABASE_URL=postgres://usuario:clave@localhost:5432/pulso
export REDIS_URL=redis://localhost:6379

npm run migrar
```

Después, en tres terminales:

```bash
npm run api
npm run worker
npm run sitio-lento
```

Para probar:

```bash
curl -s localhost:3000/api/estado

curl -s -X POST localhost:3000/api/monitores \
  -H 'content-type: application/json' \
  -d '{"url":"http://localhost:3001/ok","intervaloSegundos":10}'
```

La web (`web/`) no tiene servidor propio: son archivos estáticos que necesitan un reverse proxy que los sirva y pase `/api` a la api (nginx, se arma en el curso 1). Sin eso, abrir `web/index.html` directo del disco no va a poder pedirle nada a la api.

## Variables de entorno

| Variable | Proceso | Por defecto |
|---|---|---|
| `PORT` | api (3000), sitio-lento (3001) | según el proceso |
| `METRICAS_PORT` | worker | `9464` |
| `DATABASE_URL` | api, worker, migrar | — (obligatoria) |
| `REDIS_URL` | api, worker | — (obligatoria) |
| `LOG_LEVEL` | todos | `info` |
| `WORKER_CONCURRENCIA` | worker | `5` |
| `FALLA_LATENCIA_MS` | api | `0` — ver [FALLAS.md](./FALLAS.md) |
| `FALLA_FUGA_MEMORIA` | api | `0`, `1` la activa — ver [FALLAS.md](./FALLAS.md) |
| `FALLA_SIN_TIMEOUT` | worker | `0`, `1` la activa — ver [FALLAS.md](./FALLAS.md) |

## Endpoints

### api (`PORT`, 3000 por defecto)

| Método y ruta | Respuestas |
|---|---|
| `GET /healthz` | 200 `{"estado":"ok"}` mientras el proceso vive |
| `GET /readyz` | 200 `{"estado":"listo","base":true,"cola":true}`; 503 `{"estado":"no_listo","base":bool,"cola":bool}`; 503 `{"estado":"cerrando"}` después de SIGTERM (casi no se ve: ver [Apagado](#apagado)) |
| `GET /metrics` | 200 texto de Prometheus |
| `GET /api/estado` | 200 `EstadoMonitor[]` |
| `GET /api/monitores` | 200 `Monitor[]` |
| `POST /api/monitores` | 201 `Monitor`; 400 `{"error":"validacion","detalles":[...]}`; 503 `{"error":"cola_no_disponible"}` (no queda el alta) |
| `GET /api/monitores/:id` | 200 `Monitor`; 404 `{"error":"no_encontrado"}` (también con un id que no es número) |
| `PATCH /api/monitores/:id` | 200 `Monitor`; 400; 404; 503 (el monitor queda como estaba) |
| `DELETE /api/monitores/:id` | 204; 404; 503 (no se borra) |
| `GET /api/monitores/:id/chequeos?limite=N` | 200 `Chequeo[]` del más nuevo al más viejo, `limite` 1-500 (50 por defecto); 400; 404 |
| Cualquier otra | 404 `{"error":"no_encontrado"}` |
| JSON roto o cuerpo ilegible | 400 `{"error":"json_invalido"}`; cuerpo de más de 10 kB: 413 `{"error":"cuerpo_demasiado_grande"}`; `content-encoding` o `charset` no soportados: 415 `{"error":"tipo_no_soportado"}`; otro error al leer el cuerpo: 400 `{"error":"cuerpo_invalido"}` |
| Error inesperado | 500 `{"error":"interno"}` y log `error` |

Reglas de validación: `url` obligatoria, `http` o `https`, hasta 2048 caracteres; `intervaloSegundos` entero 10-3600 (30 por defecto); `timeoutMs` entero 100-30000 (5000 por defecto) y menor que el intervalo en milisegundos; campos desconocidos rechazados.

### sitio-lento (`PORT`, 3001 por defecto)

Sitio de prueba para los labs: no forma parte del contrato de Pulso, pero lo usan los monitores de ejemplo.

| Método y ruta | Respuestas |
|---|---|
| `GET /ok` | 200 |
| `GET /healthz` | 200 |
| `GET /lento?ms=N` | 200 después de N ms (0-60000); 400 si N es inválido |
| `GET /error?codigo=N` | responde con el código N si está entre 400 y 599, si no 500 |
| `GET /colgado` | nunca responde |
| Cualquier otra | 404 |

### worker — servidor de métricas (`METRICAS_PORT`, 9464 por defecto)

El worker no atiende HTTP de negocio: este servidor chico es solo para Prometheus y las probes.

| Método y ruta | Respuestas |
|---|---|
| `GET /healthz` | 200 `{"estado":"ok"}` |
| `GET /readyz` | 200 `{"estado":"listo","base":true,"cola":true}`; 503 `{"estado":"no_listo",...}`; 503 `{"estado":"cerrando"}` después de SIGTERM |
| `GET /metrics` | 200 texto de Prometheus |
| Cualquier otra | 404 `{"error":"no_encontrado"}` |

## Salud y métricas

`/healthz` responde mientras el proceso está vivo, sin chequear dependencias. `/readyz` chequea que Postgres y la cola respondan (503 si no). Apenas llega SIGTERM pasa a `{"estado":"cerrando"}` (503): en el **worker** se ve normal, porque el servidor de métricas sigue aceptando pedidos mientras se drenan los chequeos en curso. En la **api** casi no se llega a ver: Node deja de aceptar conexiones nuevas en el mismo instante en que llega la señal, así que ese 503 solo lo ve un pedido que ya estaba en una conexión abierta (keep-alive); una conexión nueva recibe el socket rechazado, no una respuesta HTTP (ver [Apagado](#apagado)). `/metrics` expone texto de Prometheus, con las métricas de proceso por defecto más las propias:

Si Postgres se cae (un lab la reinicia, un restart de contenedor), `/readyz` pasa a responder 503 sin que el proceso se caiga: node-postgres descarta las conexiones ociosas que quedan colgadas y el pool avisa por un log `warn` (`"se perdió una conexión ociosa con la base"`), no con un crash. Cuando Postgres vuelve a responder, el pool abre conexiones nuevas solo con la próxima consulta, sin reiniciar nada a mano.

**api**

- `pulso_http_pedidos_total{metodo,ruta,codigo}`: pedidos atendidos.
- `pulso_http_duracion_segundos{metodo,ruta}`: histograma de duración por ruta.

**worker**

- `pulso_chequeos_total{resultado="ok"|"falla"}`: chequeos hechos.
- `pulso_chequeo_duracion_segundos`: histograma de duración de cada chequeo.
- `pulso_cola_pendientes`: chequeos esperando un worker; `Nan` si la cola no responde en 1 s (no rompe el resto de `/metrics`).

## Logs

Cada proceso escribe JSON a stdout con [pino](https://getpino.io), una línea por evento — nada de `console.*`. Campos fijos: `level` numérico (10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal), `time` en epoch ms, `servicio` (`api`, `worker`, `sitio-lento`, `migrar`) y `msg`. Los errores agregan `err` con el mensaje y el stack. `LOG_LEVEL` controla el piso (`info` por defecto). Los errores HTTP van en el cuerpo de la respuesta, en snake_case español (`{"error":"no_encontrado"}`), no en el mensaje del log.

## Tests

- `npm test`: unitarios y de datos (estos últimos contra PGlite, en memoria). No necesitan Postgres ni Valkey corriendo.
- `npm run test:integracion`: contra servicios reales. Necesita `TEST_DATABASE_URL` y `TEST_REDIS_URL` — **nunca** `DATABASE_URL`: los tests borran el esquema `public` de esa base en cada archivo.

## Apagado

Con SIGTERM (lo manda Docker o Kubernetes al bajar un contenedor), cada proceso tiene una ventana para terminar antes de que el orquestador lo mate:

- **api** (hasta 10 s): deja de aceptar conexiones nuevas en el mismo instante en que llega la señal — antes de que `/readyz` llegue a responder `{"estado":"cerrando"}` para una conexión nueva, esa conexión ya fue rechazada. Los pedidos que ya estaban en curso en una conexión abierta terminan normal (esos sí pueden llegar a ver el 503 `cerrando` si piden `/readyz` de nuevo en esa misma conexión); después se cierra la conexión a la base y a la cola. En Kubernetes hace falta un `preStop` con `sleep` para cubrir la ventana entre que el pod deja de recibir tráfico nuevo (se actualiza el Endpoint) y que la app corta conexiones, si no algunos pedidos en tránsito van a rebotar.
- **worker** (hasta 25 s): deja de tomar trabajos nuevos y espera a que terminen los chequeos en curso antes de cerrar; mientras drena, `/readyz` de su servidor de métricas sí muestra `cerrando` con normalidad.

Código de salida: `0` si el apagado terminó a tiempo; `1` si se agotó el timeout de la ventana, si alguna tarea del apagado falló, o si la configuración era inválida al arrancar.

`docker stop` y el `stop_grace_period` de Compose esperan 10 s por defecto antes de mandar SIGKILL: alcanza para la api, pero es menos que los 25 s del worker — para el worker hay que subir ese valor (o `terminationGracePeriodSeconds` en Kubernetes), si no el proceso puede terminar matado a mitad de un chequeo en vez de cerrar solo.

`npm run <script>` reporta el código de salida 143 al recibir SIGTERM aunque el proceso haya terminado con 0 (lo intercepta npm, no el script). En producción (systemd, contenedores) conviene arrancar los procesos con `node dist/...` directo, no con `npm run`, para ver el código de salida real.

## Seguridad

Esta app no tiene autenticación: cualquiera que le llegue a `POST`/`PATCH`/`DELETE /api/monitores` puede crear, cambiar o borrar monitores, y el worker le va a pegar un `GET` a cualquier URL que le den, sin restringir el destino (incluidas redes privadas). Está bien para los labs de los cursos, pero no expongas esas rutas sin protegerlas (un proxy con auth, una red interna) fuera de ese contexto.

## Licencia

MIT. Ver [LICENSE](./LICENSE).
// concurrencia 1 (2026-09-15T00:12:45Z)
