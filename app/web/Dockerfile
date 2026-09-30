FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY app/web/package.json app/web/package.json
RUN pnpm install --filter @auto-calling/web... --no-frozen-lockfile
COPY packages/contracts packages/contracts
COPY app/web app/web
RUN pnpm --filter @auto-calling/contracts build && pnpm --filter @auto-calling/web build

FROM nginx:1.27-alpine
COPY app/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/app/web/dist /usr/share/nginx/html
EXPOSE 5173
