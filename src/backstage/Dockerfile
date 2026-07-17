FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && npm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/backstage/package.json ./src/backstage/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts --filter @xihong/backstage...

COPY src/backstage ./src/backstage

ARG NEXT_PUBLIC_API_BASE=https://api.xihongzhubao.com
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE

RUN pnpm --dir src/backstage build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/src/backstage/public ./src/backstage/public
COPY --from=builder /app/src/backstage/.next/static ./src/backstage/.next/static
COPY --from=builder /app/src/backstage/.next/standalone ./

EXPOSE 3000

CMD ["node", "src/backstage/server.js"]
