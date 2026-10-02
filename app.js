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
const MITIGATION_FILTER_STORAGE_KEY = 'berry-mitigation-filter';
const MITIGATION_SLOT_STORAGE_KEY = 'berry-mitigation-slot';
const LEGACY_SHOW_ON_TIME_STORAGE_KEY = 'berry-show-on-time-mitigations';
const DETAILS_VIEW_STORAGE_KEY = 'berry-details-view';
const MITIGATION_FILTER_MODES = new Set(['more-than-one', 'off-time', 'all']);
const DETAILS_VIEW_MODES = new Set(['timeline', 'table']);
const PARTY_SLOT_ORDER = ['MT', 'OT', 'H1', 'H2', 'M1', 'M2', 'R1', 'R2'];
const MITIGATION_ABILITY_ICON_URLS = new Map([
  [25862, './assets/ability-icons/002649_hr1.png'],
  [16536, './assets/ability-icons/002645_hr1.png'],
  [3569, './assets/ability-icons/002632_hr1.png'],
  [37011, './assets/ability-icons/002128_hr1.png'],
  [7433, './assets/ability-icons/002639_hr1.png'],
  [24298, './assets/ability-icons/003666_hr1.png'],
  [24310, './assets/ability-icons/003678_hr1.png'],
  [24311, './assets/ability-icons/003679_hr1.png'],
  [37035, './assets/ability-icons/003690_hr1.png'],
]);
const UNKNOWN_MITIGATION_ABILITY_ICON_URL = './assets/ability-icons/question-mark-status.png';

let currentUser = null;
let dancingMadMechanics = [];
let dancingMadMitigations = [];
let mitigationCooldowns = new Map();
let fightDetails = new Map();
let openFightDetailKeys = new Set();
let openFightMitigationKeys = new Set();
let reports = [];
let selectedDetailsView = loadDetailsViewMode();
let selectedReport = null;
let selectedReportPhase = 'all';
let mitigationFilterMode = loadMitigationFilterMode();
let selectedMitigationSlot = loadMitigationSlot();
let usingTestData = false;
let timelineCollisionFrame = null;
let fightPanelLayoutFrame = null;
const mitigationHistoryPromises = new Map();

// P1-P3 use stable encounter timings. P4 begins at a pull-specific cast, and the
// relative P4/P5 mechanic data is added only after that anchor has been observed.
const DANCING_MAD_FIXED_PHASE_STARTS = new Map([
  [1, 0],
  [2, 207_000],
  [3, 421_000],
]);
const DANCING_MAD_PHASE_FIVE_OFFSET_MS = 150_000;
const MITIGATION_GRACE_SECONDS = 20;
const JOB_ROLES = new Map([
  ['PLD', 'Tank'], ['WAR', 'Tank'], ['DRK', 'Tank'], ['GNB', 'Tank'],
  ['WHM', 'Healer'], ['SCH', 'Healer'], ['AST', 'Healer'], ['SGE', 'Healer'],
  ['MNK', 'Melee'], ['DRG', 'Melee'], ['NIN', 'Melee'], ['SAM', 'Melee'],
  ['RPR', 'Melee'], ['VPR', 'Melee'],
  ['BRD', 'Ranged'], ['MCH', 'Ranged'], ['DNC', 'Ranged'],
  ['BLM', 'Ranged'], ['SMN', 'Ranged'], ['RDM', 'Ranged'], ['PCT', 'Ranged'],
]);
const JOB_ABBREVIATIONS = new Map([
  ['Paladin', 'PLD'], ['Warrior', 'WAR'], ['DarkKnight', 'DRK'], ['Gunbreaker', 'GNB'],
  ['WhiteMage', 'WHM'], ['Scholar', 'SCH'], ['Astrologian', 'AST'], ['Sage', 'SGE'],
  ['Monk', 'MNK'], ['Dragoon', 'DRG'], ['Ninja', 'NIN'], ['Samurai', 'SAM'],
  ['Reaper', 'RPR'], ['Viper', 'VPR'], ['Bard', 'BRD'], ['Machinist', 'MCH'],
  ['Dancer', 'DNC'], ['BlackMage', 'BLM'], ['Summoner', 'SMN'],
  ['RedMage', 'RDM'], ['Pictomancer', 'PCT'],
]);

// Timeline positions travel through percentages before returning to pixels. Treat
// sub-hundredth-pixel drift as exact contact at the grouping boundary.
const TIMELINE_GROUP_EPSILON_PX = 0.01;
const TIMELINE_EVENT_COLLISION_WIDTH_PX = {
  'Damage down': 13,
  Death: 16,
};

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
    await loadDancingMadMitigations();
    await loadMitigationCooldowns();
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
        .map((report, reportIndex) => addTestMitigationCasts(report, payload.actors ?? [], reportIndex));
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
    openFightMitigationKeys = new Set();
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
  scheduleResponsiveFightPanelLayout();
}

// Every DMU fixture exercises the mitigation tracker. Cast timing rotates through a
// stable set of outcomes so screenshots and manual checks remain reproducible.
function addTestMitigationCasts(report, actors, reportIndex) {
  const friendlyPlayers = actors.filter((actor) => actor.type === 'Player').map((actor) => Number(actor.id));
  const actorNames = new Map(actors.map((actor) => [Number(actor.id), actor.name]));
  const playerByJob = new Map(actors
    .filter((actor) => actor.type === 'Player')
    .map((actor) => [normalizeJobAbbreviation(actor.subType ?? actor.job), actor]));
  const trackedAbilityIds = new Set(dancingMadMitigations.map((entry) => Number(entry.abilityId)));

  const fights = report.fights.map((fight) => {
    if (!isDmuPull(fight)) return fight;
    const durationMs = getFightDuration(fight);
    const retainedEvents = (fight.events ?? []).filter((event) => {
      const eventType = String(event.eventType ?? event.type ?? '').replace(/\s+/g, '').toLowerCase();
      const abilityId = Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id);
      return eventType !== 'cast' || !trackedAbilityIds.has(abilityId);
    });
    const phaseFourStartTimestamp = findDancingMadPhaseFourStart(retainedEvents, actorNames);
    const phaseFourOffsetMs = Number.isFinite(phaseFourStartTimestamp)
      ? phaseFourStartTimestamp - Number(fight.startTime)
      : null;
    const mitigationEvents = dancingMadMitigations.flatMap((mitigation, mitigationIndex) => {
      const sourcePlayer = playerByJob.get(normalizeJobAbbreviation(mitigation.class));
      if (!sourcePlayer) return [];
      const isPhaseFourRelative = mitigation.afterPhaseThree === true || Number(mitigation.phase) >= 4;
      if (isPhaseFourRelative && !Number.isFinite(phaseFourOffsetMs)) return [];
      const relativeAnchorMs = isPhaseFourRelative ? phaseFourOffsetMs : 0;
      const startMs = relativeAnchorMs + Number(mitigation.startElapsedSeconds) * 1000;
      const endMs = relativeAnchorMs + Number(mitigation.endElapsedSeconds) * 1000;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > durationMs) return [];

      const scenario = (reportIndex * 3 + Number(fight.id) + mitigationIndex) % 7;
      if (scenario === 0) return [];
      const castElapsedMs = scenario === 1
        ? startMs - 3_200
        : scenario === 2
          ? endMs + 2_200
          : scenario === 3
            ? startMs + 250
            : scenario === 4
              ? endMs + 400
              : scenario === 5
                ? (startMs + endMs) / 2
                : startMs - 350;
      if (castElapsedMs < 0 || castElapsedMs > durationMs) return [];
      return [{
        type: 'cast',
        abilityGameID: Number(mitigation.abilityId),
        sourceID: Number(sourcePlayer.id),
        timestamp: Number(fight.startTime) + castElapsedMs,
      }];
    });

    return {
      ...fight,
      friendlyPlayers,
      events: [...retainedEvents, ...mitigationEvents].sort((first, second) => Number(first.timestamp) - Number(second.timestamp)),
    };
  });
  return { ...report, fights, testActors: actors };
}

