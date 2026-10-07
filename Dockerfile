# MECGURA Platform — production image (PostgreSQL).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PRISMA_SCHEMA=prisma/schema.postgres.prisma
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# Baked into the browser bundle at build time (this app's public https URL).
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build
EXPOSE 3000
# Applies the schema (never drops data — Prisma refuses destructive changes), seeds plans/admin, then serves.
CMD ["sh", "-c", "npx prisma db push && npx tsx prisma/seed.ts && npx next start -p 3000"]
