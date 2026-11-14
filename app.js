import {
  clearFflogsSession,
  completeFflogsLogin,
  isLoggedInToFflogs,
  startFflogsLogin,
} from './src/auth.js';
import { DMU_ENCOUNTER_ID } from './src/config.js';
import { findCauseOfDeath } from './fight-data/dancing-mad-death-causes.js';
import {
  collectFflogsEventPages,
  fetchCurrentFflogsUser,
  fetchFightEventDetails,
  fetchReportByCode,
  fetchWeeklyReports,
} from './src/fflogs.js';
import { parseFflogsReportCode } from './src/report-search.js';
import { createReportController } from './src/report-controller.js';
import {
  formatFightDuration,
  formatFightStartTime,
  formatReportDate,
  formatReportDateRange,
} from './src/format.js';
import { createExternalLink, createLinkGroup, createMetric } from './src/render.js';
import { createEncounterTiming } from './src/encounter-timing.js';
import { createFightDetailsCache } from './src/fight-details-cache.js';
import { createFightDetailsController } from './src/fight-details-controller.js';
import { createFightDataLoader } from './src/fight-data-loader.js';
import { createDetailedReportViewModule } from './src/detailed-report-view.js';
import { createFightDetailsNormalizer } from './src/fight-details-normalizer.js';
import { createFightEventExtractors } from './src/fight-event-extractors.js';
import {
  createFightEventView,
  getFflogsAbilityIconUrl,
  isUnknownFflogsStatus,
} from './src/fight-event-view.js';
import { createMitigationHistory } from './src/mitigation-history.js';
import { createMitigationCore } from './src/mitigation-core.js';
import { createMitigationTracker } from './src/mitigation-tracker.js';
import {
  createBestPullBadge,
  getBestDmuPull,
  getFightDuration,
  getPullColorClass,
  isDmuPull,
  normalizeBossHealth,
} from './src/fight-summary.js';
import { createTimelineLayout } from './src/timeline-layout.js';
import { createTimelineInteractions } from './src/timeline-interactions.js';
import { createTestReportData } from './src/test-report-data.js';
import { createUiPreferences } from './src/ui-preferences.js';
import {
  createPlayerActionsOverview,
  isPlayerActionSpeedStatus,
} from './src/player-actions-overview.js';
import { createGroupingScenarioReport } from './test-data/grouping-scenarios.js';
import { createOneEventPageReport } from './test-data/pagination-scenarios.js';

