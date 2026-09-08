FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app ./
RUN mkdir -p storage/uploads && chown -R node:node storage/uploads
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/setup-db.mjs && node node_modules/next/dist/bin/next start --hostname 0.0.0.0"]
