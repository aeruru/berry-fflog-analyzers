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
import { createGroupingScenarioReport } from './test-data/grouping-scenarios.js';

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
  themeToggleButton: document.querySelector('#themeToggleButton'),
};

let currentUser = null;
let dancingMadMechanics = [];
let fightDetails = new Map();
let openFightDetailKeys = new Set();
let reports = [];
let selectedDetailsView = 'timeline';
let selectedReport = null;
let selectedReportPhase = 'all';
let usingTestData = false;
let timelineCollisionFrame = null;

// Phase boundaries are encounter timings, rather than inferred from the first named
// mechanic. Keeping them explicit also lets timelines render phases with sparse data.
const DANCING_MAD_PHASE_STARTS = new Map([
  [1, 0],
  [2, 207_000],
  [3, 421_000],
  [4, 745_000],
  [5, 900_000],
]);

// Timeline positions travel through percentages before returning to pixels. Treat
// sub-hundredth-pixel drift as exact contact so a designed 22px gap stays ungrouped.
const TIMELINE_GROUP_EPSILON_PX = 0.01;

// The app is intentionally state-driven: user actions update these module-level values,
// then the relevant render function rebuilds its section from that single source of truth.
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
elements.themeToggleButton.addEventListener('click', toggleTheme);
elements.reportSearchForm.addEventListener('submit', searchForReport);
window.addEventListener('resize', scheduleTimelineCollisionCheck);
document.addEventListener('click', (event) => {
  if (!event.target.closest('.fight-timeline-event.grouped')) {
    closePinnedTimelineGroups();
  }
});

renderThemeButton();
initialize();

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  try {
    localStorage.setItem('berry-theme', nextTheme);
  } catch {
    // The selected theme still applies for this page when storage is unavailable.
  }
  renderThemeButton();
}

function renderThemeButton() {
  const isLight = document.documentElement.dataset.theme === 'light';
  elements.themeToggleButton.textContent = isLight ? 'Dark mode' : 'Light mode';
  elements.themeToggleButton.setAttribute('aria-label', `Switch to ${isLight ? 'dark' : 'light'} mode`);
}

