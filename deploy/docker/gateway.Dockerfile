FROM caddy:2.10-alpine

RUN apk upgrade --no-cache

COPY deploy/production/Caddyfile.production /etc/caddy/Caddyfile
