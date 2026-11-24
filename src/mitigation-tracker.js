// Renders per-fight mitigation assignments and manages slot, timing, and history interactions.
export function createMitigationTracker(dependencies) {
  const {
    DANCING_MAD_ENCOUNTER_NAME,
    PARTY_SLOT_ORDER,
    closeOpenMitigationHistoryPopups,
    createMitigationAbilityIcon,
    createMitigationHistorySummary,
    createMitigationHistoryTable,
    evaluatePartySlotMitigations,
    formatFightDuration,
    getFightDuration,
    getMitigationFilterMode,
    getMitigationJobs,
    getSelectedMitigationSlot,
    getSwappedTankAssignmentsByFight,
    getTrackedMitigations,
    loadMitigationResultHistory,
    nextMitigationHistoryPopupId,
    positionMitigationHistoryPopup,
    renderLookupResult,
    resolveEncounterPhaseStarts,
    setMitigationFilterMode,
    setMitigationSlot,
  } = dependencies;

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
  // panel per standard party slot (T1 through R2), plus one merged All panel, provides desktop and compact
  // navigation, and restores the user's persisted slot and result filter.
  function createMitigationTrackerView(report, fight, state) {
    const tracker = document.createElement('section');
    tracker.className = 'mitigation-tracker';
  
    const fightKey = `${report.code}:${fight.id}`;
    const tanksSwapped = getSwappedTankAssignmentsByFight().get(fightKey) === true;
    const trackerState = tanksSwapped
      ? {
        ...state,
        tankSlots: {
          ...state.tankSlots,
          MT: state.tankSlots?.OT ?? null,
          OT: state.tankSlots?.MT ?? null,
        },
      }
      : state;
  
    const header = document.createElement('div');
    header.className = 'mitigation-header';
    const titleControls = document.createElement('div');
    titleControls.className = 'mitigation-title-controls';
    const heading = document.createElement('h4');
    heading.textContent = 'Mitigation tracker';
    const swapTanksLabel = document.createElement('label');
    swapTanksLabel.className = 'mitigation-swap-tanks-control';
    swapTanksLabel.title = 'This assignment will not be saved to local storage and will not apply to other pulls.';
    const swapTanksCheckbox = document.createElement('input');
    swapTanksCheckbox.type = 'checkbox';
    swapTanksCheckbox.checked = tanksSwapped;
    swapTanksCheckbox.disabled = !state.tankSlots?.MT || !state.tankSlots?.OT;
    swapTanksCheckbox.addEventListener('change', () => {
      if (swapTanksCheckbox.checked) getSwappedTankAssignmentsByFight().set(fightKey, true);
      else getSwappedTankAssignmentsByFight().delete(fightKey);
      renderLookupResult();
    });
    swapTanksLabel.append(swapTanksCheckbox, 'Swap MT/OT');
    titleControls.append(heading, swapTanksLabel);
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
    filterSelect.value = getMitigationFilterMode();
    filterSelect.addEventListener('change', () => setMitigationFilterMode(filterSelect.value));
    header.append(titleControls, filterSelect);
    tracker.append(header);
  
    const assignedSlots = PARTY_SLOT_ORDER.filter((slot) =>
      getTrackedMitigations().some((mitigation) => mitigation.assignedTo === slot));
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
  
    const initialSlot = getSelectedMitigationSlot() === 'all' || assignedSlots.includes(getSelectedMitigationSlot())
      ? getSelectedMitigationSlot()
      : assignedSlots[0];
  
    const allTab = document.createElement('button');
    allTab.className = 'mitigation-tab';
    allTab.type = 'button';
    allTab.id = `mitigation-tab-${fight.id}-all`;
    allTab.textContent = 'All';
    allTab.setAttribute('role', 'tab');
    allTab.setAttribute('aria-controls', `mitigation-panel-${fight.id}-all`);
    allTab.setAttribute('aria-selected', String(initialSlot === 'all'));
    allTab.dataset.mitigationSlot = 'all';
    allTab.tabIndex = initialSlot === 'all' ? 0 : -1;
    allTab.addEventListener('click', () => setMitigationSlot('all'));
    tabs.append(allTab);
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All';
    slotSelect.append(allOption);
  
    const allPanel = createAllMitigationsPanel(report, fight, trackerState, assignedSlots);
    allPanel.id = `mitigation-panel-${fight.id}-all`;
    allPanel.setAttribute('role', 'tabpanel');
    allPanel.setAttribute('aria-labelledby', allTab.id);
    allPanel.dataset.mitigationSlot = 'all';
    allPanel.hidden = initialSlot !== 'all';
    tracker.append(allPanel);
  
    assignedSlots.forEach((slot) => {
      const tab = document.createElement('button');
      const panel = createPartySlotMitigationPanel(report, fight, trackerState, slot);
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
  
  // The All view is one chronological result stream, not a row of independently sized
  // role tables. Slot-specific views remain separate so their focused layout is unchanged.
  function createAllMitigationsPanel(report, fight, state, assignedSlots) {
    const panel = document.createElement('div');
    panel.className = 'mitigation-panel';
    const results = assignedSlots.flatMap((slot) => {
      if (!hasApplicablePartySlotAssignments(fight, state, slot)
        || isPartySlotClassUnsupported(state, slot)) return [];
      return evaluatePartySlotMitigations(fight, state, slot);
    }).sort((first, second) =>
      first.startMs - second.startMs
        || first.endMs - second.endMs
        || PARTY_SLOT_ORDER.indexOf(first.mitigation.assignedTo)
          - PARTY_SLOT_ORDER.indexOf(second.mitigation.assignedTo));
  
    if (results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mitigation-empty-state';
      empty.textContent = 'No applicable assignments before this pull ended.';
      panel.append(empty);
      return panel;
    }
  
    panel.append(createMitigationResultsTable(report, results, { showRole: true }));
    return panel;
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
        const isVisible = getMitigationFilterMode() === 'all'
          || (getMitigationFilterMode() === 'off-time' && isOffTime)
          || (getMitigationFilterMode() === 'more-than-one'
            && (isMissed || (isOffTime && timingDeltaSeconds > 1)));
        row.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      }

      for (const divider of panel.querySelectorAll('.mitigation-phase-divider')) {
        let nextRow = divider.nextElementSibling;
        let hasVisibleResult = false;
        while (nextRow && !nextRow.classList.contains('mitigation-phase-divider')) {
          if (nextRow.classList.contains('mitigation-result') && !nextRow.hidden) {
            hasVisibleResult = true;
            break;
          }
          nextRow = nextRow.nextElementSibling;
        }
        divider.hidden = !hasVisibleResult;
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
      empty.textContent = getMitigationFilterMode() === 'more-than-one'
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
    const hasApplicableAssignments = hasApplicablePartySlotAssignments(fight, state, assignedTo);
    const classUnsupported = isPartySlotClassUnsupported(state, assignedTo);
    const results = hasApplicableAssignments && !classUnsupported
      ? evaluatePartySlotMitigations(fight, state, assignedTo)
      : [];
    if (results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mitigation-empty-state';
      empty.textContent = hasApplicableAssignments && classUnsupported
        ? `${assignedTo}'s class not supported.`
        : 'No applicable assignments before this pull ended.';
      panel.append(empty);
      return panel;
    }
  
    panel.append(createMitigationResultsTable(report, results));
    return panel;
  }
  
  // Rows share one renderer across merged and slot-specific views so timing colors,
  // history popups, icons, and filtering behave identically in both layouts.
  function createMitigationResultsTable(report, results, { showRole = false } = {}) {
    const table = document.createElement('table');
    table.className = 'mitigation-table';
    const head = document.createElement('thead');
    const headingRow = document.createElement('tr');
    const headings = ['Ability', 'Window', 'Result', 'Used'];
    if (showRole) headings.push('Role');
    headings.push('Player');
    for (const heading of headings) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = heading;
      headingRow.append(cell);
    }
    head.append(headingRow);
  
    const body = document.createElement('tbody');
    let previousPhase = null;
    for (const result of results) {
      const phase = Number(result.mitigation.phase);
      if (Number.isFinite(phase) && phase !== previousPhase) {
        const divider = document.createElement('tr');
        divider.className = 'mitigation-phase-divider';
        const dividerCell = document.createElement('th');
        dividerCell.scope = 'rowgroup';
        dividerCell.colSpan = headings.length;
        dividerCell.textContent = `Phase ${phase}`;
        divider.append(dividerCell);
        body.append(divider);
        previousPhase = phase;
      }
      const row = document.createElement('tr');
      row.className = `mitigation-result ${result.statusClass}`;
      const cooldownDetail = getMitigationCooldownDetail(result);
      if (cooldownDetail) row.title = cooldownDetail;
      row.dataset.timingDeltaSeconds = String(result.timingDeltaSeconds ?? 0);
      if (result.statusColor) row.style.setProperty('--timing-color', result.statusColor);
      const windowCell = document.createElement('td');
      windowCell.textContent = `${formatFightDuration(result.startMs)}–${formatFightDuration(result.endMs)}`;
      const abilityCell = document.createElement('td');
      const abilityName = result.mitigation.nickname || result.mitigation.ability;
      const abilityContent = document.createElement('span');
      abilityContent.className = 'mitigation-ability-content';
      const abilityLabel = document.createElement('span');
      abilityLabel.textContent = abilityName;
      abilityContent.append(createMitigationAbilityIcon(result.mitigation.abilityId, abilityName), abilityLabel);
      if (cooldownDetail) {
        const cooldownTooltip = document.createElement('span');
        cooldownTooltip.className = 'mitigation-cooldown-detail';
        cooldownTooltip.setAttribute('role', 'tooltip');
        cooldownTooltip.textContent = cooldownDetail;
        abilityContent.append(cooldownTooltip);
      }
      abilityCell.append(abilityContent);
      abilityCell.title = cooldownDetail || result.mitigation.ability;
      const playerCell = document.createElement('td');
      playerCell.textContent = result.status === 'Missed'
        ? '—'
        : `${result.player.name} (${result.player.job})`;
      const usedCell = document.createElement('td');
      usedCell.textContent = result.cast ? formatFightDuration(result.cast.elapsedMs) : '—';
      const roleCell = document.createElement('td');
      roleCell.textContent = result.mitigation.assignedTo;
      const statusCell = document.createElement('td');
      statusCell.className = 'mitigation-result-status';
      statusCell.append(createMitigationResultHistory(report, result));
      row.append(abilityCell, windowCell, statusCell, usedCell);
      if (showRole) row.append(roleCell);
      row.append(playerCell);
      body.append(row);
    }
    table.append(head, body);
    return table;
  }
  
  function hasApplicablePartySlotAssignments(fight, state, assignedTo) {
    const durationMs = getFightDuration(fight);
    const phaseStarts = resolveEncounterPhaseStarts(
      DANCING_MAD_ENCOUNTER_NAME,
      fight,
      state.phaseReferenceEvents ?? [],
    );
    return getTrackedMitigations()
      .filter((mitigation) => mitigation.assignedTo === assignedTo)
      .some((mitigation) => {
        const relativeAnchorMs = phaseStarts.get(Number(mitigation.phase));
        if (!Number.isFinite(relativeAnchorMs)) return false;
        const startMs = relativeAnchorMs + Number(mitigation.startElapsedSeconds) * 1000;
        return startMs <= durationMs;
      });
  }
  
  function isPartySlotClassUnsupported(state, assignedTo) {
    const partyMembers = state.partyMembers ?? [];
    if (partyMembers.length === 0) return false;
    const slotAssignments = getTrackedMitigations().filter((mitigation) => mitigation.assignedTo === assignedTo);
    if (slotAssignments.length === 0) return false;
    const supportedJobs = new Set(slotAssignments.flatMap(getMitigationJobs));
    return !partyMembers.some((member) => supportedJobs.has(member.job));
  }

  function getMitigationCooldownDetail(result) {
    if (result.status !== 'On cooldown' || !result.cooldownPreviousCast) return '';
    const mechanic = result.cooldownMechanic?.mechanic
      ? ` during ${result.cooldownMechanic.mechanic}`
      : '';
    return `Last used at ${formatFightDuration(result.cooldownPreviousCast.elapsedMs)}${mechanic}.`;
  }
  
  function createMitigationResultHistory(report, result) {
    const anchor = document.createElement('span');
    anchor.className = 'mitigation-result-history-anchor';
    anchor.tabIndex = 0;
    anchor.textContent = result.status;
    const cooldownDetail = getMitigationCooldownDetail(result);
    anchor.dataset.closedTitle = `${result.status}.${cooldownDetail ? ` ${cooldownDetail}` : ''} Click to show result history.`;
    anchor.title = anchor.dataset.closedTitle;
    anchor.setAttribute('role', 'button');
    anchor.setAttribute('aria-haspopup', 'dialog');
    anchor.setAttribute('aria-expanded', 'false');
  
    const tooltip = document.createElement('span');
    tooltip.className = 'mitigation-result-history-tooltip';
    tooltip.id = `mitigation-result-history-${nextMitigationHistoryPopupId()}`;
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-label', `${result.mitigation.nickname ?? result.mitigation.ability} result history`);
    tooltip.textContent = 'Loading pull history…';
    anchor.setAttribute('aria-controls', tooltip.id);
    anchor.historyTooltip = tooltip;
    anchor.append(tooltip);
  
    let requested = false;
    const populate = async () => {
      if (requested) return;
      requested = true;
      try {
        const rows = await loadMitigationResultHistory(report, result.mitigation);
        tooltip.replaceChildren(
          createMitigationHistorySummary(rows),
          createMitigationHistoryTable(rows, report),
        );
        positionMitigationHistoryPopup(anchor, tooltip);
      } catch (error) {
        tooltip.textContent = `Could not load pull history: ${error.message}`;
        positionMitigationHistoryPopup(anchor, tooltip);
      }
    };
    const toggle = () => {
      const willOpen = !anchor.classList.contains('open');
      closeOpenMitigationHistoryPopups(anchor);
      anchor.classList.toggle('open', willOpen);
      anchor.setAttribute('aria-expanded', String(willOpen));
      anchor.title = willOpen ? '' : anchor.dataset.closedTitle;
      if (!willOpen) {
        tooltip.classList.remove('open', 'above');
        anchor.append(tooltip);
        return;
      }
      document.body.append(tooltip);
      tooltip.classList.add('open');
      populate();
      requestAnimationFrame(() => positionMitigationHistoryPopup(anchor, tooltip));
    };
    anchor.addEventListener('click', (event) => {
      if (event.target.closest('.mitigation-result-history-tooltip')) return;
      event.stopPropagation();
      toggle();
    });
    anchor.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      toggle();
    });
    return anchor;
  }
  
  

  return { applyMitigationResultFilter, createFightMitigationPanel };
}