// Restores an FFLogs login when possible, then supplies the first complete report list
// before handing control to the normal account/report render loop.
async function initialize() {
  setBusy(true);

  try {
    await loadDancingMadMechanics();
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

async function loadDancingMadMechanics() {
  const response = await fetch('./fight-data/dancing-mad-mechs.json');
  if (!response.ok) {
    throw new Error(`Dancing Mad mechanic data returned ${response.status}.`);
  }

  const mechanics = await response.json();
  dancingMadMechanics = mechanics
    .filter((entry) => Number.isFinite(Number(entry.elapsedSeconds)))
    .sort((first, second) => Number(first.elapsedSeconds) - Number(second.elapsedSeconds));
}

// Rebuilds the weekly strip and its lookup suggestions together so both surfaces always
// expose the same current live/test report collection.
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

// Test data replaces the live report collection, but uses the same render and selection
// paths so UI work exercises the production display logic rather than a parallel mock UI.
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
      reports = [...payload.reports, createGroupingScenarioReport()]
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

// Report selection has two entry points—the weekly cards and free-form lookup—but both
// converge on selectedReport so the detailed viewer has one rendering path.
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
  scheduleTimelineCollisionCheck();
}

// Timeline labels vary enough that elapsed-time thresholds are unreliable. Measure the
// rendered label boxes and move only end labels that overlap their neighbor by 2px+.
function scheduleTimelineCollisionCheck() {
  cancelAnimationFrame(timelineCollisionFrame);
  timelineCollisionFrame = requestAnimationFrame(() => {
    renderTimelineEventGroups();
    for (const row of document.querySelectorAll('.fight-timeline-row.last-phase-row')) {
      row.classList.remove('crowded-end');
      const endTick = row.querySelector('.fight-timeline-tick.boundary-end');
      endTick?.classList.remove('crowded');
      if (!endTick) {
        continue;
      }

      const endBounds = getTimelineTickLabelBounds(endTick);
      const precedingTick = [...row.querySelectorAll('.fight-timeline-tick')]
        .filter((tick) => tick !== endTick)
        .sort((first, second) => second.getBoundingClientRect().left - first.getBoundingClientRect().left)[0];
      const precedingBounds = getTimelineTickLabelBounds(precedingTick);
      if (endBounds && precedingBounds && precedingBounds.right - endBounds.left > 1) {
        endTick.classList.add('crowded');
        row.classList.add('crowded-end');
      }
    }
  });
}

// Grouping is based on the canvas's rendered width so it reflects real icon overlap,
// including after responsive layout changes. Same event types collapse before mixed
// candidates are checked, which keeps DD and death groups separate whenever possible.
function renderTimelineEventGroups() {
  for (const canvas of document.querySelectorAll('.fight-timeline-canvas')) {
    const sourceItems = canvas.timelineEventItems ?? [];
    canvas.querySelectorAll('.fight-timeline-event, .fight-timeline-event-member-preview')
      .forEach((marker) => marker.remove());
    if (sourceItems.length === 0 || canvas.clientWidth === 0) {
      continue;
    }

    const items = sourceItems;

    const candidates = [];
    for (const kind of ['Damage down', 'Death']) {
      const kindItems = items
        .filter((item) => item.event.kind === kind)
        .sort((first, second) => first.position - second.position);
      let cluster = [];
      for (const item of kindItems) {
        const itemX = item.position / 100 * canvas.clientWidth;
        const previousX = cluster.length > 0
          ? cluster.at(-1).position / 100 * canvas.clientWidth
          : null;
        if (previousX !== null && itemX - previousX >= 22 - TIMELINE_GROUP_EPSILON_PX) {
          candidates.push(createTimelineGroupCandidate(kind, cluster, canvas.clientWidth));
          cluster = [];
        }
        cluster.push(item);
      }
      if (cluster.length > 0) {
        candidates.push(createTimelineGroupCandidate(kind, cluster, canvas.clientWidth));
      }
    }

    const remaining = new Set(candidates);
    while (remaining.size > 0) {
      const component = [remaining.values().next().value];
      remaining.delete(component[0]);
      for (let index = 0; index < component.length; index += 1) {
        const current = component[index];
        for (const candidate of [...remaining]) {
          const differentKinds = candidate.kind !== current.kind;
          const collisionDistance = (candidate.width + current.width) / 2;
          const overlaps = Math.abs(candidate.x - current.x)
            < collisionDistance - TIMELINE_GROUP_EPSILON_PX;
          if (differentKinds && overlaps) {
            component.push(candidate);
            remaining.delete(candidate);
          }
        }
      }

      const componentItems = component.flatMap((candidate) => candidate.items);
      const position = componentItems.reduce((sum, item) => sum + item.position, 0) / componentItems.length;
      if (component.length > 1) {
        const groups = ['Damage down', 'Death']
          .map((kind) => ({ kind, items: componentItems.filter((item) => item.event.kind === kind) }))
          .filter((group) => group.items.length > 0);
        canvas.append(createTimelineEventGroupMarker(groups, position, canvas));
      } else if (component[0].items.length > 1) {
        const groups = [{ kind: component[0].kind, items: component[0].items }];
        canvas.append(createTimelineEventGroupMarker(groups, position, canvas));
      } else {
        const item = component[0].items[0];
        canvas.append(createTimelineEventMarker(item.event, item.mechanic, item.elapsedMs, item.position));
      }
    }
  }
}

function createTimelineGroupCandidate(kind, items, canvasWidth) {
  const firstX = items[0].position / 100 * canvasWidth;
  const lastX = items.at(-1).position / 100 * canvasWidth;
  // Preserve the cluster's real occupied span for mixed-type collision checks.
  // Each outer marker contributes an 11px radius around its center.
  const x = (firstX + lastX) / 2;
  return {
    kind,
    items,
    position: x / canvasWidth * 100,
    width: lastX - firstX + 22,
    x,
  };
}

function getTimelineTickLabelBounds(tick) {
  if (!tick) {
    return null;
  }
  const labels = [...tick.querySelectorAll('.fight-timeline-time, .fight-timeline-mechanic')];
  if (labels.length === 0) {
    return null;
  }
  const rectangles = labels.map((label) => label.getBoundingClientRect());
  return {
    left: Math.min(...rectangles.map((rectangle) => rectangle.left)),
    right: Math.max(...rectangles.map((rectangle) => rectangle.right)),
  };
}

// Selecting a known weekly/test report avoids another network request while still
// resetting viewer-only state that belongs to the previously selected report.
function loadKnownReport(report) {
  selectedReport = report;
  fightDetails = new Map();
  openFightDetailKeys = new Set();
  elements.reportSearchInput.value = report.code;
  elements.reportSearchInput.removeAttribute('aria-invalid');
  renderLookupResult();
  setLookupStatus(`Loaded report ${report.code}.`);
}

// Builds the detailed viewer from selected report state. Phase selection filters only
// the displayed fights; it does not alter the report used for highlighting or reloads.
function createDetailedReportView(report) {
  const article = document.createElement('article');
  article.className = 'detailed-report-card';

  const fights = report.fights.filter(isDmuPull)
    .sort((first, second) => Number(second.startTime) - Number(first.startTime));
  const visibleFights = selectedReportPhase === 'all'
    ? fights
    : fights.filter((fight) => String(Number(fight.lastPhase) || 1) === selectedReportPhase);
  const highlightedFight = getBestDmuPull(visibleFights);

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

  const detailsViewButton = document.createElement('button');
  detailsViewButton.className = 'report-details-view-button';
  detailsViewButton.type = 'button';
  detailsViewButton.textContent = selectedDetailsView === 'timeline'
    ? 'Switch to table view'
    : 'Switch to timeline view';
  detailsViewButton.setAttribute('aria-label', `Switch to ${selectedDetailsView === 'timeline' ? 'table' : 'timeline'} view`);
  detailsViewButton.addEventListener('click', () => {
    selectedDetailsView = selectedDetailsView === 'timeline' ? 'table' : 'timeline';
    renderLookupResult();
  });

  const fightCount = document.createElement('span');
  fightCount.className = 'fight-count-pill';
  fightCount.textContent = `${visibleFights.length} ${visibleFights.length === 1 ? 'pull' : 'pulls'}`;
  const pullSummary = document.createElement('div');
  pullSummary.className = 'detailed-report-pull-summary';
  const emptyPullLabel = selectedReportPhase === 'all'
    ? 'No DMU pulls'
    : `No P${selectedReportPhase} pulls`;
  pullSummary.append(fightCount, createBestPullBadge(highlightedFight, emptyPullLabel));
  actions.append(reloadButton, phaseFilter, detailsViewButton, pullSummary);
  summary.append(info, actions);

  const fightList = document.createElement('div');
  fightList.className = 'detailed-fight-list';
  if (visibleFights.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'detailed-empty-state';
    empty.textContent = selectedReportPhase === 'all'
      ? 'This report does not include DMU fight data.'
      : `No fights ended during Phase ${selectedReportPhase} in this report.`;
    fightList.append(empty);
  } else {
    fightList.append(...visibleFights.map((fight) => createDetailedFightCard(report, fight, highlightedFight)));
  }

  article.append(summary, fightList);
  return article;
}

// Each fight card owns only summary UI. Expansion state and fetched event data live in
// keyed maps so several details panels can remain open across a viewer re-render.
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
  let analyzerItems = [];
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 150_000) {
    const arrowsLink = createExternalLink(
      '🔃',
      `https://analyzer.wtfdig.info/arrows?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
    );
    arrowsLink.className = 'analyzer-icon-link';
    arrowsLink.setAttribute('aria-label', 'Arrows analyzer');
    arrowsLink.title = 'Arrows analyzer';
    analyzerItems.push(arrowsLink);
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && Number(fight.lastPhase) >= 2) {
    const forsakenLink = createExternalLink(
      'FT',
      `https://analyzer.wtfdig.info/forsaken?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
    );
    forsakenLink.setAttribute('aria-label', 'Forsaken analyzer');
    forsakenLink.title = 'Forsaken analyzer';
    analyzerItems.push(forsakenLink);
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 525_000) {
    const limitCutLink = createExternalLink(
        'LC',
        `https://analyzer.wtfdig.info/kefka-lc?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
    );
    limitCutLink.setAttribute('aria-label', 'Limit Cut analyzer');
    limitCutLink.title = 'Limit Cut analyzer';
    analyzerItems.push(limitCutLink);
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 580_000) {
    const blackHoleLink = createExternalLink(
        'BH',
        `https://analyzer.wtfdig.info/black-hole?report=${encodeURIComponent(report.code)}&fight=${encodeURIComponent(fight.id)}`,
    );
    blackHoleLink.setAttribute('aria-label', 'Black Hole analyzer');
    blackHoleLink.title = 'Black Hole analyzer';
    analyzerItems.push(blackHoleLink);
  }
  if (analyzerItems.length > 0) {
    analyzerLinks.append(createLinkGroup('Analyzers:', analyzerItems));
  }
  analyzerItems = [];
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 197_000) {
    const startOffset = Number(fight.startTime);
    const P1dpsLink = createExternalLink(
        'P1',
        `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 1_000}&end=${startOffset + 198_000}`,
    );
    P1dpsLink.setAttribute('aria-label', 'P1 DPS (0:00-3:10)');
    P1dpsLink.title = 'P1 DPS';
    analyzerItems.push(P1dpsLink);
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 331_000) {
    const startOffset = Number(fight.startTime);
    const FTdpsLink = createExternalLink(
      'FT',
      `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 211_000}&end=${startOffset + 331_000}`,
    );
    FTdpsLink.setAttribute('aria-label', 'Forsaken DPS (3:30-5:30)');
    FTdpsLink.title = 'Forsaken DPS';
    analyzerItems.push(FTdpsLink);
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 381_000) {
    const startOffset = Number(fight.startTime);
    const P2dpsLink = createExternalLink(
        'P2',
        `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 211_000}&end=${startOffset + 381_000}`,
    );
    P2dpsLink.setAttribute('aria-label', 'P2 DPS (3:30-6:20)');
    P2dpsLink.title = 'P2 DPS';
    analyzerItems.push(P2dpsLink);
  }
  if (detailsOpen && !fight.kill && !fight.lastPhaseIsIntermission && durationMs > 735_000) {
    const startOffset = Number(fight.startTime);
    const P3dpsLink = createExternalLink(
        'P3',
        `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}&type=damage-done&start=${startOffset + 428_000}&end=${startOffset + 736_000}`,
    );
    P3dpsLink.setAttribute('aria-label', 'P3 DPS (7:07-12:20)');
    P3dpsLink.title = 'P3 DPS';
    analyzerItems.push(P3dpsLink);
  }
  if (analyzerItems.length > 0) {
    analyzerLinks.append(createLinkGroup('DPS:', analyzerItems));
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
    card.append(createFightDetailsPanel(fight, fightDetails.get(detailKey)));
  }
  return card;
}

