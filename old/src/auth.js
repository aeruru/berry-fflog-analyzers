import {
  FFLOGS_AUTH_URL,
  FFLOGS_CLIENT_ID,
  FFLOGS_TOKEN_URL,
  PKCE_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
} from './config.js';

export async function startFflogsLogin() {
  localStorage.removeItem(USER_STORAGE_KEY);
  const codeVerifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)));
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = getRedirectUri();

  sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify({
    codeVerifier,
    redirectUri,
    state,
  }));

  const params = new URLSearchParams({
    client_id: FFLOGS_CLIENT_ID,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  window.location.assign(`${FFLOGS_AUTH_URL}?${params.toString()}`);
}

export async function handleOAuthCallback({ refreshCurrentUserProfile, setStatus }) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const error = params.get('error');

  if (error) {
    setStatus(`FFLogs login failed: ${error}`, true);
    cleanCallbackUrl();
    return;
  }

  if (!code) {
    return;
  }

  const pending = JSON.parse(sessionStorage.getItem(PKCE_STORAGE_KEY) || 'null');
  if (!pending || pending.state !== returnedState) {
    setStatus('FFLogs login state did not match. Please try logging in again.', true);
    cleanCallbackUrl();
    return;
  }

  setStatus('Completing FFLogs login...');

  try {
    const body = new URLSearchParams({
      client_id: FFLOGS_CLIENT_ID,
      code,
      code_verifier: pending.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: pending.redirectUri,
    });

    const response = await fetch(FFLOGS_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error(`token endpoint returned ${response.status}`);
    }

    const token = await response.json();
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
      ...token,
      expires_at: Date.now() + ((token.expires_in ?? 3600) * 1000),
    }));
    sessionStorage.removeItem(PKCE_STORAGE_KEY);
    await refreshCurrentUserProfile();
    setStatus('Logged in to FFLogs. Loading your latest reports...');
  } catch (tokenError) {
    console.warn(tokenError);
    setStatus(`Could not complete FFLogs login (${tokenError.message}).`, true);
  } finally {
    cleanCallbackUrl();
  }
}

export function getStoredToken() {
  try {
    const token = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || 'null');
    return token && !isExpired(token) ? token : null;
  } catch {
    return null;
  }
}

export function isExpired(token) {
  return !token?.access_token || Date.now() > (token.expires_at - 30_000);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function storeUser(user) {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(USER_STORAGE_KEY);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function isUsingTestData() {
  return Boolean(getStoredUser()?.testData);
}

function getRedirectUri() {
  return window.location.href.split('?')[0].split('#')[0];
}

function cleanCallbackUrl() {
  window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
