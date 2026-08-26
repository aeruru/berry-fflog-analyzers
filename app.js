import {
  clearFflogsSession,
  completeFflogsLogin,
  isLoggedInToFflogs,
  startFflogsLogin,
} from './src/auth.js';
import { DMU_ENCOUNTER_ID } from './src/config.js';
import {
  fetchCurrentFflogsUser,
  fetchFightEventDetails,
  fetchReportByCode,
  fetchWeeklyReports,
} from './src/fflogs.js';
import { parseFflogsReportCode } from './src/report-search.js';

const elements = {
  accountName: document.querySelector('#accountName'),
  authButton: document.querySelector('#authButton'),
  authState: document.querySelector('#authState'),
  loadReportButton: document.querySelector('#loadReportButton'),
  lookupResult: document.querySelector('#lookupResult'),
  lookupStatus: document.querySelector('#lookupStatus'),
  recentReportCodes: document.querySelector('#recentReportCodes'),
  reportCount: document.querySelector('#reportCount'),
  reportSearchForm: document.querySelector('#reportSearchForm'),
  reportSearchInput: document.querySelector('#reportSearchInput'),
  reportsList: document.querySelector('#reportsList'),
  reportsStatus: document.querySelector('#reportsStatus'),
  statusLine: document.querySelector('#statusLine'),
  testDataButton: document.querySelector('#testDataButton'),
};

let currentUser = null;
let fightDetails = new Map();
let openFightDetailKeys = new Set();
let reports = [];
let selectedReport = null;
let selectedReportPhase = 'all';
let usingTestData = false;