const elements = {
  accountName: document.querySelector('#accountName'),
  authButton: document.querySelector('#authButton'),
  authState: document.querySelector('#authState'),
  detailsViewButton: document.querySelector('#detailsViewButton'),
  detailsViewControl: document.querySelector('#detailsViewControl'),
  detailsViewLabel: document.querySelector('#detailsViewLabel'),
  loadReportButton: document.querySelector('#loadReportButton'),
  lookupResult: document.querySelector('#lookupResult'),
  lookupStatus: document.querySelector('#lookupStatus'),
  recentReportCodes: document.querySelector('#recentReportCodes'),
  refreshReportsButton: document.querySelector('#refreshReportsButton'),
  reportCount: document.querySelector('#reportCount'),
  reportSearchForm: document.querySelector('#reportSearchForm'),
  reportSearchInput: document.querySelector('#reportSearchInput'),
  reportsList: document.querySelector('#reportsList'),
  reportsStatus: document.querySelector('#reportsStatus'),
  statusLine: document.querySelector('#statusLine'),
  testDataButton: document.querySelector('#testDataButton'),
  themeToggleButton: document.querySelector('#themeToggleButton'),
};
const FIGHT_EVENT_TABLE_HEADINGS = ['Time', 'Event', 'Mechanic', 'Player'];
const FIGHT_EVENT_DEBUFFS_TOOLTIP = 'Displays the debuffs on the caster and player.';
const FIGHT_EVENT_BUFFS_TOOLTIP = 'Displays the buffs on the player.';
const UNKNOWN_DEATH_REASON_TOOLTIP = 'No listed cause of death from FFLogs, most likely falling off';
const DEATH_REASON_DAMAGE_LOOKBACK_MS = 2_500;
const FIGHT_EVENT_RECAP_LOOKBACK_MS = 60_000;
const FIGHT_EVENT_RECAP_MAX_ROWS = 100;
// FFLogs encodes consumables as large pseudo-action IDs (for example, HQ
// tinctures in the 34-million range). They are not rows in XIVAPI's Action
// sheet, and including one makes XIVAPI reject the entire bulk request.
const FFLOGS_PSEUDO_ACTION_ID_MIN = 10_000_000;
const TANK_FORTY_PERCENT_BUFFS = new Set(['Guardian', 'Damnation', 'Shadowed Vigil', 'Great Nebula']);
const PARTY_SLOT_ORDER = ['MT', 'OT', 'H1', 'H2', 'M1', 'M2', 'R1', 'R2'];
const DANCING_MAD_ENCOUNTER_NAME = 'Dancing Mad';
const UNKNOWN_MITIGATION_ABILITY_ICON_URL = './assets/ability-icons/question-mark-status.png';
const CHECK_REPORTS_TOOLTIP = "Only checks for new reports—doesn't update existing ones. Hold Shift to reload the cache for each report.";
const RELOAD_REPORTS_TOOLTIP = 'Reloads the cache for all reports. Warning—this consumes more account usage than only checking for new reports. (release Shift to only check for new reports)';
const CHECK_PULLS_TOOLTIP = "Only checks for new pulls—doesn't update existing ones. Hold Shift to reload the cache for all pulls.";
const RELOAD_PULLS_TOOLTIP = 'Reloads the cache for all pulls. Warning—this consumes more account usage than only checking for new pulls. (release Shift to only check for new pulls)';

const {
  loadDetailsTableVisibility,
  loadMitigationFilterMode,
  loadMitigationSlot,
  renderDetailsViewControl,
  setDetailsTableVisibility,
  setMitigationFilterMode,
  setMitigationSlot,
} = createUiPreferences({
  PARTY_SLOT_ORDER,
  applyMitigationResultFilter: (...args) => applyMitigationResultFilter(...args),
  elements,
  getIsDetailsTableVisible: () => isDetailsTableVisible,
  setIsDetailsTableVisible: (value) => { isDetailsTableVisible = value; },
  setMitigationFilterModeState: (value) => { mitigationFilterMode = value; },
  setSelectedMitigationSlot: (value) => { selectedMitigationSlot = value; },
  updateWithSmoothHeight: (...args) => updateWithSmoothHeight(...args),
});

let currentUser = null;
let encounterPhaseDefinitions = new Map();
let dancingMadMechanics = [];
let dancingMadMitigations = [];
let mitigationAbilitiesById = new Map();
let mitigationAbilitiesByName = new Map();
// Pull-specific display override only. This intentionally never touches localStorage
// because a tank swap in one pull should not change any other pull or later visit.
const swappedTankAssignmentsByFight = new Map();
let mitigationCooldowns = new Map();
let fightDetails = new Map();
let openFightDetailKeys = new Set();
let openFightMitigationKeys = new Set();
let reports = [];
let isDetailsTableVisible = loadDetailsTableVisibility();
let selectedReport = null;
let selectedReportPhase = 'all';
let mitigationFilterMode = loadMitigationFilterMode();
let selectedMitigationSlot = loadMitigationSlot();
let usingTestData = false;
const mitigationHistoryPromises = new Map();
const fightDetailsCache = createFightDetailsCache();
let isRefreshingWeeklyReports = false;
let isShiftHeld = false;
const MITIGATION_GRACE_SECONDS = 20;

const {
  loadDancingMadMechanics,
  loadDancingMadMitigations,
  loadEncounterPhaseDefinitions,
  loadMitigationAbilities,
  loadMitigationCooldowns,
} = createFightDataLoader({
  PARTY_SLOT_ORDER,
  getMitigationAbilitiesByName: () => mitigationAbilitiesByName,
  setDancingMadMechanics: (value) => { dancingMadMechanics = value; },
  setDancingMadMitigations: (value) => { dancingMadMitigations = value; },
  setEncounterPhaseDefinitions: (value) => { encounterPhaseDefinitions = value; },
  setMitigationAbilities: (byId, byName) => {
    mitigationAbilitiesById = byId;
    mitigationAbilitiesByName = byName;
  },
  setMitigationCooldowns: (value) => { mitigationCooldowns = value; },
});

