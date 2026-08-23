FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY www/package* ./
RUN npm ci
COPY www/src ./src
COPY www/client ./client
COPY www/vite.config.mjs ./vite.config.mjs
RUN npm run build:client

FROM node:22-bookworm-slim
WORKDIR /app
COPY www/package* ./
RUN npm ci --omit=dev
COPY --from=build /app/src ./src
COPY CHANGELOG.md ./CHANGELOG.md
ENV CHANGELOG_PATH=/app/CHANGELOG.md
EXPOSE $PORT
ENTRYPOINT ["npm", "start"]
