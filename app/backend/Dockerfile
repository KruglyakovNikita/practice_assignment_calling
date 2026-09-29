FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY app/backend/package.json app/backend/package.json
RUN pnpm install --filter @auto-calling/backend... --no-frozen-lockfile
COPY app/backend app/backend
RUN pnpm --filter @auto-calling/backend build

FROM node:22-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY app/backend/package.json app/backend/package.json
RUN pnpm install --filter @auto-calling/backend... --prod --no-frozen-lockfile
COPY --from=build /workspace/app/backend/dist app/backend/dist
EXPOSE 8080
CMD ["node", "app/backend/dist/main.js"]