const {
  getDancingMadMechanic,
  getDancingMadPhase,
  getEncounterEventReferences,
  getEncounterRelativeTimestamp,
  normalizeEventType,
  resolveEncounterPhaseStarts,
} = createEncounterTiming({
  getDefinitions: () => encounterPhaseDefinitions,
  getMechanics: () => dancingMadMechanics,
});

const {
  clearReportFightDetailsCache,
  createFightDetailsPanel,
  discardChangedFightDetails,
  ensureReportFightDetails,
  getEventAbilityName,
  getFightDetailsCacheVersion,
  getFightFingerprint,
  reloadFightDetails,
  toggleFightDetails,
  toggleFightMitigations,
} = createFightDetailsController({
  DANCING_MAD_ENCOUNTER_NAME,
  createFightDetailsTable: (...args) => createFightDetailsTable(...args),
  createFightTimeline: (...args) => createFightTimeline(...args),
  fetchFightEventDetails,
  fightDetailsCache,
  getEncounterEventReferences,
  getFightDetails: () => fightDetails,
  getIsDetailsTableVisible: () => isDetailsTableVisible,
  getMitigationHistoryPromises: () => mitigationHistoryPromises,
  getOpenFightDetailKeys: () => openFightDetailKeys,
  getOpenFightMitigationKeys: () => openFightMitigationKeys,
  getTrackedMitigations: () => dancingMadMitigations,
  getUsingTestData: () => usingTestData,
  normalizeEmbeddedFightDetails: (...args) => normalizeEmbeddedFightDetails(...args),
  normalizeFightDetails: (...args) => normalizeFightDetails(...args),
  renderLookupResult: (...args) => renderLookupResult(...args),
  setLookupStatus: (...args) => setLookupStatus(...args),
});

const {
  initialize,
  refreshWeeklyReports,
  reloadSelectedReport,
  renderReports,
  searchForReport,
  toggleTestData,
  updateRefreshReportsButton,
  updateSelectedReportReloadButton,
  updateShiftSensitiveButtons,
} = createReportController({
  CHECK_PULLS_TOOLTIP,
  CHECK_REPORTS_TOOLTIP,
  RELOAD_PULLS_TOOLTIP,
  RELOAD_REPORTS_TOOLTIP,
  addTestMitigationCasts: (...args) => addTestMitigationCasts(...args),
  clearReportFightDetailsCache,
  clearSpecialHardcodedViewState: (...args) => clearSpecialHardcodedViewState(...args),
  completeFflogsLogin,
  createBestPullBadge,
  createGroupingScenarioReport,
  createOneEventPageReport,
  discardChangedFightDetails,
  elements,
  fetchCurrentFflogsUser,
  fetchReportByCode,
  fetchWeeklyReports,
  getBestDmuPull,
  getCurrentUser: () => currentUser,
  getDancingMadMitigations: () => dancingMadMitigations,
  getIsRefreshingWeeklyReports: () => isRefreshingWeeklyReports,
  getIsShiftHeld: () => isShiftHeld,
  getReports: () => reports,
  getSelectedReport: () => selectedReport,
  getUsingTestData: () => usingTestData,
  isDmuPull,
  isLoggedInToFflogs,
  loadDancingMadMechanics,
  loadDancingMadMitigations,
  loadEncounterPhaseDefinitions,
  loadMitigationAbilities,
  loadMitigationCooldowns,
  materializePaginatedTestReport: (...args) => materializePaginatedTestReport(...args),
  mitigationHistoryPromises,
  parseFflogsReportCode,
  renderAccount: (...args) => renderAccount(...args),
  renderLookupResult: (...args) => renderLookupResult(...args),
  setBusy: (...args) => setBusy(...args),
  setCurrentUser: (value) => { currentUser = value; },
  setFightDetails: (value) => { fightDetails = value; },
  setIsRefreshingWeeklyReports: (value) => { isRefreshingWeeklyReports = value; },
  setIsShiftHeld: (value) => { isShiftHeld = value; },
  setLookupStatus: (...args) => setLookupStatus(...args),
  setOpenFightDetailKeys: (value) => { openFightDetailKeys = value; },
  setOpenFightMitigationKeys: (value) => { openFightMitigationKeys = value; },
  setReports: (value) => { reports = value; },
  setReportsStatus: (...args) => setReportsStatus(...args),
  setSelectedReport: (value) => { selectedReport = value; },
  setStatus: (...args) => setStatus(...args),
  setUsingTestData: (value) => { usingTestData = value; },
});