// Timeline labels and grouped event markers depend on their rendered pixel width,
// which is unavailable until the browser finishes layout. Queue one recalculation
// for the next frame and replace any older request caused by the same resize burst.
function scheduleResponsiveFightPanelLayout() {
  cancelAnimationFrame(fightPanelLayoutFrame);
  fightPanelLayoutFrame = requestAnimationFrame(() => {
    for (const panels of document.querySelectorAll('.fight-panels')) {
      panels.classList.remove('side-by-side');
      const detailsTable = panels.querySelector('.fight-details-table');
      const mitigationTable = panels.querySelector('.mitigation-table');
      if (!detailsTable || !mitigationTable) continue;
      const dividerSpace = 49;
      const requiredWidth = detailsTable.scrollWidth + mitigationTable.scrollWidth + dividerSpace;
      if (requiredWidth <= panels.clientWidth) {
        panels.classList.add('side-by-side');
        // Verify the completed grid too: loaded fonts and intrinsic table sizing can
        // make the actual pair wider than the preliminary measurements suggested.
        const panelBounds = panels.getBoundingClientRect();
        const detailsBounds = detailsTable.getBoundingClientRect();
        const mitigationBounds = mitigationTable.getBoundingClientRect();
        const overflows = detailsBounds.left < panelBounds.left - 1
          || mitigationBounds.right > panelBounds.right + 1;
        if (overflows || panels.scrollWidth > panels.clientWidth + 1) {
          panels.classList.remove('side-by-side');
        }
      }
    }
  });
}

window.addEventListener('resize', scheduleResponsiveFightPanelLayout);
document.fonts?.ready.then(scheduleResponsiveFightPanelLayout);

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

// Grouping uses the canvas's rendered width so collision geometry follows responsive
// layout. Both initial collisions and later border-driven absorption may chain.
function renderTimelineEventGroups() {
  for (const canvas of document.querySelectorAll('.fight-timeline-canvas')) {
    const sourceItems = canvas.timelineEventItems ?? [];
    canvas.querySelectorAll('.fight-timeline-event, .fight-timeline-event-member-preview')
      .forEach((marker) => marker.remove());
    if (sourceItems.length === 0 || canvas.clientWidth === 0) {
      continue;
    }

    const initialClusters = groupOverlappingTimelineEvents(sourceItems, canvas.clientWidth);
    const initialGroups = initialClusters
      .filter((items) => items.length > 1)
      .map((items) => ({ items, layout: calculateTimelineGroupLayout(items, canvas) }));
    const initialSingles = initialClusters.filter((items) => items.length === 1).map(([item]) => item);

    const groupComponents = initialGroups.map((group) => [group]);
    const absorbedSingles = new Set();
    let absorbedOrMerged = true;
    while (absorbedOrMerged) {
      absorbedOrMerged = false;

      // Recalculate after every merge: a wider combined border can touch another
      // group, allowing the requested group-to-group suction to propagate.
      for (let firstIndex = 0; firstIndex < groupComponents.length; firstIndex += 1) {
        const firstItems = groupComponents[firstIndex].flatMap((group) => group.items);
        const firstLayout = calculateTimelineGroupLayout(firstItems, canvas);
        for (let secondIndex = firstIndex + 1; secondIndex < groupComponents.length; secondIndex += 1) {
          const secondItems = groupComponents[secondIndex].flatMap((group) => group.items);
          const secondLayout = calculateTimelineGroupLayout(secondItems, canvas);
          if (timelineIntervalsTouch(firstLayout, secondLayout)) {
            groupComponents[firstIndex].push(...groupComponents[secondIndex]);
            groupComponents.splice(secondIndex, 1);
            absorbedOrMerged = true;
            break;
          }
        }
        if (absorbedOrMerged) {
          break;
        }
      }
      if (absorbedOrMerged) {
        continue;
      }

      // Absorb one single at a time, then restart with the expanded border. This
      // deliberately permits a newly sucked-in event to bring the next one within reach.
      for (const item of initialSingles) {
        if (absorbedSingles.has(item)) {
          continue;
        }
        const hitbox = getTimelineItemCollisionBounds(item, canvas.clientWidth);
        const component = groupComponents.find((groups) => {
          const items = groups.flatMap((group) => group.items);
          return timelineIntervalsTouch(calculateTimelineGroupLayout(items, canvas), hitbox);
        });
        if (component) {
          component.push({ items: [item], layout: hitbox });
          absorbedSingles.add(item);
          absorbedOrMerged = true;
          break;
        }
      }
    }

    const renderedItems = [
      ...groupComponents.map((component) => component.flatMap((group) => group.items)),
      ...initialSingles.filter((item) => !absorbedSingles.has(item)).map((item) => [item]),
    ].sort((first, second) => first[0].position - second[0].position);

    for (const componentItems of renderedItems) {
      if (componentItems.length === 1) {
        const item = componentItems[0];
        canvas.append(createTimelineEventMarker(item.event, item.mechanic, item.elapsedMs, item.position));
        continue;
      }
      const groups = createTimelineEventKindGroups(componentItems);
      const layout = calculateTimelineGroupLayout(componentItems, canvas);
      canvas.append(createTimelineEventGroupMarker(groups, layout, canvas));
    }
  }
}

function loadMitigationFilterMode() {
  try {
    const savedMode = localStorage.getItem(MITIGATION_FILTER_STORAGE_KEY);
    if (MITIGATION_FILTER_MODES.has(savedMode)) return savedMode;
    const legacyValue = localStorage.getItem(LEGACY_SHOW_ON_TIME_STORAGE_KEY);
    if (legacyValue === 'true') return 'all';
    if (legacyValue === 'false') return 'off-time';
  } catch {
    // Fall through to the most focused default when storage is unavailable.
  }
  return 'more-than-one';
}

function loadMitigationSlot() {
  try {
    const savedSlot = localStorage.getItem(MITIGATION_SLOT_STORAGE_KEY);
    if (PARTY_SLOT_ORDER.includes(savedSlot)) return savedSlot;
  } catch {
    // Fall through to H1 when storage is unavailable.
  }
  return 'H1';
}

function loadDetailsViewMode() {
  try {
    const savedMode = localStorage.getItem(DETAILS_VIEW_STORAGE_KEY);
    if (DETAILS_VIEW_MODES.has(savedMode)) return savedMode;
  } catch {
    // Fall through to timeline when storage is unavailable.
  }
  return 'timeline';
}

function setDetailsViewMode(mode) {
  if (!DETAILS_VIEW_MODES.has(mode)) return;
  selectedDetailsView = mode;
  try {
    localStorage.setItem(DETAILS_VIEW_STORAGE_KEY, mode);
  } catch {
    // Keep the preference active for this page when storage is unavailable.
  }
}