// Reloading replaces the selected report's fight snapshot and invalidates event details;
// those details are tied to the previous snapshot and must be fetched again on demand.
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

// Groups related tools under a plain-language label while leaving every destination
// as an independently focusable link.
function createLinkGroup(label, links) {
  const group = document.createElement('span');
  group.className = 'detailed-fight-link-group';
  group.append(`${label} `, ...links);
  return group;
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

// FFLogs event responses reference actor IDs, so normalize them into display-ready rows
// once and keep the rendering code independent of the GraphQL response shape.
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

function createFightDetailsPanel(fight, state) {
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
  panel.replaceChildren(selectedDetailsView === 'table'
    ? createFightDetailsTable(fight, state.events)
    : createFightTimeline(fight, state.events));
  return panel;
}

function createFightDetailsTable(fight, events) {
  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'detailed-empty-state';
    empty.textContent = 'No deaths or damage downs in this fight.';
    return empty;
  }

  const table = document.createElement('table');
  table.className = 'fight-details-table';
  const head = document.createElement('thead');
  const headingRow = document.createElement('tr');
  for (const heading of ['Time', 'Mechanic', 'Player', 'Event']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = heading;
    headingRow.append(cell);
  }
  head.append(headingRow);

  const body = document.createElement('tbody');
  for (const event of events) {
    const elapsedMs = Math.max(0, Number(event.timestamp) - Number(fight.startTime));
    const eventPhase = getDancingMadPhase(elapsedMs);
    const mechanic = getDancingMadMechanic(elapsedMs, eventPhase);
    const row = document.createElement('tr');
    const timeCell = document.createElement('td');
    timeCell.textContent = formatFightDuration(elapsedMs);
    const mechanicCell = document.createElement('td');
    mechanicCell.textContent = mechanic ? `P${mechanic.phase}.${mechanic.mechanic}` : '—';
    const playerCell = document.createElement('td');
    playerCell.textContent = event.player;
    const eventCell = document.createElement('td');
    eventCell.append(createFightEventIcon(event.kind));
    row.append(timeCell, mechanicCell, playerCell, eventCell);
    body.append(row);
  }

  table.append(head, body);
  return table;
}

