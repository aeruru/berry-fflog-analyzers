const UNKNOWN_ZONE_NAMES = new Set(['unknown', 'unknown zone', '']);
const FFLOGS_CLIENT_ID = 'a210738b-1a9b-40d8-98f6-a4054696f1eb';
const FFLOGS_AUTH_URL = 'https://www.fflogs.com/oauth/authorize';
const FFLOGS_TOKEN_URL = 'https://www.fflogs.com/oauth/token';
const TOKEN_STORAGE_KEY = 'berry.fflogs.pkce.token';
const USER_STORAGE_KEY = 'berry.fflogs.user';
const PKCE_STORAGE_KEY = 'berry.fflogs.pkce.pending';
const CACHE_STORAGE_PREFIX = 'berry.fflogs.cache.';
const TEST_DATA_URL = 'fflogs-testdata/sample-report-fights.json';
const GRAPHQL_ENDPOINT = 'https://www.fflogs.com/api/v2/user';
const TARGET_ZONE_ID = 76;
const TARGET_ZONE_REPORT_LIMIT = 2;
const DAMAGE_DOWN_ABILITY_ID = 1002911;
const FIGHT_EVENT_FILTER = `type = "death" OR (type = "applydebuff" AND ability.id = ${DAMAGE_DOWN_ABILITY_ID})`;

let sessions = [];
let zoneReports = [];
let expandedZoneReportIds = new Set();
let activeFightEventKey = null;
let fightEventDetails = new Map();
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
const clearCacheButton = document.querySelector('#clearCacheButton');
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
clearCacheButton.addEventListener('click', () => {
  const cleared = clearCacheEntries();
  fightEventDetails = new Map();
  setStatus(`Cleared ${cleared} cached ${cleared === 1 ? 'entry' : 'entries'}.`);
  renderZoneReports();
});

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

    normalized.testData = true;
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

  const reportsResult = await cachedFflogsGraphql('RecentUserReports', endpoint, RECENT_REPORTS_QUERY, variables);
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
      const fightsResult = await cachedFflogsGraphql('ReportFights', getGraphqlEndpoint(), REPORT_FIGHTS_QUERY, { code: session.reportCode });
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

async function cachedFflogsGraphql(queryName, endpoint, query, variables) {
  const cacheKey = makeCacheKey(queryName, {
    endpoint,
    queryHash: hashString(query),
    variables,
  });
  const cached = readCacheEntry(cacheKey);

  if (cached) {
    return cached;
  }

  const payload = await fflogsGraphql(endpoint, query, variables);
  writeCacheEntry(cacheKey, payload);
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

function makeCacheKey(queryName, inputs) {
  return `${CACHE_STORAGE_PREFIX}${queryName}:${encodeURIComponent(stableStringify(inputs))}`;
}

function readCacheEntry(cacheKey) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    return cached?.payload ?? null;
  } catch {
    localStorage.removeItem(cacheKey);
    return null;
  }
}

function writeCacheEntry(cacheKey, payload) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      cachedAt: Date.now(),
      payload,
    }));
  } catch (error) {
    console.info('Could not write FFLogs cache entry.', error);
  }
}

function clearCacheEntries(predicate = null) {
  const keys = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(CACHE_STORAGE_PREFIX)) {
      keys.push(key);
    }
  }

  const keysToClear = predicate ? keys.filter((key) => predicate(readCacheKeyParts(key))) : keys;
  keysToClear.forEach((key) => localStorage.removeItem(key));
  return keysToClear.length;
}

