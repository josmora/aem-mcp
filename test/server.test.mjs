import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AemClient } from '../dist/aem.js';
import { createServer } from '../dist/server.js';

test('MCP tools read AEM endpoints, authenticate, and reject unsafe paths', async () => {
  const requests = [];
  const http = httpServer((req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('missing')) res.statusCode = 404;
    res.end(JSON.stringify({ title: 'Example content' }));
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const aem = new AemClient({ AEM_URL: `http://127.0.0.1:${http.address().port}`, AEM_USERNAME: 'reader', AEM_PASSWORD: 'secret' });
  const server = createServer(aem);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.equal((await client.listTools()).tools.length, 5);
    for (const [name, path] of [['aem_read_page', '/content/site/en'], ['aem_list_children', '/content/site'], ['aem_read_asset', '/content/dam/site/logo.png']]) {
      const result = await client.callTool({ name, arguments: { path } });
      assert.ok(!result.isError);
      assert.equal(JSON.parse(result.content[0].text).title, 'Example content');
    }
    assert.deepEqual(requests.map(r => r.path), ['/content/site/en/jcr:content.1.json', '/content/site.1.json', '/api/assets/site/logo.png.json']);
    assert.ok(requests.every(r => r.auth === `Basic ${Buffer.from('reader:secret').toString('base64')}`));
    for (const path of ['/etc/secret', '/content/../etc', '/content/%2e%2e/etc', '//example.com/content', '/content/site?x=1', '/content/site\\..']) {
      await assert.rejects(aem.read(path, '.json'));
    }
    assert.equal(requests.length, 3);
    const search = await client.callTool({ name: 'aem_search_components', arguments: {
      path: '/content/site/en', resourceType: 'site/components/teaser', limit: 10, offset: 20,
    } });
    assert.ok(!search.isError);
    let query = new URL(requests.at(-1).path, 'http://localhost').searchParams;
    assert.equal(query.get('path'), '/content/site/en');
    assert.equal(query.get('group.property'), 'sling:resourceType');
    assert.equal(query.get('group.property.value'), 'site/components/teaser');
    assert.equal(query.get('p.limit'), '10');
    assert.equal(query.get('p.offset'), '20');
    const custom = await client.callTool({ name: 'aem_query', arguments: {
      path: '/content/site', predicates: { 'p.or': 'true', '1_property': 'jcr:title', '1_property.value': 'Home', '2_fulltext': 'welcome' },
    } });
    assert.ok(!custom.isError);
    query = new URL(requests.at(-1).path, 'http://localhost').searchParams;
    assert.equal(query.get('group.p.or'), 'true');
    assert.equal(query.get('p.or'), null);
    assert.equal(query.get('p.guessTotal'), 'true');
    const count = requests.length;
    for (const predicates of [{ path: '/etc' }, { 'p.limit': '-1' }, { savedquery: '/etc/query' }, { 'group.path': '/etc' }, { 'p.not': 'true' }]) {
      await assert.rejects(aem.query('/content/site', predicates), /Unsupported/);
    }
    await assert.rejects(aem.query('/content/site*', {}), /Wildcard/);
    await assert.rejects(aem.query('/etc', {}), /outside/);
    await assert.rejects(aem.query('/content/site', {}, -1), /limit/);
    assert.equal(requests.length, count);
    const missing = await client.callTool({ name: 'aem_read_page', arguments: { path: '/content/missing' } });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /HTTP 404/);
    assert.ok(!missing.content[0].text.includes('secret'));
  } finally {
    await client.close();
    await server.close();
    await new Promise(resolve => http.close(resolve));
  }
});

test('configuration requires credentials and a fixed origin', () => {
  assert.throws(() => new AemClient({}), /Set AEM_TOKEN_FILE/);
  assert.throws(() => new AemClient({ AEM_URL: 'https://example.com/path', AEM_TOKEN: 'test' }), /origin/);
});

test('cloud requires HTTPS and bearer credentials while local config stays compatible', () => {
  assert.throws(() => new AemClient({ AEM_ENV: 'other' }), /local or cloud/);
  assert.throws(() => new AemClient({ AEM_ENV: 'cloud', AEM_TOKEN: 'test' }), /HTTPS/);
  assert.throws(() => new AemClient({ AEM_ENV: 'cloud', AEM_URL: 'http://example.com', AEM_TOKEN: 'test' }), /HTTPS/);
  assert.throws(() => new AemClient({ AEM_ENV: 'cloud', AEM_URL: 'https://example.com', AEM_USERNAME: 'admin', AEM_PASSWORD: 'secret' }), /require AEM_TOKEN/);
  assert.throws(() => new AemClient({ AEM_TOKEN_FILE: 'relative.json' }), /absolute/);
});

test('cloud reloads JSON and raw tokens per request and fails closed on file errors', async (t) => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'aem-token-test-'));
  const file = join(dir, 'token.json');
  const requests = [];
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), auth: options.headers.Authorization });
    return new Response('{}', { status, headers: { 'Content-Type': 'application/json' } });
  });
  const client = new AemClient({ AEM_ENV: 'cloud', AEM_URL: 'https://author.example.com', AEM_TOKEN_FILE: file, AEM_TOKEN: 'ignored', AEM_USERNAME: 'admin', AEM_PASSWORD: 'ignored' });
  try {
    await assert.rejects(client.read('/content/site', '.json'), /Cannot read AEM_TOKEN_FILE/);
    assert.equal(requests.length, 0);
    await writeFile(file, JSON.stringify({ accessToken: 'first-token' }));
    await client.read('/content/site', '.json');
    assert.equal(requests.at(-1).auth, 'Bearer first-token');
    assert.equal(requests.at(-1).url, 'https://author.example.com/content/site.json');
    status = 401;
    await assert.rejects(client.read('/content/site', '.json'), /Replace AEM_TOKEN_FILE.*no restart/);
    status = 200;
    await writeFile(file, 'second-token\n');
    await client.query('/content/site', { type: 'cq:Page' });
    assert.equal(requests.at(-1).auth, 'Bearer second-token');
    const count = requests.length;
    for (const invalid of ['', '{bad-json', '{}', '{"accessToken":123}', 'Bearer secret', 'secret\nheader']) {
      await writeFile(file, invalid);
      await assert.rejects(client.read('/content/site', '.json'), /Invalid/);
    }
    await rm(file);
    await assert.rejects(client.read('/content/site', '.json'), /Cannot read/);
    assert.equal(requests.length, count);
    const staticClient = new AemClient({ AEM_ENV: 'cloud', AEM_URL: 'https://author.example.com', AEM_TOKEN: 'static-token' });
    await staticClient.read('/content/site', '.json');
    assert.equal(requests.at(-1).auth, 'Bearer static-token');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