const {
  createMitigationAbilityIcon,
  evaluatePartySlotMitigations,
  getFiniteNumber,
  getMitigationJobs,
  getMitigationTimingStatusColor,
  inferTankPlanSlots,
  interpolateColor,
  loadMitigationResultHistory,
  mapPartyMembersToPlanSlots,
  mitigationCastDistance,
  rgbColor,
} = createMitigationCore({
  DANCING_MAD_ENCOUNTER_NAME,
  DMU_ENCOUNTER_ID,
  MITIGATION_GRACE_SECONDS,
  UNKNOWN_MITIGATION_ABILITY_ICON_URL,
  ensureReportFightDetails,
  getEventAbilityName,
  getFightDetails: () => fightDetails,
  getFightDuration,
  getFightFingerprint,
  getMitigationAbilitiesById: () => mitigationAbilitiesById,
  getMitigationCooldowns: () => mitigationCooldowns,
  getMitigationHistoryPromises: () => mitigationHistoryPromises,
  getMitigationIdentity: (...args) => mitigationIdentity(...args),
  getTrackedMitigations: () => dancingMadMitigations,
  normalizeEventType,
  normalizeJobAbbreviation: (...args) => normalizeJobAbbreviation(...args),
  resolveEncounterPhaseStarts,
});

const {
  attachFightEventStatusTooltip,
  clearPinnedFightEventRecap,
  closePinnedTimelineGroups,
  createFightDetailsTable,
  createFightEventStatusFallback,
  createFightTimeline,
  createTimelineEventGroupMarker,
  createTimelineEventMarker,
  createTimelineGroupSummaryBox,
} = createFightEventView({
  DANCING_MAD_ENCOUNTER_NAME,
  FIGHT_EVENT_BUFFS_TOOLTIP,
  FIGHT_EVENT_DEBUFFS_TOOLTIP,
  FIGHT_EVENT_TABLE_HEADINGS,
  UNKNOWN_DEATH_REASON_TOOLTIP,
  UNKNOWN_MITIGATION_ABILITY_ICON_URL,
  formatFightDuration,
  getDancingMadMechanic,
  getDancingMadMechanics: () => dancingMadMechanics,
  getDancingMadPhase,
  getEncounterPhaseDefinitions: () => encounterPhaseDefinitions,
  getEncounterRelativeTimestamp,
  getFightDuration,
  resolveEncounterPhaseStarts,
});

const {
  createDetailedReportView,
  filterReportFightsByOutcome,
} = createDetailedReportViewModule({
  createBestPullBadge,
  createExternalLink,
  createFightDetailsPanel,
  createFightMitigationPanel: (...args) => createFightMitigationPanel(...args),
  createLinkGroup,
  formatFightDuration,
  formatFightStartTime,
  formatReportDateRange,
  getBestDmuPull,
  getFightDetails: () => fightDetails,
  getFightDuration,
  getIsShiftHeld: () => isShiftHeld,
  getOpenFightDetailKeys: () => openFightDetailKeys,
  getOpenFightMitigationKeys: () => openFightMitigationKeys,
  getPullColorClass,
  getSelectedReportPhase: () => selectedReportPhase,
  isDmuPull,
  normalizeBossHealth,
  reloadFightDetails,
  reloadSelectedReport,
  renderLookupResult,
  setSelectedReportPhase: (value) => { selectedReportPhase = value; },
  showReportMitigationHistoryOverview: (...args) => showReportMitigationHistoryOverview(...args),
  showReportPlayerActionsOverview: (...args) => showReportPlayerActionsOverview(...args),
  showSpecialHardcodedViews: (...args) => showSpecialHardcodedViews(...args),
  toggleFightDetails,
  toggleFightMitigations,
  updateSelectedReportReloadButton,
});

