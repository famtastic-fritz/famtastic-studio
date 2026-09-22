ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node server/cloud/control-main.js ./server/cloud/control-main.js
COPY --chown=node:node server/cloud/control-server.js ./server/cloud/control-server.js
COPY --chown=node:node server/cloud/phase2-http.js ./server/cloud/phase2-http.js
COPY --chown=node:node server/kernel/cli-entry.js ./server/kernel/cli-entry.js
COPY --chown=node:node server/kernel/durable-execution/phase2 ./server/kernel/durable-execution/phase2

USER node
EXPOSE 8080
CMD ["node", "server/cloud/control-main.js"]
