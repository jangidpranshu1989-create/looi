# Looi — 24/7 marketing agent (API + web app + scheduler + ad renderer)
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg fonts-inter fonts-noto-color-emoji fonts-noto-core ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=5000 CHROME_PATH=/usr/bin/chromium \
    LOOI_DATA_DIR=/app/looi-data LOOI_DB=/app/looi-data/data.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/server/py ./server/py
COPY package.json ./
RUN mkdir -p /app/looi-data
VOLUME ["/app/looi-data"]
EXPOSE 5000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.cjs"]
