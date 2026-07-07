const UNKNOWN_ZONE_NAMES = new Set(['unknown', 'unknown zone', '']);
const FFLOGS_CLIENT_ID = 'a210738b-1a9b-40d8-98f6-a4054696f1eb';
const FFLOGS_AUTH_URL = 'https://www.fflogs.com/oauth/authorize';
const FFLOGS_TOKEN_URL = 'https://www.fflogs.com/oauth/token';
const TOKEN_STORAGE_KEY = 'berry.fflogs.pkce.token';
const USER_STORAGE_KEY = 'berry.fflogs.user';
const PKCE_STORAGE_KEY = 'berry.fflogs.pkce.pending';
const TEST_DATA_URL = 'fflogs-testdata/sample-report-fights.json';
const GRAPHQL_ENDPOINT = 'https://www.fflogs.com/api/v2/user';
const TARGET_ZONE_ID = 76;
const TARGET_ZONE_REPORT_LIMIT = 2;

let sessions = [];
let zoneReports = [];
let expandedZoneReportIds = new Set();
let selectedSessionId = null;
let currentUserId = null;
let currentUserName = null;

const statusLine = document.querySelector('#statusLine');
const zoneReportTitle = document.querySelector('#zoneReportTitle');
const zoneReportList = document.querySelector('#zoneReportList');
const zoneReportCount = document.querySelector('#zoneReportCount');
const reportGraph = document.querySelector('#reportGraph');
const reportGraphCount = document.querySelector('#reportGraphCount');
const authState = document.querySelector('#authState');
const userPanelTitle = document.querySelector('#userPanelTitle');
const loginButton = document.querySelector('#loginButton');
const logoutButton = document.querySelector('#logoutButton');
const loadTestDataButton = document.querySelector('#loadTestDataButton');

loginButton.addEventListener('click', startFflogsLogin);
logoutButton.addEventListener('click', () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  currentUserId = null;
  currentUserName = null;
  setZoneReports([]);
  updateAuthUi();
  setStatus('Logged out of FFLogs.');
});

loadTestDataButton.addEventListener('click', toggleTestData);

setSessions([]);
setZoneReports([]);
handleOAuthCallback().finally(async () => {
  updateAuthUi();
  if (getStoredToken() && !isUsingTestData()) {
    await loadMyRecentReports();
  }
});

async function toggleTestData() {
  if (isUsingTestData()) {
    localStorage.removeItem(USER_STORAGE_KEY);
    currentUserId = null;
    currentUserName = null;
    setSessions([]);
    setZoneReports([]);
    updateAuthUi();

    if (getStoredToken()) {
      await loadMyRecentReports();
      return;
    }

    setStatus('Switched back to live data. Log in with FFLogs to load your latest reports.');
    return;
  }

  await loadTestData();
}

async function loadTestData() {
  setTestDataLoading(true);

  try {
    const response = await fetch(TEST_DATA_URL);

    if (!response.ok) {
      throw new Error(`test data returned ${response.status}`);
    }

    const payload = await response.json();
    const report = payload.report ?? payload?.data?.reportData?.report;
    const normalized = normalizeSession(report, 'test-data');

    if (!normalized) {
      throw new Error('sample report was missing report data');
    }

    currentUserId = payload.user?.id ?? 'test-data';
    currentUserName = 'Test Data';
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
      id: currentUserId,
      name: currentUserName,
      testData: true,
    }));
    updateAuthUi();
    setSessions([normalized]);
    setZoneReports([normalized]);
    setStatus('Loaded test data from the local JSON file.');
  } catch (error) {
    console.warn(error);
    setStatus(`Could not load local test data (${error.message}).`, true);
  } finally {
    setTestDataLoading(false);
  }
}

async function fetchRecentSessions({ endpoint, userId, limit = 12, zoneId = null }) {
  const variables = {
    userId,
    limit,
  };

  if (zoneId !== null) {
    variables.zoneId = zoneId;
  }

  const reportsResult = await fflogsGraphql(endpoint, RECENT_REPORTS_QUERY, variables);
  const reports = reportsResult?.data?.reportData?.reports?.data ?? [];
  return hydrateReportSessions(reports);
}

