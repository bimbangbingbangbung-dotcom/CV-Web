/**
 * GitHub publishing (Save to GitHub): repo auto-detection, config validation,
 * UTF-8 base64, token storage isolation and the Contents API commit flow —
 * fetch is mocked, and one test enforces the hard rule that the token only
 * ever reaches https://api.github.com.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  GitHubApiError,
  clearToken,
  commitContent,
  describeApiError,
  detectRepo,
  encodeBase64,
  encodeBase64Bytes,
  getToken,
  isConfigured,
  loadSettings,
  saveSettings,
  setToken,
  testConnection,
  validateConfig,
} from '../../src/admin/github';

const OK_CONFIG = {
  owner: 'octo-cat',
  repo: 'CV-Web',
  branch: 'main',
  path: 'public/content.json',
} as const;

/** Minimal Response stand-in — jsdom doesn't provide fetch's Response. */
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string): string | null => headers[name.toLowerCase()] ?? null },
    json: async (): Promise<unknown> => body,
  }) as unknown as Response;

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectRepo', () => {
  it('reads owner/repo from project pages URLs', () => {
    expect(detectRepo('https://bimbangbingbangbung-dotcom.github.io/CV-Web/#admin')).toEqual({
      owner: 'bimbangbingbangbung-dotcom',
      repo: 'CV-Web',
    });
  });

  it('treats a bare user site as owner.github.io', () => {
    expect(detectRepo('https://alice.github.io/')).toEqual({
      owner: 'alice',
      repo: 'alice.github.io',
    });
  });

  it('falls back to the canonical URL, then to null', () => {
    expect(detectRepo('http://localhost:4173/', 'https://octo-cat.github.io/CV-Web/')).toEqual({
      owner: 'octo-cat',
      repo: 'CV-Web',
    });
    expect(detectRepo('http://localhost:4173/', 'https://example.com/')).toBeNull();
    expect(detectRepo('http://localhost:4173/')).toBeNull();
  });

  it('rejects hosts whose prefix is not a valid owner', () => {
    expect(detectRepo('https://my.site.github.io/CV-Web/')).toBeNull();
  });
});

describe('validateConfig', () => {
  it('accepts a normal configuration', () => {
    expect(validateConfig(OK_CONFIG)).toEqual([]);
  });

  it('rejects bad owners, repos, branches and paths', () => {
    expect(validateConfig({ ...OK_CONFIG, owner: 'bad owner!' })).not.toEqual([]);
    expect(validateConfig({ ...OK_CONFIG, owner: '' })).not.toEqual([]);
    expect(validateConfig({ ...OK_CONFIG, repo: '../evil' })).not.toEqual([]);
    expect(validateConfig({ ...OK_CONFIG, branch: 'feat/../main' })).not.toEqual([]);
    expect(validateConfig({ ...OK_CONFIG, path: 'public/content.txt' })).not.toEqual([]);
    expect(validateConfig({ ...OK_CONFIG, path: 'public/../secret.json' })).not.toEqual([]);
    expect(validateConfig({ ...OK_CONFIG, path: 'content' })).not.toEqual([]);
  });
});

