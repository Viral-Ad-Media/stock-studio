# syntax=docker/dockerfile:1.7
# Stock Studio images. Two targets:
#   web         the Next.js app (standalone server, non-root, healthcheck)
#   signal-bot  the Discord signal bot (scripts/signal-bot.ts)
# Secrets are never baked in: pass runtime env with --env-file / compose
# env_file. Only the three NEXT_PUBLIC_* values are build args, because Next
# inlines them into the browser bundle at build time (they're public anyway).

# Override to pull the same official image through a mirror, e.g.
#   --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Behind a TLS-inspecting proxy? Pass its CA as a BuildKit secret; it's only
# mounted for the steps that download, never written into an image layer:
#   docker build --secret id=ca_bundle,src=/path/to/ca.pem ...

# ---- dependencies (cached on package-lock.json) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; fi; \
    npm ci --no-audit --no-fund

# ---- build the app ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_OUTPUT=standalone
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; fi; \
    npm run build

# ---- web: the production server ----
FROM base AS web
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3200
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ---- signal-bot: the Discord bot ----
FROM base AS signal-bot
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY lib/signals.ts lib/signal-delivery.ts ./lib/
COPY scripts/signal-bot.ts ./scripts/signal-bot.ts
USER node
CMD ["node_modules/.bin/tsx", "scripts/signal-bot.ts"]
