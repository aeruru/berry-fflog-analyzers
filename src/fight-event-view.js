// Renders fight timelines, event tables, status icons, grouped markers, and event recaps.
export function getFflogsAbilityIconUrl(icon, abilityName = '') {
  const value = String(icon ?? '').trim();
  if (!value || isUnknownFflogsStatus(abilityName, value)) return '';
  if (/^(?:https?:|data:|blob:|\/|\.\/|\.\.\/)/i.test(value)) return value;
  return `https://assets.rpglogs.com/img/ff/abilities/${encodeURIComponent(value)}`;
}

export function isUnknownFflogsStatus(name, icon) {
  return /^unknown(?:_|$)/i.test(String(name ?? ''))
    || /(?:^|\/)000000-000405\.png(?:$|[?#])/i.test(String(icon ?? ''));
}



export function createFightEventView(dependencies) {
  const {
    DANCING_MAD_ENCOUNTER_NAME,
    FIGHT_EVENT_BUFFS_TOOLTIP,
    FIGHT_EVENT_DEBUFFS_TOOLTIP,
    FIGHT_EVENT_TABLE_HEADINGS,
    UNKNOWN_DEATH_REASON_TOOLTIP,
    UNKNOWN_MITIGATION_ABILITY_ICON_URL,
    formatFightDuration,
    getDancingMadMechanic,
    getDancingMadMechanics,
    getDancingMadPhase,
    getEncounterPhaseDefinitions,
    getEncounterRelativeTimestamp,
    getFightDuration,
    resolveEncounterPhaseStarts,
  } = dependencies;
  let pinnedFightEventRecap = null;

  function createFightDetailsTable(fight, state) {
    const { events } = state;
    const table = document.createElement('table');
    table.className = 'fight-details-table';
    const head = document.createElement('thead');
    head.append(createFightEventTableHeadingRow());
  
    const body = document.createElement('tbody');
    const phaseStarts = resolveEncounterPhaseStarts(
      DANCING_MAD_ENCOUNTER_NAME,
      fight,
      state.phaseReferenceEvents ?? [],
    );
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
      const casterDebuffsCell = document.createElement('td');
      setFightEventDebuffsCell(casterDebuffsCell, event.casterDebuffs, 'caster');
      const playerDebuffsCell = document.createElement('td');
      setFightEventDebuffsCell(playerDebuffsCell, event.playerDebuffs, 'player');
      const playerBuffsCell = document.createElement('td');
      setFightEventStatusesCell(playerBuffsCell, event.playerBuffs, 'player', 'buffs');
      const reasonCell = document.createElement('td');
      setFightEventReasonCell(reasonCell, event);
      row.append(
        timeCell,
        eventCell,
        mechanicCell,
        playerCell,
        reasonCell,
        casterDebuffsCell,
        playerDebuffsCell,
        playerBuffsCell,
      );
      attachFightEventRecap(row, event);
      body.append(row);
    }
  
    table.append(head, body);
    alignFightEventDebuffHeading(table);
    return createFightEventTableScrollArea(table);
  }
  
  function getFightEventRecapRows(event) {
    return event.recapEvents ?? [];
  }
  
  function clearPinnedFightEventRecap() {
    if (!pinnedFightEventRecap) return;
    const pinned = pinnedFightEventRecap;
    pinnedFightEventRecap = null;
    pinned.row.classList.remove('fight-event-recap-pinned');
    pinned.row.setAttribute('aria-expanded', 'false');
    pinned.popup.remove();
    pinned.release();
  }
  
  function attachFightEventRecap(row, event) {
    row.classList.add('fight-event-annotated-row');
    row.tabIndex = 0;
    row.setAttribute('aria-expanded', 'false');
    let popup = null;
    let popupPlacement = null;
  
    const position = () => {
      if (!popup) return;
      const rowBounds = row.getBoundingClientRect();
      const popupBounds = popup.getBoundingClientRect();
      const gap = 6;
      const viewportGap = 8;
      const left = Math.max(viewportGap, Math.min(
        rowBounds.left,
        window.innerWidth - popupBounds.width - viewportGap,
      ));
      if (!popupPlacement) {
        const fitsBelow = rowBounds.bottom + gap + popupBounds.height
          <= window.innerHeight - viewportGap;
        popupPlacement = fitsBelow ? 'below' : 'above';
      }
      const top = popupPlacement === 'below'
        ? rowBounds.bottom + gap
        : Math.max(viewportGap, rowBounds.top - popupBounds.height - gap);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    const show = () => {
      if (pinnedFightEventRecap || popup) return;
      popup = createFightEventRecap(event);
      document.body.append(popup);
      position();
    };
    const togglePinned = () => {
      if (pinnedFightEventRecap?.row === row) {
        clearPinnedFightEventRecap();
        return;
      }
      clearPinnedFightEventRecap();
      show();
      if (!popup) return;
      const pinnedPopup = popup;
      const reposition = () => position();
      const dismissOnOutsideClick = (clickEvent) => {
        const clickPath = clickEvent.composedPath();
        if (clickPath.includes(row) || clickPath.includes(pinnedPopup)) return;
        clearPinnedFightEventRecap();
      };
      row.classList.add('fight-event-recap-pinned');
      row.setAttribute('aria-expanded', 'true');
      pinnedPopup.classList.add('is-pinned');
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, true);
      document.addEventListener('click', dismissOnOutsideClick, true);
      pinnedFightEventRecap = {
        row,
        popup: pinnedPopup,
        release: () => {
          window.removeEventListener('resize', reposition);
          window.removeEventListener('scroll', reposition, true);
          document.removeEventListener('click', dismissOnOutsideClick, true);
          popup = null;
          popupPlacement = null;
        },
      };
    };
  
    row.addEventListener('click', togglePinned);
    row.addEventListener('keydown', (keyboardEvent) => {
      if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
        keyboardEvent.preventDefault();
        togglePinned();
      } else if (keyboardEvent.key === 'Escape' && pinnedFightEventRecap?.row === row) {
        clearPinnedFightEventRecap();
      }
    });
  }
  
  function createFightEventRecap(event) {
    const popup = document.createElement('aside');
    popup.className = 'fight-event-recap';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', `${event.player} ${event.kind} recap`);
    const heading = document.createElement('div');
    heading.className = 'fight-event-recap-heading';
    const title = document.createElement('strong');
    title.textContent = `${event.player} · ${event.kind}`;
    const subtitle = document.createElement('span');
    subtitle.textContent = '60-second incoming-event recap';
    const closeButton = document.createElement('button');
    closeButton.className = 'fight-event-recap-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close death recap');
    closeButton.addEventListener('click', clearPinnedFightEventRecap);
    heading.append(title, subtitle, closeButton);
  
    const scroller = document.createElement('div');
    scroller.className = 'fight-event-recap-scroll';
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headingRow = document.createElement('tr');
    for (const label of ['Time', 'Amount', 'Ability', 'Source', 'HP']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headingRow.append(cell);
    }
    const debuffs = document.createElement('th');
    debuffs.scope = 'colgroup';
    debuffs.colSpan = 2;
    debuffs.className = 'fight-event-debuffs-heading';
    debuffs.textContent = 'Debuffs';
    debuffs.title = FIGHT_EVENT_DEBUFFS_TOOLTIP;
    const buffs = document.createElement('th');
    buffs.scope = 'col';
    buffs.textContent = 'Buffs';
    buffs.title = FIGHT_EVENT_BUFFS_TOOLTIP;
    headingRow.append(debuffs, buffs);
    head.append(headingRow);
  
    const body = document.createElement('tbody');
    const recapRows = getFightEventRecapRows(event);
    for (const recap of recapRows) {
      body.append(createFightEventRecapRow(recap));
    }
    if (recapRows.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 8;
      emptyCell.className = 'fight-event-recap-empty';
      emptyCell.textContent = 'No incoming events were recorded in the preceding 60 seconds.';
      emptyRow.append(emptyCell);
      body.append(emptyRow);
    }
    table.append(head, body);
    alignFightEventDebuffHeading(table);
    scroller.append(table);
    popup.append(heading, scroller);
    return popup;
  }
  
  function createFightEventRecapRow(recap) {
    const row = document.createElement('tr');
    const time = document.createElement('td');
    time.textContent = `${(Number(recap.relativeMs) / 1000).toFixed(1)}s`;
    const amount = document.createElement('td');
    amount.className = `fight-event-recap-amount ${recap.eventType}`;
    const displayedAmount = Number.isFinite(recap.effectiveAmount)
      ? recap.effectiveAmount
      : recap.amount;
    if (Number.isFinite(displayedAmount)) {
      const effective = document.createElement('span');
      effective.textContent = `${recap.eventType === 'heal' ? '+' : '−'}${Math.round(displayedAmount).toLocaleString('en-US')}`;
      amount.append(effective);
      if (recap.eventType === 'heal' && Number(recap.overheal) > 0) {
        const attempted = document.createElement('span');
        attempted.className = 'fight-event-recap-overheal';
        attempted.textContent = ` (+${Math.round(displayedAmount + recap.overheal).toLocaleString('en-US')})`;
        amount.append(attempted);
      }
    } else {
      amount.textContent = '—';
    }
    const ability = document.createElement('td');
    ability.className = 'fight-event-recap-ability';
    if (recap.icon) {
      const icon = document.createElement('img');
      icon.src = recap.icon;
      icon.alt = '';
      icon.loading = 'lazy';
      ability.append(icon);
    }
    ability.append(recap.ability);
    const source = document.createElement('td');
    source.textContent = recap.source;
    const hitPoints = document.createElement('td');
    hitPoints.className = 'fight-event-recap-hp';
    const currentHitPoints = Number.isFinite(recap.hitPointsAfter)
      ? recap.hitPointsAfter
      : recap.hitPointsBefore;
    if (Number.isFinite(currentHitPoints)) {
      const bar = document.createElement('span');
      bar.className = 'fight-event-recap-hp-bar';
      const maximum = Number(recap.maxHitPoints);
      const previousHitPoints = Number.isFinite(recap.hitPointsBefore)
        ? recap.hitPointsBefore
        : currentHitPoints;
      const baseHitPoints = Math.min(previousHitPoints, currentHitPoints);
      const changedHitPoints = Math.abs(currentHitPoints - previousHitPoints);
      const percentage = (value) => Number.isFinite(maximum) && maximum > 0
        ? `${Math.max(0, Math.min(1, value / maximum)) * 100}%`
        : '0%';
      bar.style.setProperty('--hp-base', percentage(baseHitPoints));
      bar.style.setProperty('--hp-change-start', percentage(baseHitPoints));
      bar.style.setProperty('--hp-change', percentage(changedHitPoints));
      bar.style.setProperty('--shield-ratio', percentage(Number(recap.shieldAmount) || 0));
      const base = document.createElement('span');
      base.className = 'fight-event-recap-hp-base';
      const change = document.createElement('span');
      change.className = 'fight-event-recap-hp-change';
      const shield = document.createElement('span');
      shield.className = 'fight-event-recap-shield';
      const label = document.createElement('span');
      label.className = 'fight-event-recap-hp-label';
      const formattedHitPoints = Math.round(currentHitPoints).toLocaleString('en-US');
      const shieldAmount = Math.max(0, Number(recap.shieldAmount) || 0);
      label.textContent = '';
      if (shieldAmount > 0) {
        const shieldLabel = document.createElement('span');
        shieldLabel.className = 'fight-event-recap-shield-label';
        shieldLabel.textContent = `(${Math.round(shieldAmount).toLocaleString('en-US')}) `;
        label.append(shieldLabel);
      }
      label.append(formattedHitPoints);
      bar.append(base, change, shield, label);
      const tooltipLines = [`HP: ${formattedHitPoints}${Number.isFinite(maximum) ? ` / ${Math.round(maximum).toLocaleString('en-US')}` : ''}`];
      if (shieldAmount > 0) {
        tooltipLines.push(`Shield: ${Math.round(shieldAmount).toLocaleString('en-US')}`);
      }
      if (recap.eventType === 'damage' && Number(recap.overkill) > 0) {
        tooltipLines.push(`Overkill: ${Math.round(recap.overkill).toLocaleString('en-US')}`);
      }
      if (recap.eventType === 'heal' && Number(recap.overheal) > 0) {
        tooltipLines.push(`Overheal: ${Math.round(recap.overheal).toLocaleString('en-US')}`);
      }
      attachFightEventStatusTooltip(bar, tooltipLines.join('\n'));
      hitPoints.append(bar);
    } else {
      hitPoints.textContent = '—';
    }
    const casterDebuffs = document.createElement('td');
    setFightEventDebuffsCell(casterDebuffs, recap.casterDebuffs, 'caster');
    const playerDebuffs = document.createElement('td');
    setFightEventDebuffsCell(playerDebuffs, recap.playerDebuffs, 'player');
    const playerBuffs = document.createElement('td');
    setFightEventStatusesCell(playerBuffs, recap.playerBuffs, 'player', 'buffs');
    row.append(time, amount, ability, source, hitPoints, casterDebuffs, playerDebuffs, playerBuffs);
    return row;
  }
  
  function createFightTimeline(fight, state) {
    const { events } = state;
    const timeline = document.createElement('div');
    timeline.className = 'fight-timeline';
    const durationMs = getFightDuration(fight);
    const phaseStarts = resolveEncounterPhaseStarts(
      DANCING_MAD_ENCOUNTER_NAME,
      fight,
      state.phaseReferenceEvents ?? [],
    );
    const finalAvailablePhase = Math.max(...phaseStarts.keys());
    const endingPhase = Math.min(finalAvailablePhase, Math.max(1, Number(fight.lastPhase) || 1));
    const eqMechanic = getDancingMadMechanics().find((mechanic) => mechanic.mechanic.startsWith('EQ'));
    const eqTimestampMs = eqMechanic
      ? getEncounterRelativeTimestamp(eqMechanic, phaseStarts)
      : Number.NaN;
    const splitLongPhaseThree = durationMs >= 600_000 && Number.isFinite(eqTimestampMs);
    const phaseSegments = [];
    const phaseDefinitions = getEncounterPhaseDefinitions().get(DANCING_MAD_ENCOUNTER_NAME)?.phases ?? [];
  
    for (let phase = 1; phase <= endingPhase; phase += 1) {
      const phaseStart = Math.min(durationMs, phaseStarts.get(phase) ?? durationMs);
      const nextKnownStart = phaseStarts.get(phase + 1);
      const actualPhaseEnd = Math.max(phaseStart, Math.min(durationMs, nextKnownStart ?? durationMs));
      const defaultDurationMs = Number(phaseDefinitions
        .find((definition) => Number(definition.phase) === phase)?.defaultDurationSeconds) * 1_000;
      const expectedPhaseEnd = Number.isFinite(nextKnownStart)
        ? nextKnownStart
        : phaseStart + defaultDurationMs;
      const phaseEnd = phase === endingPhase && Number.isFinite(expectedPhaseEnd)
        ? Math.max(actualPhaseEnd, expectedPhaseEnd)
        : actualPhaseEnd;
      if (phase === 3 && splitLongPhaseThree && eqTimestampMs > phaseStart && eqTimestampMs < phaseEnd) {
        phaseSegments.push(
          {
            phase,
            phaseStart,
            phaseEnd: eqTimestampMs,
            actualPhaseEnd: Math.min(actualPhaseEnd, eqTimestampMs),
            isFirstSegment: true,
            isLastSegment: false,
          },
          {
            phase,
            phaseStart: eqTimestampMs,
            phaseEnd,
            actualPhaseEnd,
            isFirstSegment: false,
            isLastSegment: true,
          },
        );
      } else {
        phaseSegments.push({
          phase,
          phaseStart,
          phaseEnd,
          actualPhaseEnd,
          isFirstSegment: true,
          isLastSegment: true,
        });
      }
    }
  
    for (const {
      phase,
      phaseStart,
      phaseEnd,
      actualPhaseEnd,
      isFirstSegment,
      isLastSegment,
    } of phaseSegments) {
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
      if (actualPhaseEnd < phaseEnd) {
        const unreached = document.createElement('span');
        unreached.className = 'fight-timeline-unreached';
        unreached.style.left = `${((actualPhaseEnd - phaseStart) / phaseDuration) * 100}%`;
        track.append(unreached);
      }
  
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
  
      for (const mechanic of getDancingMadMechanics().filter((entry) => Number(entry.phase) === phase)) {
        const mechanicMs = getEncounterRelativeTimestamp(mechanic, phaseStarts);
        if (mechanicMs < phaseStart || mechanicMs > phaseEnd) {
          continue;
        }
        addTimelineTick(mechanicMs, mechanic.mechanic || `Phase ${phase} begins`, mechanic.mechanic);
      }
  
      addTimelineTick(
        actualPhaseEnd,
        `Phase ${phase} timeline ${isLastSegment ? 'ends' : 'continues'}`,
        isLastSegment ? 'END' : '',
        'end',
      );
  
      for (const event of events) {
        const elapsedMs = Math.max(0, Number(event.timestamp) - Number(fight.startTime));
        const eventPhase = getDancingMadPhase(elapsedMs, phaseStarts);
        const mechanic = getDancingMadMechanic(elapsedMs, phaseStarts, eventPhase);
        if (eventPhase !== phase || elapsedMs < phaseStart || elapsedMs > actualPhaseEnd
          || (!isLastSegment && elapsedMs === actualPhaseEnd)) {
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
    tooltip.className = `fight-timeline-tooltip fight-timeline-table-tooltip${position < 18 ? ' align-start' : position > 82 ? ' align-end' : ''}`;
    tooltip.addEventListener('click', (clickEvent) => clickEvent.stopPropagation());
    tooltip.append(createTimelineEventTable([{ event, mechanic, elapsedMs }]));
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
    tooltip.className = `fight-timeline-tooltip fight-timeline-table-tooltip${layout.position < 18 ? ' align-start' : layout.position > 82 ? ' align-end' : ''}`;
    // Interacting with the scrollbar must not bubble to the grouped marker and
    // toggle its pinned state closed.
    tooltip.addEventListener('click', (clickEvent) => clickEvent.stopPropagation());
    const tableItems = groups
      .flatMap((group) => group.items)
      .sort((first, second) => first.elapsedMs - second.elapsedMs);
    tooltip.append(createTimelineEventTable(tableItems));
  
    marker.append(box, tooltip);
    enableAdaptiveTimelineTooltip(marker);
    return marker;
  }
  
  // Single and grouped timeline popups deliberately use the same compact table.
  // Status snapshots remain available in the full events table without making the
  // timeline popup too wide to scan.
  function createTimelineEventTable(items) {
    const table = document.createElement('table');
    table.className = 'fight-timeline-event-table';
    const head = document.createElement('thead');
    head.append(createFightEventTableHeadingRow({ includeStatuses: false }));
    const body = document.createElement('tbody');
    for (const item of items) {
      const row = document.createElement('tr');
      const time = document.createElement('td');
      time.textContent = formatFightDuration(item.elapsedMs);
      const event = document.createElement('td');
      event.append(createFightEventIcon(item.event.kind));
      const mechanic = document.createElement('td');
      mechanic.textContent = item.mechanic?.mechanic || 'Before first mechanic';
      const player = document.createElement('td');
      player.textContent = item.event.player;
      const reason = document.createElement('td');
      setFightEventReasonCell(reason, item.event);
      row.append(time, event, mechanic, player, reason);
      body.append(row);
    }
    table.append(head, body);
    return createFightEventTableScrollArea(table);
  }
  
  // Use one grouped heading while keeping caster and player statuses in distinct
  // body columns. The short center rule visually carries the split into the rows.
  function createFightEventTableHeadingRow({ includeStatuses = true } = {}) {
    const row = document.createElement('tr');
    for (const label of FIGHT_EVENT_TABLE_HEADINGS) {
      const heading = document.createElement('th');
      heading.scope = 'col';
      heading.textContent = label;
      row.append(heading);
    }
    const reasonHeading = document.createElement('th');
    reasonHeading.scope = 'col';
    reasonHeading.textContent = 'Reason';
    row.append(reasonHeading);
    if (!includeStatuses) return row;
  
    const debuffsHeading = document.createElement('th');
    debuffsHeading.className = 'fight-event-debuffs-heading';
    debuffsHeading.colSpan = 2;
    debuffsHeading.scope = 'colgroup';
    debuffsHeading.textContent = 'Debuffs';
    debuffsHeading.title = FIGHT_EVENT_DEBUFFS_TOOLTIP;
    debuffsHeading.setAttribute('aria-label', FIGHT_EVENT_DEBUFFS_TOOLTIP);
    const buffsHeading = document.createElement('th');
    buffsHeading.className = 'fight-event-buffs-heading';
    buffsHeading.scope = 'col';
    buffsHeading.textContent = 'Buffs';
    buffsHeading.title = FIGHT_EVENT_BUFFS_TOOLTIP;
    buffsHeading.setAttribute('aria-label', FIGHT_EVENT_BUFFS_TOOLTIP);
    row.append(debuffsHeading, buffsHeading);
    return row;
  }
  
  function createFightEventTableScrollArea(table) {
    const scrollArea = document.createElement('div');
    scrollArea.className = 'fight-event-table-scroll';
    scrollArea.tabIndex = 0;
    scrollArea.setAttribute('aria-label', 'Scrollable fight events table');
    scrollArea.append(table);
    return scrollArea;
  }
  
  // The grouped Debuffs heading spans two auto-sized columns. Measure their real
  // boundary after layout so the short header notch matches the body divider even
  // when one side contains many more status icons than the other.
  function alignFightEventDebuffHeading(table) {
    requestAnimationFrame(() => {
      const heading = table.querySelector('.fight-event-debuffs-heading');
      const playerDebuffs = table.querySelector('.fight-event-debuffs-cell.player');
      if (!heading || !playerDebuffs || !table.isConnected) return;
      const headingBounds = heading.getBoundingClientRect();
      const playerBounds = playerDebuffs.getBoundingClientRect();
      const dividerOffset = playerBounds.left - headingBounds.left;
      if (dividerOffset <= 0 || dividerOffset >= headingBounds.width) return;
      heading.style.setProperty('--debuff-divider-offset', `${dividerOffset}px`);
    });
  }
  
  function setFightEventDebuffsCell(cell, debuffs, subject) {
    setFightEventStatusesCell(cell, debuffs, subject, 'debuffs');
  }
  
  function setFightEventStatusesCell(cell, values, subject, statusKind) {
    const statuses = Array.isArray(values) ? values : [];
    cell.className = `fight-event-statuses-cell fight-event-${statusKind}-cell ${subject}`;
    cell.setAttribute('aria-label', statuses.length > 0
      ? `${statusKind} on ${subject}: ${statuses.map((status) => status.name).join(', ')}`
      : `${statusKind} on ${subject}: none`);
    if (statuses.length === 0) {
      cell.textContent = '—';
      return;
    }
    const list = document.createElement('span');
    list.className = 'fight-event-status-list';
    for (const status of statuses) {
      if (!status.icon || isUnknownFflogsStatus(status.name, status.icon)) {
        list.append(createFightEventStatusFallback(status.name));
        continue;
      }
      const icon = document.createElement('img');
      icon.className = 'fight-event-status-icon';
      icon.loading = 'lazy';
      icon.alt = '';
      icon.src = status.icon;
      attachFightEventStatusTooltip(icon, status.name);
      icon.addEventListener('error', () => {
        icon.replaceWith(createFightEventStatusFallback(status.name));
      }, { once: true });
      list.append(icon);
    }
    cell.append(list);
  }
  
  function createFightEventStatusFallback(name) {
    const fallback = document.createElement('img');
    fallback.className = 'fight-event-status-icon fallback';
    fallback.alt = '';
    fallback.src = UNKNOWN_MITIGATION_ABILITY_ICON_URL;
    fallback.loading = 'lazy';
    attachFightEventStatusTooltip(fallback, name);
    return fallback;
  }
  
  // Native title bubbles have a noticeable delay. Render this tooltip at the
  // viewport level so status names appear immediately and escape table clipping.
  // A modal dialog occupies the browser's top layer, so a tooltip for content in
  // that dialog must be its descendant rather than a high-z-index body child.
  function attachFightEventStatusTooltip(anchor, name) {
    anchor.tabIndex = 0;
    anchor.setAttribute('aria-label', name);
    let tooltip = null;
    const show = () => {
      tooltip?.remove();
      tooltip = document.createElement('span');
      tooltip.className = 'fight-event-status-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.textContent = name;
      (anchor.closest('dialog') ?? document.body).append(tooltip);
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const left = Math.max(8, Math.min(
        window.innerWidth - tooltipRect.width - 8,
        anchorRect.left + (anchorRect.width - tooltipRect.width) / 2,
      ));
      const fitsAbove = anchorRect.top >= tooltipRect.height + 10;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = fitsAbove
        ? `${anchorRect.top - tooltipRect.height - 6}px`
        : `${anchorRect.bottom + 6}px`;
    };
    const hide = () => {
      tooltip?.remove();
      tooltip = null;
    };
    anchor.addEventListener('mouseenter', show);
    anchor.addEventListener('mouseleave', hide);
    anchor.addEventListener('focus', show);
    anchor.addEventListener('blur', hide);
  }
  
  // ReportAbility.icon is normally a filename; turn it into FFLogs' public asset
  // URL while preserving complete URLs and local test-data paths unchanged.
  

  function setFightEventReasonCell(cell, event) {
    cell.textContent = event.reason || '—';
    if (event.reason !== 'Unknown') return;
    cell.title = UNKNOWN_DEATH_REASON_TOOLTIP;
    cell.setAttribute('aria-label', `Unknown. ${UNKNOWN_DEATH_REASON_TOOLTIP}`);
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
  
  // Weekly cards are deliberately self-contained controls: their visible summary comes
  // from report data, while activation feeds the shared detailed-report selection flow.
  

  return {
    attachFightEventStatusTooltip,
    clearPinnedFightEventRecap,
    closePinnedTimelineGroups,
    createFightDetailsTable,
    createFightEventStatusFallback,
    createFightTimeline,
    createTimelineEventGroupMarker,
    createTimelineEventMarker,
    createTimelineGroupSummaryBox,
  };
}