const {
  clearSpecialHardcodedViewState,
  showReportPlayerActionsOverview,
  showSpecialHardcodedViews,
} = createPlayerActionsOverview({
  attachFightEventStatusTooltip,
  createBestPullBadge,
  createFightEventStatusFallback,
  DANCING_MAD_ENCOUNTER_NAME,
  DMU_ENCOUNTER_ID,
  ensureReportFightDetails,
  FFLOGS_PSEUDO_ACTION_ID_MIN,
  filterReportFightsByOutcome,
  formatFightDuration,
  getDancingMadMechanics: () => dancingMadMechanics,
  getDancingMadMitigations: () => dancingMadMitigations,
  getEncounterRelativeTimestamp,
  getFightDetails: () => fightDetails,
  getFightDuration,
  getMitigationCooldowns: () => mitigationCooldowns,
  getMitigationJobs,
  getSelectedReportPhase: () => selectedReportPhase,
  isUnknownFflogsStatus,
  mapPartyMembersToPlanSlots,
  MITIGATION_GRACE_SECONDS,
  mitigationCastDistance,
  PARTY_SLOT_ORDER,
  resolveEncounterPhaseStarts,
  swappedTankAssignmentsByFight,
  updateWithSmoothHeight: (...args) => updateWithSmoothHeight(...args),
});

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

const {
  extractPhaseReferenceEvents,
  extractPlayerActionCasts,
  extractPlayerDebuffEvents,
  extractPlayerLifeEvents,
  extractPlayerSpeedAttributes,
  extractPlayerSpeedStatusEvents,
  extractTargetabilityEvents,
  extractTrackedMitigationCasts,
  isDisplayedFightEvent,
  normalizeJobAbbreviation,
  normalizePartyMembers,
} = createFightEventExtractors({
  getEncounterEventReferences,
  getEventAbilityName,
  getFflogsAbilityIconUrl,
  getMitigationAbility: (abilityId) => mitigationAbilitiesById.get(abilityId),
  getTrackedMitigations: () => dancingMadMitigations,
  isPlayerActionSpeedStatus,
  jobAbbreviations: JOB_ABBREVIATIONS,
  jobRoles: JOB_ROLES,
  normalizeEventType,
  encounterName: DANCING_MAD_ENCOUNTER_NAME,
});

const {
  normalizeEmbeddedFightDetails,
  normalizeFightDetails,
} = createFightDetailsNormalizer({
  DANCING_MAD_ENCOUNTER_NAME,
  DEATH_REASON_DAMAGE_LOOKBACK_MS,
  FIGHT_EVENT_RECAP_LOOKBACK_MS,
  FIGHT_EVENT_RECAP_MAX_ROWS,
  TANK_FORTY_PERCENT_BUFFS,
  extractPhaseReferenceEvents,
  extractPlayerActionCasts,
  extractPlayerDebuffEvents,
  extractPlayerLifeEvents,
  extractPlayerSpeedAttributes,
  extractPlayerSpeedStatusEvents,
  extractTargetabilityEvents,
  extractTrackedMitigationCasts,
  findCauseOfDeath,
  getDancingMadPhase,
  getEventAbilityName,
  getFiniteNumber,
  getFflogsAbilityIconUrl,
  inferTankPlanSlots,
  isDisplayedFightEvent,
  normalizeEventType,
  normalizePartyMembers,
  resolveEncounterPhaseStarts,
});

const {
  addTestMitigationCasts,
  materializePaginatedTestReport,
} = createTestReportData({
  DANCING_MAD_ENCOUNTER_NAME,
  collectFflogsEventPages,
  extractPhaseReferenceEvents,
  getDancingMadMitigations: () => dancingMadMitigations,
  getFightDuration,
  getMitigationJobs,
  isDmuPull,
  mapPartyMembersToPlanSlots,
  normalizeJobAbbreviation,
  normalizePartyMembers,
  resolveEncounterPhaseStarts,
});

