const { chromium } = require('playwright');

const BASE = 'http://localhost:3400';
const PAGES = [
  { id: 'work', path: '/' },
  { id: 'sites', path: '/sites' },
  { id: 'site-view', path: '/site?site_id=site-drop-the-beat' },
  { id: 'applications', path: '/applications' },
  { id: 'proofs', path: '/proofs' },
  { id: 'deployments', path: '/deployments' },
  { id: 'media', path: '/media' },
  { id: 'components', path: '/components' },
  { id: 'builds', path: '/builds' },
  { id: 'automations', path: '/automations' },
  { id: 'settings', path: '/settings' },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const p of PAGES) {
    try {
      const resp = await page.goto(BASE + p.path, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => {
        const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim());
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => h.tagName);
        const landmarks = {
          nav: document.querySelectorAll('nav').length,
          main: document.querySelectorAll('main').length,
          header: document.querySelectorAll('header').length,
        };
        const skipLink = !!document.querySelector('a[href^="#"][class*="skip"], a.skip-link, [data-skip-link]');
        const tablist = document.querySelectorAll('[role="tablist"]').length;
        return { title: document.title, h1s, headings, landmarks, skipLink, tablist, bodyClasses: document.body.className };
      });
      console.log(p.id, resp.status(), JSON.stringify(info));
    } catch (e) {
      console.log(p.id, 'ERROR', e.message);
    }
  }
  await browser.close();
}
main();