function setMitigationFilterMode(mode) {
  if (!MITIGATION_FILTER_MODES.has(mode)) return;
  mitigationFilterMode = mode;
  try {
    localStorage.setItem(MITIGATION_FILTER_STORAGE_KEY, mode);
    localStorage.removeItem(LEGACY_SHOW_ON_TIME_STORAGE_KEY);
  } catch {
    // Keep the preference active for this page when storage is unavailable.
  }
  document.querySelectorAll('.mitigation-tracker').forEach((tracker) => {
    const select = tracker.querySelector('.mitigation-filter-select');
    if (select) select.value = mode;
    applyMitigationResultFilter(tracker);
  });
}

// Keep the desktop tabs and compact select synchronized while preserving the
// requested party slot when the tracker switches responsive layouts.
function selectMitigationSlotInTracker(tracker, requestedSlot) {
  const slotSelect = tracker.querySelector('.mitigation-slot-select');
  if (!slotSelect) return;
  const availableSlots = [...slotSelect.options].map((option) => option.value);
  const selectedSlot = availableSlots.includes(requestedSlot) ? requestedSlot : availableSlots[0];
  if (!selectedSlot) return;

  slotSelect.value = selectedSlot;
  for (const tab of tracker.querySelectorAll('.mitigation-tab')) {
    const isSelected = tab.dataset.mitigationSlot === selectedSlot;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
  }
  for (const panel of tracker.querySelectorAll('.mitigation-panel')) {
    panel.hidden = panel.dataset.mitigationSlot !== selectedSlot;
  }
}

function setMitigationSlot(slot) {
  if (!PARTY_SLOT_ORDER.includes(slot)) return;
  selectedMitigationSlot = slot;
  try {
    localStorage.setItem(MITIGATION_SLOT_STORAGE_KEY, slot);
  } catch {
    // Keep the preference active for this page when storage is unavailable.
  }
  document.querySelectorAll('.mitigation-tracker').forEach((tracker) => {
    selectMitigationSlotInTracker(tracker, slot);
  });
}

// Load and normalize the encounter plan once so every pull evaluates the same
// chronologically ordered mitigation assignments.
async function loadDancingMadMitigations() {
  const response = await fetch('./fight-data/dancing-mad-mitigations.json');
  if (!response.ok) {
    throw new Error(`Dancing Mad mitigation data returned ${response.status}.`);
  }

  const mitigations = await response.json();
  dancingMadMitigations = mitigations
    .filter((entry) => Number.isFinite(Number(entry.abilityId))
      && Number.isFinite(Number(entry.startElapsedSeconds))
      && Number.isFinite(Number(entry.endElapsedSeconds))
      && PARTY_SLOT_ORDER.includes(entry.assignedTo))
    .sort((first, second) => Number(first.startElapsedSeconds) - Number(second.startElapsedSeconds));
}

async function loadMitigationCooldowns() {
  const response = await fetch('./fight-data/mitigation-cooldowns.json');
  if (!response.ok) {
    throw new Error(`Mitigation cooldown data returned ${response.status}.`);
  }
  const cooldowns = await response.json();
  mitigationCooldowns = new Map(Object.entries(cooldowns)
    .map(([abilityId, seconds]) => [Number(abilityId), Number(seconds)])
    .filter(([abilityId, seconds]) => Number.isFinite(abilityId) && Number.isFinite(seconds) && seconds >= 0));
}

// Convert timeline percentages into pixel hitboxes, then place touching deaths and
// damage downs into the same cluster. Every absorbed event can expand either edge,
// so repeatedly scan all remaining events until the cluster reaches a fixed point.
function groupOverlappingTimelineEvents(sourceItems, canvasWidth) {
  const remaining = sourceItems.map((item) => ({
    item,
    bounds: getTimelineItemCollisionBounds(item, canvasWidth),
  }));
  const clusters = [];

  while (remaining.length > 0) {
    const seed = remaining.shift();
    const cluster = [seed.item];
    let clusterLeft = seed.bounds.left;
    let clusterRight = seed.bounds.right;
    let absorbedItem = true;

    while (absorbedItem) {
      absorbedItem = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        if (!timelineIntervalsTouch(
          { left: clusterLeft, right: clusterRight },
          candidate.bounds,
        )) {
          continue;
        }

        cluster.push(candidate.item);
        clusterLeft = Math.min(clusterLeft, candidate.bounds.left);
        clusterRight = Math.max(clusterRight, candidate.bounds.right);
        remaining.splice(index, 1);
        absorbedItem = true;
      }
    }

    clusters.push(cluster.sort((first, second) => first.position - second.position));
  }

  return clusters.sort((first, second) => first[0].position - second[0].position);
}

function getTimelineItemCollisionBounds(item, canvasWidth) {
  const center = item.position / 100 * canvasWidth;
  const halfWidth = TIMELINE_EVENT_COLLISION_WIDTH_PX[item.event.kind] / 2;
  return { left: center - halfWidth, right: center + halfWidth };
}

function createTimelineEventKindGroups(items) {
  return ['Damage down', 'Death']
    .map((kind) => ({ kind, items: items.filter((item) => item.event.kind === kind) }))
    .filter((group) => group.items.length > 0);
}

// Calculate both kinds of geometry used by a grouped marker. `collisionLeft` and
// `collisionRight` decide which nearby events are absorbed; `left` and `right`
// describe the visible summary box, including its minimum content width.
function calculateTimelineGroupLayout(items, canvas) {
  const collisionBounds = items.map((item) => getTimelineItemCollisionBounds(item, canvas.clientWidth));
  const eventLeft = Math.min(...collisionBounds.map((bounds) => bounds.left));
  const eventRight = Math.max(...collisionBounds.map((bounds) => bounds.right));
  const eventWidth = eventRight - eventLeft;
  const groups = createTimelineEventKindGroups(items);
  const intrinsicWidth = measureTimelineGroupBoxWidth(groups, canvas);
  const expandsToEvents = eventWidth > intrinsicWidth;
  const center = expandsToEvents
    ? (eventLeft + eventRight) / 2
    : items.reduce((sum, item) => sum + item.position / 100 * canvas.clientWidth, 0) / items.length;
  const width = Math.max(eventWidth, intrinsicWidth);
  return {
    left: center - width / 2,
    right: center + width / 2,
    position: center / canvas.clientWidth * 100,
    width,
    expandsToEvents,
  };
}

function timelineIntervalsTouch(first, second) {
  return first.left <= second.right + TIMELINE_GROUP_EPSILON_PX
    && second.left <= first.right + TIMELINE_GROUP_EPSILON_PX;
}

