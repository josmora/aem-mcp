export class AemClient {
  private base: URL;
  private authorization: string;
  private roots: string[];

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.base = new URL(env.AEM_URL || 'http://localhost:4502');
    if (!['http:', 'https:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.pathname !== '/' || this.base.search || this.base.hash) {
      throw new Error('AEM_URL must be an HTTP(S) origin without credentials, path, or query.');
    }
    if (env.AEM_TOKEN) this.authorization = `Bearer ${env.AEM_TOKEN}`;
    else if (env.AEM_USERNAME && env.AEM_PASSWORD) {
      this.authorization = `Basic ${Buffer.from(`${env.AEM_USERNAME}:${env.AEM_PASSWORD}`).toString('base64')}`;
    } else throw new Error('Set AEM_TOKEN or both AEM_USERNAME and AEM_PASSWORD.');
    this.roots = (env.AEM_ALLOWED_ROOTS || '/content').split(',').map(s => this.validatePath(s.trim()));
  }

  private validatePath(path: string): string {
    if (!path.startsWith('/') || path === '/' || path.endsWith('/') || /[\\%?#\u0000-\u0020\u007f]/.test(path) || path.split('/').some(s => s === '.' || s === '..' || s === '' && path.indexOf('//') >= 0)) {
      throw new Error('Use an absolute repository path without trailing slash, encoding, query, or traversal.');
    }
    return path;
  }

  async read(path: string, suffix: string, assets = false): Promise<unknown> {
    this.validatePath(path);
    this.checkScope(path);
    if (assets && path !== '/content/dam' && !path.startsWith('/content/dam/')) throw new Error('Assets must be under /content/dam.');
    const repositoryPath = assets ? '/api/assets' + path.slice('/content/dam'.length) : path;
    const url = new URL(repositoryPath.split('/').map(encodeURIComponent).join('/') + suffix, this.base);
    return this.request(url);
  }

  private checkScope(path: string) {
    this.validatePath(path);
    if (/[\*\[\]]/.test(path)) throw new Error('Wildcard paths are not allowed.');
    if (!this.roots.some(root => path === root || path.startsWith(`${root}/`))) throw new Error('Path is outside AEM_ALLOWED_ROOTS.');
  }

  async query(path: string, predicates: Record<string, string>, limit = 20, offset = 0): Promise<unknown> {
    this.checkScope(path);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
      throw new Error('Use limit 1–100 and offset 0–10000.');
    }
    if (Object.keys(predicates).length > 50) throw new Error('Use at most 50 predicate entries.');
    // All custom predicates live inside an AND-scoped subgroup. They cannot
    // replace the outer path or alter pagination and result writer settings.
    const allowed = /^(?:(?:\d+_)?group\.)*(?:(?:\d+_)?(?:property(?:\.(?:value|\d+_value|operation|and|depth))?|fulltext(?:\.relPath)?|type|nodename|boolproperty(?:\.value)?|daterange(?:\.(?:property|lowerBound|upperBound|lowerOperation|upperOperation|timeZone))?)|p\.or)$/;
    const url = new URL('/bin/querybuilder.json', this.base);
    url.searchParams.set('path', path);
    for (const [key, value] of Object.entries(predicates)) {
      if (!allowed.test(key) || typeof value !== 'string' || value.length > 2000) throw new Error(`Unsupported query predicate: ${key}`);
      url.searchParams.set(`group.${key}`, value);
    }
    url.searchParams.set('p.limit', String(limit));
    url.searchParams.set('p.offset', String(offset));
    url.searchParams.set('p.guessTotal', 'true');
    url.searchParams.set('p.hits', 'selective');
    url.searchParams.set('p.properties', 'jcr:path sling:resourceType jcr:title');
    const data = await this.request(url);
    if (data && typeof data === 'object' && 'success' in data && data.success === false) throw new Error('AEM Query Builder reported an unsuccessful query.');
    return data;
  }

  private async request(url: URL): Promise<unknown> {
    const response = await fetch(url, {
      headers: { Authorization: this.authorization, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`AEM returned HTTP ${response.status}. Check the path, permissions, and credentials.`);
    }
    if (!response.headers.get('content-type')?.includes('json')) {
      await response.body?.cancel();
      throw new Error('AEM returned a non-JSON response. Check the endpoint and authentication.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('AEM returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error('Response exceeds 2 MB. Request a narrower path or lower depth.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
}
