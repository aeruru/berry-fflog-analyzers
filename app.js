import {
  GRAPHQL_ENDPOINT,
  TARGET_ZONE_REPORT_LIMIT,
  TEST_DATA_URL,
} from './src/config.js';
import {
  clearStoredToken,
  clearStoredUser,
  getStoredToken,
  getStoredUser,
  handleOAuthCallback,
  isUsingTestData,
  startFflogsLogin,
  storeUser,
} from './src/auth.js';
import { clearCacheEntries } from './src/cache.js';
import {
  fetchCurrentUser,
  fetchMyRecentSessions,
} from './src/fflogs.js';
import {
  fetchFightEventDetails,
  getEmbeddedFightEventDetails,
  getFightEventKey,
} from './src/fight-events.js';
import {
  normalizeReportList,
  normalizeSession,
} from './src/normalize.js';
import { renderZoneReports as renderZoneReportsView } from './src/render.js';

let zoneReports = [];
let expandedZoneReportIds = new Set();
let activeFightEventKey = null;
let fightEventDetails = new Map();
let currentUserId = null;
let currentUserName = null;

const elements = {
  statusLine: document.querySelector('#statusLine'),
  zoneReportTitle: document.querySelector('#zoneReportTitle'),
  zoneReportList: document.querySelector('#zoneReportList'),
  zoneReportCount: document.querySelector('#zoneReportCount'),
  authState: document.querySelector('#authState'),
  userPanelTitle: document.querySelector('#userPanelTitle'),
  loginButton: document.querySelector('#loginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  clearCacheButton: document.querySelector('#clearCacheButton'),
  loadTestDataButton: document.querySelector('#loadTestDataButton'),
};

elements.loginButton.addEventListener('click', startFflogsLogin);
elements.logoutButton.addEventListener('click', () => {
  clearStoredToken();
  clearStoredUser();
  currentUserId = null;
  currentUserName = null;
  setZoneReports([]);
  updateAuthUi();
  setStatus('Logged out of FFLogs.');
});

elements.loadTestDataButton.addEventListener('click', toggleTestData);
elements.clearCacheButton.addEventListener('click', () => {
  const cleared = clearCacheEntries();
  fightEventDetails = new Map();
  setStatus(`Cleared ${cleared} cached ${cleared === 1 ? 'entry' : 'entries'}.`);
  renderZoneReports();
});

setZoneReports([]);
handleOAuthCallback({
  refreshCurrentUserProfile,
  setStatus,
}).finally(async () => {
  updateAuthUi();
  if (getStoredToken() && !isUsingTestData()) {
    await loadMyRecentReports();
  }
});

async function toggleTestData() {
  if (isUsingTestData()) {
    clearStoredUser();
    currentUserId = null;
    currentUserName = null;
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
    storeUser({
      id: currentUserId,
      name: currentUserName,
      testData: true,
    });
    updateAuthUi();
    setZoneReports([normalized]);
    setStatus('Loaded test data from the local JSON file.');
  } catch (error) {
    console.warn(error);
    setStatus(`Could not load local test data (${error.message}).`, true);
  } finally {
    setTestDataLoading(false);
  }
}

async function loadMyRecentReports() {
  if (!getStoredToken()) {
    setStatus('Log in to FFLogs to load your latest reports.', true);
    return;
  }

  setAppLoading(true);
  setStatus('Looking up your FFLogs account and latest reports...');

  try {
    const { normalized, targetZoneReports, user } = await fetchMyRecentSessions({
      endpoint: getGraphqlEndpoint(),
      onExpired: updateAuthUi,
    });

    if (normalized.length === 0) {
      throw new Error('No known-zone reports were found for your account.');
    }

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

async function refreshCurrentUserProfile() {
  try {
    const user = await fetchCurrentUser({
      endpoint: getGraphqlEndpoint(),
      onExpired: updateAuthUi,
    });
    setCurrentUser(user);
  } catch (error) {
    console.info('Could not load current FFLogs user profile yet.', error);
  }
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
    clearStoredUser();
  } else if (!isLoggedIn) {
    currentUserId = null;
    currentUserName = null;
    clearStoredUser();
  }

  elements.userPanelTitle.textContent = currentUserName || 'FFLogs account';
  elements.authState.textContent = isTestData ? 'Using test data' : isLoggedIn ? 'Logged in to FFLogs' : 'Not logged in';
  elements.loginButton.classList.toggle('hidden', Boolean(token));
  elements.logoutButton.classList.toggle('hidden', !token);
  if (!elements.loadTestDataButton.disabled) {
    elements.loadTestDataButton.textContent = isTestData ? 'Use live data' : 'Use test data';
  }
}

function setCurrentUser(user) {
  if (!user?.id && !user?.name) {
    return;
  }

  currentUserId = Number.isFinite(Number(user.id)) ? Number(user.id) : user.id;
  currentUserName = user.name ?? currentUserName;
  storeUser({
    id: currentUserId,
    name: currentUserName,
  });
  updateAuthUi();
}

function setZoneReports(nextReports) {
  zoneReports = normalizeReportList(nextReports).slice(0, TARGET_ZONE_REPORT_LIMIT);
  expandedZoneReportIds = new Set([...expandedZoneReportIds].filter((id) => zoneReports.some((report) => report.id === id)));
  activeFightEventKey = null;
  fightEventDetails = new Map();
  renderZoneReports();
}

function renderZoneReports() {
  renderZoneReportsView({
    activeFightEventKey,
    elements,
    expandedZoneReportIds,
    fightEventDetails,
    onClearFightCache: clearFightCache,
    onClearReportCache: clearReportCache,
    onLoadFight: loadFightEventDetails,
    onToggleReport: toggleZoneReport,
    zoneReports,
  });
}

function toggleZoneReport(reportId) {
  if (expandedZoneReportIds.has(reportId)) {
    expandedZoneReportIds.delete(reportId);
  } else {
    expandedZoneReportIds.add(reportId);
  }
  renderZoneReports();
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
      : await fetchFightEventDetails(report, fight, {
        endpoint: getGraphqlEndpoint(),
        onExpired: updateAuthUi,
      });
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

function setStatus(message, isError = false) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle('error', isError);
}

function setAppLoading(isLoading) {
  elements.loginButton.disabled = isLoading;
  elements.logoutButton.disabled = isLoading;
  elements.loadTestDataButton.disabled = isLoading;
  if (!isLoading) {
    updateAuthUi();
  }
}

function setTestDataLoading(isLoading) {
  elements.loadTestDataButton.disabled = isLoading;
  elements.loadTestDataButton.textContent = isLoading ? 'Loading...' : isUsingTestData() ? 'Use live data' : 'Use test data';
}

function getGraphqlEndpoint() {
  return GRAPHQL_ENDPOINT;
}
