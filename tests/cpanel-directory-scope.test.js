import { afterEach, expect, it } from 'vitest';
import { fixture, html } from './staging-worker-fixture.mjs';
import { mockCpanelHttp } from './cpanel-http-fixture.mjs';
import { createCpanelHttpTransport } from '../server/kernel/cpanel-http-transport.js';
let f;
afterEach(()=>f?.cleanup());
function setup(url) {
  f=fixture();const binding={...f.binding,url};
  const mock=mockCpanelHttp({binding,html,artifactUrl:'https://assets.example.invalid/index.html',callbackEndpoint:'https://designs.example.invalid/callback'});
  const transport=createCpanelHttpTransport({paths:f.paths,journal:f.journal,binding,credentialProvider:async()=> 'synthetic-token',reviewAuthorization:'Basic synthetic-review',authFile:'/home/nineoo/.famtastic-review/synthetic.htpasswd',fetchImpl:mock.fetchImpl});
  return {binding,mock,transport};
}
it('rejects a subfolder URL without trailing slash before credentials or HTTP',()=>{
  f=fixture();let calls=0;
  expect(()=>createCpanelHttpTransport({binding:{...f.binding,url:'https://famtasticinc.com/synthetic'},credentialProvider:()=>{calls++;},fetchImpl:()=>{calls++;}})).toThrow('review_target_invalid');
  expect(calls).toBe(0);
});
for(const url of ['https://synthetic.famtasticinc.com/','https://famtasticinc.com/synthetic/']) it(`keeps file, access and alias probes within ${url}`,async()=>{
  const {binding,mock,transport}=setup(url);
  mock.files.set(`${binding.target_path}/index.html`,Buffer.from(html));
  expect(await transport.verifyAccess()).toEqual({anonymous_denied:false,aliases_denied:false,noindex:false});
  await transport.claim('scope-test');await transport.preflight();await transport.protect();
  expect(await transport.verifyAccess()).toEqual({anonymous_denied:true,aliases_denied:true,noindex:true});
  expect((await transport.probe({path:'index.html'})).bytes.toString()).toBe(html);
  const prefix=new URL(url).pathname;
  expect(mock.calls.filter(c=>!c.host.endsWith(':2083')).every(c=>c.route.startsWith(prefix))).toBe(true);
  expect(mock.calls.some(c=>c.route===`${prefix}index.html`)).toBe(true);
  const count=mock.calls.length;
  await expect(transport.probe({path:'../index.html'})).rejects.toThrow('review_probe_path_invalid');expect(mock.calls).toHaveLength(count);
  await transport.release();
});
