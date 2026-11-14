const PLAYER_ACTION_PIXELS_PER_SECOND = 50;
const PLAYER_ACTION_BASE_GCD_MS = 2_500;
const PLAYER_ACTION_LOG_BATCH_MS = 45;
const PLAYER_ACTION_CAST_ANIMATION_LOCK_MS = 100;
const PLAYER_ACTION_GCD_COOLDOWN_GROUP = 58;
// Some jobs have an always-on recast reduction that is not represented by an
// FFLogs status window. Remove it from observed action intervals when inferring
// the player's stat-based GCD; action timestamps themselves remain unchanged.
const PLAYER_ACTION_JOB_SPEED_MODIFIERS = new Map([
  ['MNK', 0.80],
  ['NIN', 0.85],
]);
const PLAYER_ACTION_SPEED_STATUS_MODIFIERS = new Map([
  [738, 0.85], // Circle of Power (Ley Lines)
  [3689, 0.75], // Inspiration
  [1299, 0.87], // Fuka
  [3669, 0.85], // Swiftscaled
  [157, 0.80], // Presence of Mind
]);

export function isPlayerActionSpeedStatus(statusId) {
  return PLAYER_ACTION_SPEED_STATUS_MODIFIERS.has(statusId);
}
const PLAYER_ACTION_SPELL_SPEED_JOBS = new Set([
  'WHM', 'SCH', 'AST', 'SGE', 'BLM', 'SMN', 'RDM', 'PCT', 'BLU',
]);
const PLAYER_ACTION_DOT_STATUS_FAMILIES_BY_JOB = new Map([
  ['WHM', [['aero', 'aero ii', 'dia']]],
  ['SCH', [['bio', 'bio ii', 'biolysis']]],
  ['AST', [['combust', 'combust ii', 'combust iii']]],
  ['SGE', [['eukrasian dosis', 'eukrasian dosis ii', 'eukrasian dosis iii']]],
  ['MNK', [['demolish']]],
  ['DRG', [['chaos thrust', 'chaotic spring']]],
  ['SAM', [['higanbana']]],
  ['BRD', [
    ['venomous bite', 'caustic bite'],
    ['windbite', 'stormbite'],
  ]],
  ['BLM', [['thunder', 'thunder iii', 'high thunder']]],
]);
const WHM_AFFLATUS_ACTIONS = new Map([
  ['afflatus solace', 'Solace'],
  ['afflatus rapture', 'Rapture'],
  ['afflatus misery', 'Misery'],
]);
const PLAYER_ACTION_EXPLICIT_GCDS = new Set([
  'eukrasia',
  'eukrasian diagnosis',
  'eukrasian prognosis',
  'eukrasian prognosis ii',
  'eukrasian dosis',
  'eukrasian dosis ii',
  'eukrasian dosis iii',
  'eukrasian dyskrasia',
  'phlegma',
  'phlegma ii',
  'phlegma iii',
  'pneuma',
]);
// Eukrasia and its transformed spells use short fixed recasts that Spell Speed
// does not modify.
const PLAYER_ACTION_FIXED_GCD_RECASTS = new Map([
  ['eukrasia', 1_000],
  ['eukrasian diagnosis', 1_500],
  ['eukrasian prognosis', 1_500],
  ['eukrasian prognosis ii', 1_500],
  ['eukrasian dosis', 1_500],
  ['eukrasian dosis ii', 1_500],
  ['eukrasian dosis iii', 1_500],
]);
const PLAYER_ACTION_BASE_GCD_OVERRIDES = new Set([
  'phlegma',
  'phlegma ii',
  'phlegma iii',
  'pneuma',
]);

const playerActionGameDataById = new Map();
// Deliberately session-only: each report remembers its own viewer controls until
// this page is reloaded, without making later visits load player-action data.
const reportPlayerActionViewStates = new Map();
const reportSpecialHardcodedViewStates = new Map();

