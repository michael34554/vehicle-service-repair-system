# Generic container build for the Node API + Vite-built frontend.
# MySQL is expected to be an external service (see docker-compose.yml).
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    PYTHON_EXECUTABLE=/usr/bin/python3
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN python3 -m pip install --no-cache-dir -r ml/requirements.txt \
 && npm run build \
 && useradd --create-home --uid 10001 nextgen \
 && chown -R nextgen:nextgen /app
USER nextgen
EXPOSE 3000
CMD ["npm", "start"]
