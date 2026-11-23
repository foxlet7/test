# NOC Platform server: Next.js (standalone output) + Prisma migrations on start.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && groupadd -r noc && useradd -r -g noc noc
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
# Generated Prisma client + query engine used by the app
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI (with its own dependencies) only for "migrate deploy" at start-up
RUN npm install --prefix /opt/prisma prisma@6.19.3 --no-audit --no-fund && npm cache clean --force
USER noc
EXPOSE 3000
CMD ["sh", "-c", "node /opt/prisma/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && exec node server.js"]