elements.authButton.addEventListener('click', async () => {
  if (isLoggedInToFflogs()) {
    clearFflogsSession();
    currentUser = null;
    if (!usingTestData) {
      reports = [];
    }
    renderAccount();
    renderReports();
    setStatus('Logged out of FFLogs.');
    setReportsStatus(usingTestData ? 'Using local test report data.' : 'Log in to load reports.');
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

elements.testDataButton.addEventListener('click', toggleTestData);
elements.reportSearchForm.addEventListener('submit', searchForReport);

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
      setReportsStatus(formatLoadedReportsStatus(reports.length));
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
  elements.testDataButton.textContent = usingTestData ? 'Use live data' : 'Use test data';
  elements.recentReportCodes.replaceChildren(...reports.map((report) => {
    const option = document.createElement('option');
    option.value = report.code;
    return option;
  }));
}

async function toggleTestData() {
  elements.testDataButton.disabled = true;

  try {
    if (!usingTestData) {
      setReportsStatus('Loading local test report data...');
      const response = await fetch('./test-data/reports.json');
      if (!response.ok) {
        throw new Error(`Test report data returned ${response.status}.`);
      }

      const payload = await response.json();
      reports = payload.reports
        .filter((report) => report?.fights?.length > 0)
        .map((report) => ({ ...report, testActors: payload.actors ?? [] }));
      usingTestData = true;
      setReportsStatus('Using local test report data.');
      return;
    }

    usingTestData = false;
    if (!isLoggedInToFflogs() || !currentUser) {
      reports = [];
      setReportsStatus('Log in to load reports.');
      return;
    }

    setReportsStatus('Restoring live reports...');
    reports = await fetchWeeklyReports(currentUser.id);
    setReportsStatus(formatLoadedReportsStatus(reports.length));
  } catch (error) {
    setReportsStatus(error.message, true);
  } finally {
    elements.testDataButton.disabled = false;
    renderReports();
  }
}

async function searchForReport(event) {
  event.preventDefault();
  const reportCode = parseFflogsReportCode(elements.reportSearchInput.value);

  if (!reportCode) {
    elements.reportSearchInput.setAttribute('aria-invalid', 'true');
    setLookupStatus('Enter a report code or a valid https://www.fflogs.com/reports/ URL.', true);
    return;
  }

  elements.reportSearchInput.removeAttribute('aria-invalid');
  const knownReport = reports.find((report) => report.code === reportCode);

  if (knownReport) {
    loadKnownReport(knownReport);
    return;
  }

  if (usingTestData) {
    setLookupStatus(`Test data does not include report ${reportCode}.`, true);
    return;
  }

  if (!isLoggedInToFflogs()) {
    setLookupStatus('Log in to FFLogs before loading a report.', true);
    return;
  }

  elements.loadReportButton.disabled = true;
  elements.reportSearchInput.disabled = true;
  setLookupStatus(`Loading report ${reportCode}...`);

  try {
    selectedReport = await fetchReportByCode(reportCode);
    if (!selectedReport) {
      throw new Error(`FFLogs could not find report ${reportCode}.`);
    }
    selectedReportPhase = 'all';
    fightDetails = new Map();
    openFightDetailKeys = new Set();
    renderLookupResult();
    setLookupStatus(`Loaded report ${reportCode}.`);
  } catch (error) {
    selectedReport = null;
    renderLookupResult();
    setLookupStatus(error.message, true);
  } finally {
    elements.loadReportButton.disabled = false;
    elements.reportSearchInput.disabled = false;
  }
}

function renderLookupResult() {
  elements.lookupResult.replaceChildren(...(selectedReport ? [createDetailedReportView(selectedReport)] : []));
}

function loadKnownReport(report) {
  selectedReport = report;
  selectedReportPhase = 'all';
  fightDetails = new Map();
  openFightDetailKeys = new Set();
  elements.reportSearchInput.value = report.code;
  elements.reportSearchInput.removeAttribute('aria-invalid');
  renderLookupResult();
  setLookupStatus(`Loaded report ${report.code}.`);
}

function createDetailedReportView(report) {
  const article = document.createElement('article');
  article.className = 'detailed-report-card';

  const summary = document.createElement('div');
  summary.className = 'detailed-report-summary';

  const info = document.createElement('div');
  info.className = 'detailed-report-info';
  const title = document.createElement('h3');
  title.textContent = report.title || report.zone?.name || 'Untitled report';
  const codeLink = document.createElement('a');
  codeLink.className = 'report-code-link';
  codeLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}`;
  codeLink.target = '_blank';
  codeLink.rel = 'noreferrer';
  codeLink.textContent = report.code;
  const dateRange = document.createElement('p');
  dateRange.className = 'detailed-report-dates';
  dateRange.textContent = formatReportDateRange(report.startTime, report.endTime);
  info.append(title, codeLink, dateRange);

  const actions = document.createElement('div');
  actions.className = 'detailed-report-actions';
  const reloadButton = document.createElement('button');
  reloadButton.className = 'report-reload-button';
  reloadButton.type = 'button';
  reloadButton.textContent = 'Reload report';
  reloadButton.addEventListener('click', () => reloadSelectedReport(reloadButton));
  const phaseFilter = document.createElement('select');
  phaseFilter.className = 'report-phase-select';
  phaseFilter.setAttribute('aria-label', 'Filter fights by phase');
  phaseFilter.append(new Option('All phases', 'all'));
  for (let phase = 1; phase <= 5; phase += 1) {
    phaseFilter.append(new Option(`Phase ${phase}`, String(phase)));
  }
  phaseFilter.value = selectedReportPhase;
  phaseFilter.addEventListener('change', () => {
    selectedReportPhase = phaseFilter.value;
    renderLookupResult();
  });

  const fights = report.fights.filter(isDmuPull)
    .sort((first, second) => Number(second.startTime) - Number(first.startTime));
  const fightCount = document.createElement('span');
  fightCount.className = 'fight-count-pill';
  fightCount.textContent = `${fights.length} ${fights.length === 1 ? 'fight' : 'fights'}`;
  actions.append(reloadButton, phaseFilter, fightCount);
  summary.append(info, actions);

  const highlightedFight = getBestDmuPull(fights);
  const visibleFights = selectedReportPhase === 'all'
    ? fights
    : fights.filter((fight) => String(Number(fight.lastPhase) || 1) === selectedReportPhase);
  const fightList = document.createElement('div');
  fightList.className = 'detailed-fight-list';
  if (visibleFights.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'detailed-empty-state';
    empty.textContent = selectedReportPhase === 'all'
      ? 'This report does not include DMU fight data.'
      : `No fights reached Phase ${selectedReportPhase} in this report.`;
    fightList.append(empty);
  } else {
    fightList.append(...visibleFights.map((fight) => createDetailedFightCard(report, fight, highlightedFight)));
  }

  article.append(summary, fightList);
  return article;
}

function createDetailedFightCard(report, fight, highlightedFight) {
  const bossRemaining = fight.kill ? 0 : normalizeBossHealth(fight);
  const bossDamageDone = Math.min(100, Math.max(0, 100 - bossRemaining));
  const isHighlighted = fight === highlightedFight;
  const card = document.createElement('article');
  card.className = `detailed-fight-card${isHighlighted ? ' highlighted' : ''}`;

  const top = document.createElement('div');
  top.className = 'detailed-fight-top';
  const titleRow = document.createElement('div');
  titleRow.className = 'detailed-fight-title';
  const phaseTag = document.createElement('span');
  phaseTag.className = `detailed-phase-tag ${getPullColorClass(fight)}`;
  phaseTag.textContent = fight.kill ? 'CLR' : fight.lastPhaseIsIntermission
    ? `I${Number(fight.lastPhase) || 1}`
    : `P${Number(fight.lastPhase) || 1}`;
  const heading = document.createElement('h4');
  const phaseName = fight.kill ? 'Clear' : fight.lastPhaseIsIntermission
    ? `Intermission ${Number(fight.lastPhase) || 1}`
    : `Phase ${Number(fight.lastPhase) || 1}`;
  heading.textContent = `${fight.id} - ${fight.name || 'Dancing Mad'}: ${phaseName}`;
  titleRow.append(phaseTag, heading);

  const links = document.createElement('div');
  links.className = 'detailed-fight-links';
  const detailKey = `${report.code}:${fight.id}`;
  const detailsOpen = openFightDetailKeys.has(detailKey);
  const detailsButton = document.createElement('button');
  detailsButton.className = 'fight-details-button';
  detailsButton.type = 'button';
  detailsButton.textContent = detailsOpen ? 'Hide details' : 'Details';
  detailsButton.setAttribute('aria-expanded', String(detailsOpen));
  detailsButton.addEventListener('click', () => toggleFightDetails(report, fight));
  const fflogsLink = document.createElement('a');
  fflogsLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}`;
  fflogsLink.target = '_blank';
  fflogsLink.rel = 'noreferrer';
  fflogsLink.textContent = 'FFLogs';
  links.append(detailsButton, fflogsLink);
  const analyzerLinks = document.createElement('div');
  analyzerLinks.className = 'detailed-fight-analyzer-links';
  const durationMs = getFightDuration(fight);
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 150_000) {
    analyzerLinks.append(createExternalLink(
      'Arrows analyzer',
      `https://analyzer.wtfdig.info/arrows?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
    ));
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && Number(fight.lastPhase) === 2) {
    analyzerLinks.append(createExternalLink(
      'P2 analyzer',
      `https://analyzer.wtfdig.info/forsaken?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
    ));
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 330_000) {
    const startOffset = Number(fight.startTime);
    analyzerLinks.append(createExternalLink(
      'P2 DPS',
      `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 211_000}&end=${startOffset + 331_000}`,
    ));
  }
  top.append(titleRow, links);

  const meta = document.createElement('div');
  meta.className = 'detailed-fight-meta';
  const start = document.createElement('span');
  start.textContent = formatFightStartTime(report.startTime, fight.startTime);
  const duration = document.createElement('span');
  duration.textContent = formatFightDuration(getFightDuration(fight));
  const health = document.createElement('strong');
  health.className = isHighlighted ? 'highlighted' : '';
  health.textContent = `${bossRemaining.toFixed(1)}% remaining`;
  meta.append(start, duration, health);

  const bar = document.createElement('div');
  bar.className = `boss-health-bar${isHighlighted ? ' highlighted' : ''}`;
  const fill = document.createElement('div');
  fill.style.width = `${bossDamageDone}%`;
  bar.append(fill);
  card.append(top, meta, bar);
  if (analyzerLinks.childElementCount > 0) {
    card.append(analyzerLinks);
  }
  if (detailsOpen) {
    card.append(createFightDetailsPanel(report, fight, fightDetails.get(detailKey)));
  }
  return card;
}