function measureTimelineGroupBoxWidth(groups, canvas) {
  const box = createTimelineGroupSummaryBox(groups);
  box.style.position = 'absolute';
  box.style.visibility = 'hidden';
  canvas.append(box);
  const width = box.getBoundingClientRect().width;
  box.remove();
  return width;
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
  openFightMitigationKeys = new Set();
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
    setDetailsViewMode(selectedDetailsView === 'timeline' ? 'table' : 'timeline');
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

// Each fight card owns only summary UI. The details and mitigation panels have
// independent expansion state while sharing fetched event data for the same fight.
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
  const mitigationsOpen = openFightMitigationKeys.has(detailKey);
  const detailsButton = document.createElement('button');
  detailsButton.className = 'fight-details-button';
  detailsButton.type = 'button';
  detailsButton.textContent = detailsOpen ? 'Hide DD/death events' : 'Show DD/death events';
  detailsButton.setAttribute('aria-expanded', String(detailsOpen));
  detailsButton.addEventListener('click', () => toggleFightDetails(report, fight));
  const mitigationsButton = document.createElement('button');
  mitigationsButton.className = 'fight-details-button';
  mitigationsButton.type = 'button';
  mitigationsButton.textContent = mitigationsOpen ? 'Hide mits' : 'Show mits';
  mitigationsButton.setAttribute('aria-expanded', String(mitigationsOpen));
  mitigationsButton.addEventListener('click', () => toggleFightMitigations(report, fight));
  const fflogsLink = document.createElement('a');
  fflogsLink.href = `https://www.fflogs.com/reports/${encodeURIComponent(report.code)}?fight=${encodeURIComponent(fight.id)}`;
  fflogsLink.target = '_blank';
  fflogsLink.rel = 'noreferrer';
  fflogsLink.textContent = 'FFLogs';
  links.append(detailsButton, mitigationsButton, fflogsLink);
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
  meta.append(start, duration);
  if (isHighlighted) {
    const bestPullBadge = document.createElement('span');
    bestPullBadge.className = 'fight-best-pull-badge';
    bestPullBadge.textContent = '★';
    bestPullBadge.title = 'Best pull';
    bestPullBadge.setAttribute('role', 'img');
    bestPullBadge.setAttribute('aria-label', 'Best pull');
    meta.append(bestPullBadge);
  }
  meta.append(health);

  const bar = document.createElement('div');
  bar.className = `boss-health-bar${isHighlighted ? ' highlighted' : ''}`;
  const fill = document.createElement('div');
  fill.style.width = `${bossDamageDone}%`;
  bar.append(fill);
  card.append(top, meta, bar);
  if (analyzerLinks.childElementCount > 0) {
    card.append(analyzerLinks);
  }
  const detailsPanel = detailsOpen ? createFightDetailsPanel(fight, fightDetails.get(detailKey)) : null;
  const mitigationPanel = mitigationsOpen ? createFightMitigationPanel(report, fight, fightDetails.get(detailKey)) : null;
  if (detailsPanel && mitigationPanel) {
    const panels = document.createElement('div');
    panels.className = 'fight-panels';
    panels.append(detailsPanel, mitigationPanel);
    card.append(panels);
  } else if (detailsPanel) {
    card.append(detailsPanel);
  } else if (mitigationPanel) {
    card.append(mitigationPanel);
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
    openFightMitigationKeys = new Set();
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
  return toggleFightPanelWithLoadedState(report, fight, openFightDetailKeys);
}

async function toggleFightMitigations(report, fight) {
  return toggleFightPanelWithLoadedState(report, fight, openFightMitigationKeys);
}

// Open or close one fight subpanel. On first open, fetch and normalize the shared
// fight data; the caller-provided key set determines whether this is the details
// panel or mitigation panel without duplicating their loading and error handling.
async function toggleFightPanelWithLoadedState(report, fight, openPanelKeys) {
  const key = `${report.code}:${fight.id}`;
  if (openPanelKeys.has(key)) {
    openPanelKeys.delete(key);
    renderLookupResult();
    return;
  }

  openPanelKeys.add(key);
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
    const mitigationAbilityIds = [...new Set(dancingMadMitigations.map((entry) => Number(entry.abilityId)))];
    const rawDetails = await fetchFightEventDetails(report.code, fight.id, mitigationAbilityIds);
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
  const rawEvents = rawDetails?.events?.data ?? [];
  const phaseFourStartTimestamp = findDancingMadPhaseFourStart(rawEvents, actorNames);
  const partyMembers = normalizePartyMembers(actors, friendlyIds);
  const mitigationCasts = extractTrackedMitigationCasts(rawEvents, actorNames);
  const lifeEvents = extractPlayerLifeEvents(rawEvents);
  const events = rawEvents
    .filter(isDisplayedFightEvent)
    .filter((event) => friendlyIds.size === 0 || friendlyIds.has(Number(event.targetID)))
    .map((event) => ({
      kind: event.type === 'death' ? 'Death' : 'Damage down',
      player: actorNames.get(Number(event.targetID)) ?? event.targetName ?? `Actor ${event.targetID}`,
      timestamp: Number(event.timestamp),
    }));
  return { status: 'ready', events, phaseFourStartTimestamp, partyMembers, mitigationCasts, lifeEvents };
}

function normalizeEmbeddedFightDetails(report, fight) {
  const actorNames = new Map((report.testActors ?? []).map((actor) => [Number(actor.id), actor.name]));
  const friendlyIds = new Set((fight.friendlyPlayers ?? []).map(Number));
  const phaseFourStartTimestamp = findDancingMadPhaseFourStart(fight.events ?? [], actorNames);
  const partyMembers = normalizePartyMembers(report.testActors ?? [], friendlyIds);
  const mitigationCasts = extractTrackedMitigationCasts(fight.events ?? [], actorNames);
  const lifeEvents = extractPlayerLifeEvents(fight.events ?? []);
  const events = (fight.events ?? [])
    .filter(isDisplayedFightEvent)
    .filter((event) => friendlyIds.size === 0 || friendlyIds.has(Number(event.targetID)))
    .map((event) => ({
      kind: event.type === 'death' ? 'Death' : 'Damage down',
      player: actorNames.get(Number(event.targetID)) ?? event.targetName ?? `Actor ${event.targetID}`,
      timestamp: Number(event.timestamp),
    }));
  return { status: 'ready', events, phaseFourStartTimestamp, partyMembers, mitigationCasts, lifeEvents };
}

function extractPlayerLifeEvents(events) {
  return events
    .filter((event) => ['death', 'resurrect'].includes(String(event.type ?? event.eventType ?? '').toLowerCase()))
    .map((event) => ({
      type: String(event.type ?? event.eventType).toLowerCase(),
      playerId: Number(event.targetID ?? event.targetId),
      timestamp: Number(event.timestamp),
    }))
    .filter((event) => Number.isFinite(event.playerId) && Number.isFinite(event.timestamp))
    .sort((first, second) => first.timestamp - second.timestamp);
}

function normalizeJobAbbreviation(job) {
  const compactJob = String(job ?? '').replace(/\s+/g, '');
  return JOB_ABBREVIATIONS.get(compactJob) ?? compactJob.toUpperCase();
}

function normalizePartyMembers(actors, friendlyIds) {
  return actors
    .filter((actor) => actor.type === 'Player' && (friendlyIds.size === 0 || friendlyIds.has(Number(actor.id))))
    .map((actor) => {
      const job = normalizeJobAbbreviation(actor.subType ?? actor.job);
      return { id: Number(actor.id), name: actor.name, job, role: JOB_ROLES.get(job) ?? null };
    });
}

// Extract only configured mitigation casts from the much larger FFLogs event list.
// The returned records contain normalized timestamps, actor names, and ability IDs,
// so the evaluation code does not need to understand the raw API/test-data shapes.
function extractTrackedMitigationCasts(events, actorNames) {
  const trackedAbilityIds = new Set(dancingMadMitigations.map((entry) => Number(entry.abilityId)));
  return events
    .filter((event) => String(event.eventType ?? event.type ?? '').replace(/\s+/g, '').toLowerCase() === 'cast')
    .filter((event) => trackedAbilityIds.has(Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id)))
    .map((event) => ({
      abilityId: Number(event.abilityId ?? event.abilityGameID ?? event.ability?.id),
      sourceId: Number(event.sourceID ?? event.sourceId),
      source: event.source ?? event.sourceName ?? actorNames.get(Number(event.sourceID ?? event.sourceId)),
      timestamp: Number(event.timestamp),
    }))
    .filter((event) => Number.isFinite(event.timestamp));
}

