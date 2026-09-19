# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# ignore-scripts: avoid pnpm approve-builds for esbuild (dev-only; we compile with tsc)
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Reinstall production deps only (prune trips on ignored esbuild builds)
RUN rm -rf node_modules \
  && pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production

RUN groupadd --gid 1001 bot \
  && useradd --uid 1001 --gid bot --create-home --shell /usr/sbin/nologin bot

WORKDIR /app

COPY --from=build --chown=bot:bot /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=bot:bot /app/node_modules ./node_modules
COPY --from=build --chown=bot:bot /app/dist ./dist
COPY --chown=bot:bot data ./data

USER bot

CMD ["node", "dist/index.js"]