async function hydrateReportSessions(reports) {
  const baseSessions = normalizeReportList(reports).slice(0, 6);

  const hydratedSessions = await Promise.all(baseSessions.map(async (session) => {
    if (!session.reportCode) {
      return session;
    }

    try {
      const fightsResult = await fflogsGraphql(getGraphqlEndpoint(), REPORT_FIGHTS_QUERY, { code: session.reportCode });
      const report = fightsResult?.data?.reportData?.report;
      return normalizeSession({
        ...report,
        code: session.reportCode,
        title: report?.title ?? session.title,
        zone: report?.zone ?? session.zoneName,
      }, session.id);
    } catch (error) {
      console.warn(`Could not hydrate fights for report ${session.reportCode}`, error);
      return {
        ...session,
        hydrationError: error.message,
      };
    }
  }));

  return hydratedSessions
    .filter((session) => !UNKNOWN_ZONE_NAMES.has(session.zoneName.trim().toLowerCase()))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, 6);
}

async function loadMyRecentReports() {
  if (!getStoredToken()) {
    setStatus('Log in to FFLogs to load your latest reports.', true);
    return;
  }

  setAppLoading(true);
  setStatus('Looking up your FFLogs account and latest reports...');

  try {
    const { normalized, targetZoneReports, user } = await fetchMyRecentSessions();

    if (normalized.length === 0) {
      throw new Error('No known-zone reports were found for your account.');
    }

    setSessions(normalized);
    setZoneReports(targetZoneReports);
    setCurrentUser(user);

    const latest = normalized[0];
    const latestText = latest.reportCode ? ` Latest report: ${latest.reportCode}.` : '';
    setStatus(`Loaded ${normalized.length} latest reports${currentUserName ? ` for ${currentUserName}` : ''}.${latestText}`);
  } catch (error) {
    console.warn(error);
    setStatus(`Could not load your latest reports (${error.message}).`, true);
  } finally {
    setAppLoading(false);
  }
}

async function fetchMyRecentSessions() {
  const user = await fetchCurrentUser();
  setCurrentUser(user);

  const [normalized, targetZoneReports] = await Promise.all([
    fetchRecentSessions({
      endpoint: getGraphqlEndpoint(),
      userId: currentUserId,
    }),
    fetchRecentSessions({
      endpoint: getGraphqlEndpoint(),
      userId: currentUserId,
      limit: TARGET_ZONE_REPORT_LIMIT,
      zoneId: TARGET_ZONE_ID,
    }),
  ]);

  return { normalized, targetZoneReports, user };
}