function isDisplayedFightEvent(event) {
  return event.type === 'death'
    || (event.type === 'applydebuff' && Number(event.abilityGameID) === 1002911);
}

// Test fixtures use the analyzed-event field names from the CSV conversion, while
// live FFLogs data uses `begincast`, actor IDs, and a server-side ability-name filter.
function findDancingMadPhaseFourStart(events, actorNames) {
  const matchingTimestamps = events.flatMap((event) => {
    const eventType = String(event.eventType ?? event.type ?? '').replace(/\s+/g, '').toLowerCase();
    const ability = event.ability?.name ?? event.abilityName ?? event.ability;
    const source = event.source ?? event.sourceName ?? actorNames.get(Number(event.sourceID));
    const isFilteredLiveCast = eventType === 'begincast' && ability === undefined;
    const matches = eventType === 'begincast'
      && (ability === 'Kefka Says' || isFilteredLiveCast)
      && source === 'Kefka';
    const timestamp = Number(event.timestamp);
    return matches && Number.isFinite(timestamp) ? [timestamp] : [];
  });
  return matchingTimestamps.length > 0 ? Math.min(...matchingTimestamps) : null;
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
  const fightEvents = selectedDetailsView === 'table'
    ? createFightDetailsTable(fight, state)
    : createFightTimeline(fight, state);
  panel.replaceChildren(fightEvents);
  return panel;
}

function createFightMitigationPanel(report, fight, state) {
  const panel = document.createElement('div');
  panel.className = 'fight-mitigation-panel';
  if (!state || state.status === 'loading') {
    panel.textContent = 'Loading mitigation events...';
    return panel;
  }
  if (state.status === 'error') {
    panel.textContent = `Could not load mitigation events: ${state.error}`;
    return panel;
  }
  panel.replaceChildren(createMitigationTrackerView(report, fight, state));
  return panel;
}

// Build the complete mitigation-tracker UI for one pull. It creates one result
// panel per standard party slot (T1 through R2), provides desktop and compact
// navigation, and restores the user's persisted slot and result filter.
function createMitigationTrackerView(report, fight, state) {
  const tracker = document.createElement('section');
  tracker.className = 'mitigation-tracker';

  const header = document.createElement('div');
  header.className = 'mitigation-header';
  const heading = document.createElement('h4');
  heading.textContent = 'Mitigation tracker';
  const filterSelect = document.createElement('select');
  filterSelect.className = 'mitigation-filter-select';
  filterSelect.setAttribute('aria-label', 'Mitigation result filter');
  for (const [value, label] of [
    ['more-than-one', 'Only show >1s off'],
    ['off-time', 'Only show off-time'],
    ['all', 'Show all'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    filterSelect.append(option);
  }
  filterSelect.value = mitigationFilterMode;
  filterSelect.addEventListener('change', () => setMitigationFilterMode(filterSelect.value));
  header.append(heading, filterSelect);
  tracker.append(header);

  const assignedSlots = PARTY_SLOT_ORDER.filter((slot) =>
    dancingMadMitigations.some((mitigation) => mitigation.assignedTo === slot));
  if (assignedSlots.length === 0) {
    filterSelect.hidden = true;
    const empty = document.createElement('p');
    empty.className = 'mitigation-empty-state';
    empty.textContent = 'No mitigation assignments configured.';
    tracker.append(empty);
    return tracker;
  }

  const tabs = document.createElement('div');
  tabs.className = 'mitigation-tabs';
  tabs.setAttribute('role', 'tablist');
  const slotSelect = document.createElement('select');
  slotSelect.className = 'mitigation-slot-select';
  slotSelect.setAttribute('aria-label', 'Mitigation assignment');

  const initialSlot = assignedSlots.includes(selectedMitigationSlot)
    ? selectedMitigationSlot
    : assignedSlots[0];

  assignedSlots.forEach((slot) => {
    const tab = document.createElement('button');
    const panel = createPartySlotMitigationPanel(report, fight, state, slot);
    const selected = slot === initialSlot;
    const tabId = `mitigation-tab-${fight.id}-${slot}`;
    const panelId = `mitigation-panel-${fight.id}-${slot}`;
    tab.className = 'mitigation-tab';
    tab.type = 'button';
    tab.id = tabId;
    tab.textContent = slot;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panelId);
    tab.setAttribute('aria-selected', String(selected));
    tab.dataset.mitigationSlot = slot;
    tab.tabIndex = selected ? 0 : -1;
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.dataset.mitigationSlot = slot;
    panel.hidden = !selected;
    tab.addEventListener('click', () => setMitigationSlot(slot));
    const option = document.createElement('option');
    option.value = slot;
    option.textContent = slot;
    slotSelect.append(option);
    tabs.append(tab);
    tracker.append(panel);
  });
  slotSelect.value = initialSlot;
  slotSelect.addEventListener('change', () => setMitigationSlot(slotSelect.value));

  tracker.insertBefore(tabs, tracker.children[1]);
  tracker.insertBefore(slotSelect, tracker.children[2]);
  const resultRows = [...tracker.querySelectorAll('.mitigation-result')];
  filterSelect.hidden = !resultRows.some((row) => row.classList.contains('on-time')
    || (!row.classList.contains('missed') && Number(row.dataset.timingDeltaSeconds) <= 1));
  applyMitigationResultFilter(tracker);
  return tracker;
}

// Apply the selected result filter to every party-slot panel. A panel whose rows
// are all filtered out receives a visible explanation instead of becoming an
// unexplained blank area.
function applyMitigationResultFilter(tracker) {
  for (const panel of tracker.querySelectorAll('.mitigation-panel')) {
    const rows = [...panel.querySelectorAll('.mitigation-result')];
    if (rows.length === 0) continue;
    let visibleCount = 0;
    for (const row of rows) {
      const timingDeltaSeconds = Number(row.dataset.timingDeltaSeconds);
      const isOffTime = !row.classList.contains('on-time');
      const isMissed = row.classList.contains('missed');
      const isVisible = mitigationFilterMode === 'all'
        || (mitigationFilterMode === 'off-time' && isOffTime)
        || (mitigationFilterMode === 'more-than-one'
          && (isMissed || (isOffTime && timingDeltaSeconds > 1)));
      row.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    }

    const table = panel.querySelector('.mitigation-table');
    if (table) table.hidden = visibleCount === 0;
    let empty = panel.querySelector('.mitigation-filter-empty');
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'mitigation-filter-empty';
      panel.append(empty);
    }
    empty.hidden = visibleCount > 0;
    empty.textContent = mitigationFilterMode === 'more-than-one'
      ? 'No applicable mitigations were more than 1s off.'
      : 'All applicable mitigations were on time.';
  }
}

