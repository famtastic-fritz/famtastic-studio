#!/usr/bin/env node
import http from 'node:http';
import { createStagingIngressProxy } from '../server/kernel/staging-ingress-proxy.js';

const port = Number(process.env.SELECTED_STAGING_INGRESS_PORT || 3418);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_ingress_port');
const handler = createStagingIngressProxy({ secret: process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET });
const server = http.createServer(handler);
server.requestTimeout = 40000;
server.headersTimeout = 10000;
server.maxConnections = 16;
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ service: 'selected-staging-ingress', port, scope: 'signed-staging-accept-only' })));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => server.closeAllConnections(), 40000).unref();
});