async function fetchCurrentUser() {
  const errors = [];

  for (const query of CURRENT_USER_QUERY_CANDIDATES) {
    try {
      const result = await fflogsGraphql(getGraphqlEndpoint(), query, {});
      const user = result?.data?.userData?.currentUser
        ?? result?.data?.userData?.user
        ?? result?.data?.currentUser;

      if (user?.id) {
        return user;
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`FFLogs did not expose a current-user field in the attempted GraphQL shapes. Errors: ${errors.join(' | ')}`);
}

async function fflogsGraphql(endpoint, query, variables) {
  const payload = await fflogsGraphqlRaw(endpoint, query, variables);

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  return payload;
}

async function fflogsGraphqlRaw(endpoint, query, variables) {
  const token = getStoredToken();

  if (!token) {
    throw new Error('not logged in to FFLogs');
  }

  const headers = {
    authorization: `Bearer ${token.access_token}`,
    'content-type': 'application/json',
  };

  if (isExpired(token)) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    updateAuthUi();
    throw new Error('FFLogs login expired. Log in again.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL endpoint returned ${response.status}`);
  }

  return response.json();
}

async function startFflogsLogin() {
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

async function handleOAuthCallback() {
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

function getStoredToken() {
  try {
    const token = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || 'null');
    return token && !isExpired(token) ? token : null;
  } catch {
    return null;
  }
}

function isExpired(token) {
  return !token?.access_token || Date.now() > (token.expires_at - 30_000);
}

function updateAuthUi() {
  const token = getStoredToken();
  const storedUser = getStoredUser();
  const isTestData = isUsingTestData();
  const isLoggedIn = Boolean(token);

  if (storedUser && (isLoggedIn || isTestData)) {
    currentUserId = storedUser.id;
    currentUserName = storedUser.name;
  } else if (isLoggedIn) {
    currentUserId = Number.isFinite(Number(currentUserId)) ? currentUserId : null;
    currentUserName = null;
    localStorage.removeItem(USER_STORAGE_KEY);
  } else if (!isLoggedIn) {
    currentUserId = null;
    currentUserName = null;
    localStorage.removeItem(USER_STORAGE_KEY);
  }

  userPanelTitle.textContent = currentUserName || 'FFLogs account';
  authState.textContent = isTestData ? 'Using test data' : isLoggedIn ? 'Logged in to FFLogs' : 'Not logged in';
  loginButton.classList.toggle('hidden', Boolean(token));
  logoutButton.classList.toggle('hidden', !token);
  if (!loadTestDataButton.disabled) {
    loadTestDataButton.textContent = isTestData ? 'Use live data' : 'Use test data';
  }
}

function setCurrentUser(user) {
  if (!user?.id && !user?.name) {
    return;
  }

  currentUserId = Number.isFinite(Number(user.id)) ? Number(user.id) : user.id;
  currentUserName = user.name ?? currentUserName;
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
    id: currentUserId,
    name: currentUserName,
  }));
  updateAuthUi();
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function isUsingTestData() {
  return Boolean(getStoredUser()?.testData);
}

async function refreshCurrentUserProfile() {
  try {
    const user = await fetchCurrentUser();
    setCurrentUser(user);
  } catch (error) {
    console.info('Could not load current FFLogs user profile yet.', error);
  }
}

function normalizeReportList(raw) {
  if (typeof raw === 'string') {
    return [];
  }

  const roots = [
    raw,
    raw?.reports,
    raw?.reportData?.reports?.data,
    raw?.userData?.user?.reports?.data,
    raw?.data,
    raw?.sessions,
  ].filter(Boolean);

  const flattened = roots.flatMap((root) => Array.isArray(root) ? root : Object.values(root));

  return flattened
    .map(normalizeSession)
    .filter(Boolean)
    .filter((session) => !UNKNOWN_ZONE_NAMES.has(session.zoneName.trim().toLowerCase()))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, 6);
}

function normalizeSession(item, index = 0) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const reportStartTime = item.startTime ?? item.start ?? item.start_time ?? item.report?.startTime;
  const pulls = normalizePulls(item.fights ?? item.encounters ?? item.pulls ?? item.report?.fights ?? [], reportStartTime);
  const startTime = toDateString(reportStartTime ?? pulls[0]?.startTime);
  const endTime = toDateString(item.endTime ?? item.end ?? item.end_time ?? item.report?.endTime ?? pulls[pulls.length - 1]?.endTime, reportStartTime);
  const zoneName = item.zoneName ?? item.zone?.name ?? item.zone ?? item.report?.zone?.name ?? item.report?.zoneName ?? 'Unknown Zone';

  return {
    id: String(item.id ?? item.code ?? item.report?.code ?? `session-${index}`),
    reportCode: item.code ?? item.report?.code ?? null,
    title: item.title ?? item.report?.title ?? null,
    zoneName: String(zoneName),
    startTime,
    endTime,
    pulls,
  };
}

function normalizePulls(items, reportStartTime = null) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => {
    const startTime = toDateString(item.startTime ?? item.start ?? item.start_time, reportStartTime);
    const endTime = toDateString(item.endTime ?? item.end ?? item.end_time, reportStartTime);
    const durationSeconds = normalizeDuration(item.durationSeconds ?? item.duration ?? secondsBetween(startTime, endTime) ?? 0);
    const bossPercent = normalizeBossPercent(item.bossPercentage ?? item.bossPercent ?? item.fightPercentage);

    return {
      id: String(item.id ?? item.fightID ?? index + 1),
      name: item.name ?? item.encounterName ?? item.bossName ?? `Pull ${index + 1}`,
      startTime,
      endTime: endTime || addSeconds(startTime, durationSeconds),
      durationSeconds,
      bossPercent,
      kill: Boolean(item.kill ?? item.isKill ?? bossPercent === 0),
    };
  });
}