// Render the encounter plan and actual cast result for one logical party slot,
// such as T1 or H2. This is a view function; matching casts to assignments is
// delegated to `evaluatePartySlotMitigations`.
function createPartySlotMitigationPanel(report, fight, state, assignedTo) {
  const panel = document.createElement('div');
  panel.className = 'mitigation-panel';
  const classUnsupported = isPartySlotClassUnsupported(state, assignedTo);
  const results = classUnsupported ? [] : evaluatePartySlotMitigations(fight, state, assignedTo);
  if (results.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mitigation-empty-state';
    empty.textContent = classUnsupported
      ? `${assignedTo}'s class not supported.`
      : 'No applicable assignments before this pull ended.';
    panel.append(empty);
    return panel;
  }

  const table = document.createElement('table');
  table.className = 'mitigation-table';
  const head = document.createElement('thead');
  const headingRow = document.createElement('tr');
  for (const heading of ['Ability', 'Window', 'Result', 'Used', 'Player']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = heading;
    headingRow.append(cell);
  }
  head.append(headingRow);

  const body = document.createElement('tbody');
  for (const result of results) {
    const row = document.createElement('tr');
    row.className = `mitigation-result ${result.statusClass}`;
    row.dataset.timingDeltaSeconds = String(result.timingDeltaSeconds ?? 0);
    if (result.statusColor) row.style.setProperty('--timing-color', result.statusColor);
    const windowCell = document.createElement('td');
    windowCell.textContent = `${formatFightDuration(result.startMs)}–${formatFightDuration(result.endMs)}`;
    const abilityCell = document.createElement('td');
    const abilityName = result.mitigation.formalName || result.mitigation.ability;
    const abilityContent = document.createElement('span');
    abilityContent.className = 'mitigation-ability-content';
    const abilityLabel = document.createElement('span');
    abilityLabel.textContent = abilityName;
    abilityContent.append(createMitigationAbilityIcon(result.mitigation.abilityId, abilityName), abilityLabel);
    abilityCell.append(abilityContent);
    abilityCell.title = result.mitigation.ability;
    const playerCell = document.createElement('td');
    playerCell.textContent = `${result.player.name} (${result.player.job})`;
    const usedCell = document.createElement('td');
    usedCell.textContent = result.cast ? formatFightDuration(result.cast.elapsedMs) : '—';
    const statusCell = document.createElement('td');
    statusCell.className = 'mitigation-result-status';
    statusCell.append(createMitigationResultHistory(report, result));
    row.append(abilityCell, windowCell, statusCell, usedCell, playerCell);
    body.append(row);
  }
  table.append(head, body);
  panel.append(table);
  return panel;
}

function isPartySlotClassUnsupported(state, assignedTo) {
  const partyMembers = state.partyMembers ?? [];
  if (partyMembers.length === 0) return false;
  const slotAssignments = dancingMadMitigations.filter((mitigation) => mitigation.assignedTo === assignedTo);
  if (slotAssignments.length === 0) return false;
  const supportedJobs = new Set(slotAssignments.map((mitigation) =>
    normalizeJobAbbreviation(mitigation.class)));
  return !partyMembers.some((member) => supportedJobs.has(member.job));
}

function createMitigationResultHistory(report, result) {
  const anchor = document.createElement('span');
  anchor.className = 'mitigation-result-history-anchor';
  anchor.tabIndex = 0;
  anchor.textContent = result.status;
  anchor.setAttribute('aria-label', `${result.status}. Show result history.`);

  const tooltip = document.createElement('span');
  tooltip.className = 'mitigation-result-history-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.textContent = 'Loading pull history…';
  anchor.append(tooltip);

  let requested = false;
  const populate = async () => {
    if (requested) return;
    requested = true;
    try {
      const rows = await loadMitigationResultHistory(report, result.mitigation);
      tooltip.replaceChildren(createMitigationHistoryTable(rows));
    } catch (error) {
      tooltip.textContent = `Could not load pull history: ${error.message}`;
    }
  };
  anchor.addEventListener('mouseenter', populate, { once: true });
  anchor.addEventListener('focus', populate, { once: true });
  return anchor;
}

function createMitigationHistoryTable(rows) {
  if (rows.length === 0) {
    const empty = document.createElement('span');
    empty.textContent = 'No pulls reached this assignment.';
    return empty;
  }
  const table = document.createElement('table');
  table.className = 'mitigation-history-table';
  const headRow = document.createElement('tr');
  for (const label of ['Pull', 'Badge', 'Result']) {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = label;
    headRow.append(heading);
  }
  const head = document.createElement('thead');
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tableRow = document.createElement('tr');
    const pullCell = document.createElement('td');
    pullCell.textContent = String(row.fight.id);
    const badgeCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `mitigation-history-badge ${getPullColorClass(row.fight)}`;
    badge.textContent = row.fight.kill ? 'CLR' : row.fight.lastPhaseIsIntermission
      ? `I${Number(row.fight.lastPhase) || 1}`
      : `P${Number(row.fight.lastPhase) || 1}`;
    badgeCell.append(badge);
    const resultCell = document.createElement('td');
    resultCell.className = `mitigation-history-result ${row.result.statusClass}`;
    resultCell.textContent = row.result.status;
    if (row.result.statusColor) resultCell.style.setProperty('--timing-color', row.result.statusColor);
    tableRow.append(pullCell, badgeCell, resultCell);
    body.append(tableRow);
  }
  table.append(head, body);
  return table;
}

function mitigationIdentity(mitigation) {
  return [mitigation.assignedTo, mitigation.abilityId, mitigation.phase ?? '', mitigation.afterPhaseThree === true,
    mitigation.startElapsedSeconds, mitigation.endElapsedSeconds].join(':');
}

async function loadMitigationResultHistory(report, mitigation) {
  const cacheKey = `${report.code}:${mitigationIdentity(mitigation)}`;
  if (!mitigationHistoryPromises.has(cacheKey)) {
    mitigationHistoryPromises.set(cacheKey, (async () => {
      const rows = [];
      for (const fight of report.fights ?? []) {
        if (Number(fight.encounterID) !== DMU_ENCOUNTER_ID) continue;
        const detailKey = `${report.code}:${fight.id}`;
        let state = fightDetails.get(detailKey);
        if (!state || state.status !== 'ready') {
          if (usingTestData) {
            state = normalizeEmbeddedFightDetails(report, fight);
          } else {
            const abilityIds = [...new Set(dancingMadMitigations.map((entry) => Number(entry.abilityId)))];
            state = normalizeFightDetails(await fetchFightEventDetails(report.code, fight.id, abilityIds));
          }
          fightDetails.set(detailKey, state);
        }
        const result = evaluatePartySlotMitigations(fight, state, mitigation.assignedTo)
          .find((entry) => mitigationIdentity(entry.mitigation) === mitigationIdentity(mitigation));
        if (result) rows.push({ fight, result });
      }
      return rows.sort((first, second) => Number(first.fight.id) - Number(second.fight.id));
    })());
  }
  return mitigationHistoryPromises.get(cacheKey);
}

