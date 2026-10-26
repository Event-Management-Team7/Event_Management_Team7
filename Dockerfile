FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend ./backend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV EMRS_DB=/data/emrs.db EMRS_PORT=8080 EMRS_WEB_DIR=/app/frontend/dist
RUN mkdir /data && chown -R node:node /data /app
USER node
EXPOSE 8080
VOLUME /data
CMD ["node", "backend/src/server.js"]
