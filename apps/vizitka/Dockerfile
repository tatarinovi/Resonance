FROM node:22 AS builder

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --ignore-scripts

ENV PORT=3000
ENV BASE_PATH=/

RUN pnpm --filter @workspace/portfolio build

FROM nginx:stable

COPY --from=builder /app/artifacts/portfolio/dist /usr/share/nginx/html