function createMitigationAbilityIcon(abilityId, abilityName) {
  const icon = document.createElement('span');
  icon.className = 'mitigation-ability-icon';
  const iconUrl = MITIGATION_ABILITY_ICON_URLS.get(Number(abilityId))
    ?? UNKNOWN_MITIGATION_ABILITY_ICON_URL;

  const image = document.createElement('img');
  image.src = iconUrl;
  image.alt = '';
  image.loading = 'lazy';
  if (!MITIGATION_ABILITY_ICON_URLS.has(Number(abilityId))) {
    icon.setAttribute('aria-label', `Unknown ability icon for ${abilityName}`);
  }
  image.addEventListener('error', () => icon.replaceChildren(), { once: true });
  icon.append(image);
  return icon;
}

// Compare one party slot's planned mitigation windows with that player's actual
// casts. Each cast can satisfy at most one assignment; the nearest eligible unused
// cast is marked on-time, early, or late, and an unmatched assignment is missing.
function evaluatePartySlotMitigations(fight, state, assignedTo) {
  const durationMs = getFightDuration(fight);
  const partySlots = mapPartyMembersToPlanSlots(state.partyMembers ?? []);
  const phaseStarts = calculateDancingMadPhaseStarts(fight, state.phaseFourStartTimestamp);
  const usedCastIndexes = new Set();
  const results = [];

  for (const mitigation of dancingMadMitigations.filter((entry) => entry.assignedTo === assignedTo)) {
    const requiredJob = normalizeJobAbbreviation(mitigation.class);
    const assignedPlayer = partySlots.get(assignedTo);
    const player = requiredJob
      ? (assignedPlayer?.job === requiredJob
        ? assignedPlayer
        : (state.partyMembers ?? []).find((member) => member.job === requiredJob))
      : assignedPlayer;
    if (!player) continue;

    const phase = Number(mitigation.phase);
    const isPhaseFourRelative = mitigation.afterPhaseThree === true || phase >= 4;
    const relativeAnchorMs = isPhaseFourRelative ? phaseStarts.get(4) : 0;
    if (isPhaseFourRelative && !Number.isFinite(relativeAnchorMs)) continue;
    const startMs = relativeAnchorMs + Number(mitigation.startElapsedSeconds) * 1000;
    const endMs = relativeAnchorMs + Number(mitigation.endElapsedSeconds) * 1000;
    if (startMs > durationMs) continue;

    const earliestMs = startMs - MITIGATION_GRACE_SECONDS * 1000;
    const latestMs = endMs + MITIGATION_GRACE_SECONDS * 1000;
    const candidates = (state.mitigationCasts ?? [])
      .map((cast, index) => ({ ...cast, index, elapsedMs: cast.timestamp - Number(fight.startTime) }))
      .filter((cast) => !usedCastIndexes.has(cast.index)
        && cast.abilityId === Number(mitigation.abilityId)
        && (cast.sourceId === player.id || cast.source === player.name)
        && cast.elapsedMs >= earliestMs
        && cast.elapsedMs <= latestMs)
      .sort((first, second) => mitigationCastDistance(first.elapsedMs, startMs, endMs)
        - mitigationCastDistance(second.elapsedMs, startMs, endMs));
    const cast = candidates[0] ?? null;
    if (cast) usedCastIndexes.add(cast.index);

    let status = 'Missed';
    let statusClass = 'missed';
    let statusColor = '#fb7185';
    let timingDeltaSeconds = null;
    if (cast && cast.elapsedMs < startMs) {
      const deltaSeconds = (startMs - cast.elapsedMs) / 1000;
      timingDeltaSeconds = deltaSeconds;
      status = `${formatMitigationDelta(deltaSeconds)} early`;
      statusClass = 'early';
      statusColor = getMitigationTimingStatusColor(deltaSeconds, 'early');
    } else if (cast && cast.elapsedMs > endMs) {
      const deltaSeconds = (cast.elapsedMs - endMs) / 1000;
      timingDeltaSeconds = deltaSeconds;
      status = `${formatMitigationDelta(deltaSeconds)} late`;
      statusClass = 'late';
      statusColor = getMitigationTimingStatusColor(deltaSeconds, 'late');
    } else if (cast) {
      timingDeltaSeconds = 0;
      status = 'On time';
      statusClass = 'on-time';
      statusColor = '#34d399';
    } else if (isPlayerDeadAt(
      state.lifeEvents ?? [],
      state.mitigationCasts ?? [],
      player,
      Number(fight.startTime) + endMs,
    )) {
      status = 'Dead';
      statusClass = 'missed dead';
    } else if (isMitigationOnCooldown(state.mitigationCasts ?? [], mitigation, player, fight, endMs)) {
      status = 'On cooldown';
      statusClass = 'missed on-cooldown';
    }

    results.push({
      mitigation,
      player,
      startMs,
      endMs,
      cast,
      status,
      statusClass,
      statusColor,
      timingDeltaSeconds,
    });
  }
  return results;
}

function isPlayerDeadAt(lifeEvents, casts, player, timestamp) {
  const lifeTransitions = lifeEvents
    .filter((event) => event.playerId === Number(player.id) && event.timestamp <= timestamp);
  const proofOfLife = casts
    .filter((cast) => (cast.sourceId === Number(player.id) || cast.source === player.name)
      && cast.timestamp <= timestamp)
    .map((cast) => ({ type: 'alive', timestamp: cast.timestamp }));
  const latest = [...lifeTransitions, ...proofOfLife]
    .sort((first, second) => first.timestamp - second.timestamp)
    .at(-1);
  return latest?.type === 'death';
}

function isMitigationOnCooldown(casts, mitigation, player, fight, windowEndMs) {
  const cooldownSeconds = mitigationCooldowns.get(Number(mitigation.abilityId));
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds <= 0) return false;
  const fightStart = Number(fight.startTime);
  const previousCast = casts
    .filter((cast) => cast.abilityId === Number(mitigation.abilityId)
      && (cast.sourceId === player.id || cast.source === player.name)
      && cast.timestamp - fightStart < windowEndMs)
    .sort((first, second) => second.timestamp - first.timestamp)[0];
  if (!previousCast) return false;
  return previousCast.timestamp - fightStart + cooldownSeconds * 1000 > windowEndMs;
}

// Map real party members onto the encounter plan's role slots. Members keep API
// order within each role, making duplicate tanks, healers, melee, and ranged jobs
// resolve deterministically to labels such as T1, H2, M1, and R2.
function mapPartyMembersToPlanSlots(partyMembers) {
  const slots = new Map();
  const roleSlots = new Map([
    ['Tank', ['MT', 'OT']],
    ['Healer', ['H1', 'H2']],
    ['Melee', ['M1', 'M2']],
    ['Ranged', ['R1', 'R2']],
  ]);
  for (const [role, availableSlots] of roleSlots) {
    partyMembers.filter((member) => member.role === role).slice(0, 2)
      .forEach((member, index) => slots.set(availableSlots[index], member));
  }
  return slots;
}

function mitigationCastDistance(elapsedMs, startMs, endMs) {
  if (elapsedMs < startMs) return startMs - elapsedMs;
  if (elapsedMs > endMs) return elapsedMs - endMs;
  return 0;
}

function formatMitigationDelta(seconds) {
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
}