function readCacheKeyParts(key) {
  const withoutPrefix = key.slice(CACHE_STORAGE_PREFIX.length);
  const separatorIndex = withoutPrefix.indexOf(':');
  const queryName = separatorIndex >= 0 ? withoutPrefix.slice(0, separatorIndex) : withoutPrefix;
  const encodedInputs = separatorIndex >= 0 ? withoutPrefix.slice(separatorIndex + 1) : '';

  try {
    return {
      queryName,
      inputs: JSON.parse(decodeURIComponent(encodedInputs)),
    };
  } catch {
    return {
      queryName,
      inputs: null,
    };
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashString(value) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
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
  const players = normalizePlayers(item.players ?? item.report?.players ?? item.masterData?.actors ?? item.report?.masterData?.actors);

  return {
    id: String(item.id ?? item.reportCode ?? item.code ?? item.report?.code ?? `session-${index}`),
    reportCode: item.reportCode ?? item.code ?? item.report?.code ?? null,
    title: item.title ?? item.report?.title ?? null,
    zoneName: String(zoneName),
    startTime,
    endTime,
    testData: Boolean(item.testData ?? item.report?.testData),
    players,
    pulls,
  };
}

function normalizePulls(items, reportStartTime = null) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => {
    const rawStartTime = item.startTime ?? item.start ?? item.start_time;
    const rawEndTime = item.endTime ?? item.end ?? item.end_time;
    const startTime = toDateString(rawStartTime, reportStartTime);
    const endTime = toDateString(rawEndTime, reportStartTime);
    const startOffsetMs = normalizeOffsetMs(item.startOffsetMs ?? rawStartTime);
    const endOffsetMs = normalizeOffsetMs(item.endOffsetMs ?? rawEndTime);
    const durationSeconds = normalizeDuration(item.durationSeconds ?? item.duration ?? secondsBetween(startTime, endTime) ?? 0);
    const bossPercent = normalizeBossPercent(item.bossPercentage ?? item.bossPercent ?? item.fightPercentage);

    return {
      id: String(item.id ?? item.fightID ?? index + 1),
      name: item.name ?? item.encounterName ?? item.bossName ?? `Pull ${index + 1}`,
      startTime,
      startOffsetMs,
      endTime: endTime || addSeconds(startTime, durationSeconds),
      endOffsetMs,
      durationSeconds,
      bossPercent,
      kill: Boolean(item.kill ?? item.isKill ?? bossPercent === 0),
      events: normalizeFightEvents(item.events ?? item.eventData ?? [], {
        fightStartTime: startTime,
        fightStartOffsetMs: startOffsetMs,
      }),
      friendlyPlayerIds: normalizeIdList(item.friendlyPlayers ?? item.friendlyPlayerIds),
    };
  });
}

function normalizePlayers(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((actor) => actor && typeof actor === 'object')
    .map((actor) => ({
      id: Number(actor.id ?? actor.gameID ?? actor.reportID),
      name: actor.name ?? `Actor ${actor.id ?? ''}`.trim(),
      type: actor.type ?? null,
      subType: actor.subType ?? actor.subtype ?? null,
    }))
    .filter((actor) => Number.isFinite(actor.id) && actor.name);
}

function normalizeIdList(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(Number).filter(Number.isFinite);
}

function setSessions(nextSessions) {
  sessions = normalizeReportList(nextSessions);
  selectedSessionId = sessions[0]?.id ?? null;
  renderReportGraph();
}

