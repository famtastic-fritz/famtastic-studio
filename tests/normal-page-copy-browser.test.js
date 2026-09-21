import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
const frontend = process.env.SELECTED_PORTAL_FRONTEND;
const dependencies = process.env.SELECTED_PORTAL_DEPENDENCIES;

it.skipIf(!frontend || !dependencies)('real portal editor serializes partial, edited and withdrawn copy on mobile and desktop', async () => {
  const result = await build({ stdin: { contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {WebsiteRequestIntakeEditor} from ${JSON.stringify(path.join(frontend || '', 'src/components/portal/PortalProjectsView.jsx'))};
    import {pageContentFromForm} from ${JSON.stringify(path.join(frontend || '', 'src/components/portal/pageContentForm.js'))};
    import {withdrawWebsiteRequestAsset,uploadWebsiteRequestAsset} from ${JSON.stringify(path.join(frontend || '', 'src/api/customer.js'))};
    window.reupload=async()=>{try{await uploadWebsiteRequestAsset('00000000-0000-4000-8000-000000000901',new FormData());return 'unexpected success';}catch(error){return {message:error.message,status:error.status,code:error.code};}};
    function App() { const [request,setRequest] = useState({public_id:'00000000-0000-4000-8000-000000000901',project_name:'Synthetic project',business_name:'Synthetic',intake:{page_count:2,page_list:'Home, About'},assets:[{public_id:'00000000-0000-4000-8000-000000000001',name:'logo.png',size_bytes:68}]});
      return <WebsiteRequestIntakeEditor editingRequest={request} setEditingRequest={setRequest} busy={false} onUploadAsset={e=>e.preventDefault()}
        onWithdrawAsset={async id=>{await withdrawWebsiteRequestAsset(request.public_id,id);setRequest(current=>({...current,assets:[]}));window.withdrawn=id;}}
        onSave={e=>{e.preventDefault();window.saved=pageContentFromForm(new FormData(e.currentTarget));window.submitted=true;}}/>; }
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: frontend, loader: 'jsx' },
    nodePaths: [dependencies], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'import.meta.env': '{}' } });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(3000); page.setDefaultNavigationTimeout(3000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const requests = [];
      await page.route('**/*', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" class="portal-page"></div></body></html>' });
        if (pathname === '/web/session/token') return route.fulfill({ contentType: 'text/plain', body: 'synthetic-csrf' });
        if (pathname.endsWith('/assets')) return route.fulfill({ status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'reference_inactive',message:'This reference was withdrawn and remains inactive. Uploading it again does not restore permission to use it.'}) });
        if (pathname.endsWith('/assets/00000000-0000-4000-8000-000000000001/withdraw')) { requests.push({ method: route.request().method(), csrf: route.request().headers()['x-csrf-token'] }); return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"status":"withdrawn"}' }); }
        return route.abort();
      });
      await page.goto('http://portal.test/');
      await page.addStyleTag({ content: fs.readFileSync(path.join(frontend, 'src/portal.css'), 'utf8') });
      await page.addScriptTag({ content: result.outputFiles[0].text });
      await page.locator('#website-request-editor form').first().evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(await page.evaluate(() => window.saved)).toBeUndefined();
      await page.getByText('Page copy', { exact: true }).click();
      await page.getByRole('button', { name: 'Add page copy', exact: true }).click();
      await page.getByLabel('Page name', { exact: true }).fill('About');
      await page.getByLabel('Page heading', { exact: true }).fill('Our story');
      // Submit the actual form without unrelated intake validity blocking this component proof.
      await page.locator('#website-request-editor form').first().evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(await page.evaluate(() => window.saved)).toEqual([{ page_name: 'About', title: '', heading: 'Our story', description: '', body: '' }]);
      await page.getByLabel('Page text', { exact: true }).fill('Actual customer copy.');
      await page.locator('#website-request-editor form').first().evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect((await page.evaluate(() => window.saved))[0].body).toBe('Actual customer copy.');
      await page.getByRole('button', { name: 'Withdraw reference', exact: true }).click();
      await page.waitForFunction(() => window.withdrawn, null, { timeout: 3000 });
      expect(requests).toEqual([{ method: 'POST', csrf: 'synthetic-csrf' }]);
      expect(await page.getByRole('button', { name: 'Withdraw reference', exact: true }).count()).toBe(0);
      expect(await page.evaluate(()=>window.reupload())).toMatchObject({status:409,code:'reference_inactive',message:expect.stringContaining('remains inactive')});
      expect(await page.locator('[name="page_copy_body"]').count(), await page.locator('#website-request-editor').innerText()).toBe(1);
      expect(await page.getByLabel('Page text', { exact: true }).inputValue()).toBe('Actual customer copy.');
      await page.getByRole('button', { name: 'Remove this page copy', exact: true }).click();
      await page.locator('#website-request-editor form').first().evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(await page.evaluate(() => window.saved)).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.close();
    }
  } finally { await browser.close(); }
}, 20000);