describe('encodeBase64', () => {
  it('round-trips UTF-8 that plain btoa would mangle', () => {
    const text = '{"name":"José Núñez — 日本語 🚀"}\n';
    const bytes = Uint8Array.from(atob(encodeBase64(text)), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });

  it('round-trips plain ASCII', () => {
    expect(atob(encodeBase64('{"a":1}\n'))).toBe('{"a":1}\n');
  });
});

describe('encodeBase64Bytes', () => {
  it('round-trips raw bytes (JPEG magic travels intact)', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x42]);
    const decoded = Uint8Array.from(atob(encodeBase64Bytes(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it('handles payloads larger than one internal chunk (>32 KB)', () => {
    const bytes = new Uint8Array(70_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    const decoded = Uint8Array.from(atob(encodeBase64Bytes(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it('matches encodeBase64 for the same content', () => {
    const text = 'José — 日本語';
    expect(encodeBase64Bytes(new TextEncoder().encode(text))).toBe(encodeBase64(text));
  });
});

describe('settings storage', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips settings', () => {
    saveSettings({ ...OK_CONFIG, rememberToken: true });
    expect(loadSettings()).toEqual({ ...OK_CONFIG, rememberToken: true });
  });

  it('fills defaults for partially stored settings', () => {
    localStorage.setItem('cvweb:github', JSON.stringify({ owner: 'octo-cat', repo: 'CV' }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, owner: 'octo-cat', repo: 'CV' });
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('cvweb:github', '{oops');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('token storage', () => {
  it('keeps the token in sessionStorage by default', () => {
    setToken('secret', false);
    expect(getToken()).toBe('secret');
    expect(localStorage.getItem('cvweb:github-token-persist')).toBeNull();
    expect(sessionStorage.getItem('cvweb:github-token')).not.toBeNull();
  });

  it('moves it to localStorage when remembered, and clears both on forget', () => {
    setToken('secret', true);
    expect(JSON.parse(localStorage.getItem('cvweb:github-token-persist') ?? 'null')).toBe('secret');
    expect(sessionStorage.getItem('cvweb:github-token')).toBeNull();
    expect(getToken()).toBe('secret');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('isConfigured needs a valid config AND a token', () => {
    const config = { ...OK_CONFIG, rememberToken: false };
    expect(isConfigured(config, null)).toBe(false);
    expect(isConfigured(config, 'tok')).toBe(true);
    expect(isConfigured({ ...config, owner: '' }, 'tok')).toBe(false);
  });
});

describe('commitContent', () => {
  it('creates the file when it does not exist yet', async () => {
    fetchMock
      .mockResolvedValueOnce(res(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(res(201, { commit: { sha: 'c0ffee' } }));

    const result = await commitContent({
      ...OK_CONFIG,
      token: 'tok',
      content: '{"a":1}',
      message: 'content: update',
    });
    expect(result.commitSha).toBe('c0ffee');

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.github.com/repos/octo-cat/CV-Web/contents/public/content.json?ref=main',
    );
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(String(putUrl)).toBe(
      'https://api.github.com/repos/octo-cat/CV-Web/contents/public/content.json',
    );
    const body = JSON.parse(String(putInit?.body)) as {
      sha?: string;
      branch: string;
      content: string;
    };
    expect(body.sha).toBeUndefined();
    expect(body.branch).toBe('main');
    expect(atob(body.content)).toBe('{"a":1}');
    expect((putInit?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('supplies the blob sha when the file already exists', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { sha: 'blob-sha' }))
      .mockResolvedValueOnce(res(200, { commit: { sha: 'def456' } }));

    await commitContent({ ...OK_CONFIG, token: 'tok', content: '{}', message: 'm' });
    const body = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as { sha?: string };
    expect(body.sha).toBe('blob-sha');
  });

  it('only ever sends requests to api.github.com', async () => {
    fetchMock
      .mockResolvedValueOnce(res(404))
      .mockResolvedValueOnce(res(201, { commit: { sha: 'x' } }));
    await commitContent({ ...OK_CONFIG, token: 'tok', content: '{}', message: 'm' });
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url).startsWith('https://api.github.com/')).toBe(true);
    }
  });

  it('maps a bad token to a friendly 401 message', async () => {
    fetchMock.mockResolvedValueOnce(res(401, { message: 'Bad credentials' }));
    const error = await commitContent({
      ...OK_CONFIG,
      token: 'nope',
      content: '{}',
      message: 'm',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(describeApiError(error)).toMatch(/invalid or expired/);
  });

  it('detects rate limiting from the response headers', async () => {
    fetchMock.mockResolvedValueOnce(
      res(
        403,
        { message: 'API rate limit exceeded' },
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600),
        },
      ),
    );
    await expect(
      commitContent({ ...OK_CONFIG, token: 'tok', content: '{}', message: 'm' }),
    ).rejects.toThrow(/rate limit/);
  });

  it('surfaces GitHub’s 422 detail (concurrent edit race)', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { sha: 'blob-sha' }))
      .mockResolvedValueOnce(res(422, { message: 'sha was not supplied' }));
    await expect(
      commitContent({ ...OK_CONFIG, token: 'tok', content: '{}', message: 'm' }),
    ).rejects.toThrow(/sha was not supplied/);
  });

  it('turns network failures into a friendly status-0 error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await commitContent({
      ...OK_CONFIG,
      token: 'tok',
      content: '{}',
      message: 'm',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(0);
    expect(describeApiError(error)).toMatch(/could not reach api\.github\.com/);
  });
});

describe('testConnection', () => {
  it('returns the repository’s full name', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { full_name: 'octo-cat/CV-Web' }));
    await expect(testConnection(OK_CONFIG, 'tok')).resolves.toBe('octo-cat/CV-Web');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.github.com/repos/octo-cat/CV-Web',
    );
  });

  it('maps 404 to a check-your-settings message', async () => {
    fetchMock.mockResolvedValueOnce(res(404, { message: 'Not Found' }));
    const error = await testConnection(OK_CONFIG, 'tok').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(describeApiError(error)).toMatch(/owner, repository/);
  });
});
