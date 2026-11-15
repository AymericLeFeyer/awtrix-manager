# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4444 \
    DATA_DIR=/app/data \
    TZ=Europe/Paris

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/

# La configuration (appareils, providers, widgets) vit dans un volume.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 4444

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
