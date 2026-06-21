FROM golang:1.26.4-alpine AS builder

RUN apk add --no-cache git

WORKDIR /src
RUN git clone --depth 1 --branch v2.11.4 https://github.com/caddyserver/caddy.git . \
    && go mod edit -require=github.com/go-jose/go-jose/v3@v3.0.5 \
    && go mod tidy \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/bin/caddy ./cmd/caddy

FROM alpine:3.23

RUN apk add --no-cache ca-certificates mailcap tzdata curl \
    && apk upgrade --no-cache \
    && mkdir -p /config/caddy /data/caddy /etc/caddy

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY deploy/production/Caddyfile.production /etc/caddy/Caddyfile

EXPOSE 80 443 443/udp
ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
