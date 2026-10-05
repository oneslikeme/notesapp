/**
 * OneDrive access via Microsoft Graph. Inkwell only asks for its own app folder
 * (OneDrive/Apps/Inkwell) — it cannot see the rest of your files.
 */
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

const SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];
const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const LS_CLIENT = 'inkwell.onedriveClientId';
const SS_HASH = 'inkwell.preAuthHash';

export class ReconnectNeeded extends Error {}

export function clientId(): string {
  const fromBuild = (import.meta.env.VITE_ONEDRIVE_CLIENT_ID as string | undefined)?.trim();
  if (fromBuild) return fromBuild;
  try {
    return localStorage.getItem(LS_CLIENT)?.trim() || '';
  } catch {
    return '';
  }
}

export function clientIdFromBuild() {
  return !!(import.meta.env.VITE_ONEDRIVE_CLIENT_ID as string | undefined)?.trim();
}

export function setClientId(id: string) {
  try {
    localStorage.setItem(LS_CLIENT, id.trim());
  } catch {}
}

export function redirectUri() {
  return location.origin + import.meta.env.BASE_URL;
}

let pca: PublicClientApplication | null = null;

/** Must run once at startup: completes a sign-in redirect if we're returning from one. */
export async function initAuth(): Promise<{ account: AccountInfo | null; justSignedIn: boolean }> {
  const id = clientId();
  if (!id) return { account: null, justSignedIn: false };
  pca = new PublicClientApplication({
    auth: {
      clientId: id,
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: redirectUri(),
      // The app uses the URL hash for routing, so the sign-in response comes back in the query string.
      OIDCOptions: { responseMode: 'query' },
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  let justSignedIn = false;
  try {
    const res = await pca.handleRedirectPromise({ navigateToLoginRequestUrl: false });
    if (res?.account) {
      pca.setActiveAccount(res.account);
      justSignedIn = true;
    }
  } catch (e) {
    console.warn('Sign-in did not complete', e);
  }
  if (location.search.includes('code=') || location.search.includes('error=')) history.replaceState(null, '', location.pathname + location.hash);
  const saved = sessionStorage.getItem(SS_HASH);
  if (saved != null) {
    sessionStorage.removeItem(SS_HASH);
    if (justSignedIn) history.replaceState(null, '', location.pathname + saved);
  }
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
  if (account) pca.setActiveAccount(account);
  return { account, justSignedIn };
}

export async function signIn() {
  if (!pca) await initAuth();
  if (!pca) throw new Error('OneDrive is not configured yet');
  sessionStorage.setItem(SS_HASH, location.hash);
  await pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export async function reconnect() {
  if (!pca) throw new Error('OneDrive is not configured yet');
  sessionStorage.setItem(SS_HASH, location.hash);
  await pca.acquireTokenRedirect({ scopes: SCOPES, account: pca.getActiveAccount() ?? undefined });
}

export async function signOut() {
  if (!pca) return;
  pca.setActiveAccount(null);
  await pca.clearCache();
}

export function currentAccount() {
  return pca?.getActiveAccount() ?? null;
}

let testToken: (() => string) | null = null;
/** Development only: lets tests run the sync engine against a simulated OneDrive. */
export const __test = import.meta.env.DEV ? { setToken: (f: (() => string) | null) => (testToken = f) } : undefined;

async function token(): Promise<string> {
  if (testToken) return testToken();
  const account = pca?.getActiveAccount();
  if (!pca || !account) throw new ReconnectNeeded('Not signed in');
  try {
    return (await pca.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) throw new ReconnectNeeded('Sign-in expired');
    throw e;
  }
}

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Authenticated Graph request with retry on throttling / transient failures. */
async function graph(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const url = path.startsWith('https://') ? path : GRAPH + path;
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await token()}` } });
  if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
    const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
    return graph(path, init, attempt + 1);
  }
  if (res.status === 401 && attempt === 0) return graph(path, init, 1);
  return res;
}

export interface RemoteItem {
  name: string;
  eTag: string;
  size: number;
  downloadUrl: string;
}

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** All files in an app-folder subfolder (empty if the folder doesn't exist yet). */
export async function listFolder(folder: string): Promise<RemoteItem[]> {
  const out: RemoteItem[] = [];
  let next: string | null = `:/${enc(folder)}:/children?$top=999`;
  while (next) {
    const res: Response = await graph(next);
    if (res.status === 404) return [];
    if (!res.ok) throw new GraphError(res.status, `Listing ${folder} failed (${res.status})`);
    const body: any = await res.json();
    for (const it of body.value || []) {
      if (it.file) out.push({ name: it.name, eTag: it.eTag, size: it.size, downloadUrl: it['@microsoft.graph.downloadUrl'] });
    }
    next = body['@odata.nextLink'] ?? null;
  }
  return out;
}

export async function getItem(path: string): Promise<RemoteItem | null> {
  const res = await graph(`:/${enc(path)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new GraphError(res.status, `Reading ${path} failed (${res.status})`);
  const it = await res.json();
  return { name: it.name, eTag: it.eTag, size: it.size, downloadUrl: it['@microsoft.graph.downloadUrl'] };
}

export async function download(item: RemoteItem): Promise<Blob> {
  // Pre-authenticated, short-lived URL from the listing — no token needed.
  const res = await fetch(item.downloadUrl);
  if (!res.ok) throw new GraphError(res.status, `Download of ${item.name} failed (${res.status})`);
  return res.blob();
}

const SMALL = 4 * 1024 * 1024 - 1024;
const CHUNK = 320 * 1024 * 16; // 5 MiB, a multiple of 320 KiB as Graph requires

/**
 * Upload a file. `ifMatch` makes the write fail with 412 if someone else changed it first.
 * Returns the new eTag.
 */
export async function upload(path: string, data: Blob, ifMatch?: string): Promise<string> {
  if (data.size <= SMALL) {
    const headers: Record<string, string> = { 'Content-Type': data.type || 'application/octet-stream' };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const res = await graph(`:/${enc(path)}:/content`, { method: 'PUT', body: data, headers });
    if (!res.ok) throw new GraphError(res.status, `Upload of ${path} failed (${res.status})`);
    return (await res.json()).eTag;
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ifMatch) headers['If-Match'] = ifMatch;
  const s = await graph(`:/${enc(path)}:/createUploadSession`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  if (!s.ok) throw new GraphError(s.status, `Upload of ${path} failed (${s.status})`);
  const { uploadUrl } = await s.json();
  let last: any = null;
  for (let start = 0; start < data.size; start += CHUNK) {
    const end = Math.min(data.size, start + CHUNK);
    const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${data.size}` }, body: data.slice(start, end) });
    if (!res.ok && res.status !== 202) throw new GraphError(res.status, `Upload of ${path} failed (${res.status})`);
    last = res.status === 202 ? null : await res.json();
  }
  return last?.eTag ?? '';
}