const {
  closeOpenMitigationHistoryPopups,
  createMitigationHistorySummary,
  createMitigationHistoryTable,
  mitigationIdentity,
  nextMitigationHistoryPopupId,
  positionMitigationHistoryPopup,
  positionOpenMitigationHistoryPopup,
  showReportMitigationHistoryOverview,
} = createMitigationHistory({
  PARTY_SLOT_ORDER,
  createBestPullBadge,
  createMitigationAbilityIcon,
  filterReportFightsByOutcome,
  formatFightDuration,
  getMitigationTimingStatusColor,
  getSelectedReportPhase: () => selectedReportPhase,
  getTrackedMitigations: () => dancingMadMitigations,
  interpolateColor,
  loadMitigationResultHistory,
  loadMitigationSlot,
  rgbColor,
  setMitigationSlot,
  updateWithSmoothHeight: (...args) => updateWithSmoothHeight(...args),
});

const {
  applyMitigationResultFilter,
  createFightMitigationPanel,
} = createMitigationTracker({
  DANCING_MAD_ENCOUNTER_NAME,
  PARTY_SLOT_ORDER,
  closeOpenMitigationHistoryPopups,
  createMitigationAbilityIcon,
  createMitigationHistorySummary,
  createMitigationHistoryTable,
  evaluatePartySlotMitigations,
  formatFightDuration,
  getFightDuration,
  getMitigationFilterMode: () => mitigationFilterMode,
  getMitigationJobs,
  getSelectedMitigationSlot: () => selectedMitigationSlot,
  getSwappedTankAssignmentsByFight: () => swappedTankAssignmentsByFight,
  getTrackedMitigations: () => dancingMadMitigations,
  loadMitigationResultHistory,
  nextMitigationHistoryPopupId,
  positionMitigationHistoryPopup,
  renderLookupResult,
  resolveEncounterPhaseStarts,
  setMitigationFilterMode,
  setMitigationSlot,
});

const {
  calculateTimelineGroupLayout,
  createTimelineEventKindGroups,
  getTimelineItemCollisionBounds,
  getTimelineTickLabelBounds,
  groupOverlappingTimelineEvents,
  timelineIntervalsTouch,
} = createTimelineLayout({ createGroupSummaryBox: createTimelineGroupSummaryBox });

const {
  scheduleResponsiveFightPanelLayout,
  scheduleTimelineCollisionCheck,
  updateWithSmoothHeight,
} = createTimelineInteractions({
  calculateTimelineGroupLayout,
  createTimelineEventGroupMarker,
  createTimelineEventKindGroups,
  createTimelineEventMarker,
  getTimelineItemCollisionBounds,
  getTimelineTickLabelBounds,
  groupOverlappingTimelineEvents,
  timelineIntervalsTouch,
});

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
elements.refreshReportsButton.addEventListener('click', refreshWeeklyReports);
elements.detailsViewButton.addEventListener('click', () => {
  setDetailsTableVisibility(!isDetailsTableVisible);
  renderLookupResult();
});
elements.themeToggleButton.addEventListener('click', toggleTheme);
elements.reportSearchForm.addEventListener('submit', searchForReport);
window.addEventListener('resize', scheduleTimelineCollisionCheck);
window.addEventListener('resize', scheduleResponsiveFightPanelLayout);
document.fonts?.ready.then(scheduleResponsiveFightPanelLayout);
window.addEventListener('resize', positionOpenMitigationHistoryPopup);
document.addEventListener('click', (event) => {
  if (!event.target.closest('.mitigation-result-history-anchor')
    && !event.target.closest('.mitigation-result-history-tooltip')) {
    closeOpenMitigationHistoryPopups();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Shift') updateShiftSensitiveButtons(true);
  if (event.key !== 'Escape') return;
  const openAnchor = document.querySelector('.mitigation-result-history-anchor.open');
  if (!openAnchor) return;
  closeOpenMitigationHistoryPopups();
  openAnchor.focus();
});
document.addEventListener('keyup', (event) => {
  if (event.key === 'Shift') updateShiftSensitiveButtons(false);
});
window.addEventListener('blur', () => updateShiftSensitiveButtons(false));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.fight-timeline-event.grouped')) {
    closePinnedTimelineGroups();
  }
});

