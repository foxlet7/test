# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @tablya/shared --workspace @tablya/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @tablya/shared && npm run build -w @tablya/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @tablya/shared --workspace @tablya/api --include-workspace-root
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && npx prisma generate
USER node
EXPOSE 3000
WORKDIR /repo/apps/api
# Run `npx prisma migrate deploy` as a release step (see docs/DEPLOYMENT.md), not on every container start.
CMD ["node", "dist/main.js"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
