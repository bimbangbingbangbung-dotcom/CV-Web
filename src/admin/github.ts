/**
 * GitHub publishing for the editor — the "Save to GitHub" button commits
 * `public/content.json` straight to the repository through the Contents API,
 * which then triggers the existing deploy workflow.
 *
 * Security rules (consistent with the rest of the hardening pass):
 * - The site is static, so writing to the repo requires a token the owner
 *   supplies. The token is kept in sessionStorage (localStorage only when
 *   "remember on this device" is checked) and is ONLY ever sent to the
 *   constant API origin below — never to any user-configurable host.
 * - Every user-supplied path part is validated against a strict pattern and
 *   URL-encoded before it reaches a request.
 * - All storage access is try/catch-wrapped (private mode / blocked storage).
 */

const API_ORIGIN = 'https://api.github.com';
const SETTINGS_KEY = 'cvweb:github';
const TOKEN_KEY = 'cvweb:github-token'; // sessionStorage
const TOKEN_PERSIST_KEY = 'cvweb:github-token-persist'; // localStorage ("remember")

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export interface RepoSettings extends RepoConfig {
  rememberToken: boolean;
}

export const DEFAULT_SETTINGS: RepoSettings = {
  owner: '',
  repo: '',
  branch: 'main',
  path: 'public/content.json',
  rememberToken: false,
};

const PATTERNS = {
  owner: /^[A-Za-z0-9-]{1,39}$/,
  repo: /^[A-Za-z0-9._-]{1,100}$/,
  branch: /^[A-Za-z0-9._/-]{1,255}$/,
  path: /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/,
} as const;

/** Field-level problems with the stored settings (empty list = usable). */
export function validateConfig(config: RepoConfig): string[] {
  const errors: string[] = [];
  if (!PATTERNS.owner.test(config.owner)) {
    errors.push('owner must be the GitHub user or organization name (letters, numbers, hyphens)');
  }
  if (!PATTERNS.repo.test(config.repo)) {
    errors.push('repository name contains invalid characters');
  }
  if (!PATTERNS.branch.test(config.branch) || config.branch.includes('..')) {
    errors.push('branch name contains invalid characters');
  }
  if (!PATTERNS.path.test(config.path) || config.path.includes('..')) {
    errors.push('file path must point at a .json file in the repo (e.g. public/content.json)');
  }
  return errors;
}

function repoFromUrl(raw: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(raw);
    if (!url.hostname.endsWith('.github.io')) return null;
    const owner = url.hostname.slice(0, -'.github.io'.length);
    if (!PATTERNS.owner.test(owner)) return null;
    const first = url.pathname.split('/').filter(Boolean)[0];
    // Project pages carry the repo in the path; a user site (owner.github.io)
    // serves the equally named repository.
    const repo = first ?? `${owner}.github.io`;
    return PATTERNS.repo.test(repo) ? { owner, repo } : null;
  } catch {
    return null;
  }
}

/**
 * Pre-fill owner/repo from the deployed URL (owner.github.io/CV-Web) or from
 * the canonical URL in content.json, so localhost editing works too.
 */
export function detectRepo(
  pageHref: string,
  canonicalUrl?: string,
): {
  owner: string;
  repo: string;
} | null {
  return repoFromUrl(pageHref) ?? (canonicalUrl ? repoFromUrl(canonicalUrl) : null);
}

function readStorage(storage: Storage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* storage unavailable — settings simply won't persist */
  }
}

function removeStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Stored settings (owner/repo/branch/path) with defaults applied. */
export function loadSettings(): RepoSettings {
  const stored = readStorage(localStorage, SETTINGS_KEY);
  if (typeof stored !== 'object' || stored === null) return { ...DEFAULT_SETTINGS };
  const s = stored as Partial<RepoSettings>;
  return {
    owner: typeof s.owner === 'string' ? s.owner : DEFAULT_SETTINGS.owner,
    repo: typeof s.repo === 'string' ? s.repo : DEFAULT_SETTINGS.repo,
    branch: typeof s.branch === 'string' && s.branch ? s.branch : DEFAULT_SETTINGS.branch,
    path: typeof s.path === 'string' && s.path ? s.path : DEFAULT_SETTINGS.path,
    rememberToken: s.rememberToken === true,
  };
}

export function saveSettings(settings: RepoSettings): void {
  writeStorage(localStorage, SETTINGS_KEY, JSON.stringify(settings));
}

