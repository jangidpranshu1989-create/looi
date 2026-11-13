# Looi — 24/7 marketing agent server (API + web client + scheduler)
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg fonts-inter fonts-noto-color-emoji fonts-noto-core python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium NODE_ENV=production PORT=5000
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npx drizzle-kit push && npm prune --omit=dev || true
VOLUME ["/app/looi-data"]
EXPOSE 5000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "LOOI_DB=/app/looi-data/data.db npx drizzle-kit push >/dev/null 2>&1; LOOI_DB=/app/looi-data/data.db node dist/index.cjs"]
