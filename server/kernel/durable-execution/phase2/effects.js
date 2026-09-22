import { phase2Failure } from './errors.js';

export const PHASE2_EFFECT_POLICY = Object.freeze({
  callback: 'deny',
  outbound: 'deny',
  publish: 'deny',
  deploy: 'deny',
  repository_write: 'deny',
  payment: 'deny',
});

function blockedEffect(kind) {
  throw phase2Failure(403, 'phase2_external_effect_denied', `${kind} is denied in the Phase 2 cloud-shadow pilot`);
}

export function createPhase2EffectsFirewall() {
  const attempted = Object.fromEntries(Object.keys(PHASE2_EFFECT_POLICY).map((key) => [key, 0]));
  const completed = Object.fromEntries(Object.keys(PHASE2_EFFECT_POLICY).map((key) => [key, 0]));
  const deny = (kind) => {
    attempted[kind] += 1;
    return blockedEffect(kind);
  };
  return Object.freeze({
    callback: () => deny('callback'),
    outbound: () => deny('outbound'),
    publish: () => deny('publish'),
    deploy: () => deny('deploy'),
    repositoryWrite: () => deny('repository_write'),
    payment: () => deny('payment'),
    snapshot: () => Object.freeze({
      policy: PHASE2_EFFECT_POLICY,
      attempted: Object.freeze({ ...attempted }),
      completed: Object.freeze({ ...completed }),
    }),
  });
}
