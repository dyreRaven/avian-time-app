FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data /app/backups /app/secure_uploads /app/uploads /app/public/uploads /app/public \
    && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "server.js"]
