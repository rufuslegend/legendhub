FROM node:latest
WORKDIR /app
COPY package* ./
RUN npm ci --omit=dev
EXPOSE $PORT
ENTRYPOINT ["npm", "start"]
