import { afterEach, expect, it } from 'vitest';
import { fixture, packet } from './staging-worker-fixture.mjs';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
let f;
afterEach(()=>{f?.cleanup();f=null;});
it('leaves the live first claim untouched while an independent project completes', async()=>{
  f=fixture();const first=f.store.accept(packet()),held=f.store.claim(first.id);
  const next=packet();next.project_id='43';next.request_id='request-2';next.packet_id='packet-2';next.idempotency_key='idem-2';
  const second=f.store.accept(next),options=f.options(),hosted=[];
  options.host={deploy:async({job})=>{hosted.push(job.packet.project_id);return {verified:true,review_only:true,url:'https://synthetic.famtasticinc.com/',manifest_sha256:'a'.repeat(64),target_path:'/home/nineoo/public_html/synthetic',remote_subdirectory:'synthetic'};}};
  const results=await createStagingWorker(options).tick();
  expect(results[0]).toMatchObject({id:first.id,state:'busy',code:'project_busy'});
  expect(results[1]).toMatchObject({id:second.id,state:'complete'});expect(hosted).toEqual(['43']);
  expect(f.store.read(first.id).attempts).toEqual({});
  expect(()=>f.store.claim(first.id)).toThrow('project_busy');
  f.store.checkpoint(first,held.token);f.store.release(first,held.token);
});
it('does not swallow unrelated claim errors', async()=>{
  const error=Object.assign(new Error('disk failed'),{code:'storage_failed'});
  const worker=createStagingWorker({store:{list:()=>[{id:'one',state:'queued'}],claim:()=>{throw error;}}});
  await expect(worker.tick()).rejects.toBe(error);
});
it('does not mistake a non-claim project_busy error for a skippable live claim', async()=>{
  const error=Object.assign(new Error('release failed'),{code:'project_busy'});
  const worker=createStagingWorker({store:{list:()=>[{id:'one',state:'queued'}],claim:()=>({job:{state:'complete'},token:'token'}),release:()=>{throw error;}}});
  await expect(worker.tick()).rejects.toBe(error);
});