/** The token never touches the returned settings object. */
export function getToken(): string | null {
  const fromSession = readStorage(sessionStorage, TOKEN_KEY);
  if (typeof fromSession === 'string' && fromSession) return fromSession;
  const fromLocal = readStorage(localStorage, TOKEN_PERSIST_KEY);
  return typeof fromLocal === 'string' && fromLocal ? fromLocal : null;
}

export function setToken(token: string, remember: boolean): void {
  if (remember) {
    writeStorage(localStorage, TOKEN_PERSIST_KEY, JSON.stringify(token));
    removeStorage(sessionStorage, TOKEN_KEY);
  } else {
    writeStorage(sessionStorage, TOKEN_KEY, JSON.stringify(token));
    removeStorage(localStorage, TOKEN_PERSIST_KEY);
  }
}

export function clearToken(): void {
  removeStorage(sessionStorage, TOKEN_KEY);
  removeStorage(localStorage, TOKEN_PERSIST_KEY);
}

/** True when a save could actually run (config valid + token present). */
export function isConfigured(settings: RepoSettings, token: string | null): boolean {
  return validateConfig(settings).length === 0 && Boolean(token);
}

/** UTF-8-safe base64 for the Contents API (btoa alone mangles non-Latin1). */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/** Human-readable failure text for the editor status line. */
export function describeApiError(error: unknown): string {
  if (error instanceof GitHubApiError) {
    switch (error.status) {
      case 0:
        return error.message; // network failure (already friendly)
      case 401:
        return 'GitHub rejected the token (401) — it is invalid or expired. Create a new one at github.com/settings/tokens.';
      case 403:
        return `GitHub refused the request (403) — ${error.message || 'the token needs Contents: read and write permission, or the API rate limit was hit.'}`;
      case 404:
        return 'Not found (404) — check the owner, repository, branch and file path.';
      case 422:
        return `GitHub could not apply the change (422) — ${error.message || 'try again in a moment.'}`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

async function apiError(response: Response, fallback: string): Promise<GitHubApiError> {
  let detail = '';
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') detail = message;
  } catch {
    /* non-JSON error body */
  }
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const minutes = Number.isFinite(reset)
      ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000))
      : 60;
    return new GitHubApiError(`the API rate limit was hit — try again in ~${minutes} min`, 403);
  }
  return new GitHubApiError(detail || fallback, response.status);
}

async function api(
  path: string,
  token: string,
  init: { method: 'GET' | 'PUT'; body?: string } = { method: 'GET' },
): Promise<Response> {
  // API_ORIGIN is a constant — the token never goes anywhere else.
  try {
    return await fetch(`${API_ORIGIN}${path}`, {
      method: init.method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });
  } catch {
    throw new GitHubApiError('could not reach api.github.com — check your internet connection.', 0);
  }
}

export interface CommitOptions extends RepoConfig {
  token: string;
  /** Full file text (already serialized). */
  content: string;
  message: string;
}

/**
 * Commit the file. Creates it when missing, updates it otherwise (the GET
 * supplies the blob sha the PUT needs).
 */
export async function commitContent(options: CommitOptions): Promise<{ commitSha: string }> {
  const { owner, repo, branch, path, token, content, message } = options;
  const encOwner = encodeURIComponent(owner);
  const encRepo = encodeURIComponent(repo);
  const encPath = path.split('/').map(encodeURIComponent).join('/');
  const base = `/repos/${encOwner}/${encRepo}/contents/${encPath}`;

  let sha: string | undefined;
  const current = await api(`${base}?ref=${encodeURIComponent(branch)}`, token);
  if (current.ok) {
    const body: unknown = await current.json();
    const got = (body as { sha?: unknown }).sha;
    if (typeof got === 'string') sha = got;
  } else if (current.status !== 404) {
    throw await apiError(current, 'could not read the current file');
  }

  const payload = { message, content: encodeBase64(content), branch, ...(sha ? { sha } : {}) };
  const put = await api(base, token, { method: 'PUT', body: JSON.stringify(payload) });
  if (!put.ok) throw await apiError(put, 'could not commit the file');

  const result: unknown = await put.json();
  const commit = (result as { commit?: { sha?: unknown } }).commit?.sha;
  return { commitSha: typeof commit === 'string' ? commit : '' };
}

/** Verify owner/repo/token in one call (Help tab "Test connection"). */
export async function testConnection(config: RepoConfig, token: string): Promise<string> {
  const base = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const response = await api(base, token);
  if (!response.ok) throw await apiError(response, 'could not open the repository');
  const body: unknown = await response.json();
  const name = (body as { full_name?: unknown }).full_name;
  return typeof name === 'string' ? name : `${config.owner}/${config.repo}`;
}
