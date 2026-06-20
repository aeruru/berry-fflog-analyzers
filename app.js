const UNKNOWN_ZONE_NAMES = new Set(['unknown', 'unknown zone', '']);

const sampleSessions = [
  {
    id: 'aac-light-heavy-m2',
    zoneName: 'AAC Light-heavyweight',
    startTime: '2026-06-12T02:18:00Z',
    endTime: '2026-06-12T05:04:00Z',
    pulls: [
      pull('M2S', '2026-06-12T02:20:33Z', 388, 45.8, false),
      pull('M2S', '2026-06-12T02:33:21Z', 512, 16.3, false),
      pull('M2S', '2026-06-12T02:49:18Z', 596, 0, true),
      pull('M3S', '2026-06-12T03:27:44Z', 279, 62.9, false),
      pull('M3S', '2026-06-12T03:37:10Z', 462, 27.4, false),
    ],
  },
  {
    id: 'the-futures-rewritten-ult',
    zoneName: 'The Futures Rewritten',
    startTime: '2026-06-07T01:58:00Z',
    endTime: '2026-06-07T05:22:00Z',
    pulls: [
      pull('Futures Rewritten', '2026-06-07T02:01:12Z', 245, 75.1, false),
      pull('Futures Rewritten', '2026-06-07T02:12:05Z', 431, 49.6, false),
      pull('Futures Rewritten', '2026-06-07T02:30:39Z', 688, 18.2, false),
      pull('Futures Rewritten', '2026-06-07T02:56:18Z', 724, 9.5, false),
    ],
  },
  {
    id: 'aac-cruiserweight-m5',
    zoneName: 'AAC Cruiserweight',
    startTime: '2026-05-31T02:09:00Z',
    endTime: '2026-05-31T04:48:00Z',
    pulls: [
      pull('M5S', '2026-05-31T02:11:15Z', 324, 58.4, false),
      pull('M5S', '2026-05-31T02:24:04Z', 583, 11.8, false),
      pull('M5S', '2026-05-31T02:44:28Z', 607, 0, true),
    ],
  },
  {
    id: 'chaotic-alliance',
    zoneName: 'Chaotic Alliance Raid',
    startTime: '2026-05-24T02:14:00Z',
    endTime: '2026-05-24T03:40:00Z',
    pulls: [
      pull('Cloud of Darkness', '2026-05-24T02:16:11Z', 191, 81.2, false),
      pull('Cloud of Darkness', '2026-05-24T02:25:49Z', 533, 22.6, false),
      pull('Cloud of Darkness', '2026-05-24T02:45:06Z', 559, 0, true),
    ],
  },
  {
    id: 'dawntrail-extreme',
    zoneName: 'Dawntrail Extremes',
    startTime: '2026-05-18T01:50:00Z',
    endTime: '2026-05-18T04:01:00Z',
    pulls: [
      pull('Valigarmanda EX', '2026-05-18T01:52:43Z', 402, 35.2, false),
      pull('Valigarmanda EX', '2026-05-18T02:08:55Z', 421, 0, true),
      pull('Zoraal Ja EX', '2026-05-18T02:41:13Z', 357, 28.8, false),
    ],
  },
  {
    id: 'eden-ultimate-reclear',
    zoneName: 'Futures Rewritten Reclear',
    startTime: '2026-05-11T02:20:00Z',
    endTime: '2026-05-11T03:33:00Z',
    pulls: [
      pull('Futures Rewritten', '2026-05-11T02:22:31Z', 701, 6.7, false),
      pull('Futures Rewritten', '2026-05-11T02:45:48Z', 737, 0, true),
    ],
  },
  {
    id: 'unknown-zone-demo',
    zoneName: 'Unknown Zone',
    startTime: '2026-05-10T02:20:00Z',
    endTime: '2026-05-10T03:33:00Z',
    pulls: [pull('Unknown Encounter', '2026-05-10T02:22:31Z', 120, 92, false)],
  },
];

let sessions = [];
let selectedSessionId = null;

const form = document.querySelector('#reportForm');
const input = document.querySelector('#reportInput');
const endpointInput = document.querySelector('#endpointInput');
const tokenInput = document.querySelector('#tokenInput');
const statusLine = document.querySelector('#statusLine');
const sessionList = document.querySelector('#sessionList');
const sessionCount = document.querySelector('#sessionCount');
const detailTitle = document.querySelector('#detailTitle');
const detailSubtitle = document.querySelector('#detailSubtitle');
const pullCount = document.querySelector('#pullCount');
const pullList = document.querySelector('#pullList');
const loadDemoButton = document.querySelector('#loadDemoButton');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadReports(input.value);
});

loadDemoButton.addEventListener('click', () => {
  setStatus('Loaded demo data with the unknown zone filtered out.');
  setSessions(sampleSessions);
});

setSessions(sampleSessions);