// Convert an early/late offset into the status color shown beside a cast. Early
// casts receive a wider warning ramp because their effects may still overlap the
// mechanic, while late casts reach red sooner because mitigation arrived too late.
function getMitigationTimingStatusColor(seconds, timing) {
  const green = [52, 211, 153];
  const yellowGreen = [163, 230, 53];
  const yellow = [251, 191, 36];
  const red = [239, 68, 68];
  const greenLimit = timing === 'early' ? 0.5 : 0;
  if (seconds <= greenLimit) return rgbColor(green);
  if (seconds <= 1.5) return interpolateColor(green, yellowGreen, (seconds - greenLimit) / (1.5 - greenLimit));
  if (seconds <= 2.5) return interpolateColor(yellowGreen, yellow, seconds - 1.5);
  if (seconds <= 4) return interpolateColor(yellow, red, (seconds - 2.5) / 1.5);
  return rgbColor(red);
}

function interpolateColor(start, end, progress) {
  const amount = Math.max(0, Math.min(1, progress));
  return rgbColor(start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount)));
}

function rgbColor(channels) {
  return `rgb(${channels.join(', ')})`;
}

function createFightDetailsTable(fight, state) {
  const { events } = state;
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
  for (const heading of ['Time', 'Event', 'Mechanic', 'Player']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = heading;
    headingRow.append(cell);
  }
  head.append(headingRow);

  const body = document.createElement('tbody');
  const phaseStarts = calculateDancingMadPhaseStarts(fight, state.phaseFourStartTimestamp);
  for (const event of events) {
    const elapsedMs = Math.max(0, Number(event.timestamp) - Number(fight.startTime));
    const eventPhase = getDancingMadPhase(elapsedMs, phaseStarts);
    const mechanic = getDancingMadMechanic(elapsedMs, phaseStarts, eventPhase);
    const row = document.createElement('tr');
    const timeCell = document.createElement('td');
    timeCell.textContent = formatFightDuration(elapsedMs);
    const eventCell = document.createElement('td');
    eventCell.append(createFightEventIcon(event.kind));
    const mechanicCell = document.createElement('td');
    mechanicCell.textContent = mechanic ? `P${mechanic.phase}.${mechanic.mechanic}` : '—';
    const playerCell = document.createElement('td');
    playerCell.textContent = event.player;
    row.append(timeCell, eventCell, mechanicCell, playerCell);
    body.append(row);
  }

  table.append(head, body);
  return table;
}

function createFightTimeline(fight, state) {
  const { events } = state;
  const timeline = document.createElement('div');
  timeline.className = 'fight-timeline';
  const durationMs = getFightDuration(fight);
  const phaseStarts = calculateDancingMadPhaseStarts(fight, state.phaseFourStartTimestamp);
  const finalAvailablePhase = phaseStarts.has(4) ? 5 : 3;
  const endingPhase = Math.min(finalAvailablePhase, Math.max(1, Number(fight.lastPhase) || 1));
  const eqMechanic = dancingMadMechanics.find((mechanic) => mechanic.mechanic.startsWith('EQ'));
  const eqTimestampMs = Number(eqMechanic?.elapsedSeconds) * 1000;
  const splitLongPhaseThree = durationMs >= 600_000 && Number.isFinite(eqTimestampMs);
  const phaseSegments = [];

  for (let phase = 1; phase <= endingPhase; phase += 1) {
    const phaseStart = Math.min(durationMs, phaseStarts.get(phase) ?? durationMs);
    const nextKnownStart = phaseStarts.get(phase + 1);
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
      const mechanicMs = getDancingMadMechanicTimestamp(mechanic, phaseStarts);
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
      const eventPhase = getDancingMadPhase(elapsedMs, phaseStarts);
      const mechanic = getDancingMadMechanic(elapsedMs, phaseStarts, eventPhase);
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

function createTimelineEventGroupMarker(groups, layout, canvas) {
  const marker = document.createElement('span');
  marker.className = 'fight-timeline-event grouped';
  marker.tabIndex = 0;
  marker.style.left = `${layout.position}%`;
  marker.setAttribute('aria-label', groups
    .map((group) => `${group.items.length} ${group.kind.toLowerCase()} events`)
    .join(' and '));

  const box = createTimelineGroupSummaryBox(groups);
  // The collision layout may span every constituent hitbox for suction purposes,
  // while the visible summary border deliberately remains at its intrinsic width.

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
  tooltip.className = `fight-timeline-tooltip fight-timeline-group-tooltip${layout.position < 18 ? ' align-start' : layout.position > 82 ? ' align-end' : ''}`;
  const table = document.createElement('table');
  table.className = 'fight-timeline-group-table';
  const head = document.createElement('thead');
  const headingRow = document.createElement('tr');
  // Mirror the regular details table so both views preserve the same reading order.
  for (const label of ['Time', 'Event', 'Mechanic', 'Player']) {
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
    const event = document.createElement('td');
    event.append(createFightEventIcon(kind));
    const mechanic = document.createElement('td');
    mechanic.textContent = item.mechanic?.mechanic || 'Before first mechanic';
    const player = document.createElement('td');
    player.textContent = item.event.player;
    row.append(time, event, mechanic, player);
    body.append(row);
  }
  table.append(head, body);
  tooltip.append(table);

  marker.append(box, tooltip);
  enableAdaptiveTimelineTooltip(marker);
  return marker;
}

// Create the small boxed icon/count summary for one collision cluster. Mixed
// clusters show separate death and damage-down counts; hover/pin details are built
// by the parent marker from the original ungrouped events.
function createTimelineGroupSummaryBox(groups) {
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
  return box;
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

// Return the absolute elapsed-time boundary for every encounter phase. Phases 1-3
// use known fixed timings; phase 4 begins at a cast detected in this specific pull
// and is clamped to its duration so short pulls cannot create impossible geometry.
function calculateDancingMadPhaseStarts(fight, phaseFourStartTimestamp) {
  const phaseStarts = new Map(DANCING_MAD_FIXED_PHASE_STARTS);
  if (Number.isFinite(phaseFourStartTimestamp)) {
    const phaseFourStartMs = Math.max(0, phaseFourStartTimestamp - Number(fight.startTime));
    phaseStarts.set(4, phaseFourStartMs);
    phaseStarts.set(5, phaseFourStartMs + DANCING_MAD_PHASE_FIVE_OFFSET_MS);
  }
  return phaseStarts;
}

function getDancingMadPhase(elapsedMs, phaseStarts) {
  let phase = 1;
  for (const [candidatePhase, startMs] of phaseStarts) {
    if (startMs > elapsedMs) {
      break;
    }
    phase = candidatePhase;
  }
  return phase;
}

function getDancingMadMechanicTimestamp(mechanic, phaseStarts) {
  const phase = Number(mechanic.phase);
  const relativeMs = Number(mechanic.elapsedSeconds) * 1000;
  return phase >= 4 ? (phaseStarts.get(4) ?? Number.POSITIVE_INFINITY) + relativeMs : relativeMs;
}

function getDancingMadMechanic(elapsedMs, phaseStarts, phase = null) {
  let latestMechanic = null;
  for (const mechanic of dancingMadMechanics) {
    if (phase !== null && Number(mechanic.phase) !== phase) continue;
    if (getDancingMadMechanicTimestamp(mechanic, phaseStarts) >= elapsedMs) continue;
    if (!latestMechanic
      || getDancingMadMechanicTimestamp(mechanic, phaseStarts)
        > getDancingMadMechanicTimestamp(latestMechanic, phaseStarts)) latestMechanic = mechanic;
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