function createFightTimeline(fight, events) {
  const timeline = document.createElement('div');
  timeline.className = 'fight-timeline';
  const durationMs = getFightDuration(fight);
  const endingPhase = Math.max(1, Number(fight.lastPhase) || 1);
  const eqMechanic = dancingMadMechanics.find((mechanic) => mechanic.mechanic.startsWith('EQ'));
  const eqTimestampMs = Number(eqMechanic?.elapsedSeconds) * 1000;
  const splitLongPhaseThree = durationMs >= 600_000 && Number.isFinite(eqTimestampMs);
  const phaseSegments = [];

  for (let phase = 1; phase <= endingPhase; phase += 1) {
    const phaseStart = Math.min(durationMs, DANCING_MAD_PHASE_STARTS.get(phase) ?? durationMs);
    const nextKnownStart = DANCING_MAD_PHASE_STARTS.get(phase + 1);
    const phaseEnd = Math.max(phaseStart, Math.min(durationMs, nextKnownStart ?? durationMs));
    if (phase === 3 && splitLongPhaseThree && eqTimestampMs > phaseStart && eqTimestampMs < phaseEnd) {
      phaseSegments.push(
        { phase, phaseStart, phaseEnd: eqTimestampMs, isFirstSegment: true, isLastSegment: false },
        { phase, phaseStart: eqTimestampMs, phaseEnd, isFirstSegment: false, isLastSegment: true },
      );
    } else {
      phaseSegments.push({ phase, phaseStart, phaseEnd, isFirstSegment: true, isLastSegment: true });
    }
  }

  for (const { phase, phaseStart, phaseEnd, isFirstSegment, isLastSegment } of phaseSegments) {
    const phaseDuration = Math.max(1, phaseEnd - phaseStart);
    const row = document.createElement('div');
    row.className = 'fight-timeline-row';
    if (phase === endingPhase && isLastSegment) {
      row.classList.add('last-phase-row');
    }

    const label = document.createElement('strong');
    label.className = 'fight-timeline-phase';
    label.textContent = `P${phase}`;

    const canvas = document.createElement('div');
    canvas.className = 'fight-timeline-canvas';
    canvas.timelineEventItems = [];
    const track = document.createElement('div');
    track.className = `fight-timeline-track phase-${((phase - 1) % 6) + 1}`;

    const timelineTicks = new Map();
    const addTimelineTick = (timestampMs, title, mechanicLabel = '', boundary = '') => {
      const position = ((timestampMs - phaseStart) / phaseDuration) * 100;
      const mergeToleranceMs = boundary === 'end' ? 100 : 1_000;
      const nearbyTick = [...timelineTicks.entries()]
        .find(([tickTime]) => Math.abs(tickTime - timestampMs) < mergeToleranceMs);
      const tickKey = nearbyTick?.[0] ?? Math.round(timestampMs);
      let tick = nearbyTick?.[1];
      if (!tick) {
        tick = document.createElement('span');
        tick.className = 'fight-timeline-tick';
        tick.style.left = `${position}%`;
        const timestamp = document.createElement('span');
        timestamp.className = 'fight-timeline-time';
        timestamp.textContent = formatFightDuration(timestampMs);
        tick.append(timestamp);
        timelineTicks.set(tickKey, tick);
        track.append(tick);
      }
      if (boundary) {
        tick.classList.add('boundary', `boundary-${boundary}`);
      }
      if (mechanicLabel) {
        let mechanicName = tick.querySelector('.fight-timeline-mechanic');
        if (!mechanicName) {
          mechanicName = document.createElement('span');
          mechanicName.className = 'fight-timeline-mechanic';
          tick.append(mechanicName);
        }
        const words = mechanicLabel.split(/\s+/);
        mechanicName.replaceChildren(words.shift());
        if (words.length > 0) {
          mechanicName.append(document.createElement('br'), words.join(' '));
        }
      }
      if (title) {
        tick.title = title;
      }
      return tick;
    };

    addTimelineTick(
      phaseStart,
      `Phase ${phase} timeline ${isFirstSegment ? 'begins' : 'continues'}`,
      phase === 1 ? 'START' : '',
      'start',
    );

    for (const mechanic of dancingMadMechanics.filter((entry) => Number(entry.phase) === phase)) {
      const mechanicMs = Number(mechanic.elapsedSeconds) * 1000;
      if (mechanicMs < phaseStart || mechanicMs > phaseEnd) {
        continue;
      }
      addTimelineTick(mechanicMs, mechanic.mechanic || `Phase ${phase} begins`, mechanic.mechanic);
    }

    addTimelineTick(
      phaseEnd,
      `Phase ${phase} timeline ${isLastSegment ? 'ends' : 'continues'}`,
      isLastSegment ? 'END' : '',
      'end',
    );

    for (const event of events) {
      const elapsedMs = Math.max(0, Number(event.timestamp) - Number(fight.startTime));
      const eventPhase = getDancingMadPhase(elapsedMs);
      const mechanic = getDancingMadMechanic(elapsedMs, eventPhase);
      if (eventPhase !== phase || elapsedMs < phaseStart || elapsedMs > phaseEnd
        || (!isLastSegment && elapsedMs === phaseEnd)) {
        continue;
      }
      const position = Math.max(0, Math.min(100, ((elapsedMs - phaseStart) / phaseDuration) * 100));
      row.classList.add('has-events');
      canvas.timelineEventItems.push({
        event,
        mechanic,
        elapsedMs,
        position,
      });
    }

    if (canvas.timelineEventItems.length === 0) {
      continue;
    }

    canvas.append(track);
    row.append(label, canvas);
    timeline.append(row);
  }

  if (timeline.childElementCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'detailed-empty-state';
    empty.textContent = 'No deaths or damage downs in this fight.';
    timeline.append(empty);
  }

  return timeline;
}

