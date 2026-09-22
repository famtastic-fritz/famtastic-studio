import crypto from 'node:crypto';
export function selectedArtifactAuthorization(url, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const match = /\/api\/site-studio\/selected-artifacts\/([^/]+)\/([0-9]+)\/([a-f0-9]{64})$/.exec(new URL(url).pathname);
  if (!match || !secret) throw new Error('artifact_authorization_configuration_invalid');
  const message = `selected-artifact.v1\n${decodeURIComponent(match[1])}\n${Number(match[2])}\n${match[3]}\n${timestamp}`;
  return `FAMtastic-Artifact ${timestamp}:${crypto.createHmac('sha256', secret).update(message).digest('hex')}`;
}
