FROM node:latest
WORKDIR /app
COPY www/package* ./
RUN npm ci --omit=dev
COPY www/src ./src
COPY CHANGELOG.md ./CHANGELOG.md
ENV CHANGELOG_PATH=/app/CHANGELOG.md
EXPOSE $PORT
ENTRYPOINT ["npm", "start"]
