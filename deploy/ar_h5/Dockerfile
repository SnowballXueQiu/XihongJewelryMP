FROM node:22-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

RUN git clone --depth 1 https://github.com/SnowballXueQiu/ar-tryon.git .

RUN npm config set registry https://registry.npmmirror.com && \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com corepack enable && \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com corepack prepare pnpm@10.29.2 --activate

RUN pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm build

FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/ar_h5/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3020

CMD ["nginx", "-g", "daemon off;"]
