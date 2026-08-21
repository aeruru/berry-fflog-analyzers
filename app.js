import {
  clearFflogsSession,
  completeFflogsLogin,
  isLoggedInToFflogs,
  startFflogsLogin,
} from './src/auth.js';
import { DMU_ENCOUNTER_ID } from './src/config.js';
import {
  fetchCurrentFflogsUser,
  fetchWeeklyReports,
} from './src/fflogs.js';

const elements = {
  accountName: document.querySelector('#accountName'),
  authButton: document.querySelector('#authButton'),
  authState: document.querySelector('#authState'),
  reportCount: document.querySelector('#reportCount'),
  reportsList: document.querySelector('#reportsList'),
  reportsStatus: document.querySelector('#reportsStatus'),
  statusLine: document.querySelector('#statusLine'),
};

let currentUser = null;
let reports = [];

elements.authButton.addEventListener('click', async () => {
  if (isLoggedInToFflogs()) {
    clearFflogsSession();
    currentUser = null;
    reports = [];
    renderAccount();
    renderReports();
    setStatus('Logged out of FFLogs.');
    setReportsStatus('Log in to load reports.');
    return;
  }

  setBusy(true);
  setStatus('Opening FFLogs login...');

  try {
    await startFflogsLogin();
  } catch (error) {
    setBusy(false);
    setStatus(error.message, true);
  }
});

initialize();

async function initialize() {
  setBusy(true);

  try {
    const token = await completeFflogsLogin();
    if (token) {
      setStatus('FFLogs login complete. Loading your account...');
    }

    if (isLoggedInToFflogs()) {
      currentUser = await fetchCurrentFflogsUser();
      setStatus('Loading your reports...');
      setReportsStatus('Loading every nonempty report from the last week...');
      reports = await fetchWeeklyReports(currentUser.id);
      setStatus('Ready to query FFLogs.');
      setReportsStatus(reports.length > 0 ? '' : 'No nonempty reports found in the last week.');
    }
  } catch (error) {
    setStatus(error.message, true);
    setReportsStatus('Reports could not be loaded.', true);
  } finally {
    setBusy(false);
    renderAccount();
    renderReports();
  }
}

function renderReports() {
  elements.reportCount.textContent = `${reports.length} ${reports.length === 1 ? 'report' : 'reports'}`;
  elements.reportsList.replaceChildren(...reports.map(createReportCard));
}

function createReportCard(report) {
  const dmuPulls = report.fights.filter(isDmuPull);
  const bestPull = getBestDmuPull(dmuPulls);
  const article = document.createElement('article');
  article.className = 'report-card';

  const heading = document.createElement('div');
  heading.className = 'report-card-heading';

  const identity = document.createElement('div');
  identity.className = 'report-identity';

  const title = document.createElement('strong');
  title.textContent = report.title || 'Untitled report';

  const codeLink = document.createElement('a');
  codeLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}`;
  codeLink.target = '_blank';
  codeLink.rel = 'noreferrer';
  codeLink.textContent = report.code;
  identity.append(title, codeLink);

  const date = document.createElement('time');
  date.dateTime = new Date(report.startTime).toISOString();
  date.textContent = formatReportDate(report.startTime);
  heading.append(identity, date);

  const metrics = document.createElement('dl');
  metrics.className = 'report-metrics';
  metrics.append(
    createMetric('DMU pulls', String(dmuPulls.length)),
    createMetric('Best DMU pull', formatBestPull(bestPull)),
  );

  article.append(heading, metrics);
  return article;
}

function createMetric(label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  return wrapper;
}

function isDmuPull(fight) {
  return Number(fight.encounterID) === DMU_ENCOUNTER_ID;
}

function getBestDmuPull(pulls) {
  if (pulls.length === 0) {
    return null;
  }

  return [...pulls].sort((first, second) => {
    if (first.kill !== second.kill) {
      return first.kill ? -1 : 1;
    }

    const phaseDifference = (Number(second.lastPhase) || 0) - (Number(first.lastPhase) || 0);
    if (phaseDifference !== 0) {
      return phaseDifference;
    }

    const healthDifference = normalizeBossHealth(first) - normalizeBossHealth(second);
    if (healthDifference !== 0) {
      return healthDifference;
    }

    return getFightDuration(second) - getFightDuration(first);
  })[0];
}

function normalizeBossHealth(fight) {
  const health = Number(fight.bossPercentage);
  return Number.isFinite(health) ? (health > 100 ? health / 100 : health) : 100;
}

function getFightDuration(fight) {
  return Math.max(0, Number(fight.endTime) - Number(fight.startTime));
}

function formatBestPull(pull) {
  if (!pull) {
    return 'No DMU pulls';
  }

  if (pull.kill) {
    return 'Clear';
  }

  const phase = Number(pull.lastPhase) || 1;
  return `P${phase} · ${normalizeBossHealth(pull).toFixed(1)}%`;
}

function formatReportDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function renderAccount() {
  const isLoggedIn = isLoggedInToFflogs();
  elements.accountName.textContent = currentUser?.name || 'FFLogs account';
  elements.authState.textContent = isLoggedIn ? 'Logged in to FFLogs' : 'Not logged in';
  elements.authButton.textContent = isLoggedIn ? 'Log out' : 'Log in to FFLogs';
}

function setBusy(isBusy) {
  elements.authButton.disabled = isBusy;
}

function setStatus(message, isError = false) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle('error', isError);
}

function setReportsStatus(message, isError = false) {
  elements.reportsStatus.textContent = message;
  elements.reportsStatus.classList.toggle('error', isError);
  elements.reportsStatus.hidden = !message;
}
