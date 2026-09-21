import { stagingError } from './staging-store.js';
export function reviewDirectoryUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw stagingError('review_target_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || !/^(?:[a-z0-9-]+\.)?famtasticinc\.com$/.test(url.hostname)
    || !/^\/(?:[a-z0-9-]+\/)?$/.test(url.pathname)) throw stagingError('review_target_invalid');
  return url;
}
