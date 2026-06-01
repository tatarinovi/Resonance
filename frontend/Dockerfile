FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN test -f vite.config.mjs || (echo "vite.config.mjs missing" >&2 && exit 1)
RUN npm run build

FROM nginx:1.27-alpine

# SPA: index.html fallback for client-side React Router routes
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  # Static assets get long cache; index.html is no-cache so deploys are picked up.\n\
  location /assets/ {\n\
    expires 365d;\n\
    add_header Cache-Control "public, immutable";\n\
    try_files $uri =404;\n\
  }\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
    add_header Cache-Control "no-cache";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
