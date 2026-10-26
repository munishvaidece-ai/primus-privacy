# One image for both processes: the web app and the AI worker.
#   web:     CMD ["npm","start"]               (default)
#   worker:  CMD ["npm","run","ai:worker"]
#   setup:   npm run db:migrate:apply  /  npm run bootstrap -- ...
# NOTE: this Dockerfile was written but could not be built or run in the
# environment it was authored in (no container runtime there). Build it once
# in CI and run the smoke check in docs/DEPLOYMENT.md §7 before relying on it.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The build does not need database or Supabase credentials.
RUN npm run build

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app ./
# Run as an unprivileged user.
RUN useradd --system --uid 10001 --home /app primus && chown -R primus /app/.next
USER primus
EXPOSE 3000
CMD ["npm", "start"]