async function reloadSelectedReport(button) {
  if (!selectedReport) {
    return;
  }

  button.disabled = true;
  const reportCode = selectedReport.code;
  setLookupStatus(`Reloading report ${reportCode}...`);

  try {
    if (usingTestData) {
      selectedReport = reports.find((report) => report.code === reportCode) ?? selectedReport;
    } else {
      const refreshedReport = await fetchReportByCode(reportCode);
      if (!refreshedReport) {
        throw new Error(`FFLogs could not find report ${reportCode}.`);
      }
      selectedReport = refreshedReport;
      reports = reports.map((report) => report.code === reportCode ? refreshedReport : report);
      renderReports();
    }

    fightDetails = new Map();
    openFightDetailKeys = new Set();
    renderLookupResult();
    setLookupStatus(`Reloaded report ${reportCode}.`);
  } catch (error) {
    setLookupStatus(error.message, true);
    button.disabled = false;
  }
}

function createExternalLink(label, href) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
}

async function toggleFightDetails(report, fight) {
  const key = `${report.code}:${fight.id}`;
  if (openFightDetailKeys.has(key)) {
    openFightDetailKeys.delete(key);
    renderLookupResult();
    return;
  }

  openFightDetailKeys.add(key);
  renderLookupResult();
  if (fightDetails.has(key)) {
    return;
  }

  if (usingTestData) {
    fightDetails.set(key, normalizeEmbeddedFightDetails(report, fight));
    renderLookupResult();
    return;
  }

  fightDetails.set(key, { status: 'loading' });
  renderLookupResult();
  try {
    const rawDetails = await fetchFightEventDetails(report.code, fight.id);
    fightDetails.set(key, normalizeFightDetails(rawDetails));
  } catch (error) {
    fightDetails.set(key, { status: 'error', error: error.message });
  }
  renderLookupResult();
}

