# Build from the repository root:  docker build -f services/api/Dockerfile -t gdc-api .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/api services/api
RUN npm ci --workspace @gdc/api --workspace @gdc/shared --include-workspace-root
RUN npm run build -w @gdc/api

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci --omit=dev --workspace @gdc/api --include-workspace-root && npm cache clean --force
COPY --from=build /app/services/api/dist services/api/dist
USER node
WORKDIR /app/services/api
EXPOSE 8080
CMD ["node", "dist/server.js"]