function setZoneReports(nextReports) {
  zoneReports = normalizeReportList(nextReports).slice(0, TARGET_ZONE_REPORT_LIMIT);
  expandedZoneReportIds = new Set([...expandedZoneReportIds].filter((id) => zoneReports.some((report) => report.id === id)));
  activeFightEventKey = null;
  fightEventDetails = new Map();
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
        <div class="zone-report-toggle" data-zone-report-id="${escapeHtml(report.id)}" role="button" tabindex="0" aria-expanded="${isExpanded}">
          <div>
            <h3>${escapeHtml(report.title || report.zoneName)}</h3>
            <p class="meta">${report.reportCode ? `<a class="report-code-link" href="${getFflogsReportUrl(report.reportCode)}" target="_blank" rel="noreferrer">${escapeHtml(report.reportCode)}</a><br>` : ''}${formatDateRange(report.startTime, report.endTime)}</p>
          </div>
          <div class="report-card-actions">
            <button class="cache-clear-button report-cache-clear" data-report-id="${escapeHtml(report.id)}" type="button">Clear cache</button>
            <span class="pill">${formatFightCount(report.pulls.length)}</span>
          </div>
        </div>
        ${isExpanded ? renderZoneFightCards(report, fights) : ''}
      </article>
    `;
  }).join('');

  zoneReportList.querySelectorAll('.report-code-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  });

  zoneReportList.querySelectorAll('.report-cache-clear').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      clearReportCache(button.dataset.reportId);
    });
  });

  zoneReportList.querySelectorAll('.zone-report-toggle').forEach((toggle) => {
    const toggleReport = () => {
      const reportId = toggle.dataset.zoneReportId;
      if (expandedZoneReportIds.has(reportId)) {
        expandedZoneReportIds.delete(reportId);
      } else {
        expandedZoneReportIds.add(reportId);
      }
      renderZoneReports();
    };

    toggle.addEventListener('click', toggleReport);
    toggle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleReport();
      }
    });
  });

  zoneReportList.querySelectorAll('.zone-fight-card').forEach((card) => {
    card.addEventListener('click', () => {
      loadFightEventDetails(card.dataset.reportId, card.dataset.fightId);
    });
  });

  zoneReportList.querySelectorAll('.fight-cache-clear').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      clearFightCache(button.dataset.reportId, button.dataset.fightId);
    });
  });
}

function renderZoneFightCards(report, fights) {
  if (fights.length === 0) {
    return `<div class="zone-fight-list"><div class="empty-state">${report.hydrationError ? `Fight details unavailable: ${escapeHtml(report.hydrationError)}` : 'This report does not include fight data yet.'}</div></div>`;
  }

  return `
    <div class="zone-fight-list">
      ${fights.map((fight, index) => {
        const progress = fight.kill ? 100 : clamp(100 - fight.bossPercent, 0, 100);
        const phase = fight.kill ? 'Clear' : formatPhaseLabel(estimatePhase(progress));
        const bossRemaining = fight.kill ? 0 : clamp(fight.bossPercent, 0, 100);
        const bossLabel = `${bossRemaining.toFixed(1)}% boss remaining`;
        const fightName = fight.name || report.zoneName || `Fight ${index + 1}`;
        const eventKey = getFightEventKey(report, fight);
        const eventState = fightEventDetails.get(eventKey);
        const isActive = eventKey === activeFightEventKey;

        return `
          <article class="zone-fight-card ${isActive ? 'active' : ''}" data-report-id="${escapeHtml(report.id)}" data-fight-id="${escapeHtml(fight.id)}">
            <div class="pull-top">
              <h4>${escapeHtml(`${fight.id} - ${fightName}: ${phase}`)}</h4>
              <button class="cache-clear-button fight-cache-clear" data-report-id="${escapeHtml(report.id)}" data-fight-id="${escapeHtml(fight.id)}" type="button">Clear cache</button>
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
            ${isActive ? renderFightEventDetails(eventState) : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

async function loadFightEventDetails(reportId, fightId) {
  const report = zoneReports.find((candidate) => candidate.id === reportId);
  const fight = report?.pulls.find((candidate) => String(candidate.id) === String(fightId));

  if (!report || !fight) {
    return;
  }

  const eventKey = getFightEventKey(report, fight);
  activeFightEventKey = eventKey;

  if (fightEventDetails.has(eventKey)) {
    renderZoneReports();
    return;
  }

  fightEventDetails.set(eventKey, { status: 'loading', events: [] });
  renderZoneReports();

  try {
    const detail = isEmbeddedReport(report)
      ? getEmbeddedFightEventDetails(report, fight)
      : await fetchFightEventDetails(report, fight);
    fightEventDetails.set(eventKey, { status: 'ready', ...detail });
  } catch (error) {
    console.warn(error);
    fightEventDetails.set(eventKey, {
      status: 'error',
      error: error.message,
      events: [],
    });
  }

  renderZoneReports();
}

function renderFightEventDetails(eventState) {
  if (!eventState || eventState.status === 'loading') {
    return `<div class="fight-events-panel"><div class="empty-state">Loading death and damage down events...</div></div>`;
  }

  if (eventState.status === 'error') {
    return `<div class="fight-events-panel"><div class="empty-state">Could not load fight events: ${escapeHtml(eventState.error)}</div></div>`;
  }

  if (eventState.events.length === 0) {
    return `<div class="fight-events-panel"><div class="empty-state">No death or damage down events found for this fight.</div></div>`;
  }

  return `
    <div class="fight-events-panel">
      <div class="fight-events-summary">${eventState.players.length} players in report</div>
      <table class="fight-events-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Player</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          ${eventState.events.map((event) => `
            <tr>
              <td>${escapeHtml(formatEventTime(event.timestampMs))}</td>
              <td>${escapeHtml(event.playerName)}</td>
              <td class="event-icon">${renderEventIcon(event.kind)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function fetchFightEventDetails(report, fight) {
  if (!report.reportCode) {
    throw new Error('report code unavailable');
  }

  const result = await cachedFflogsGraphql('FightEvents', getGraphqlEndpoint(), FIGHT_EVENTS_QUERY, {
    code: report.reportCode,
    fightIDs: [Number(fight.id)],
    filterExpression: FIGHT_EVENT_FILTER,
  });
  const rawReport = result?.data?.reportData?.report;
  const actors = normalizePlayers(rawReport?.masterData?.actors ?? []);
  const fightInfo = rawReport?.fights?.[0] ?? {};
  const eventRows = rawReport?.events?.data ?? [];
  const playerLookup = buildPlayerLookup(actors);
  const players = getFightPlayers(actors, fightInfo.friendlyPlayers);

  return {
    players,
    events: normalizeFightEvents(eventRows, {
      fightStartTime: fight.startTime,
      fightStartOffsetMs: fight.startOffsetMs,
      playerLookup,
    }),
  };
}

function getEmbeddedFightEventDetails(report, fight) {
  const playerLookup = buildPlayerLookup(report.players);
  const players = getFightPlayers(report.players, fight.friendlyPlayerIds);

  return {
    players,
    events: normalizeFightEvents(fight.events, {
      fightStartTime: fight.startTime,
      fightStartOffsetMs: fight.startOffsetMs,
      playerLookup,
    }),
  };
}

function normalizeFightEvents(rawEvents, options = {}) {
  if (!Array.isArray(rawEvents)) {
    return [];
  }

  const fightStartMs = new Date(options.fightStartTime ?? 0).getTime();
  const fightStartOffsetMs = Number(options.fightStartOffsetMs);
  const playerLookup = options.playerLookup ?? new Map();

  return rawEvents
    .filter((event) => event && typeof event === 'object')
    .filter((event) => event.kind === 'death' || event.kind === 'damageDown' || event.type === 'death' || (event.type === 'applydebuff' && Number(event.abilityGameID) === DAMAGE_DOWN_ABILITY_ID))
    .map((event) => {
      const playerId = Number(event.targetID ?? event.sourceID ?? event.playerId);
      const timestamp = Number(event.timestamp ?? event.time ?? event.startTime ?? 0);
      const timing = normalizeEventTiming({
        elapsedMs: event.elapsedMs,
        fightStartMs,
        fightStartOffsetMs,
        timestamp,
        timestampMs: event.timestampMs,
      });

      return {
        elapsedMs: timing.elapsedMs,
        timestampMs: timing.timestampMs,
        kind: event.kind ?? (event.type === 'death' ? 'death' : 'damageDown'),
        playerId,
        playerName: playerLookup.get(playerId)?.name ?? event.playerName ?? event.targetName ?? event.sourceName ?? `Actor ${playerId}`,
      };
    })
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
}

function buildPlayerLookup(players) {
  return new Map((players ?? []).map((player) => [Number(player.id), player]));
}

function getFightPlayers(players, friendlyPlayerIds) {
  if (!friendlyPlayerIds?.length) {
    return players ?? [];
  }

  const friendlyIds = new Set(friendlyPlayerIds.map(Number));
  return (players ?? []).filter((player) => friendlyIds.has(Number(player.id)));
}

function getFightEventKey(report, fight) {
  return `${report.id}:${fight.id}`;
}

function clearReportCache(reportId) {
  const report = zoneReports.find((candidate) => candidate.id === reportId);

  if (!report) {
    return;
  }

  const cleared = clearCacheEntries((entry) => {
    const variables = entry.inputs?.variables;
    return variables?.code === report.reportCode;
  });

  [...fightEventDetails.keys()]
    .filter((key) => key.startsWith(`${report.id}:`))
    .forEach((key) => fightEventDetails.delete(key));

  if (activeFightEventKey?.startsWith(`${report.id}:`)) {
    activeFightEventKey = null;
  }

  setStatus(`Cleared ${cleared} cached ${cleared === 1 ? 'entry' : 'entries'} for ${report.reportCode ?? report.title ?? 'this report'}.`);
  renderZoneReports();
}

function clearFightCache(reportId, fightId) {
  const report = zoneReports.find((candidate) => candidate.id === reportId);
  const fight = report?.pulls.find((candidate) => String(candidate.id) === String(fightId));

  if (!report || !fight) {
    return;
  }

  const fightNumber = Number(fight.id);
  const cleared = clearCacheEntries((entry) => {
    const variables = entry.inputs?.variables;
    return entry.queryName === 'FightEvents'
      && variables?.code === report.reportCode
      && Array.isArray(variables.fightIDs)
      && variables.fightIDs.map(Number).includes(fightNumber);
  });
  const eventKey = getFightEventKey(report, fight);
  fightEventDetails.delete(eventKey);

  if (activeFightEventKey === eventKey) {
    activeFightEventKey = null;
  }

  setStatus(`Cleared ${cleared} cached ${cleared === 1 ? 'entry' : 'entries'} for fight ${fight.id}.`);
  renderZoneReports();
}

function isEmbeddedReport(report) {
  return report.testData || report.reportCode?.startsWith('TEST') || currentUserName === 'Test Data' || isUsingTestData();
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

function renderEventIcon(kind) {
  if (kind === 'death') {
    return '<span aria-label="Death" title="Death">💀</span>';
  }

  return '<img class="damage-down-icon" src="assets/damage-down.png" alt="Damage down" title="Damage down">';
}

function getFflogsReportUrl(reportCode) {
  return `https://www.fflogs.com/reports/${encodeURIComponent(reportCode)}`;
}

function normalizeBossPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 100;
  }

  return number > 100 ? number / 100 : number;
}

function normalizeOffsetMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number > 100_000_000) {
    return null;
  }

  return number;
}

function normalizeEventTiming({ elapsedMs, fightStartMs, fightStartOffsetMs, timestamp, timestampMs }) {
  const explicitTimestampMs = Number(timestampMs);
  if (Number.isFinite(explicitTimestampMs)) {
    return {
      elapsedMs: Math.max(0, explicitTimestampMs - fightStartMs),
      timestampMs: explicitTimestampMs,
    };
  }

  const explicitElapsedMs = Number(elapsedMs);
  if (Number.isFinite(explicitElapsedMs)) {
    const safeElapsedMs = Math.max(0, explicitElapsedMs);
    return {
      elapsedMs: safeElapsedMs,
      timestampMs: fightStartMs + safeElapsedMs,
    };
  }

  if (timestamp > 10_000_000_000) {
    return {
      elapsedMs: Math.max(0, timestamp - fightStartMs),
      timestampMs: timestamp,
    };
  }

  if (Number.isFinite(fightStartOffsetMs)) {
    const calculatedElapsedMs = timestamp >= fightStartOffsetMs ? timestamp - fightStartOffsetMs : timestamp;
    const safeElapsedMs = Math.max(0, calculatedElapsedMs);
    return {
      elapsedMs: safeElapsedMs,
      timestampMs: fightStartMs + safeElapsedMs,
    };
  }

  return {
    elapsedMs: Math.max(0, timestamp),
    timestampMs: fightStartMs + Math.max(0, timestamp),
  };
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

function formatFightElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatEventTime(milliseconds) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(milliseconds));
}

function formatFightCount(count) {
  return `${count} ${count === 1 ? 'fight' : 'fights'}`;
}

function formatPhaseLabel(phase) {
  return phase.replace(/^Phase\s+(\d+)$/i, 'Phase$1');
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
          friendlyPlayers
        }
      }
    }
  }
`;

const FIGHT_EVENTS_QUERY = `
  query FightEvents($code: String!, $fightIDs: [Int]!, $filterExpression: String!) {
    reportData {
      report(code: $code) {
        masterData {
          actors {
            id
            name
            type
            subType
          }
        }
        fights(fightIDs: $fightIDs) {
          id
          friendlyPlayers
        }
        events(fightIDs: $fightIDs, filterExpression: $filterExpression, limit: 10000) {
          data
        }
      }
    }
  }
`;
