export function mockCpanelHttp({ binding, html, artifactUrl, callbackEndpoint }) {
  const privateRoot = '/home/nineoo/.famtastic-review';
  const files = new Map([[`${privateRoot}/synthetic.htpasswd`, Buffer.from('synthetic-hash')]]), calls = [], callbacks = [];
  const dirs = new Set([privateRoot, binding.target_path]);
  const controls = { corrupt: false, partial: false };
  const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(raw, options = {}) {
    const url = new URL(raw); calls.push({ host: url.host, route: url.pathname, method: options.method || 'GET' });
    if (raw === artifactUrl) return new Response(html);
    if (raw === callbackEndpoint) { callbacks.push(JSON.parse(options.body)); return json({ ok: true }); }
    if (url.port === '2083') {
      if (options.headers?.Authorization !== 'cpanel nineoo:synthetic-token') return new Response('', { status: 401 });
      const q = Object.fromEntries(url.searchParams);
      if (url.pathname === '/execute/DomainInfo/domains_data') return json({ status: 1, data: { sub_domains: [{ domain: new URL(binding.url).hostname, documentroot: binding.target_path }] } });
      if (url.pathname === '/execute/Fileman/list_files') {
        if (!dirs.has(q.dir)) return json({ status: 0 });
        const rows = [];
        for (const [path] of files) if (path.startsWith(q.dir + '/') && !path.slice(q.dir.length + 1).includes('/')) rows.push({ file: path.slice(q.dir.length + 1), type: 'file' });
        for (const path of dirs) if (path.startsWith(q.dir + '/') && !path.slice(q.dir.length + 1).includes('/')) rows.push({ file: path.slice(q.dir.length + 1), type: 'dir' });
        return json({ status: 1, data: rows });
      }
      if (url.pathname === '/execute/Fileman/get_file_content') {
        const content = files.get(`${q.dir}/${q.file}`);
        return json(content ? { status: 1, data: { content: content.toString() } } : { status: 0 });
      }
      if (url.pathname === '/execute/Fileman/upload_files') {
        const form = options.body, blob = form.get('file-1'), path = `${form.get('dir')}/${blob.name}`;
        if (files.has(path) && form.get('overwrite') === '0') return json({ status: 0 });
        if (controls.partial && path.endsWith('index.html')) throw new Error('synthetic transport timeout');
        files.set(path, Buffer.from(await blob.arrayBuffer())); return json({ status: 1 });
      }
      if (q.cpanel_jsonapi_func === 'mkdir') { dirs.add(`${q.path}/${q.name}`); return json({ event: { result: 1 } }); }
      if (q.cpanel_jsonapi_func === 'fileop' && q.op === 'trash') { files.delete(`/home/nineoo/${q.sourcefiles}`); return json({ event: { result: 1 } }); }
      throw new Error('Unexpected API call');
    }
    const headers = { 'X-Robots-Tag': 'noindex, nofollow' };
    if (url.hostname !== new URL(binding.url).hostname) return new Response('', { status: 403, headers });
    if (options.headers?.Authorization !== 'Basic synthetic-review') return new Response('', { status: 401, headers });
    const bytes = files.get(`${binding.target_path}${url.pathname === '/' ? '/index.html' : url.pathname}`);
    return new Response(bytes ? (controls.corrupt ? 'corrupt' : bytes) : '', { status: bytes ? 200 : 404, headers });
  }
  return { fetchImpl, files, calls, callbacks, controls };
}