function normalizeFightDetails(rawDetails) {
  const actors = rawDetails?.masterData?.actors ?? [];
  const actorNames = new Map(actors.map((actor) => [Number(actor.id), actor.name]));
  const friendlyPlayers = rawDetails?.fights?.[0]?.friendlyPlayers ?? [];
  const friendlyIds = new Set(friendlyPlayers.map(Number));
  const events = (rawDetails?.events?.data ?? [])
    .filter((event) => friendlyIds.size === 0 || friendlyIds.has(Number(event.targetID)))
    .map((event) => ({
      kind: event.type === 'death' ? 'Death' : 'Damage down',
      player: actorNames.get(Number(event.targetID)) ?? event.targetName ?? `Actor ${event.targetID}`,
      timestamp: Number(event.timestamp),
    }));
  return { status: 'ready', events };
}

function normalizeEmbeddedFightDetails(report, fight) {
  const actorNames = new Map((report.testActors ?? []).map((actor) => [Number(actor.id), actor.name]));
  const friendlyIds = new Set((fight.friendlyPlayers ?? []).map(Number));
  const events = (fight.events ?? [])
    .filter((event) => event.type === 'death' || (event.type === 'applydebuff' && Number(event.abilityGameID) === 1002911))
    .filter((event) => friendlyIds.size === 0 || friendlyIds.has(Number(event.targetID)))
    .map((event) => ({
      kind: event.type === 'death' ? 'Death' : 'Damage down',
      player: actorNames.get(Number(event.targetID)) ?? event.targetName ?? `Actor ${event.targetID}`,
      timestamp: Number(event.timestamp),
    }));
  return { status: 'ready', events };
}

