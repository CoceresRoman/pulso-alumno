# syntax=docker/dockerfile:1
FROM nginxinc/nginx-unprivileged:1.30-alpine

ENV PULSO_API_URL=http://api:3000

COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY index.html app.js estado.js estilos.css /usr/share/nginx/html/

EXPOSE 8080
