FROM node:latest
WORKDIR /app
COPY package* ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE $PORT
ENTRYPOINT ["npm", "start"]
