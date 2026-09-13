# syntax=docker/dockerfile:1
ARG NODE_VERSION=24-trixie-slim

FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY migraciones ./migraciones

# "node" es el usuario que ya trae la imagen oficial: se resuelve dentro del contenedor,
# que es lo que importa acá (no un UID numérico legible desde el host).
# hadolint ignore=DL3066
USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/api/servidor.js"]
