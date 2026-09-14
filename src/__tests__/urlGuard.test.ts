import {
  fetchFollowingSafeRedirects,
  isPrivateHostname,
  validateFetchUrl,
} from '../../supabase/functions/_shared/urlGuard';

describe('validateFetchUrl', () => {
  it.each([
    'https://www.allrecipes.com/recipe/1',
    'http://example.com/',
    'https://[2606:4700::1111]/',
    'https://8.8.8.8/',
  ])('allows public %s', (url) => {
    expect('url' in validateFetchUrl(url)).toBe(true);
  });

  it.each([
    ['http://localhost/', 'loopback name'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://2130706433/', 'decimal loopback'],
    ['http://0x7f.1/', 'hex short loopback'],
    ['http://10.1.2.3/', 'rfc1918'],
    ['http://172.20.0.1/', 'rfc1918'],
    ['http://192.168.1.1/', 'rfc1918'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://100.64.0.1/', 'cgnat'],
    ['http://198.18.0.1/', 'benchmarking'],
    ['http://0.0.0.0/', 'this-net'],
    ['http://[::1]/', 'ipv6 loopback'],
    ['http://[::ffff:127.0.0.1]/', 'ipv4-mapped loopback'],
    ['http://[::ffff:169.254.169.254]/', 'ipv4-mapped metadata'],
    ['http://[fd00::1]/', 'ipv6 unique local'],
    ['http://[fe80::1]/', 'ipv6 link-local'],
    ['http://kong.internal/', 'internal suffix'],
    ['http://printer.local/', 'mdns'],
  ])('blocks %s (%s)', (url) => {
    expect(validateFetchUrl(url)).toEqual({ error: 'hostname is not allowed' });
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/html,hi'])(
    'rejects non-http scheme %s',
    (url) => {
      expect(validateFetchUrl(url)).toEqual({ error: 'only http(s) urls are allowed' });
    }
  );

  it('rejects embedded credentials, empty and malformed input', () => {
    expect(validateFetchUrl('https://user:pw@example.com/')).toEqual({
      error: 'credentials in url are not allowed',
    });
    expect(validateFetchUrl('')).toEqual({ error: 'url is required' });
    expect(validateFetchUrl(42)).toEqual({ error: 'url is required' });
    expect(validateFetchUrl('not a url')).toEqual({ error: 'url is malformed' });
  });

  it('isPrivateHostname reads the WHATWG-canonical hostname', () => {
    expect(isPrivateHostname(new URL('http://[::ffff:10.0.0.1]/').hostname)).toBe(true);
    expect(isPrivateHostname(new URL('http://[::ffff:8.8.8.8]/').hostname)).toBe(false);
  });
});

type FakeRes = {
  status: number;
  headers: { get: (k: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function res(status: number, location?: string): FakeRes {
  return {
    status,
    headers: { get: (k) => (k.toLowerCase() === 'location' ? location ?? null : null) },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe('fetchFollowingSafeRedirects', () => {
  it('refuses a public URL that redirects into cloud metadata, without fetching it', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return res(302, 'http://169.254.169.254/latest/meta-data/iam/') as unknown as Response;
    };
    const out = await fetchFollowingSafeRedirects(new URL('https://evil.example/r'), {}, fetchImpl);
    expect(out).toEqual({ kind: 'blocked-redirect', status: 302 });
    expect(calls).toEqual(['https://evil.example/r']);
  });

  it('follows safe relative and absolute redirects, then returns the final response', async () => {
    const script: Record<string, FakeRes> = {
      'https://a.example/1': res(301, '/2'),
      'https://a.example/2': res(302, 'https://b.example/3'),
      'https://b.example/3': res(200),
    };
    const fetchImpl = async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe('manual');
      return script[url] as unknown as Response;
    };
    const out = await fetchFollowingSafeRedirects(new URL('https://a.example/1'), {}, fetchImpl);
    expect(out.kind).toBe('response');
    if (out.kind === 'response') {
      expect(out.url).toBe('https://b.example/3');
      expect(out.response.status).toBe(200);
    }
  });

  it('stops after the redirect limit', async () => {
    let n = 0;
    const fetchImpl = async () => res(302, `https://loop.example/${++n}`) as unknown as Response;
    const out = await fetchFollowingSafeRedirects(new URL('https://loop.example/0'), {}, fetchImpl, 3);
    expect(out).toEqual({ kind: 'too-many-redirects', status: 302 });
    expect(n).toBe(4);
  });
});