function createTimelineEventMarker(event, mechanic, elapsedMs, position) {
  const marker = document.createElement('span');
  marker.className = 'fight-timeline-event';
  marker.tabIndex = 0;
  marker.style.left = `${position}%`;
  marker.setAttribute('aria-label', `${event.kind}: ${event.player} at ${formatFightDuration(elapsedMs)}`);
  marker.append(createFightEventIcon(event.kind));

  const tooltip = document.createElement('span');
  tooltip.className = `fight-timeline-tooltip${position < 18 ? ' align-start' : position > 82 ? ' align-end' : ''}`;
  const tooltipIcon = createFightEventIcon(event.kind);
  tooltipIcon.classList.add('fight-timeline-tooltip-icon');
  tooltip.append(
    createTimelineTooltipItem('Time', formatFightDuration(elapsedMs)),
    createTimelineTooltipItem('Mechanic', mechanic?.mechanic || 'Before first mechanic'),
    createTimelineTooltipItem('Player', event.player),
    tooltipIcon,
  );
  marker.append(tooltip);
  enableAdaptiveTimelineTooltip(marker);
  return marker;
}

function createTimelineEventGroupMarker(groups, position, canvas) {
  const marker = document.createElement('span');
  marker.className = 'fight-timeline-event grouped';
  marker.tabIndex = 0;
  marker.style.left = `${position}%`;
  marker.setAttribute('aria-label', groups
    .map((group) => `${group.items.length} ${group.kind.toLowerCase()} events`)
    .join(' and '));

  const box = document.createElement('span');
  box.className = `fight-timeline-event-box${groups.length > 1 ? ' mixed' : ''}`;
  for (const group of groups) {
    const iconWrap = document.createElement('span');
    iconWrap.className = 'fight-timeline-group-icon';
    iconWrap.append(createFightEventIcon(group.kind));
    const count = document.createElement('span');
    count.className = 'fight-timeline-event-count';
    count.textContent = String(group.items.length);
    iconWrap.append(count);
    box.append(iconWrap);
  }

  const previewItems = groups
    .flatMap((group) => group.items.map((item) => ({ kind: group.kind, item })))
    .sort((first, second) => first.item.elapsedMs - second.item.elapsedMs);
  const previews = [];
  for (const { kind, item } of previewItems) {
    const preview = document.createElement('span');
    preview.className = 'fight-timeline-event-member-preview';
    // Anchor previews to the canvas using the source event's original percentage.
    // This is identical to an ungrouped marker and remains exact after a resize.
    preview.style.left = `${item.position}%`;
    preview.setAttribute('aria-hidden', 'true');
    preview.append(createFightEventIcon(kind));
    previews.push(preview);
    canvas.append(preview);
  }

  marker.timelineMemberPreviews = previews;
  const showPreviews = () => previews.forEach((preview) => preview.classList.add('visible'));
  const hidePreviews = () => {
    if (!marker.classList.contains('pinned')) {
      previews.forEach((preview) => preview.classList.remove('visible'));
    }
  };
  marker.addEventListener('mouseenter', showPreviews);
  marker.addEventListener('mouseleave', hidePreviews);
  marker.addEventListener('focusin', showPreviews);
  marker.addEventListener('focusout', hidePreviews);
  marker.addEventListener('click', (event) => {
    event.stopPropagation();
    const shouldPin = !marker.classList.contains('pinned');
    closePinnedTimelineGroups();
    if (shouldPin) {
      marker.classList.add('pinned');
      showPreviews();
    } else {
      marker.blur();
    }
  });

  const tooltip = document.createElement('span');
  tooltip.className = `fight-timeline-tooltip fight-timeline-group-tooltip${position < 18 ? ' align-start' : position > 82 ? ' align-end' : ''}`;
  const table = document.createElement('table');
  table.className = 'fight-timeline-group-table';
  const head = document.createElement('thead');
  const headingRow = document.createElement('tr');
  // Mirror the regular details table so the compact hover view preserves the
  // same reading order and does not merge the event icon into the player cell.
  for (const label of ['Time', 'Mechanic', 'Player', 'Event']) {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = label;
    headingRow.append(heading);
  }
  head.append(headingRow);
  const body = document.createElement('tbody');
  const tableItems = groups
    .flatMap((group) => group.items.map((item) => ({ kind: group.kind, item })))
    .sort((first, second) => first.item.elapsedMs - second.item.elapsedMs);
  for (const { kind, item } of tableItems) {
    const row = document.createElement('tr');
    const time = document.createElement('td');
    time.textContent = formatFightDuration(item.elapsedMs);
    const mechanic = document.createElement('td');
    mechanic.textContent = item.mechanic?.mechanic || 'Before first mechanic';
    const player = document.createElement('td');
    player.textContent = item.event.player;
    const event = document.createElement('td');
    event.append(createFightEventIcon(kind));
    row.append(time, mechanic, player, event);
    body.append(row);
  }
  table.append(head, body);
  tooltip.append(table);

  marker.append(box, tooltip);
  enableAdaptiveTimelineTooltip(marker);
  return marker;
}

