# Multi-stage Dockerfile for Rawad Tech Captive Portal Backend (Supabase + MikroTik)
FROM node:22-alpine AS builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/node_modules ./backend/node_modules
EXPOSE 4000
CMD ["node", "backend/dist/api/server.js"]