function createFightDetailsPanel(report, fight, state) {
  const panel = document.createElement('div');
  panel.className = 'fight-details-panel';
  if (!state || state.status === 'loading') {
    panel.textContent = 'Loading death and damage down events...';
    return panel;
  }
  if (state.status === 'error') {
    panel.textContent = `Could not load fight events: ${state.error}`;
    return panel;
  }
  if (state.events.length === 0) {
    panel.textContent = 'No death or damage down events found for this fight.';
    return panel;
  }

  const table = document.createElement('table');
  table.className = 'fight-details-table';
  const head = table.createTHead().insertRow();
  for (const label of ['Time', 'Player', 'Event']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    head.append(cell);
  }
  const body = table.createTBody();
  for (const event of state.events) {
    const row = body.insertRow();
    const elapsedMs = Math.max(0, event.timestamp - Number(fight.startTime));
    const absoluteMs = Number(report.startTime) + event.timestamp;
    const time = new Date(absoluteMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    row.insertCell().textContent = `${time} (${formatFightDuration(elapsedMs)})`;
    row.insertCell().textContent = event.player;
    const eventCell = row.insertCell();
    eventCell.className = 'fight-event-icon';
    if (event.kind === 'Death') {
      const deathIcon = document.createElement('span');
      deathIcon.setAttribute('aria-label', 'Death');
      deathIcon.title = 'Death';
      deathIcon.textContent = '💀';
      eventCell.append(deathIcon);
    } else {
      const damageDownIcon = document.createElement('img');
      damageDownIcon.className = 'damage-down-icon';
      damageDownIcon.src = 'assets/damage-down.png';
      damageDownIcon.alt = 'Damage down';
      damageDownIcon.title = 'Damage down';
      eventCell.append(damageDownIcon);
    }
  }
  panel.replaceChildren(table);
  return panel;
}

function createReportCard(report) {
  const dmuPulls = report.fights.filter(isDmuPull);
  const bestPull = getBestDmuPull(dmuPulls);
  const article = document.createElement('article');
  article.className = 'report-card';
  article.tabIndex = 0;
  article.setAttribute('aria-label', `Load report ${report.code}`);
  article.addEventListener('click', (event) => {
    if (!event.target.closest('a')) {
      loadKnownReport(report);
    }
  });
  article.addEventListener('keydown', (event) => {
    if (event.target === article && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      loadKnownReport(report);
    }
  });

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
  date.className = 'report-date';
  date.dateTime = new Date(report.startTime).toISOString();
  const reportDate = new Date(report.startTime);
  const dateMonth = document.createElement('span');
  dateMonth.textContent = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(reportDate);
  const dateDay = document.createElement('span');
  dateDay.textContent = new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(reportDate);
  date.append(dateMonth, ' ', dateDay);

  const pullCount = document.createElement('div');
  pullCount.className = 'report-pull-summary';
  const dmuLabel = document.createElement('span');
  dmuLabel.textContent = 'DMU';
  const pullCountValue = document.createElement('strong');
  pullCountValue.textContent = String(dmuPulls.length);
  pullCount.append(dmuLabel, ': ', pullCountValue, ` ${dmuPulls.length === 1 ? 'pull' : 'pulls'}`);

  const best = document.createElement('div');
  best.className = 'report-metric report-best-pull';
  best.append(createBestPullBadge(bestPull));

  const footer = document.createElement('div');
  footer.className = 'report-card-footer';
  footer.append(pullCount, best, date);

  article.append(identity, footer);
  return article;
}

function createMetric(label, value, className) {
  const wrapper = document.createElement('div');
  wrapper.className = `report-metric ${className}`;
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('strong');
  labelElement.textContent = label;
  if (value instanceof Node) {
    valueElement.append(value);
  } else {
    valueElement.textContent = value;
  }
  wrapper.append(labelElement, valueElement);
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

    if (first.kill && second.kill) {
      return getFightDuration(first) - getFightDuration(second);
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

function createBestPullBadge(pull) {
  const badge = document.createElement('span');
  badge.className = `best-pull-badge ${getPullColorClass(pull)}`;

  const icon = document.createElement('span');
  icon.className = `best-pull-icon ${!pull ? 'no-pull-icon' : pull.kill ? 'clear-icon' : 'failure-icon'}`;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'best-pull-text';
  if (!pull) {
    text.textContent = 'No DMU pulls';
  } else if (pull.kill) {
    text.textContent = formatFightDuration(getFightDuration(pull));
  } else {
    const phase = Number(pull.lastPhase) || 1;
    const phaseLabel = pull.lastPhaseIsIntermission ? `I${phase}` : `P${phase}`;
    text.textContent = `${normalizeBossHealth(pull).toFixed(1)}% ${phaseLabel}`;
  }

  badge.append(icon, text);
  return badge;
}

function getPullColorClass(pull) {
  if (!pull) {
    return 'phase-unknown';
  }

  if (pull.kill) {
    return 'phase-clear';
  }

  if (pull.lastPhaseIsIntermission) {
    return 'phase-intermission';
  }

  const phase = Number(pull.lastPhase);
  return phase > 0 ? `phase-${((phase - 1) % 6) + 1}` : 'phase-unknown';
}

function formatFightDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

function formatLoadedReportsStatus(count) {
  return `Loaded ${count} nonempty ${count === 1 ? 'report' : 'reports'} from the last 7 days.`;
}

function formatReportDateRange(startTimestamp, endTimestamp) {
  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const endLabel = start.toDateString() === end.toDateString()
    ? time.format(end)
    : `${date.format(end)}, ${time.format(end)}`;
  return `${date.format(start)}, ${time.format(start)} - ${endLabel}`;
}

function formatFightStartTime(reportStartTime, fightStartTime) {
  const rawStart = Number(fightStartTime);
  const timestamp = rawStart < 1_700_000_000
    ? Number(reportStartTime) + rawStart
    : rawStart;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function setLookupStatus(message, isError = false) {
  elements.lookupStatus.textContent = message;
  elements.lookupStatus.classList.toggle('error', isError);
  elements.lookupStatus.hidden = !message;
}