// Group previews are canvas siblings so they can sit at their exact source positions.
// Keep their visibility tied to the marker when a click pins its contents panel.
function closePinnedTimelineGroups() {
  for (const marker of document.querySelectorAll('.fight-timeline-event.grouped.pinned')) {
    marker.classList.remove('pinned');
    marker.timelineMemberPreviews?.forEach((preview) => preview.classList.remove('visible'));
    marker.blur();
  }
}

function enableAdaptiveTimelineTooltip(marker) {
  const placeTooltip = () => {
    const tooltip = marker.querySelector('.fight-timeline-tooltip');
    if (!tooltip) {
      return;
    }
    const markerBounds = marker.getBoundingClientRect();
    const requiredBottom = markerBounds.bottom + tooltip.offsetHeight + 8;
    tooltip.classList.toggle('above', requiredBottom > window.innerHeight);
  };
  marker.addEventListener('mouseenter', placeTooltip);
  marker.addEventListener('focusin', placeTooltip);
}

function createTimelineTooltipItem(label, value) {
  const item = document.createElement('span');
  const heading = document.createElement('small');
  heading.textContent = label;
  const content = document.createElement('strong');
  content.textContent = value;
  item.append(heading, content);
  return item;
}

function createFightEventIcon(kind) {
  if (kind === 'Death') {
    const deathIcon = document.createElement('span');
    deathIcon.className = 'death-icon';
    deathIcon.setAttribute('aria-label', 'Death');
    deathIcon.textContent = '💀';
    return deathIcon;
  }

  const damageDownIcon = document.createElement('img');
  damageDownIcon.className = 'damage-down-icon';
  damageDownIcon.src = 'assets/damage-down.png';
  damageDownIcon.alt = 'Damage down';
  return damageDownIcon;
}

