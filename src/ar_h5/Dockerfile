FROM node:22-alpine AS builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com && \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com corepack enable && \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com corepack prepare pnpm@10.29.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/ar_h5/package.json ./src/ar_h5/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts --filter @xihong/ar-h5...

COPY src/ar_h5 ./src/ar_h5

RUN pnpm --dir src/ar_h5 build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/src/ar_h5/public ./src/ar_h5/public
COPY --from=builder /app/src/ar_h5/.next/static ./src/ar_h5/.next/static
COPY --from=builder /app/src/ar_h5/.next/standalone ./

EXPOSE 3001

CMD ["node", "src/ar_h5/server.js"]