function setSessions(nextSessions) {
  sessions = normalizeReportList(nextSessions);
  selectedSessionId = sessions[0]?.id ?? null;
  renderReportGraph();
}

function setZoneReports(nextReports) {
  zoneReports = normalizeReportList(nextReports).slice(0, TARGET_ZONE_REPORT_LIMIT);
  expandedZoneReportIds = new Set([...expandedZoneReportIds].filter((id) => zoneReports.some((report) => report.id === id)));
  renderZoneReports();
}

function renderZoneReports() {
  zoneReportCount.textContent = `${zoneReports.length} ${zoneReports.length === 1 ? 'report' : 'reports'}`;
  const zoneName = zoneReports.find((report) => report.zoneName)?.zoneName;
  zoneReportTitle.textContent = zoneName ? `${zoneName} reports` : `Zone ${TARGET_ZONE_ID} reports`;

  if (zoneReports.length === 0) {
    zoneReportList.innerHTML = `<div class="empty-state">No recent Zone ${TARGET_ZONE_ID} reports found yet.</div>`;
    return;
  }

  zoneReportList.innerHTML = zoneReports.map((report) => {
    const isExpanded = expandedZoneReportIds.has(report.id);
    const fights = [...report.pulls].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    return `
      <article class="zone-report-card ${isExpanded ? 'expanded' : ''}">
        <button class="zone-report-toggle" data-zone-report-id="${escapeHtml(report.id)}" type="button" aria-expanded="${isExpanded}">
          <div>
            <h3>${escapeHtml(report.title || report.zoneName)}</h3>
            <p class="meta">${report.reportCode ? `${escapeHtml(report.reportCode)}<br>` : ''}${formatDateRange(report.startTime, report.endTime)}</p>
          </div>
          <span class="pill">${formatFightCount(report.pulls.length)}</span>
        </button>
        ${isExpanded ? renderZoneFightCards(fights, report.hydrationError) : ''}
      </article>
    `;
  }).join('');

  zoneReportList.querySelectorAll('.zone-report-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const reportId = button.dataset.zoneReportId;
      if (expandedZoneReportIds.has(reportId)) {
        expandedZoneReportIds.delete(reportId);
      } else {
        expandedZoneReportIds.add(reportId);
      }
      renderZoneReports();
    });
  });
}

function renderZoneFightCards(fights, hydrationError) {
  if (fights.length === 0) {
    return `<div class="zone-fight-list"><div class="empty-state">${hydrationError ? `Fight details unavailable: ${escapeHtml(hydrationError)}` : 'This report does not include fight data yet.'}</div></div>`;
  }

  return `
    <div class="zone-fight-list">
      ${fights.map((fight, index) => {
        const progress = fight.kill ? 100 : clamp(100 - fight.bossPercent, 0, 100);
        const phase = fight.kill ? 'Clear' : estimatePhase(progress);
        const bossRemaining = fight.kill ? 0 : clamp(fight.bossPercent, 0, 100);
        const bossLabel = `${bossRemaining.toFixed(1)}% boss remaining`;

        return `
          <article class="zone-fight-card">
            <div class="pull-top">
              <h4>${escapeHtml(fight.name || `Fight ${index + 1}`)}</h4>
              <span class="zone-fight-phase">${phase}</span>
            </div>
            <div class="pull-meta">
              <span>${formatTime(fight.startTime)}</span>
              <span>${formatDuration(fight.durationSeconds)}</span>
            </div>
            <div class="boss-remaining">
              <div class="boss-remaining-label">
                <span>Boss remaining</span>
                <strong>${bossLabel}</strong>
              </div>
              <div class="boss-remaining-track" aria-label="${bossLabel}">
                <div class="boss-remaining-fill" style="width: ${bossRemaining}%"></div>
              </div>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderReportGraph() {
  reportGraphCount.textContent = `${sessions.length} ${sessions.length === 1 ? 'report' : 'reports'}`;

  if (sessions.length === 0) {
    reportGraph.innerHTML = `<div class="empty-state">Log in to graph your latest FFLogs reports, or use local test data.</div>`;
    return;
  }

  const maxPulls = Math.max(...sessions.map((session) => session.pulls.length), 1);
  reportGraph.innerHTML = sessions.map((session) => {
    const width = Math.max(8, Math.round((session.pulls.length / maxPulls) * 100));
    const isActive = session.id === selectedSessionId;

    return `
      <button class="report-bar ${isActive ? 'active' : ''}" data-session-id="${escapeHtml(session.id)}" type="button">
        <div>
          <h3>${escapeHtml(session.zoneName)}</h3>
          <p class="meta">${session.title ? `${escapeHtml(session.title)}<br>` : ''}${formatShortDate(session.startTime)}</p>
        </div>
        <div class="bar-track" aria-hidden="true">
          <div class="bar-fill" style="width: ${width}%"></div>
        </div>
        <span class="pill">${session.pulls.length} pulls</span>
      </button>
    `;
  }).join('');

  reportGraph.querySelectorAll('.report-bar').forEach((bar) => {
    bar.addEventListener('click', () => {
      selectedSessionId = bar.dataset.sessionId;
      renderReportGraph();
    });
  });
}

function normalizeBossPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 100;
  }

  return number > 100 ? number / 100 : number;
}

function normalizeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return number > 10_000 ? Math.round(number / 1000) : number;
}

function toDateString(value, reportStartTime = null) {
  if (value === null || value === undefined || value === '') {
    return new Date().toISOString();
  }

  if (typeof value === 'number') {
    if (reportStartTime && value < 100_000_000) {
      return addSeconds(toDateString(reportStartTime), value / 1000);
    }

    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function addSeconds(value, seconds) {
  return new Date(new Date(value).getTime() + seconds * 1000).toISOString();
}

function secondsBetween(startTime, endTime) {
  if (!startTime || !endTime) {
    return null;
  }

  return Math.max(0, Math.round((new Date(endTime) - new Date(startTime)) / 1000));
}

function formatDateRange(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(start);
  const times = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${times.format(start)} - ${times.format(end)}`;
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function formatFightCount(count) {
  return `${count} ${count === 1 ? 'fight' : 'fights'}`;
}

function estimatePhase(progress) {
  if (progress >= 85) return 'Final phase';
  if (progress >= 65) return 'Phase 4';
  if (progress >= 45) return 'Phase 3';
  if (progress >= 22) return 'Phase 2';
  return 'Phase 1';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle('error', isError);
}

function setAppLoading(isLoading) {
  loginButton.disabled = isLoading;
  logoutButton.disabled = isLoading;
  loadTestDataButton.disabled = isLoading;
  if (!isLoading) {
    updateAuthUi();
  }
}

function setTestDataLoading(isLoading) {
  loadTestDataButton.disabled = isLoading;
  loadTestDataButton.textContent = isLoading ? 'Loading...' : isUsingTestData() ? 'Use live data' : 'Use test data';
}

function getGraphqlEndpoint() {
  return GRAPHQL_ENDPOINT;
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

const RECENT_REPORTS_QUERY = `
  query RecentUserReports($userId: Int!, $limit: Int!, $zoneId: Int) {
    reportData {
      reports(userID: $userId, limit: $limit, zoneID: $zoneId) {
        data {
          code
          title
          startTime
          endTime
          zone {
            name
          }
        }
      }
    }
  }
`;

const CURRENT_USER_QUERY = `
  query CurrentUser {
    userData {
      currentUser {
        id
        name
      }
    }
  }
`;

const CURRENT_USER_QUERY_CANDIDATES = [
  CURRENT_USER_QUERY,
];

const REPORT_FIGHTS_QUERY = `
  query ReportFights($code: String!) {
    reportData {
      report(code: $code) {
        code
        title
        startTime
        endTime
        zone {
          name
        }
        fights {
          id
          name
          startTime
          endTime
          kill
          fightPercentage
        }
      }
    }
  }
`;
