FROM caddy:2.11.3-alpine

RUN apk upgrade --no-cache

COPY deploy/production/Caddyfile.production /etc/caddy/Caddyfile
