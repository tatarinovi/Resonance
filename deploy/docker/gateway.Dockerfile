FROM caddy:2.8-alpine

COPY deploy/production/Caddyfile.production /etc/caddy/Caddyfile