function getDancingMadPhase(elapsedMs) {
  let phase = 1;
  for (const [candidatePhase, startMs] of DANCING_MAD_PHASE_STARTS) {
    if (startMs > elapsedMs) {
      break;
    }
    phase = candidatePhase;
  }
  return phase;
}

function getDancingMadMechanic(elapsedMs, phase = null) {
  let latestMechanic = null;
  for (const mechanic of dancingMadMechanics) {
    if (Number(mechanic.elapsedSeconds) * 1000 >= elapsedMs) {
      break;
    }
    if (phase === null || Number(mechanic.phase) === phase) {
      latestMechanic = mechanic;
    }
  }

  return latestMechanic;
}

// Weekly cards are deliberately self-contained controls: their visible summary comes
// from report data, while activation feeds the shared detailed-report selection flow.
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
  codeLink.className = 'report-code';
  codeLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}`;
  codeLink.target = '_blank';
  codeLink.rel = 'noreferrer';
  codeLink.textContent = report.code;
  identity.append(title);

  const date = document.createElement('time');
  date.className = 'report-date';
  date.dateTime = new Date(report.startTime).toISOString();
  const reportDate = new Date(report.startTime);
  date.textContent = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(reportDate);

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

  article.append(identity, codeLink, pullCount, date, best);
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

  // The weekly summary treats progression as phase-first. Health and duration only
  // break ties within that phase; clears instead use the fastest completion.
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

function createBestPullBadge(pull, emptyLabel = 'No DMU pulls') {
  const badge = document.createElement('span');
  badge.className = `best-pull-badge ${getPullColorClass(pull)}`;

  const icon = document.createElement('span');
  icon.className = `best-pull-icon ${!pull ? 'no-pull-icon' : pull.kill ? 'clear-icon' : 'failure-icon'}`;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'best-pull-text';
  if (!pull) {
    text.textContent = emptyLabel;
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