async function loadReports(value) {
  const userId = parseUserId(value);

  if (!userId) {
    setStatus('Enter an FFLogs reports-list URL or numeric user id.', true);
    return;
  }

  const endpoint = endpointInput.value.trim() || '/api/fflogs/graphql';
  setLoading(true);
  setStatus(`Fetching recent reports for user ${userId} with FFLogs GraphQL...`);

  try {
    const normalized = await fetchRecentSessions({ endpoint, userId });

    if (normalized.length === 0) {
      throw new Error('No known-zone reports were found in the GraphQL response.');
    }

    setStatus(`Loaded ${normalized.length} recent known-zone sets from FFLogs GraphQL.`);
    setSessions(normalized);
  } catch (error) {
    console.warn(error);
    setStatus(`GraphQL request failed (${error.message}). Showing demo data for now.`, true);
    setSessions(sampleSessions);
  } finally {
    setLoading(false);
  }
}

async function fetchRecentSessions({ endpoint, userId }) {
  const reportsResult = await fflogsGraphql(endpoint, RECENT_REPORTS_QUERY, { userId });
  const reports = reportsResult?.data?.userData?.user?.reports?.data ?? [];
  const baseSessions = normalizeReportList(reports).slice(0, 6);

  const hydratedSessions = await Promise.all(baseSessions.map(async (session) => {
    if (!session.reportCode) {
      return session;
    }

    const fightsResult = await fflogsGraphql(endpoint, REPORT_FIGHTS_QUERY, { code: session.reportCode });
    const report = fightsResult?.data?.reportData?.report;
    return normalizeSession({ ...report, code: session.reportCode, zone: session.zoneName }, session.id);
  }));

  return hydratedSessions
    .filter((session) => !UNKNOWN_ZONE_NAMES.has(session.zoneName.trim().toLowerCase()))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, 6);
}

async function fflogsGraphql(endpoint, query, variables) {
  const headers = { 'content-type': 'application/json' };
  const token = tokenInput.value.trim();

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL endpoint returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  return payload;
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
  render();
}

function render() {
  sessionCount.textContent = `${sessions.length} ${sessions.length === 1 ? 'set' : 'sets'}`;

  if (sessions.length === 0) {
    sessionList.innerHTML = `<div class="empty-state">No recent known-zone sets found.</div>`;
    renderPulls(null);
    return;
  }

  sessionList.innerHTML = sessions.map((session) => `
    <button class="session-card ${session.id === selectedSessionId ? 'active' : ''}" data-session-id="${escapeHtml(session.id)}" type="button">
      <div class="session-top">
        <h3>${escapeHtml(session.zoneName)}</h3>
        <span class="pill">${session.pulls.length} pulls</span>
      </div>
      <p class="meta">${formatDateRange(session.startTime, session.endTime)}</p>
    </button>
  `).join('');

  sessionList.querySelectorAll('.session-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedSessionId = card.dataset.sessionId;
      render();
    });
  });

  renderPulls(sessions.find((session) => session.id === selectedSessionId));
}

function renderPulls(session) {
  if (!session) {
    detailTitle.textContent = 'Select a set';
    detailSubtitle.textContent = 'Pull details will appear here.';
    pullCount.textContent = '0 pulls';
    pullList.innerHTML = `<div class="empty-state">Choose a recent set to inspect its pulls.</div>`;
    return;
  }

  detailTitle.textContent = session.zoneName;
  detailSubtitle.textContent = formatDateRange(session.startTime, session.endTime);
  pullCount.textContent = `${session.pulls.length} ${session.pulls.length === 1 ? 'pull' : 'pulls'}`;

  if (session.pulls.length === 0) {
    pullList.innerHTML = `<div class="empty-state">This set does not include pull-level fight data yet.</div>`;
    return;
  }

  pullList.innerHTML = session.pulls.map((fight, index) => {
    const progress = fight.kill ? 100 : clamp(100 - fight.bossPercent, 0, 100);
    const phase = fight.kill ? 'Clear' : estimatePhase(progress);

    return `
      <article class="pull-card">
        <div class="pull-top">
          <h3>${escapeHtml(fight.name || `Pull ${index + 1}`)}</h3>
          <span class="pill">${fight.kill ? 'Kill' : phase}</span>
        </div>
        <div class="pull-meta">
          <span>${formatTime(fight.startTime)}</span>
          <span>${formatDuration(fight.durationSeconds)}</span>
          <span>${fight.kill ? '0% boss remaining' : `${fight.bossPercent.toFixed(1)}% boss remaining`}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-label">
            <span>Fight progress</span>
            <span>${Math.round(progress)}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function pull(name, startTime, durationSeconds, bossPercent, kill) {
  return {
    id: `${name}-${startTime}`,
    name,
    startTime,
    endTime: addSeconds(startTime, durationSeconds),
    durationSeconds,
    bossPercent,
    kill,
  };
}

function parseUserId(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/reports-list\/(\d+)/) ?? trimmed.match(/^(\d+)$/);
  return match?.[1] ?? null;
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
  if (!value) {
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

function setLoading(isLoading) {
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? 'Fetching...' : 'Fetch logs';
}

const RECENT_REPORTS_QUERY = `
  query RecentUserReports($userId: Int!) {
    userData {
      user(id: $userId) {
        reports(limit: 12) {
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
  }
`;

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