renderThemeButton();
renderDetailsViewControl();
updateRefreshReportsButton(false);
installCacheExportControl();
initialize();

function installCacheExportControl() {
  const isLocalDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (!isLocalDevelopment) return;
  const reportCode = new URLSearchParams(window.location.search).get('cache-export');
  if (!reportCode) return;
  const controls = elements.reportSearchForm.querySelector('.report-search-controls');
  if (!controls) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Download cached fixture';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const fixture = await buildCachedFightDetailsFixture(reportCode);
      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(fixture)], { type: 'application/json' }));
      const download = document.createElement('a');
      download.href = blobUrl;
      download.download = `${reportCode}-fight-details.json`;
      download.click();
      URL.revokeObjectURL(blobUrl);
      setLookupStatus(`Downloaded ${Object.keys(fixture.fights).length} cached pulls for ${reportCode}.`);
    } catch (error) {
      setLookupStatus(`Could not export cached pulls: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
  controls.append(button);
}

async function buildCachedFightDetailsFixture(reportCode) {
  const cachedEntries = await fightDetailsCache.entries();
  if (!cachedEntries) throw new Error('The local fight-details cache is unavailable.');
  const entries = cachedEntries.flatMap(([rawKey, details]) => {
    const key = String(rawKey);
    const marker = `:${reportCode}:`;
    const markerIndex = key.indexOf(marker);
    if (markerIndex < 0) return [];
    return [{
      cacheVersion: JSON.parse(key.slice(0, markerIndex)),
      fightId: key.slice(markerIndex + marker.length).split(':')[0],
      details,
    }];
  });
  const newestByFight = new Map();
  const newestRawByFight = new Map();
  for (const entry of entries) {
    const current = newestByFight.get(entry.fightId);
    if (!current || Number(entry.cacheVersion.version) > Number(current.cacheVersion.version)) {
      newestByFight.set(entry.fightId, entry);
    }
    if (entry.details?.cacheFormat === 'raw-events-v1' && entry.details.rawDetails) {
      const currentRaw = newestRawByFight.get(entry.fightId);
      if (!currentRaw || Number(entry.cacheVersion.version) > Number(currentRaw.cacheVersion.version)) {
        newestRawByFight.set(entry.fightId, entry);
      }
    }
  }
  const missingRawFightIds = [...newestByFight.keys()]
    .filter((fightId) => !newestRawByFight.has(fightId))
    .sort((first, second) => Number(first) - Number(second));
  if (missingRawFightIds.length > 0) {
    throw new Error(
      `Raw event data is missing for pull${missingRawFightIds.length === 1 ? '' : 's'} `
      + `${missingRawFightIds.join(', ')}. Load those pulls once before exporting.`,
    );
  }
  return {
    reportCode,
    cacheVersion: JSON.parse(getFightDetailsCacheVersion()),
    fixtureFormat: 'raw-events-v1',
    fights: Object.fromEntries([...newestRawByFight]
      .sort(([first], [second]) => Number(first) - Number(second))
      .map(([fightId, entry]) => [fightId, entry.details])),
  };
}

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

function renderLookupResult() {
  closeOpenMitigationHistoryPopups();
  clearPinnedFightEventRecap();
  renderDetailsViewControl();
  updateWithSmoothHeight(elements.lookupResult, () => {
    elements.lookupResult.replaceChildren(...(selectedReport ? [createDetailedReportView(selectedReport)] : []));
  });
  scheduleTimelineCollisionCheck();
  scheduleResponsiveFightPanelLayout();
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

function setLookupStatus(message, isError = false) {
  elements.lookupStatus.textContent = message;
  elements.lookupStatus.classList.toggle('error', isError);
  elements.lookupStatus.hidden = !message;
}
