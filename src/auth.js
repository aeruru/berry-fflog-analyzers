import {
  FFLOGS_AUTH_URL,
  FFLOGS_CLIENT_ID,
  FFLOGS_PKCE_STORAGE_KEY,
  FFLOGS_TOKEN_STORAGE_KEY,
  FFLOGS_TOKEN_URL,
} from './config.js';

const TOKEN_EXPIRY_BUFFER_MS = 30_000;

export async function startFflogsLogin() {
  const codeVerifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)));
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = getRedirectUri();

  sessionStorage.setItem(FFLOGS_PKCE_STORAGE_KEY, JSON.stringify({
    codeVerifier,
    redirectUri,
    state,
  }));

  const parameters = new URLSearchParams({
    client_id: FFLOGS_CLIENT_ID,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  window.location.assign(`${FFLOGS_AUTH_URL}?${parameters.toString()}`);
}

export async function completeFflogsLogin() {
  const parameters = new URLSearchParams(window.location.search);
  const code = parameters.get('code');
  const oauthError = parameters.get('error');

  if (oauthError) {
    cleanCallbackUrl();
    throw new Error(`FFLogs login failed: ${oauthError}`);
  }

  if (!code) {
    return null;
  }

  const pendingLogin = readPendingLogin();
  if (!pendingLogin || pendingLogin.state !== parameters.get('state')) {
    cleanCallbackUrl();
    throw new Error('FFLogs login state did not match. Start the login again.');
  }

  try {
    const response = await fetch(FFLOGS_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: FFLOGS_CLIENT_ID,
        code,
        code_verifier: pendingLogin.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: pendingLogin.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`FFLogs token endpoint returned ${response.status}.`);
    }

    const token = await response.json();
    const storedToken = {
      ...token,
      expires_at: Date.now() + ((token.expires_in ?? 3600) * 1000),
    };

    localStorage.setItem(FFLOGS_TOKEN_STORAGE_KEY, JSON.stringify(storedToken));
    return storedToken;
  } finally {
    sessionStorage.removeItem(FFLOGS_PKCE_STORAGE_KEY);
    cleanCallbackUrl();
  }
}

export function getFflogsAccessToken() {
  const token = readStoredToken();

  if (!token?.access_token || Date.now() >= token.expires_at - TOKEN_EXPIRY_BUFFER_MS) {
    clearFflogsSession();
    return null;
  }

  return token.access_token;
}

export function isLoggedInToFflogs() {
  return Boolean(getFflogsAccessToken());
}

export function clearFflogsSession() {
  localStorage.removeItem(FFLOGS_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(FFLOGS_PKCE_STORAGE_KEY);
}

function readStoredToken() {
  try {
    return JSON.parse(localStorage.getItem(FFLOGS_TOKEN_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function readPendingLogin() {
  try {
    return JSON.parse(sessionStorage.getItem(FFLOGS_PKCE_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function getRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function cleanCallbackUrl() {
  window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
}

async function createCodeChallenge(codeVerifier) {
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