export function createPlayerActionsOverview({
  attachFightEventStatusTooltip,
  createBestPullBadge,
  createFightEventStatusFallback,
  DANCING_MAD_ENCOUNTER_NAME,
  ensureReportFightDetails,
  FFLOGS_PSEUDO_ACTION_ID_MIN,
  filterReportFightsByOutcome,
  formatFightDuration,
  getEncounterRelativeTimestamp,
  getFightDuration,
  getMitigationJobs,
  isUnknownFflogsStatus,
  mapPartyMembersToPlanSlots,
  MITIGATION_GRACE_SECONDS,
  mitigationCastDistance,
  PARTY_SLOT_ORDER,
  resolveEncounterPhaseStarts,
  swappedTankAssignmentsByFight,
  DMU_ENCOUNTER_ID,
  getDancingMadMechanics,
  getDancingMadMitigations,
  getFightDetails,
  getMitigationCooldowns,
  getSelectedReportPhase,
  updateWithSmoothHeight,
}) {
  async function showReportPlayerActionsOverview(report, button) {
    const phaseFilter = getSelectedReportPhase();
    const fights = filterReportFightsByOutcome(report.fights ?? [], phaseFilter)
      .filter((fight) => Number(fight.encounterID) === DMU_ENCOUNTER_ID);
    const phaseFilterLabel = phaseFilter === 'all'
      ? 'All pulls'
      : phaseFilter === 'clears'
        ? 'Clears'
        : `Phase ${phaseFilter} wipes`;
  
    const dialog = document.createElement('dialog');
    dialog.className = 'mitigation-overview-dialog player-actions-dialog';
    dialog.setAttribute('aria-labelledby', 'player-actions-title');
    const header = document.createElement('div');
    header.className = 'mitigation-overview-header';
    const heading = document.createElement('h3');
    heading.id = 'player-actions-title';
    heading.textContent = 'Player actions by pull';
    const closeButton = document.createElement('button');
    closeButton.className = 'mitigation-overview-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => dialog.close());
    header.append(heading, closeButton);
  
    const content = document.createElement('div');
    content.className = 'mitigation-overview-content player-actions-content';
    const loading = document.createElement('p');
    loading.className = 'mitigation-overview-status';
    loading.textContent = `Loading player actions for ${phaseFilterLabel.toLowerCase()}…`;
    content.append(loading);
    dialog.append(header, content);
    document.body.append(dialog);
    button.disabled = true;
    dialog.addEventListener('close', () => {
      button.disabled = false;
      dialog.remove();
    }, { once: true });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.showModal();
  
    try {
      // Load one pull first so the roster and phase anchors become available
      // quickly. The expensive all-pull action load starts after the controls
      // are mounted and remains fully asynchronous.
      const seedFight = fights.find((fight) => (
        getFightDetails().get(`${report.code}:${fight.id}`)?.partyMembers?.length > 0
      )) ?? fights.at(-1);
      if (seedFight) {
        await ensureReportFightDetails(report, [seedFight], { playerActionsOnly: true });
      }
      const playerNames = [...new Set(fights.flatMap((fight) => {
        const state = getFightDetails().get(`${report.code}:${fight.id}`);
        return (state?.partyMembers ?? [])
          .filter((member) => member.role)
          .map((member) => member.name);
      }))].sort((first, second) => first.localeCompare(second));
      const abilityCatalog = createLoadedPlayerActionAbilityCatalog(fights, report);
      if (playerNames.length === 0) {
        loading.textContent = `No player action data is available for ${phaseFilterLabel.toLowerCase()}.`;
        return;
      }
  
      const controls = document.createElement('form');
      controls.className = 'player-actions-controls';
      const savedView = reportPlayerActionViewStates.get(report.code);
      const playerLabel = createPlayerActionsControlLabel('Player');
      const playerSelect = document.createElement('select');
      playerSelect.setAttribute('aria-label', 'Player');
      playerSelect.append(new Option('Choose player…', ''));
      for (const playerName of playerNames) playerSelect.append(new Option(playerName, playerName));
      playerSelect.value = playerNames.includes(savedView?.player) ? savedView.player : '';
      playerLabel.append(playerSelect);
      const phaseAnchorLabel = createPlayerActionsControlLabel('Phase anchor');
      const phaseAnchorSelect = document.createElement('select');
      phaseAnchorSelect.setAttribute('aria-label', 'Phase anchor');
      phaseAnchorSelect.append(new Option('Fight start', 'fight'));
      for (let phase = 1; phase <= 5; phase += 1) {
        phaseAnchorSelect.append(new Option(`Phase ${phase}`, String(phase)));
      }
      phaseAnchorSelect.value = ['fight', '1', '2', '3', '4', '5'].includes(savedView?.phaseAnchor)
        ? savedView.phaseAnchor
        : 'fight';
      phaseAnchorLabel.append(phaseAnchorSelect);
      const getMaximumAnchoredDuration = () => Math.max(0, ...fights.map((fight) => {
        const state = getFightDetails().get(`${report.code}:${fight.id}`);
        const anchorMs = getPlayerActionsPhaseAnchorMs(fight, state, phaseAnchorSelect.value);
        return Number.isFinite(anchorMs) ? getFightDuration(fight) - anchorMs : 0;
      }));
      const maximumFightDurationMs = getMaximumAnchoredDuration();
      const startControl = createPlayerActionsTimeControl(
        'Start',
        savedView?.start ?? '',
        maximumFightDurationMs,
        0,
      );
      const { label: startLabel, textInput: startInput, rangeInput: startRange } = startControl;
      const endControl = createPlayerActionsTimeControl(
        'End',
        savedView?.end ?? '',
        maximumFightDurationMs,
        maximumFightDurationMs,
      );
      const { label: endLabel, textInput: endInput, rangeInput: endRange } = endControl;
      const showToEndLabel = document.createElement('label');
      showToEndLabel.className = 'player-actions-show-to-end';
      const showToEndCheckbox = document.createElement('input');
      showToEndCheckbox.type = 'checkbox';
      showToEndCheckbox.checked = savedView?.showToEnd === true;
      showToEndCheckbox.setAttribute('aria-label', 'Show every pull to its end and sort by duration');
      showToEndLabel.append(showToEndCheckbox, 'Show every pull to its end · shortest first');
      const zoomLabel = createPlayerActionsControlLabel('Zoom');
      const zoomInput = document.createElement('input');
      zoomInput.type = 'range';
      zoomInput.min = '10';
      zoomInput.max = '80';
      zoomInput.step = '5';
      zoomInput.value = String(Number(savedView?.zoom) || PLAYER_ACTION_PIXELS_PER_SECOND);
      zoomInput.setAttribute('aria-label', 'Player action timeline zoom');
      const zoomOutput = document.createElement('output');
      zoomOutput.textContent = `${zoomInput.value} px/s`;
      zoomLabel.classList.add('player-actions-zoom');
      zoomLabel.append(zoomInput, zoomOutput);
      const updateButton = document.createElement('button');
      updateButton.type = 'submit';
      updateButton.textContent = 'Update';
      const filterNotice = document.createElement('span');
      filterNotice.className = 'player-actions-filter-notice';
      filterNotice.textContent = `Phase filter: ${phaseFilterLabel}`;
      controls.append(
        playerLabel,
        phaseAnchorLabel,
        startLabel,
        endLabel,
        zoomLabel,
        updateButton,
        showToEndLabel,
        filterNotice,
      );
  
      const status = document.createElement('p');
      status.className = 'player-actions-status';
      const rows = document.createElement('div');
      rows.className = 'player-actions-rows';
      const durationFilter = document.createElement('label');
      durationFilter.className = 'player-actions-duration-filter';
      const durationFilterText = document.createElement('span');
      durationFilterText.textContent = 'Hide pulls ending before';
      const durationFilterControl = document.createElement('span');
      durationFilterControl.className = 'player-actions-duration-filter-control';
      const durationFilterInput = document.createElement('input');
      durationFilterInput.type = 'range';
      durationFilterInput.step = '1000';
      durationFilterInput.setAttribute('aria-label', 'Hide player action pulls ending before this time');
      let minimumDurationMs = Math.max(0, Number(savedView?.minimumDurationMs) || 0);
      const durationFilterOutput = document.createElement('output');
      durationFilterControl.append(durationFilterInput, durationFilterOutput);
      durationFilter.append(durationFilterText, durationFilterControl);
      const selectedAbilityIds = new Set((savedView?.selectedAbilityIds ?? [])
        .map(Number)
        .filter((abilityId) => abilityCatalog.some((ability) => ability.id === abilityId)));
      const abilityFilterState = {
        hideUnhighlighted: savedView?.hideUnhighlighted === true,
      };
      let detailsReady = false;
      let detailsError = null;
      const abilityFilter = createPlayerActionsAbilityFilter({
        abilityCatalog,
        selectedAbilityIds,
        filterState: abilityFilterState,
        onChange: () => {
          saveView();
          render({ showErrors: false });
        },
      });
      const saveView = () => {
        reportPlayerActionViewStates.set(report.code, {
          player: playerSelect.value,
          phaseAnchor: phaseAnchorSelect.value,
          start: startInput.value,
          end: endInput.value,
          showToEnd: showToEndCheckbox.checked,
          zoom: Number(zoomInput.value),
          minimumDurationMs,
          selectedAbilityIds: [...selectedAbilityIds],
          hideUnhighlighted: abilityFilterState.hideUnhighlighted,
        });
      };
      const render = ({ showErrors = true } = {}) => {
        const startMs = parseFightTimeInput(startInput.value);
        const endMs = parseFightTimeInput(endInput.value);
        const showToEnd = showToEndCheckbox.checked;
        const maximumAnchoredDurationMs = getMaximumAnchoredDuration();
        const pixelsPerSecond = Number(zoomInput.value);
        minimumDurationMs = Math.max(startMs || 0, Math.min(minimumDurationMs, maximumAnchoredDurationMs));
        durationFilterInput.min = String(Math.max(0, startMs || 0));
        durationFilterInput.max = String(maximumAnchoredDurationMs);
        durationFilterInput.value = String(minimumDurationMs);
        durationFilterOutput.textContent = formatFightDuration(minimumDurationMs);
        startRange.max = String(maximumAnchoredDurationMs);
        endRange.max = String(maximumAnchoredDurationMs);
        if (!detailsReady) {
          status.className = `player-actions-status${detailsError ? ' error' : ''}`;
          status.textContent = detailsError
            ? `Could not load player actions: ${detailsError.message}`
            : 'Loading pull actions in the background… You can configure the view now.';
          updateWithSmoothHeight(rows, () => rows.replaceChildren());
          return;
        }
        if (!playerSelect.value
          || !Number.isFinite(startMs)
          || startMs < 0
          || startMs >= maximumAnchoredDurationMs
          || (!showToEnd && (
            !Number.isFinite(endMs)
            || endMs > maximumAnchoredDurationMs
            || endMs <= startMs
          ))) {
          status.className = `player-actions-status${showErrors ? ' error' : ''}`;
          status.textContent = showErrors
            ? showToEnd
              ? `Choose a player and enter a start before ${formatFightDuration(maximumAnchoredDurationMs)}.`
              : `Choose a player and enter a valid range from 0:00–${formatFightDuration(maximumAnchoredDurationMs)}; the end must be after the start.`
            : showToEnd
              ? 'Choose a player and start time.'
              : 'Choose a player, start time, and end time.';
          updateWithSmoothHeight(rows, () => rows.replaceChildren());
          return;
        }
        status.className = 'player-actions-status';
        startInput.value = formatFightDuration(startMs);
        syncPlayerActionsTimeControl(startControl, startMs);
        if (!showToEnd) {
          endInput.value = formatFightDuration(endMs);
          syncPlayerActionsTimeControl(endControl, endMs);
        }
        saveView();
        const defaultTrackWidth = Math.max(
          1,
          (((showToEnd ? maximumAnchoredDurationMs : endMs) - startMs) / 1000)
            * pixelsPerSecond,
        );
        rows.style.setProperty('--player-actions-track-width', `${defaultTrackWidth}px`);
        durationFilterControl.style.width = `${defaultTrackWidth}px`;
        const eligibleFights = fights
          .map((fight) => ({
            fight,
            anchorMs: getPlayerActionsPhaseAnchorMs(
              fight,
              getFightDetails().get(`${report.code}:${fight.id}`),
              phaseAnchorSelect.value,
            ),
          }))
          .map((entry) => ({
            ...entry,
            anchoredDurationMs: getFightDuration(entry.fight) - entry.anchorMs,
          }))
          .filter(({ anchorMs, anchoredDurationMs }) => Number.isFinite(anchorMs)
            && anchoredDurationMs >= minimumDurationMs
            && (showToEnd ? anchoredDurationMs > startMs : anchoredDurationMs >= endMs))
          .sort((first, second) => showToEnd
            ? first.anchoredDurationMs - second.anchoredDurationMs
              || Number(first.fight.id) - Number(second.fight.id)
            : Number(first.fight.id) - Number(second.fight.id));
        const anchorName = phaseAnchorSelect.value === 'fight'
          ? 'fight start'
          : `P${phaseAnchorSelect.value}`;
        const gcd = estimatePlayerGcd(fights, report, playerSelect.value);
        status.textContent = showToEnd
          ? `${eligibleFights.length} ${eligibleFights.length === 1 ? 'pull' : 'pulls'} shown from ${anchorName} + ${formatFightDuration(startMs)} to each pull's end, shortest first. ${formatPlayerGcdSummary(gcd)}.`
          : `${eligibleFights.length} ${eligibleFights.length === 1 ? 'pull' : 'pulls'} reached ${anchorName} + ${formatFightDuration(endMs)}. ${formatPlayerGcdSummary(gcd)}.`;
        updateWithSmoothHeight(rows, () => {
          rows.replaceChildren(durationFilter, ...eligibleFights.map(({ fight, anchorMs, anchoredDurationMs }) => {
            const rowEndMs = showToEnd ? getFightDuration(fight) : anchorMs + endMs;
            const row = createPlayerActionsPullRow(
              report,
              fight,
              playerSelect.value,
              anchorMs + startMs,
              rowEndMs,
              anchorMs,
              {
                selectedAbilityIds,
                hideUnhighlighted: abilityFilterState.hideUnhighlighted,
              },
              gcd,
            );
            if (showToEnd) {
              const width = Math.max(
                1,
                ((anchoredDurationMs - startMs) / 1000) * pixelsPerSecond,
              );
              row.style.setProperty('--player-actions-track-width', `${width}px`);
            }
            return row;
          }));
          if (eligibleFights.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'player-actions-empty';
            empty.textContent = showToEnd
              ? 'No pulls reached the start of this time range.'
              : 'No pulls reached the end of this time range.';
            rows.append(empty);
          }
        });
      };
      controls.addEventListener('submit', (event) => {
        event.preventDefault();
        render();
      });
      playerSelect.addEventListener('change', saveView);
      phaseAnchorSelect.addEventListener('change', () => {
        saveView();
        render({ showErrors: false });
      });
      const syncShowToEndControl = () => {
        endInput.disabled = showToEndCheckbox.checked;
        endRange.disabled = showToEndCheckbox.checked;
        endLabel.classList.toggle('disabled', showToEndCheckbox.checked);
      };
      showToEndCheckbox.addEventListener('change', () => {
        if (showToEndCheckbox.checked && !Number.isFinite(parseFightTimeInput(startInput.value))) {
          syncPlayerActionsTimeControl(startControl, 0);
        }
        syncShowToEndControl();
        saveView();
        render({ showErrors: false });
      });
      zoomInput.addEventListener('input', () => {
        zoomOutput.textContent = `${zoomInput.value} px/s`;
        saveView();
        render({ showErrors: false });
      });
      durationFilterInput.addEventListener('input', () => {
        minimumDurationMs = Number(durationFilterInput.value);
        saveView();
        render({ showErrors: false });
      });
      for (const control of [startControl, endControl]) {
        control.textInput.addEventListener('input', () => {
          const milliseconds = parseFightTimeInput(control.textInput.value);
          const currentMaximumMs = getMaximumAnchoredDuration();
          if (Number.isFinite(milliseconds)
            && milliseconds >= 0
            && milliseconds <= currentMaximumMs) {
            syncPlayerActionsTimeControl(control, milliseconds, { preserveText: true });
          } else {
            control.rangeInput.classList.add('unset');
          }
          saveView();
        });
        control.rangeInput.addEventListener('input', () => {
          syncPlayerActionsTimeControl(control, Number(control.rangeInput.value));
          saveView();
        });
      }
      updateWithSmoothHeight(content, () => {
        content.replaceChildren(controls, status, rows, abilityFilter);
      });
      syncShowToEndControl();
      render({ showErrors: false });
      void (async () => {
        try {
          await ensureReportFightDetails(report, fights, { playerActionsOnly: true });
          await loadPlayerActionCategories(fights.flatMap((fight) =>
            getFightDetails().get(`${report.code}:${fight.id}`)?.actionCasts ?? []));
          const loadedCatalog = createLoadedPlayerActionAbilityCatalog(fights, report);
          abilityCatalog.splice(0, abilityCatalog.length, ...loadedCatalog);
          detailsReady = true;
        } catch (error) {
          detailsError = error;
        }
        if (dialog.isConnected) render({ showErrors: false });
      })();
    } catch (error) {
      loading.textContent = `Could not load player actions: ${error.message}`;
    }
  }

  function clearSpecialHardcodedViewState(reportCode = null) {
    if (reportCode === null) reportSpecialHardcodedViewStates.clear();
    else reportSpecialHardcodedViewStates.delete(reportCode);
  }

  async function showSpecialHardcodedViews(report, button) {
    const fights = (report.fights ?? [])
      .filter((fight) => Number(fight.encounterID) === DMU_ENCOUNTER_ID)
      .sort((first, second) => Number(first.id) - Number(second.id));
    const dialog = document.createElement('dialog');
    dialog.className = 'mitigation-overview-dialog special-views-dialog';
    dialog.setAttribute('aria-labelledby', 'special-views-title');
    const header = document.createElement('div');
    header.className = 'mitigation-overview-header';
    const heading = document.createElement('h3');
    heading.id = 'special-views-title';
    heading.textContent = 'Special hardcoded views';
    const closeButton = document.createElement('button');
    closeButton.className = 'mitigation-overview-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => dialog.close());
    header.append(heading, closeButton);

    const content = document.createElement('div');
    content.className = 'mitigation-overview-content special-views-content';
    const loading = document.createElement('p');
    loading.className = 'mitigation-overview-status';
    loading.textContent = 'Loading fight details…';
    content.append(loading);
    dialog.append(header, content);
    document.body.append(dialog);
    button.disabled = true;
    dialog.addEventListener('close', () => {
      button.disabled = false;
      dialog.remove();
    }, { once: true });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.showModal();

    try {
      // Populate the controls from an already-loaded pull when possible. Loading
      // every pull is deferred until a concrete view is selected so opening this
      // dialog on a live report never looks frozen behind an empty loading panel.
      const hasPartyData = () => fights.some((fight) => (
        getFightDetails().get(`${report.code}:${fight.id}`)?.partyMembers?.length > 0
      ));
      if (!hasPartyData() && fights.length > 0) {
        await ensureReportFightDetails(report, [fights.at(-1)], { playerActionsOnly: true });
      }
      const playersByName = new Map();
      for (const fight of fights) {
        const state = getFightDetails().get(`${report.code}:${fight.id}`);
        for (const member of state?.partyMembers ?? []) {
          if (member.role && !playersByName.has(member.name)) playersByName.set(member.name, member);
        }
      }
      const playerNames = [...playersByName.keys()]
        .sort((first, second) => first.localeCompare(second));
      if (playerNames.length === 0) {
        loading.textContent = 'No player action data is available for this report.';
        return;
      }

      const savedView = reportSpecialHardcodedViewStates.get(report.code) ?? {};
      const controls = document.createElement('div');
      controls.className = 'special-views-controls';
      const playerLabel = createPlayerActionsControlLabel('Player');
      const playerSelect = document.createElement('select');
      playerSelect.setAttribute('aria-label', 'Special view player');
      playerSelect.append(new Option('Choose player…', ''));
      for (const playerName of playerNames) playerSelect.append(new Option(playerName, playerName));
      playerSelect.value = playerNames.includes(savedView.player) ? savedView.player : '';
      playerLabel.append(playerSelect);
      const viewLabel = createPlayerActionsControlLabel('Job-tailored view');
      const viewSelect = document.createElement('select');
      viewSelect.setAttribute('aria-label', 'Job-tailored special view');
      const supportedViews = new Set([
        'gcd-uptime-by-phase',
        'dot-uptime-by-phase',
        'lucid-dreaming-timeline',
        'afflatus-timeline',
      ]);
      const populateSpecialViews = (preferredView = '') => {
        const job = playersByName.get(playerSelect.value)?.job;
        viewSelect.replaceChildren(new Option('Choose view…', ''));
        viewSelect.append(new Option('GCD uptime in each phase', 'gcd-uptime-by-phase'));
        if (PLAYER_ACTION_DOT_STATUS_FAMILIES_BY_JOB.has(job)) {
          viewSelect.append(new Option('DoT uptime in each phase', 'dot-uptime-by-phase'));
        }
        if (PLAYER_ACTION_SPELL_SPEED_JOBS.has(job)) {
          viewSelect.append(new Option('Lucid Dreaming timeline', 'lucid-dreaming-timeline'));
        }
        if (job === 'WHM') {
          viewSelect.append(new Option('Afflatus tracker', 'afflatus-timeline'));
        }
        viewSelect.disabled = !playerSelect.value;
        viewSelect.value = [...viewSelect.options].some((option) => option.value === preferredView)
          ? preferredView
          : '';
      };
      populateSpecialViews(playerSelect.value && supportedViews.has(savedView.view)
        ? savedView.view
        : '');
      viewLabel.append(viewSelect);
      const zoomLabel = createPlayerActionsControlLabel('Zoom');
      zoomLabel.classList.add('special-views-zoom');
      zoomLabel.hidden = true;
      const zoomInput = document.createElement('input');
      zoomInput.type = 'range';
      zoomInput.min = '1';
      zoomInput.max = '8';
      zoomInput.step = '0.5';
      const savedZoom = Number(savedView.timelineZoom ?? savedView.lucidZoom);
      zoomInput.value = String(Number.isFinite(savedZoom) ? savedZoom : 2);
      let timelineMinimumDurationMs = Math.max(
        0,
        Number(savedView.timelineMinimumDurationMs ?? savedView.lucidMinimumDurationMs) || 0,
      );
      zoomInput.setAttribute('aria-label', 'Special timeline zoom');
      const zoomValue = document.createElement('output');
      zoomValue.textContent = `${Number(zoomInput.value).toFixed(1)} px/s`;
      zoomLabel.append(zoomInput, zoomValue);
      const afflatusDisplayLabel = createPlayerActionsControlLabel('Timeline coloring');
      afflatusDisplayLabel.classList.add('special-views-afflatus-display');
      afflatusDisplayLabel.hidden = true;
      const afflatusDisplaySelect = document.createElement('select');
      afflatusDisplaySelect.setAttribute('aria-label', 'Afflatus timeline coloring');
      afflatusDisplaySelect.append(
        new Option('Lilies', 'lilies'),
        new Option('Misery charges', 'misery'),
      );
      afflatusDisplaySelect.value = savedView.afflatusDisplayMode === 'misery'
        ? 'misery'
        : 'lilies';
      afflatusDisplayLabel.append(afflatusDisplaySelect);
      controls.append(playerLabel, viewLabel, zoomLabel, afflatusDisplayLabel);

      const status = document.createElement('p');
      status.className = 'special-views-status';
      const results = document.createElement('div');
      results.className = 'special-views-results';
      let allDetailsPromise = null;
      const loadAllDetails = () => {
        if (!allDetailsPromise) {
          allDetailsPromise = (async () => {
            await ensureReportFightDetails(report, fights, { playerActionsOnly: true });
            await loadPlayerActionCategories(fights.flatMap((fight) => (
              getFightDetails().get(`${report.code}:${fight.id}`)?.actionCasts ?? []
            )));
          })().catch((error) => {
            allDetailsPromise = null;
            throw error;
          });
        }
        return allDetailsPromise;
      };
      const saveView = () => {
        reportSpecialHardcodedViewStates.set(report.code, {
          player: playerSelect.value,
          view: viewSelect.value,
          timelineZoom: Number(zoomInput.value),
          timelineMinimumDurationMs,
          afflatusDisplayMode: afflatusDisplaySelect.value,
        });
      };
      let renderVersion = 0;
      const render = async () => {
        const version = ++renderVersion;
        const isLucidView = viewSelect.value === 'lucid-dreaming-timeline';
        const isAfflatusView = viewSelect.value === 'afflatus-timeline';
        const isTimelineView = isLucidView || isAfflatusView;
        zoomLabel.hidden = !isLucidView;
        afflatusDisplayLabel.hidden = !isAfflatusView;
        results.replaceChildren();
        if (!playerSelect.value) {
          status.textContent = 'Choose a player to see their job-tailored views.';
          return;
        }
        const player = playersByName.get(playerSelect.value);
        if (!viewSelect.value) {
          status.textContent = `Choose a ${player?.job ?? 'job'} view.`;
          return;
        }
        const selectedPlayer = playerSelect.value;
        const metric = viewSelect.value === 'dot-uptime-by-phase' ? 'dot' : 'gcd';
        const metricLabel = metric === 'dot' ? 'DoT' : 'GCD';
        status.textContent = isTimelineView
          ? `Loading ${selectedPlayer}'s ${isAfflatusView ? 'Afflatus' : 'Lucid Dreaming'} timeline…`
          : `Loading ${selectedPlayer}'s ${metricLabel} uptime by phase…`;
        try {
          await loadAllDetails();
          if (version !== renderVersion || !dialog.isConnected) return;
          const gcd = estimatePlayerGcd(fights, report, selectedPlayer);
          status.textContent = isTimelineView
            ? `${selectedPlayer} (${player?.job ?? 'unknown job'}) · ${isAfflatusView ? 'Afflatus tracker.' : 'Lucid Dreaming coverage.'}`
            : metric === 'gcd'
            ? `${selectedPlayer} (${player?.job ?? 'unknown job'}) · ${formatPlayerGcdSummary(gcd)}.`
            : `${selectedPlayer} (${player?.job ?? 'unknown job'}) · DoT uptime by phase.`;
          results.append(isTimelineView
            ? createSpecialActionTimeline(
              report,
              fights,
              selectedPlayer,
              isAfflatusView ? 2 : Number(zoomInput.value),
              timelineMinimumDurationMs,
              (minimumDurationMs) => {
                timelineMinimumDurationMs = minimumDurationMs;
                saveView();
              },
              isAfflatusView ? 'afflatus' : 'lucid',
              afflatusDisplaySelect.value,
            )
            : createUptimeByPhaseTable(report, fights, selectedPlayer, gcd, metric));
        } catch (error) {
          if (version !== renderVersion || !dialog.isConnected) return;
          status.textContent = `Could not load this view: ${error.message}`;
        }
      };
      playerSelect.addEventListener('change', () => {
        const currentView = viewSelect.value;
        populateSpecialViews(currentView);
        saveView();
        void render();
      });
      viewSelect.addEventListener('change', () => {
        saveView();
        void render();
      });
      zoomInput.addEventListener('input', () => {
        zoomValue.textContent = `${Number(zoomInput.value).toFixed(1)} px/s`;
        saveView();
        if (viewSelect.value === 'lucid-dreaming-timeline') {
          void render();
        }
      });
      afflatusDisplaySelect.addEventListener('change', () => {
        saveView();
        if (viewSelect.value === 'afflatus-timeline') void render();
      });
      content.replaceChildren(controls, status, results);
      void render();
    } catch (error) {
      loading.textContent = `Could not load special views: ${error.message}`;
    }
  }

  function createUptimeByPhaseTable(report, fights, playerName, gcd, metric) {
    const table = document.createElement('table');
    table.className = 'special-views-table';
    const head = document.createElement('thead');
    const headingRow = document.createElement('tr');
    for (const label of ['Pull', 'P1', 'P2', 'P3', 'P4', 'P5', 'Total']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headingRow.append(cell);
    }
    head.append(headingRow);
    const body = document.createElement('tbody');
    for (const fight of fights) {
      const state = getFightDetails().get(`${report.code}:${fight.id}`);
      const durationMs = getFightDuration(fight);
      const phaseStarts = resolveEncounterPhaseStarts(
        DANCING_MAD_ENCOUNTER_NAME,
        fight,
        state?.phaseReferenceEvents ?? [],
      );
      const starts = [...phaseStarts.entries()]
        .filter(([, startMs]) => Number.isFinite(startMs) && startMs < durationMs)
        .sort((first, second) => first[1] - second[1]);
      const row = document.createElement('tr');
      const pull = document.createElement('th');
      pull.scope = 'row';
      pull.textContent = `Pull ${fight.id}`;
      row.append(pull);
      for (let phase = 1; phase <= 5; phase += 1) {
        const phaseEntryIndex = starts.findIndex(([candidate]) => Number(candidate) === phase);
        const cell = document.createElement('td');
        if (phaseEntryIndex < 0) {
          cell.textContent = '—';
        } else {
          const startMs = starts[phaseEntryIndex][1];
          const endMs = starts[phaseEntryIndex + 1]?.[1] ?? durationMs;
          const metrics = calculatePlayerActionUptimeMetrics(
            fight,
            state,
            playerName,
            gcd,
            startMs,
            endMs,
          );
          const percent = metric === 'dot' ? metrics.dotPercent : metrics.gcdPercent;
          cell.textContent = Number.isFinite(percent)
            ? `${percent.toFixed(1)}%`
            : '—';
        }
        row.append(cell);
      }
      const totalCell = document.createElement('td');
      totalCell.className = 'special-views-total';
      const totalMetrics = calculatePlayerActionUptimeMetrics(
        fight,
        state,
        playerName,
        gcd,
        0,
        durationMs,
      );
      const totalPercent = metric === 'dot'
        ? totalMetrics.dotPercent
        : totalMetrics.gcdPercent;
      totalCell.textContent = Number.isFinite(totalPercent)
        ? `${totalPercent.toFixed(1)}%`
        : '—';
      row.append(totalCell);
      body.append(row);
    }
    table.append(head, body);
    const scroller = document.createElement('div');
    scroller.className = 'special-views-table-scroll';
    scroller.append(table);
    return scroller;
  }

  function createSpecialActionTimeline(
    report,
    fights,
    playerName,
    pixelsPerSecond,
    minimumDurationMs,
    onMinimumDurationChange,
    mode,
    afflatusDisplayMode = 'lilies',
  ) {
    const scroller = document.createElement('div');
    scroller.className = 'special-views-lucid-scroll';
    const rows = document.createElement('div');
    rows.className = 'special-views-lucid-rows';
    const maximumDurationMs = Math.max(0, ...fights.map(getFightDuration));
    const maximumTrackWidth = (maximumDurationMs / 1000) * pixelsPerSecond;
    const thresholdRow = document.createElement('label');
    thresholdRow.className = 'special-views-lucid-threshold';
    const thresholdText = document.createElement('span');
    thresholdText.textContent = 'Hide pulls ending before';
    const thresholdControl = document.createElement('span');
    thresholdControl.className = 'special-views-lucid-threshold-control';
    thresholdControl.style.width = `${maximumTrackWidth}px`;
    const thresholdInput = document.createElement('input');
    thresholdInput.type = 'range';
    thresholdInput.min = '0';
    thresholdInput.max = String(maximumDurationMs);
    thresholdInput.step = '1000';
    thresholdInput.value = String(Math.min(minimumDurationMs, maximumDurationMs));
    thresholdInput.setAttribute('aria-label', 'Hide pulls ending before this time');
    const thresholdValue = document.createElement('output');
    thresholdValue.textContent = formatFightDuration(Number(thresholdInput.value));
    thresholdValue.style.left = maximumDurationMs > 0
      ? `${(Number(thresholdInput.value) / maximumDurationMs) * 100}%`
      : '0%';
    thresholdControl.append(thresholdInput, thresholdValue);
    thresholdRow.append(thresholdText, thresholdControl);
    rows.append(thresholdRow);
    for (const fight of fights) {
      const state = getFightDetails().get(`${report.code}:${fight.id}`);
      const durationMs = getFightDuration(fight);
      if (!(durationMs > 0)) continue;
      const casts = (state?.actionCasts ?? [])
        .filter((action) => {
          if (action.source !== playerName || action.eventType === 'begincast') return false;
          const ability = String(action.ability).toLocaleLowerCase();
          return mode === 'afflatus'
            ? WHM_AFFLATUS_ACTIONS.has(ability)
            : ability === 'lucid dreaming';
        })
        .map((action) => ({
          ability: String(action.ability).toLocaleLowerCase(),
          timestamp: Number(action.timestamp) - Number(fight.startTime),
        }))
        .filter((cast) => cast.timestamp >= 0 && cast.timestamp <= durationMs)
        .sort((first, second) => first.timestamp - second.timestamp);
      const row = document.createElement('section');
      row.className = 'special-views-lucid-row';
      row.dataset.durationMs = String(durationMs);
      row.hidden = durationMs < Number(thresholdInput.value);
      const identity = document.createElement('div');
      identity.className = 'special-views-lucid-pull';
      const pullNumber = document.createElement('strong');
      pullNumber.textContent = `Pull ${fight.id}`;
      identity.append(pullNumber, createBestPullBadge(fight));
      const track = document.createElement('div');
      track.className = 'special-views-lucid-track';
      track.style.width = `${(durationMs / 1000) * pixelsPerSecond}px`;
      if (mode === 'afflatus') {
        appendAfflatusStateRanges(track, casts, durationMs, afflatusDisplayMode);
      }
      let coveredUntil = null;
      for (const cast of casts) {
        const castMs = cast.timestamp;
        if (mode === 'lucid') {
          if (Number.isFinite(coveredUntil) && castMs > coveredUntil) {
            appendLucidDreamingRange(track, coveredUntil, castMs, durationMs, 'gap');
          }
          const coverageEnd = Math.min(durationMs, castMs + 60_000);
          appendLucidDreamingRange(track, castMs, coverageEnd, durationMs, 'coverage');
          coveredUntil = Math.max(coveredUntil ?? 0, coverageEnd);
        }
        const tick = document.createElement('span');
        const afflatusName = WHM_AFFLATUS_ACTIONS.get(cast.ability);
        tick.className = mode === 'afflatus'
          ? `special-views-lucid-tick afflatus ${afflatusName?.toLocaleLowerCase() ?? ''}`
          : 'special-views-lucid-tick';
        tick.style.left = `${(castMs / durationMs) * 100}%`;
        tick.title = `${mode === 'afflatus' ? `Afflatus ${afflatusName}` : 'Lucid Dreaming'} · ${formatPreciseFightDuration(castMs)}`;
        tick.setAttribute('aria-label', tick.title);
        if (mode === 'afflatus') tick.textContent = afflatusName?.[0] ?? '';
        track.append(tick);
      }
      const endLabel = document.createElement('span');
      endLabel.className = 'special-views-lucid-end';
      endLabel.textContent = formatFightDuration(durationMs);
      track.append(endLabel);
      appendLucidDreamingHoverTime(track, durationMs);
      row.append(identity, track);
      rows.append(row);
    }
    thresholdInput.addEventListener('input', () => {
      const thresholdMs = Number(thresholdInput.value);
      thresholdValue.textContent = formatFightDuration(thresholdMs);
      thresholdValue.style.left = maximumDurationMs > 0
        ? `${(thresholdMs / maximumDurationMs) * 100}%`
        : '0%';
      for (const row of rows.querySelectorAll('.special-views-lucid-row')) {
        row.hidden = Number(row.dataset.durationMs) < thresholdMs;
      }
      onMinimumDurationChange(thresholdMs);
    });
    scroller.append(rows);
    return scroller;
  }

  function appendAfflatusStateRanges(track, casts, durationMs, displayMode) {
    const events = casts.map((cast) => ({ ...cast, type: 'cast' }));
    for (let timestamp = 20_000; timestamp < durationMs; timestamp += 20_000) {
      events.push({ timestamp, type: 'lily-generation' });
    }
    events.sort((first, second) => first.timestamp - second.timestamp
      || (first.type === 'lily-generation' ? -1 : 1));
    let lilies = 3;
    let miseryCharges = 0;
    let rangeStart = 0;
    for (const event of events) {
      appendAfflatusStateRange(
        track,
        rangeStart,
        event.timestamp,
        durationMs,
        displayMode,
        displayMode === 'misery' ? miseryCharges : lilies,
      );
      if (event.type === 'lily-generation') {
        lilies = Math.min(3, lilies + 1);
      } else {
        const action = WHM_AFFLATUS_ACTIONS.get(event.ability);
        if (['Solace', 'Rapture'].includes(action)) {
          lilies = Math.max(0, lilies - 1);
          miseryCharges = Math.min(3, miseryCharges + 1);
        } else if (action === 'Misery') {
          miseryCharges = 0;
        }
      }
      rangeStart = event.timestamp;
    }
    appendAfflatusStateRange(
      track,
      rangeStart,
      durationMs,
      durationMs,
      displayMode,
      displayMode === 'misery' ? miseryCharges : lilies,
    );
  }

  function appendAfflatusStateRange(track, startMs, endMs, durationMs, displayMode, amount) {
    if (!(endMs > startMs)) return;
    const range = document.createElement('span');
    range.className = `special-views-afflatus-state ${displayMode} amount-${amount}`;
    range.style.left = `${(startMs / durationMs) * 100}%`;
    range.style.width = `${((endMs - startMs) / durationMs) * 100}%`;
    track.append(range);
  }

  function appendLucidDreamingHoverTime(track, durationMs) {
    const line = document.createElement('span');
    line.className = 'special-views-lucid-hover-line';
    const label = document.createElement('span');
    label.className = 'special-views-lucid-hover-time';
    track.addEventListener('mousemove', (event) => {
      const rectangle = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width));
      line.style.left = `${ratio * 100}%`;
      label.style.left = `${ratio * 100}%`;
      label.textContent = formatPreciseFightDuration(ratio * durationMs);
      track.classList.add('show-hover-time');
    });
    track.addEventListener('mouseleave', () => track.classList.remove('show-hover-time'));
    track.append(line, label);
  }

  function appendLucidDreamingRange(track, startMs, endMs, durationMs, kind) {
    if (!(endMs > startMs) || !(durationMs > 0)) return;
    const range = document.createElement('span');
    range.className = `special-views-lucid-range ${kind}`;
    range.style.left = `${(startMs / durationMs) * 100}%`;
    range.style.width = `${((endMs - startMs) / durationMs) * 100}%`;
    track.append(range);
  }
  
  function createLoadedPlayerActionAbilityCatalog(fights, report) {
    const abilitiesById = new Map();
    for (const fight of fights) {
      const actions = getFightDetails().get(`${report.code}:${fight.id}`)?.actionCasts ?? [];
      for (const action of actions) {
        const id = Number(action.abilityId);
        if (!Number.isFinite(id)
          || id >= FFLOGS_PSEUDO_ACTION_ID_MIN
          || !playerActionGameDataById.has(id)
          || abilitiesById.has(id)) continue;
        abilitiesById.set(id, {
          id,
          name: action.ability,
          icon: action.icon,
        });
      }
    }
    return [...abilitiesById.values()]
      .filter((ability) => ability.name)
      .sort((first, second) => first.name.localeCompare(second.name));
  }
  
  function rankPlayerActionAbilities(abilities, query) {
    const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];
    return abilities
      .map((ability) => ({
        ...ability,
        matchIndex: ability.name.toLocaleLowerCase().indexOf(normalizedQuery),
      }))
      .filter((ability) => ability.matchIndex >= 0)
      .sort((first, second) => first.matchIndex - second.matchIndex
        || first.name.localeCompare(second.name));
  }
  
  function createPlayerActionsAbilityFilter({
    abilityCatalog,
    selectedAbilityIds,
    filterState,
    onChange,
  }) {
    const section = document.createElement('section');
    section.className = 'player-actions-ability-filter';
    const heading = document.createElement('h4');
    heading.textContent = 'Highlight abilities';
    const form = document.createElement('form');
    form.className = 'player-actions-ability-search';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'player-actions-ability-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search loaded abilities…';
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('aria-label', 'Search loaded abilities');
    searchInput.setAttribute('aria-autocomplete', 'list');
    const results = document.createElement('div');
    results.className = 'player-actions-ability-results';
    results.setAttribute('role', 'listbox');
    results.hidden = true;
  
    const positionResults = () => {
      if (results.hidden || !searchWrap.isConnected) return;
      const anchor = searchWrap.getBoundingClientRect();
      const viewportGap = 8;
      const popupGap = 4;
      const maximumHeight = 260;
      const spaceBelow = Math.max(0, window.innerHeight - anchor.bottom - popupGap - viewportGap);
      const spaceAbove = Math.max(0, anchor.top - popupGap - viewportGap);
      const desiredHeight = Math.min(maximumHeight, results.scrollHeight);
      const opensUpward = desiredHeight > spaceBelow && spaceAbove > spaceBelow;
      const availableHeight = opensUpward ? spaceAbove : spaceBelow;
      results.classList.toggle('opens-upward', opensUpward);
      results.style.left = `${anchor.left}px`;
      results.style.width = `${anchor.width}px`;
      results.style.maxHeight = `${Math.min(maximumHeight, availableHeight)}px`;
      results.style.top = opensUpward
        ? `${Math.max(viewportGap, anchor.top - popupGap - Math.min(desiredHeight, availableHeight))}px`
        : `${anchor.bottom + popupGap}px`;
    };
  
    const createAbilityImage = (ability) => {
      if (!ability.icon || isUnknownFflogsStatus(ability.name, ability.icon)) {
        const fallback = createFightEventStatusFallback(ability.name);
        fallback.classList.add('player-actions-ability-image');
        return fallback;
      }
      const image = document.createElement('img');
      image.className = 'player-actions-ability-image';
      image.src = ability.icon;
      image.alt = '';
      image.loading = 'lazy';
      return image;
    };
    const hideResults = () => {
      results.hidden = true;
      results.replaceChildren();
    };
    const renderResults = () => {
      const matches = rankPlayerActionAbilities(abilityCatalog, searchInput.value).slice(0, 30);
      results.replaceChildren(...matches.map((ability) => {
        const option = document.createElement('div');
        option.className = 'player-actions-ability-result';
        option.setAttribute('role', 'option');
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'player-actions-ability-result-choice';
        choice.append(createAbilityImage(ability), ability.name);
        choice.addEventListener('click', () => {
          searchInput.value = ability.name;
          hideResults();
          searchInput.focus();
        });
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'player-actions-ability-result-add';
        add.textContent = '+';
        add.title = `Add ${ability.name}`;
        add.setAttribute('aria-label', `Add ${ability.name}`);
        add.addEventListener('click', () => {
          selectedAbilityIds.add(ability.id);
          visibilityCheckbox.disabled = false;
          renderSelected();
          onChange();
        });
        option.append(choice, add);
        return option;
      }));
      results.hidden = matches.length === 0;
      positionResults();
    };
    searchInput.addEventListener('input', renderResults);
    searchInput.addEventListener('focus', renderResults);
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideResults();
    });
    searchWrap.append(searchInput, results);
    const visibilityLabel = document.createElement('label');
    visibilityLabel.className = 'player-actions-hide-unhighlighted';
    const visibilityCheckbox = document.createElement('input');
    visibilityCheckbox.type = 'checkbox';
    visibilityCheckbox.checked = filterState.hideUnhighlighted;
    visibilityCheckbox.disabled = selectedAbilityIds.size === 0;
    visibilityCheckbox.setAttribute('aria-label', 'Hide unhighlighted actions');
    visibilityLabel.append(visibilityCheckbox, 'Hide unhighlighted actions');
    form.append(searchWrap, visibilityLabel);
    const selectedList = document.createElement('div');
    selectedList.className = 'player-actions-selected-abilities';
  
    const renderSelected = () => {
      const selected = abilityCatalog.filter((ability) => selectedAbilityIds.has(ability.id));
      selectedList.replaceChildren(...selected.map((ability) => {
        const item = document.createElement('span');
        item.className = 'player-actions-selected-ability';
        item.append(createAbilityImage(ability), ability.name);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = `Remove ${ability.name}`;
        remove.setAttribute('aria-label', `Remove ${ability.name}`);
        remove.addEventListener('click', () => {
          selectedAbilityIds.delete(ability.id);
          if (selectedAbilityIds.size === 0) filterState.hideUnhighlighted = false;
          visibilityCheckbox.checked = filterState.hideUnhighlighted;
          visibilityCheckbox.disabled = selectedAbilityIds.size === 0;
          renderSelected();
          onChange();
        });
        item.append(remove);
        return item;
      }));
      if (selected.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'player-actions-selected-empty';
        empty.textContent = 'No abilities highlighted.';
        selectedList.append(empty);
      }
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    visibilityCheckbox.addEventListener('change', () => {
      filterState.hideUnhighlighted = visibilityCheckbox.checked;
      onChange();
    });
    const positionController = new AbortController();
    document.addEventListener('scroll', positionResults, {
      capture: true,
      signal: positionController.signal,
    });
    window.addEventListener('resize', positionResults, { signal: positionController.signal });
    queueMicrotask(() => section.closest('dialog')?.addEventListener(
      'close',
      () => positionController.abort(),
      { once: true },
    ));
    section.append(heading, form, selectedList);
    renderSelected();
    return section;
  }
  
  function createPlayerActionsControlLabel(text) {
    const label = document.createElement('label');
    label.className = 'player-actions-control-label';
    const caption = document.createElement('span');
    caption.textContent = text;
    label.append(caption);
    return label;
  }
  
  function createPlayerActionsTimeControl(labelText, value, maximumMs, unsetValueMs) {
    const label = createPlayerActionsControlLabel(labelText);
    label.classList.add('player-actions-time-control');
    const fields = document.createElement('span');
    fields.className = 'player-actions-time-fields';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.inputMode = 'numeric';
    textInput.value = value;
    textInput.placeholder = 'm:ss';
    textInput.setAttribute('aria-label', `Time range ${labelText.toLowerCase()} text`);
    const rangeInput = document.createElement('input');
    rangeInput.type = 'range';
    rangeInput.min = '0';
    rangeInput.max = String(maximumMs);
    rangeInput.step = '100';
    rangeInput.value = String(unsetValueMs);
    rangeInput.className = 'unset';
    rangeInput.setAttribute('aria-label', `Time range ${labelText.toLowerCase()} slider`);
    fields.append(textInput, rangeInput);
    label.append(fields);
    const control = { label, textInput, rangeInput };
    const milliseconds = parseFightTimeInput(value);
    if (Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= maximumMs) {
      syncPlayerActionsTimeControl(control, milliseconds, { preserveText: true });
    }
    return control;
  }
  
  function syncPlayerActionsTimeControl(control, milliseconds, { preserveText = false } = {}) {
    control.rangeInput.value = String(milliseconds);
    control.rangeInput.classList.remove('unset');
    if (!preserveText) control.textInput.value = formatFightDuration(milliseconds);
  }
  
  function getPlayerActionsPhaseAnchorMs(fight, state, phaseAnchor) {
    if (phaseAnchor === 'fight') return 0;
    const phase = Number(phaseAnchor);
    if (!Number.isInteger(phase) || phase < 1 || phase > 5) return Number.NaN;
    const phaseStarts = resolveEncounterPhaseStarts(
      DANCING_MAD_ENCOUNTER_NAME,
      fight,
      state?.phaseReferenceEvents ?? [],
    );
    return phaseStarts.get(phase) ?? Number.NaN;
  }
  
  // FFLogs' ability `type` is a damage/healing school, not FFXIV's action
  // category. Resolve the real category in bulk so healing abilities such as
  // Asylum are not mistaken for spells. A failed lookup falls back gracefully.
  async function loadPlayerActionCategories(actions) {
    const unknownIds = [...new Set(actions
      .map((action) => Number(action.abilityId))
      .filter((abilityId) => Number.isFinite(abilityId)
        && !playerActionGameDataById.has(abilityId)))];
    const pseudoActionIds = unknownIds.filter((abilityId) => abilityId >= FFLOGS_PSEUDO_ACTION_ID_MIN);
    for (const abilityId of pseudoActionIds) {
      playerActionGameDataById.set(abilityId, { category: 'Ability' });
    }
    const xivapiActionIds = unknownIds.filter((abilityId) => abilityId < FFLOGS_PSEUDO_ACTION_ID_MIN);
    const chunks = [];
    for (let index = 0; index < xivapiActionIds.length; index += 100) {
      chunks.push(xivapiActionIds.slice(index, index + 100));
    }
    await Promise.all(chunks.map(async (abilityIds) => {
      try {
        const params = new URLSearchParams({
          rows: abilityIds.join(','),
          fields: 'ActionCategory.Name,Recast100ms,CooldownGroup,AdditionalCooldownGroup',
        });
        const response = await fetch(`https://v2.xivapi.com/api/sheet/Action?${params}`);
        if (!response.ok) {
          console.warn('XIVAPI action-category request returned an error.', {
            abilityIds,
            status: response.status,
            statusText: response.statusText,
            responseBody: await response.text(),
          });
          return;
        }
        const payload = await response.json();
        for (const row of payload.rows ?? []) {
          const abilityId = Number(row.row_id);
          const category = row.fields?.ActionCategory?.fields?.Name;
          if (Number.isFinite(abilityId) && category) {
            playerActionGameDataById.set(abilityId, {
              category,
              recastMs: Number(row.fields?.Recast100ms) * 100,
              cooldownGroup: Number(row.fields?.CooldownGroup),
              additionalCooldownGroup: Number(row.fields?.AdditionalCooldownGroup),
            });
          }
        }
      } catch (error) {
        console.warn('Failed to load XIVAPI action categories.', {
          abilityIds,
          error,
        });
        // The timeline remains usable with FFLogs' best-effort fallback styling.
      }
    }));
  }
  
  function getPlayerActionGameData(action) {
    const loaded = playerActionGameDataById.get(Number(action.abilityId));
    if (loaded) return loaded;
    const category = action.category;
    const normalizedCategory = String(category ?? '').trim().toLowerCase();
    const isFallbackGcd = normalizedCategory === 'spell' || normalizedCategory === 'weaponskill';
    return {
      category,
      recastMs: isFallbackGcd ? PLAYER_ACTION_BASE_GCD_MS : Number.NaN,
      cooldownGroup: isFallbackGcd ? PLAYER_ACTION_GCD_COOLDOWN_GROUP : Number.NaN,
      additionalCooldownGroup: Number.NaN,
    };
  }
  
  function getPlayerActionMarkerCategory(action) {
    // FFLogs/test fixtures may include an actionCategory hint, but the game-data
    // category is authoritative whenever XIVAPI returned one for this action ID.
    const category = getPlayerActionGameData(action).category;
    const normalizedCategory = String(category ?? '').trim().toLowerCase();
    if (normalizedCategory === 'auto-attack') return 'auto-attack';
    if (normalizedCategory === 'spell' || normalizedCategory === 'weaponskill') {
      return 'spell-or-weaponskill';
    }
    // FFLogs represents consumables with pseudo-action IDs that have no Action
    // sheet row. Non-GCD/unresolved actions therefore share the Ability treatment;
    // only authoritative Spell and Weaponskill categories use the baseline style.
    return 'ability';
  }
  
  function isPlayerActionGcd(action) {
    const data = getPlayerActionGameData(action);
    // The primary cooldown group determines whether the action is on the GCD.
    // Eukrasia is the known exception: it uses its own short primary recast and
    // may reference the normal GCD group differently across XIVAPI data versions.
    // ActionCategory cannot guard this generally because FFXIV categorizes
    // magical oGCD abilities as Spells, so keep the exception name-specific.
    const ability = String(action.ability ?? '').trim().toLowerCase();
    return data.cooldownGroup === PLAYER_ACTION_GCD_COOLDOWN_GROUP
      || PLAYER_ACTION_EXPLICIT_GCDS.has(ability);
  }

  function getPlayerActionFixedGcdRecast(action) {
    return PLAYER_ACTION_FIXED_GCD_RECASTS.get(
      String(action.ability ?? '').trim().toLowerCase(),
    );
  }
  
  function getPlayerActionSpeedType(action) {
    const category = String(getPlayerActionGameData(action).category ?? '').trim().toLowerCase();
    if (category === 'spell') return 'spellSpeed';
    if (category === 'weaponskill') return 'skillSpeed';
    return null;
  }
  
  function getPlayerPrimarySpeedType(fights, report, playerName) {
    for (const fight of fights) {
      const member = getFightDetails().get(`${report.code}:${fight.id}`)?.partyMembers
        ?.find((entry) => entry.name === playerName);
      if (member?.job) {
        return PLAYER_ACTION_SPELL_SPEED_JOBS.has(member.job) ? 'spellSpeed' : 'skillSpeed';
      }
    }
    return null;
  }
  
  function getSpeedStatAdjustedDuration(speedStat, baseDurationMs = PLAYER_ACTION_BASE_GCD_MS) {
    if (!Number.isFinite(speedStat)) return Number.NaN;
    const attributeMultiplier = 1_000 - Math.floor(130 * (speedStat - 420) / 2_780);
    const adjustedDuration = Math.floor(attributeMultiplier * baseDurationMs / 1_000);
    return Math.floor(adjustedDuration / 10) * 10;
  }
  
  function getProvidedPlayerGcd(fights, report, playerName, speedType) {
    if (!speedType) return null;
    for (const fight of fights) {
      const state = getFightDetails().get(`${report.code}:${fight.id}`);
      const attributes = state?.playerSpeedAttributes
        ?.find((entry) => entry.source === playerName);
      const speedStat = Number(attributes?.[speedType]);
      if (!Number.isFinite(speedStat)) continue;
      const durationMs = getSpeedStatAdjustedDuration(speedStat);
      if (Number.isFinite(durationMs)) return { durationMs, estimated: false, sampleCount: 0 };
    }
    return null;
  }
  
  function getPlayerJob(fightState, playerName) {
    return fightState?.partyMembers?.find((entry) => entry.name === playerName)?.job ?? null;
  }
  
  function buildPlayerSpeedModifierWindows(events, playerName) {
    const windowsByStatus = new Map();
    for (const event of events ?? []) {
      if (event.target !== playerName) continue;
      let windows = windowsByStatus.get(event.statusId);
      if (!windows) {
        windows = [];
        windowsByStatus.set(event.statusId, windows);
      }
      const openWindow = windows.at(-1);
      if (event.eventType === 'removebuff') {
        if (openWindow && openWindow.end === null) openWindow.end = event.timestamp;
      } else if (!openWindow || openWindow.end !== null) {
        windows.push({ start: event.timestamp, end: null });
      }
    }
    return windowsByStatus;
  }
  
  function getPlayerSpeedModifierAtTimestamp(windowsByStatus, job, timestamp) {
    let modifier = PLAYER_ACTION_JOB_SPEED_MODIFIERS.get(job) ?? 1;
    for (const [statusId, windows] of windowsByStatus) {
      if (windows.some((window) => window.start < timestamp
        && timestamp <= (window.end ?? Number.POSITIVE_INFINITY))) {
        modifier *= PLAYER_ACTION_SPEED_STATUS_MODIFIERS.get(statusId) ?? 1;
      }
    }
    return modifier;
  }
  
  function collectCompletedPlayerGcds(actions, speedType) {
    const { visibleActions, castSpans } = pairPlayerActionEvents(actions);
    const completedSpansByEnd = new Map(castSpans
      .filter((span) => span.outcome === 'completed')
      .map((span) => [span.end, span]));
    const gcds = visibleActions
      .filter((action) => action.eventType === 'cast'
        && isPlayerActionGcd(action)
        && (!speedType || getPlayerActionSpeedType(action) === speedType))
      .map((action) => {
        const span = completedSpansByEnd.get(action);
        return {
          action,
          timestamp: Number(span?.begin.timestamp ?? action.timestamp),
          completionTimestamp: Number(action.timestamp),
          castDurationMs: Number(span?.begin.duration),
        };
      })
      .filter((entry) => Number.isFinite(entry.timestamp))
      .sort((first, second) => first.timestamp - second.timestamp);
    return gcds.filter((entry, index) => {
      const previous = gcds[index - 1];
      if (!previous) return true;
      const sameAbility = String(previous.action.ability ?? '').trim().toLowerCase()
        === String(entry.action.ability ?? '').trim().toLowerCase();
      const completionGap = Math.abs(previous.completionTimestamp - entry.completionTimestamp);
      const sameBatch = completionGap <= PLAYER_ACTION_LOG_BATCH_MS;
      const castAndEffectPair = completionGap <= 2_000
        && Number.isFinite(previous.castDurationMs) !== Number.isFinite(entry.castDurationMs);
      return !sameAbility || (!sameBatch && !castAndEffectPair);
    });
  }
  
  function estimateGcdFromIntervals(intervals) {
    if (intervals.length < 3) return null;
    const batches = new Map();
    for (const interval of intervals) {
      const batch = Math.floor(interval / PLAYER_ACTION_LOG_BATCH_MS);
      batches.set(batch, (batches.get(batch) ?? 0) + 1);
    }
    const modeBatch = [...batches.entries()]
      .reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
    let weightedTotal = 0;
    let sampleCount = 0;
    for (let batch = modeBatch - 2; batch <= modeBatch + 2; batch += 1) {
      const count = batches.get(batch) ?? 0;
      if (count === 0) continue;
      const midpoint = batch * PLAYER_ACTION_LOG_BATCH_MS + (PLAYER_ACTION_LOG_BATCH_MS - 1) / 2;
      weightedTotal += midpoint * count;
      sampleCount += count;
    }
    if (sampleCount < 3) return null;
    return {
      durationMs: Math.round((weightedTotal / sampleCount) / 10) * 10,
      estimated: true,
      sampleCount,
    };
  }
  
  function estimatePlayerGcd(fights, report, playerName) {
    const speedType = getPlayerPrimarySpeedType(fights, report, playerName);
    const provided = getProvidedPlayerGcd(fights, report, playerName, speedType);
    if (provided) return provided;
    const intervals = [];
    for (const fight of fights) {
      const state = getFightDetails().get(`${report.code}:${fight.id}`);
      const actions = (state?.actionCasts ?? [])
        .filter((action) => action.source === playerName);
      const speedModifierWindows = buildPlayerSpeedModifierWindows(
        state?.playerSpeedStatusEvents,
        playerName,
      );
      const playerJob = getPlayerJob(state, playerName);
      const gcds = collectCompletedPlayerGcds(actions, speedType);
      for (let index = 1; index < gcds.length; index += 1) {
        const previous = gcds[index - 1];
        const current = gcds[index];
        const gameData = getPlayerActionGameData(previous.action);
        const fixedRecastMs = getPlayerActionFixedGcdRecast(previous.action);
        const ability = String(previous.action.ability ?? '').trim().toLowerCase();
        const baseRecastMs = fixedRecastMs
          ?? (PLAYER_ACTION_BASE_GCD_OVERRIDES.has(ability) ? PLAYER_ACTION_BASE_GCD_MS : null)
          ?? (Number.isFinite(gameData.recastMs) && gameData.recastMs > 0
            ? gameData.recastMs
            : PLAYER_ACTION_BASE_GCD_MS);
        const hasLongCast = Number.isFinite(previous.castDurationMs)
          && previous.castDurationMs >= PLAYER_ACTION_BASE_GCD_MS;
        const intervalBaseMs = hasLongCast ? previous.castDurationMs : baseRecastMs;
        const rawIntervalMs = current.timestamp - previous.timestamp
          - (hasLongCast ? PLAYER_ACTION_CAST_ANIMATION_LOCK_MS : 0);
        const speedModifier = Number.isFinite(fixedRecastMs)
          ? 1
          : getPlayerSpeedModifierAtTimestamp(
            speedModifierWindows,
            playerJob,
            previous.timestamp,
          );
        // Normalize job/status haste out of the logged interval so intervals from
        // different jobs and temporary speed-buff windows estimate the same GCD.
        const normalizedIntervalMs = rawIntervalMs
          / (intervalBaseMs / PLAYER_ACTION_BASE_GCD_MS)
          / speedModifier;
        if (normalizedIntervalMs >= 1_000 && normalizedIntervalMs <= 4_000) {
          intervals.push(normalizedIntervalMs);
        }
      }
    }
    return estimateGcdFromIntervals(intervals);
  }
  
  function formatPlayerGcdSummary(gcd) {
    if (!gcd) return 'GCD unavailable';
    const duration = `${(gcd.durationMs / 1_000).toFixed(2)}s`;
    return gcd.estimated
      ? `Estimated GCD: ${duration} (${gcd.sampleCount} samples)`
      : `GCD: ${duration} (FFLogs stats)`;
  }
  
  function parseFightTimeInput(value) {
    const match = String(value ?? '').trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    if (!match) return Number.NaN;
    const seconds = Number(match[2]);
    if (match[1] === undefined) return Number.isFinite(seconds) ? seconds * 1000 : Number.NaN;
    const minutes = Number(match[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return Number.NaN;
    return (minutes * 60 + seconds) * 1000;
  }
  
  const PLAYER_ACTION_CANCEL_EVENT_TYPES = new Set([
    'cancelcast', 'castcancel', 'cancelledcast', 'castcancelled',
  ]);
  
  function pairPlayerActionEvents(actions) {
    const visibleActions = [];
    const castSpans = [];
    const pendingBySource = new Map();
    const sortedActions = [...actions].sort((first, second) => first.timestamp - second.timestamp);
  
    const finishPending = (pending, endAction, outcome) => {
      if (!pending) return;
      castSpans.push({ begin: pending, end: endAction, outcome });
      const sourceKey = String(pending.sourceId ?? pending.source);
      const sourcePending = pendingBySource.get(sourceKey) ?? [];
      sourcePending.splice(sourcePending.indexOf(pending), 1);
    };
  
    for (const action of sortedActions) {
      const eventType = action.eventType ?? 'cast';
      const sourceKey = String(action.sourceId ?? action.source);
      const sourcePending = pendingBySource.get(sourceKey) ?? [];
      if (eventType === 'begincast') {
        for (const pending of [...sourcePending]) finishPending(pending, action, 'cancelled');
        sourcePending.push(action);
        pendingBySource.set(sourceKey, sourcePending);
        visibleActions.push(action);
        continue;
      }
  
      const matchingPending = [...sourcePending].reverse().find((pending) => (
        Number(pending.abilityId) === Number(action.abilityId)
      ));
      if (PLAYER_ACTION_CANCEL_EVENT_TYPES.has(eventType)) {
        finishPending(matchingPending, action, 'cancelled');
        continue;
      }
  
      if (eventType === 'cast') {
        for (const pending of [...sourcePending]) {
          finishPending(pending, action, pending === matchingPending ? 'completed' : 'cancelled');
        }
        visibleActions.push(action);
      }
    }
  
    return { visibleActions, castSpans };
  }
  
  function appendPlayerActionMechanicTicks(track, fight, state, startMs, endMs, displayAnchorMs = 0) {
    const phaseStarts = resolveEncounterPhaseStarts(
      DANCING_MAD_ENCOUNTER_NAME,
      fight,
      state?.phaseReferenceEvents ?? [],
    );
    let visibleMechanicIndex = 0;
    for (const mechanic of getDancingMadMechanics()) {
      const elapsedMs = getEncounterRelativeTimestamp(mechanic, phaseStarts);
      if (elapsedMs < startMs || elapsedMs > endMs) continue;
      const position = ((elapsedMs - startMs) / (endMs - startMs)) * 100;
      const tick = document.createElement('span');
      tick.className = 'player-actions-mechanic-tick';
      tick.classList.add(`label-tier-${visibleMechanicIndex % 2}`);
      tick.style.left = `${position}%`;
      tick.title = `${mechanic.mechanic} · ${formatPreciseFightDuration(elapsedMs - displayAnchorMs)}`;
      tick.setAttribute('aria-label', tick.title);
      const label = document.createElement('span');
      label.className = 'player-actions-mechanic-label';
      label.textContent = mechanic.mechanic;
      tick.append(label);
      track.append(tick);
      visibleMechanicIndex += 1;
    }
  }

  function calculatePlayerActionUptimeMetrics(
    fight,
    state,
    playerName,
    gcd,
    shownStartMs,
    shownEndMs,
  ) {
    const fightStart = Number(fight.startTime);
    const fightDuration = getFightDuration(fight);
    if (!Number.isFinite(fightStart) || fightDuration <= 0) {
      return { gcdPercent: null, dotPercent: null };
    }
    // Uptime describes only the slice currently shown in the timeline, not the whole pull.
    const rangeStartMs = Math.max(0, Number(shownStartMs) || 0);
    const rangeEndMs = Math.min(
      fightDuration,
      Number.isFinite(Number(shownEndMs)) ? Number(shownEndMs) : fightDuration,
    );
    const rangeDurationMs = rangeEndMs - rangeStartMs;
    if (rangeDurationMs <= 0) return { gcdPercent: null, dotPercent: null };
    const player = (state?.partyMembers ?? []).find((member) => member.name === playerName);
    const actions = (state?.actionCasts ?? []).filter((action) => action.source === playerName);
    const untargetableWindows = buildGlobalUntargetableWindows(
      state?.targetabilityEvents,
      fightStart,
      fightStart + fightDuration,
    ).map(([start, end]) => [start - fightStart, end - fightStart]);
    const actionableDurationMs = rangeDurationMs - measureMergedIntervalDuration(
      untargetableWindows,
      rangeStartMs,
      rangeEndMs,
    );
    const speedModifierWindows = buildPlayerSpeedModifierWindows(
      state?.playerSpeedStatusEvents,
      playerName,
    );
    const gcdIntervals = collectCompletedPlayerGcds(actions, null).flatMap((entry) => {
      const castStartMs = entry.timestamp - fightStart;
      if (isTimestampInIntervals(castStartMs, untargetableWindows)) return [];
      const gameData = getPlayerActionGameData(entry.action);
      const fixedRecastMs = getPlayerActionFixedGcdRecast(entry.action);
      const ability = String(entry.action.ability ?? '').trim().toLowerCase();
      const baseRecastMs = fixedRecastMs
        ?? (PLAYER_ACTION_BASE_GCD_OVERRIDES.has(ability) ? PLAYER_ACTION_BASE_GCD_MS : null)
        ?? (Number.isFinite(gameData.recastMs) && gameData.recastMs > 0
          ? gameData.recastMs
          : PLAYER_ACTION_BASE_GCD_MS);
      const speedType = getPlayerActionSpeedType(entry.action);
      const statScale = !Number.isFinite(fixedRecastMs)
        && speedType && Number.isFinite(gcd?.durationMs)
        ? gcd.durationMs / PLAYER_ACTION_BASE_GCD_MS
        : 1;
      const hasteScale = Number.isFinite(fixedRecastMs)
        ? 1
        : getPlayerSpeedModifierAtTimestamp(
          speedModifierWindows,
          player?.job,
          entry.timestamp,
        );
      const recastMs = baseRecastMs * statScale * hasteScale;
      const occupiedMs = Number.isFinite(entry.castDurationMs)
        ? Math.max(recastMs, entry.castDurationMs + PLAYER_ACTION_CAST_ANIMATION_LOCK_MS)
        : recastMs;
      const intervalStartMs = entry.timestamp - fightStart;
      return [[intervalStartMs, intervalStartMs + occupiedMs]];
    });
    const gcdOccupiedMs = gcdIntervals.reduce((total, interval) => (
      total + measureIntervalOutsideWindows(
        interval,
        untargetableWindows,
        rangeStartMs,
        rangeEndMs,
      )
    ), 0);
    const gcdPercent = gcdIntervals.length > 0 && actionableDurationMs > 0
      ? Math.min(100, (gcdOccupiedMs / actionableDurationMs) * 100)
      : null;
    const dotPercent = calculatePlayerDotUptimePercent(
      state?.playerDebuffEvents,
      playerName,
      player?.job,
      fightStart,
      fightDuration,
      rangeStartMs,
      rangeEndMs,
      state?.targetabilityEvents,
    );
    return { gcdPercent, dotPercent };
  }

  function calculatePlayerDotUptimePercent(
    debuffEvents,
    playerName,
    job,
    fightStart,
    fightDuration,
    rangeStartMs,
    rangeEndMs,
    targetabilityEvents,
  ) {
    const families = PLAYER_ACTION_DOT_STATUS_FAMILIES_BY_JOB.get(job);
    if (!families) return null;
    const playerEvents = (debuffEvents ?? []).filter((event) => event.source === playerName);
    const familyPercents = families.map((family) => {
      const statusNames = new Set(family.map((name) => name.toLocaleLowerCase()));
      const openByTarget = new Map();
      const intervalsByTarget = new Map();
      const getTargetIntervals = (targetId) => {
        if (!intervalsByTarget.has(targetId)) intervalsByTarget.set(targetId, []);
        return intervalsByTarget.get(targetId);
      };
      for (const event of playerEvents) {
        if (!statusNames.has(String(event.ability ?? '').toLocaleLowerCase())) continue;
        const targetId = Number(event.targetId);
        const elapsedMs = Number(event.timestamp) - fightStart;
        if (!Number.isFinite(elapsedMs)) continue;
        if (event.eventType === 'removedebuff') {
          const startMs = openByTarget.get(targetId);
          if (Number.isFinite(startMs)) getTargetIntervals(targetId).push([startMs, elapsedMs]);
          openByTarget.delete(targetId);
        } else if (!openByTarget.has(targetId)) {
          openByTarget.set(targetId, elapsedMs);
        }
      }
      for (const [targetId, startMs] of openByTarget) {
        getTargetIntervals(targetId).push([startMs, fightDuration]);
      }
      const targetIds = new Set([
        ...intervalsByTarget.keys(),
        ...(targetabilityEvents ?? []).map((event) => Number(event.actorId)),
      ]);
      const targetPercents = [];
      for (const targetId of targetIds) {
        const intervals = intervalsByTarget.get(targetId) ?? [];
        let targetableWindows = buildActorTargetableWindows(
          targetabilityEvents,
          targetId,
          fightStart,
          fightStart + fightDuration,
        ).map(([start, end]) => [start - fightStart, end - fightStart]);
        // Some payloads omit targetability events for ordinary enemies. A DoT
        // interval proves that target existed during this viewed phase, but does
        // not make it part of phases before or after its appearance.
        if (targetableWindows.length === 0
          && intervals.some(([start, end]) => end > rangeStartMs && start < rangeEndMs)) {
          targetableWindows = [[rangeStartMs, rangeEndMs]];
        }
        const targetableDurationMs = measureMergedIntervalDuration(
          targetableWindows,
          rangeStartMs,
          rangeEndMs,
        );
        if (targetableDurationMs <= 0) continue;
        const dottedTargetableIntervals = intervals.flatMap(([dotStart, dotEnd]) => (
          targetableWindows.map(([targetStart, targetEnd]) => (
            [Math.max(dotStart, targetStart), Math.min(dotEnd, targetEnd)]
          ))
        ));
        const statusUptimeMs = measureMergedIntervalDuration(
          dottedTargetableIntervals,
          rangeStartMs,
          rangeEndMs,
        );
        targetPercents.push((statusUptimeMs / targetableDurationMs) * 100);
      }
      return targetPercents.length > 0
        ? targetPercents.reduce((sum, percent) => sum + percent, 0) / targetPercents.length
        : 0;
    });
    return familyPercents.reduce((sum, percent) => sum + percent, 0) / familyPercents.length;
  }

  function buildGlobalUntargetableWindows(events, fightStart, fightEnd) {
    const actorStates = new Map();
    const windows = [];
    let windowStart = null;
    for (const event of events ?? []) {
      const timestamp = Math.max(fightStart, Math.min(fightEnd, Number(event.timestamp)));
      if (!Number.isFinite(timestamp) || !Number.isFinite(Number(event.actorId))) continue;
      const wasGloballyUntargetable = actorStates.size > 0
        && [...actorStates.values()].every((isTargetable) => !isTargetable);
      actorStates.set(Number(event.actorId), event.isTargetable === true);
      const isGloballyUntargetable = actorStates.size > 0
        && [...actorStates.values()].every((isTargetable) => !isTargetable);
      if (!wasGloballyUntargetable && isGloballyUntargetable) windowStart = timestamp;
      if (wasGloballyUntargetable && !isGloballyUntargetable && Number.isFinite(windowStart)) {
        windows.push([windowStart, timestamp]);
        windowStart = null;
      }
    }
    if (Number.isFinite(windowStart)) windows.push([windowStart, fightEnd]);
    return windows.filter(([start, end]) => end > start);
  }

  function buildActorTargetableWindows(events, actorId, fightStart, fightEnd) {
    const actorEvents = (events ?? [])
      .filter((event) => Number(event.actorId) === Number(actorId))
      .sort((first, second) => Number(first.timestamp) - Number(second.timestamp));
    if (actorEvents.length === 0) return [];
    const windows = [];
    let isTargetable = actorEvents[0].isTargetable === false;
    let windowStart = isTargetable ? fightStart : null;
    for (const event of actorEvents) {
      const timestamp = Math.max(fightStart, Math.min(fightEnd, Number(event.timestamp)));
      if (!Number.isFinite(timestamp)) continue;
      if (event.isTargetable && !isTargetable) {
        windowStart = timestamp;
        isTargetable = true;
      } else if (!event.isTargetable && isTargetable) {
        if (Number.isFinite(windowStart) && timestamp > windowStart) {
          windows.push([windowStart, timestamp]);
        }
        windowStart = null;
        isTargetable = false;
      }
    }
    if (isTargetable && Number.isFinite(windowStart) && fightEnd > windowStart) {
      windows.push([windowStart, fightEnd]);
    }
    return windows;
  }

  function isTimestampInIntervals(timestamp, intervals) {
    return intervals.some(([start, end]) => timestamp >= start && timestamp < end);
  }

  function measureIntervalOutsideWindows(interval, windows, minimum, maximum) {
    const clippedStart = Math.max(minimum, interval[0]);
    const clippedEnd = Math.min(maximum, interval[1]);
    if (!(clippedEnd > clippedStart)) return 0;
    return (clippedEnd - clippedStart) - measureMergedIntervalDuration(
      windows,
      clippedStart,
      clippedEnd,
    );
  }

  function measureMergedIntervalDuration(intervals, minimum, maximum) {
    const normalized = intervals
      .map(([start, end]) => [Math.max(minimum, start), Math.min(maximum, end)])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
      .sort((first, second) => first[0] - second[0] || first[1] - second[1]);
    let duration = 0;
    let mergedStart = null;
    let mergedEnd = null;
    for (const [start, end] of normalized) {
      if (mergedStart === null) {
        mergedStart = start;
        mergedEnd = end;
      } else if (start <= mergedEnd) {
        mergedEnd = Math.max(mergedEnd, end);
      } else {
        duration += mergedEnd - mergedStart;
        mergedStart = start;
        mergedEnd = end;
      }
    }
    if (mergedStart !== null) duration += mergedEnd - mergedStart;
    return duration;
  }

  function createPlayerActionUptimeMetrics({ gcdPercent, dotPercent }) {
    const wrapper = document.createElement('span');
    wrapper.className = 'player-actions-uptime-metrics';
    const addMetric = (label, percent, description) => {
      const metric = document.createElement('span');
      metric.className = `player-actions-uptime-metric ${label.toLowerCase()}`;
      metric.textContent = `${label} ${Number.isFinite(percent) ? `${percent.toFixed(1)}%` : '—'}`;
      metric.title = Number.isFinite(percent)
        ? `${description}: ${percent.toFixed(1)}%`
        : `${description}: not applicable or unavailable`;
      wrapper.append(metric);
    };
    addMetric('GCD', gcdPercent, 'GCD uptime');
    if (dotPercent !== null) addMetric('DoT', dotPercent, 'DoT uptime');
    return wrapper;
  }
  
  function createPlayerActionsPullRow(
    report,
    fight,
    playerName,
    startMs,
    endMs,
    displayAnchorMs = 0,
    abilityFilter = { selectedAbilityIds: new Set(), hideUnhighlighted: false },
    gcd = null,
  ) {
    const row = document.createElement('section');
    row.className = 'player-actions-row';
    const identity = document.createElement('div');
    identity.className = 'player-actions-pull';
    const pullNumber = document.createElement('strong');
    pullNumber.textContent = `Pull ${fight.id}`;
    const state = getFightDetails().get(`${report.code}:${fight.id}`);
    const uptimeMetrics = calculatePlayerActionUptimeMetrics(
      fight, state, playerName, gcd, startMs, endMs,
    );
    identity.append(
      pullNumber,
      createBestPullBadge(fight),
      createPlayerActionUptimeMetrics(uptimeMetrics),
    );
  
    const trackWrap = document.createElement('div');
    trackWrap.className = 'player-actions-track-wrap';
    const track = document.createElement('div');
    track.className = 'player-actions-track';
    const playerActions = (state?.actionCasts ?? []).filter((cast) => cast.source === playerName);
    const { visibleActions, castSpans } = pairPlayerActionEvents(playerActions);
    const actions = visibleActions.filter((cast) => {
      const elapsedMs = cast.timestamp - Number(fight.startTime);
      const isSelected = abilityFilter.selectedAbilityIds.has(Number(cast.abilityId));
      return elapsedMs >= startMs
        && elapsedMs <= endMs
        && (!abilityFilter.hideUnhighlighted || isSelected);
    });
    // Collapse empty action lanes. When only oGCDs remain, they move down to the
    // baseline instead of leaving a GCD-sized hole beneath them.
    const hasGcdActions = actions.some(
      (action) => getPlayerActionMarkerCategory(action) === 'spell-or-weaponskill',
    );
    const hasOgcdActions = actions.some(
      (action) => getPlayerActionMarkerCategory(action) === 'ability',
    );
    row.classList.toggle('no-gcd-actions', !hasGcdActions);
    row.classList.toggle('no-ogcd-actions', !hasOgcdActions);
    appendPlayerActionMechanicTicks(track, fight, state, startMs, endMs, displayAnchorMs);
    for (const castSpan of castSpans) {
      const isSelected = abilityFilter.selectedAbilityIds.has(Number(castSpan.begin.abilityId));
      if (abilityFilter.hideUnhighlighted && !isSelected) continue;
      const beginMs = castSpan.begin.timestamp - Number(fight.startTime);
      const endCastMs = castSpan.end.timestamp - Number(fight.startTime);
      const clippedStart = Math.max(startMs, beginMs);
      const clippedEnd = Math.min(endMs, endCastMs);
      if (clippedEnd <= clippedStart) continue;
      const span = document.createElement('span');
      span.className = `player-actions-cast-span ${castSpan.outcome}`;
      span.classList.add(getPlayerActionMarkerCategory(castSpan.begin));
      if (isSelected && !abilityFilter.hideUnhighlighted) span.classList.add('highlighted');
      span.style.left = `${((clippedStart - startMs) / (endMs - startMs)) * 100}%`;
      span.style.width = `${((clippedEnd - clippedStart) / (endMs - startMs)) * 100}%`;
      span.title = `${castSpan.begin.ability} · ${castSpan.outcome} · ${formatPreciseFightDuration(beginMs - displayAnchorMs)}–${formatPreciseFightDuration(endCastMs - displayAnchorMs)}`;
      track.append(span);
    }
    const stackCounts = new Map();
    for (const action of actions) {
      const isSelected = abilityFilter.selectedAbilityIds.has(Number(action.abilityId));
      const elapsedMs = action.timestamp - Number(fight.startTime);
      const position = ((elapsedMs - startMs) / (endMs - startMs)) * 100;
      const bucket = Math.round(elapsedMs / 250);
      const stackIndex = stackCounts.get(bucket) ?? 0;
      stackCounts.set(bucket, stackIndex + 1);
      const marker = document.createElement('span');
      marker.className = 'player-actions-marker';
      marker.classList.add(getPlayerActionMarkerCategory(action));
      if (isSelected && !abilityFilter.hideUnhighlighted) marker.classList.add('highlighted');
      if (action.eventType === 'begincast') marker.classList.add('begin-cast');
      marker.style.left = `${position}%`;
      marker.style.setProperty('--action-offset', `${stackIndex * -5}px`);
      marker.style.zIndex = String(3 + stackIndex);
      const timingDescription = getTrackedPlayerActionTimingDescription(
        report,
        fight,
        state,
        playerName,
        action,
        elapsedMs,
      );
      marker.append(createPlayerActionIcon(action, elapsedMs - displayAnchorMs, timingDescription));
      track.append(marker);
    }
    const hoverLine = document.createElement('span');
    hoverLine.className = 'player-actions-hover-line';
    const hoverTime = document.createElement('span');
    hoverTime.className = 'player-actions-hover-time';
    track.addEventListener('mousemove', (event) => {
      const rectangle = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width));
      const hoveredMs = startMs + ratio * (endMs - startMs);
      hoverLine.style.left = `${ratio * 100}%`;
      hoverTime.style.left = `${ratio * 100}%`;
      hoverTime.textContent = formatPreciseFightDuration(hoveredMs - displayAnchorMs);
      track.classList.add('show-hover-time');
    });
    track.addEventListener('mouseleave', () => track.classList.remove('show-hover-time'));
    track.append(hoverLine, hoverTime);
    trackWrap.append(track);
    row.append(identity, trackWrap);
    return row;
  }
  
  function getTrackedPlayerActionTimingDescription(report, fight, state, playerName, action, elapsedMs) {
    if (action.eventType === 'begincast') return null;
    const abilityMitigations = getDancingMadMitigations().filter((mitigation) => (
      Number(mitigation.abilityId) === Number(action.abilityId)
    ));
    if (abilityMitigations.length === 0) return null;
  
    const fightKey = `${report.code}:${fight.id}`;
    const tanksSwapped = swappedTankAssignmentsByFight.get(fightKey) === true;
    const tankSlots = tanksSwapped
      ? { MT: state?.tankSlots?.OT ?? null, OT: state?.tankSlots?.MT ?? null }
      : state?.tankSlots;
    const partySlots = mapPartyMembersToPlanSlots(state?.partyMembers ?? [], tankSlots);
    const player = (state?.partyMembers ?? []).find((member) => member.name === playerName);
    const assignedSlots = PARTY_SLOT_ORDER.filter((slot) => partySlots.get(slot)?.name === playerName);
    const phaseStarts = resolveEncounterPhaseStarts(
      DANCING_MAD_ENCOUNTER_NAME,
      fight,
      state?.phaseReferenceEvents ?? [],
    );
    const windows = abilityMitigations
      .filter((mitigation) => assignedSlots.includes(mitigation.assignedTo))
      .filter((mitigation) => {
        const requiredJobs = getMitigationJobs(mitigation);
        return requiredJobs.length === 0 || requiredJobs.includes(player?.job);
      })
      .map((mitigation) => {
        const phaseStartMs = phaseStarts.get(Number(mitigation.phase));
        if (!Number.isFinite(phaseStartMs)) return null;
        return {
          mitigation,
          startMs: phaseStartMs + Number(mitigation.startElapsedSeconds) * 1000,
          endMs: phaseStartMs + Number(mitigation.endElapsedSeconds) * 1000,
        };
      })
      .filter(Boolean)
      .filter((window) => window.startMs <= getFightDuration(fight))
      .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs);
  
    const associatedWindow = windows
      .map((window, index) => ({
        ...window,
        index,
        distanceMs: mitigationCastDistance(elapsedMs, window.startMs, window.endMs),
      }))
      .filter((window) => window.distanceMs <= MITIGATION_GRACE_SECONDS * 1000)
      .sort((first, second) => first.distanceMs - second.distanceMs)[0] ?? null;
  
    let timingText = "Didn't enter into any window";
    if (associatedWindow && elapsedMs < associatedWindow.startMs) {
      timingText = `${formatTooltipSeconds((associatedWindow.startMs - elapsedMs) / 1000)} early`;
    } else if (associatedWindow && elapsedMs > associatedWindow.endMs) {
      timingText = `${formatTooltipSeconds((elapsedMs - associatedWindow.endMs) / 1000)} late`;
    } else if (associatedWindow) {
      timingText = `On time (${formatTooltipSeconds((elapsedMs - associatedWindow.startMs) / 1000)} through ${formatTooltipSecondAdjective((associatedWindow.endMs - associatedWindow.startMs) / 1000)} window)`;
    }
  
    if (action.ability === 'Dia') return timingText;
    const cooldownSeconds = getMitigationCooldowns().get(action.ability);
    if (!Number.isFinite(cooldownSeconds) || cooldownSeconds <= 0) return timingText;
    const nextWindow = associatedWindow
      ? windows[associatedWindow.index + 1]
      : windows.find((window) => window.startMs > elapsedMs);
    if (!nextWindow) return timingText;
  
    const cooldownEndMs = elapsedMs + cooldownSeconds * 1000;
    if (cooldownEndMs <= nextWindow.startMs) return timingText;
    if (cooldownEndMs <= nextWindow.endMs) {
      return `${timingText}. Caused the mit to be on cooldown until ${formatTooltipSeconds((nextWindow.endMs - cooldownEndMs) / 1000)} before the next window's maximum.`;
    }
    return `${timingText}. Caused the mit to be on cooldown until ${formatTooltipSeconds((cooldownEndMs - nextWindow.endMs) / 1000)} after the next window's maximum.`;
  }
  
  function formatTooltipSeconds(seconds) {
    const rounded = Math.round(Math.max(0, Number(seconds) || 0) * 10) / 10;
    const value = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
    return `${value} ${rounded === 1 ? 'second' : 'seconds'}`;
  }
  
  function formatTooltipSecondAdjective(seconds) {
    const rounded = Math.round(Math.max(0, Number(seconds) || 0) * 10) / 10;
    const value = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
    return `${value}-second`;
  }
  
  function createPlayerActionIcon(action, elapsedMs, timingDescription = null) {
    const eventSuffix = action.eventType === 'begincast' ? ' · begins' : '';
    const timingSuffix = timingDescription ? ` · ${timingDescription}` : '';
    const label = `${action.ability}${eventSuffix} · ${formatPreciseFightDuration(elapsedMs)}${timingSuffix}`;
    if (!action.icon || isUnknownFflogsStatus(action.ability, action.icon)) {
      const fallback = createFightEventStatusFallback(label);
      fallback.classList.add('player-action-icon');
      return fallback;
    }
    const icon = document.createElement('img');
    icon.className = 'player-action-icon';
    icon.src = action.icon;
    icon.alt = '';
    icon.loading = 'lazy';
    attachFightEventStatusTooltip(icon, label);
    icon.addEventListener('error', () => {
      const fallback = createFightEventStatusFallback(label);
      fallback.classList.add('player-action-icon');
      icon.replaceWith(fallback);
    }, { once: true });
    return icon;
  }
  
  function formatPreciseFightDuration(milliseconds) {
    const totalSeconds = Math.max(0, Number(milliseconds) || 0) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
  }
  
  return {
    clearSpecialHardcodedViewState,
    showReportPlayerActionsOverview,
    showSpecialHardcodedViews,
  };
}

