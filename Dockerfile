# syntax=docker/dockerfile:1

# Build: install all dependencies, build the app and the CLI, then drop dev dependencies.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# No install scripts: better-sqlite3 ships prebuilt binaries (Alpine's included) and esbuild's
# binary comes from its platform package, so no compiler is needed.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev

# Run: only the build output, production dependencies and SQL migrations, as the non-root user.
FROM node:22-alpine
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATA_DIR=/data \
	MIGRATIONS_DIR=/app/drizzle \
	# Behind Caddy: the client address is the last X-Forwarded-For entry (Caddy replaces any
	# value a client sends). The origin comes from ORIGIN, never from request headers.
	ADDRESS_HEADER=x-forwarded-for \
	XFF_DEPTH=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1
CMD ["node", "build/index.js"]
