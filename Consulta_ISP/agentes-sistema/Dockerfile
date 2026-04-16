FROM node:20-alpine

# better-sqlite3 precisa de build tools para compilar no Alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Remove build tools apos install (reduz imagem ~100MB)
RUN apk del python3 make g++

COPY . .

RUN mkdir -p data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

EXPOSE 3001

CMD ["node", "src/server.js"]
