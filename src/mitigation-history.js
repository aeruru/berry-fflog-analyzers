// Builds report-wide mitigation history summaries, tables, popups, and overview navigation.
export function createMitigationHistory(dependencies) {
  const {
    PARTY_SLOT_ORDER,
    createBestPullBadge,
    createPlayerActionTimelinePreview,
    createMitigationAbilityIcon,
    filterReportFightsByOutcome,
    formatFightDuration,
    getMitigationTimingStatusColor,
    getSelectedReportPhase,
    getTrackedMitigations,
    interpolateColor,
    loadMitigationResultHistory,
    loadMitigationSlot,
    rgbColor,
    setMitigationSlot,
    updateWithSmoothHeight,
  } = dependencies;
  const pinnedMitigationHistoryZoomPreviews = [];
  let openMitigationActionPreview = null;
  let mitigationHistoryPopupId = 0;

  async function showReportMitigationHistoryOverview(report, button, host = null) {
    const isEmbedded = Boolean(host);
    const phaseFilter = getSelectedReportPhase();
    const filteredReport = {
      ...report,
      fights: filterReportFightsByOutcome(report.fights ?? [], phaseFilter),
    };
    const mitigations = [...getTrackedMitigations()].sort((first, second) =>
      Number(first.phase) - Number(second.phase)
        || Number(first.startElapsedSeconds) - Number(second.startElapsedSeconds)
        || PARTY_SLOT_ORDER.indexOf(first.assignedTo) - PARTY_SLOT_ORDER.indexOf(second.assignedTo)
        || String(first.nickname ?? first.ability).localeCompare(String(second.nickname ?? second.ability)));
  
    const dialog = document.createElement(isEmbedded ? 'section' : 'dialog');
    dialog.className = 'mitigation-overview-dialog';
    if (isEmbedded) dialog.classList.add('embedded-report-overview');
    dialog.setAttribute('aria-labelledby', 'mitigation-overview-title');
  
    const header = document.createElement('div');
    header.className = 'mitigation-overview-header';
    const heading = document.createElement('h3');
    heading.id = 'mitigation-overview-title';
    heading.textContent = 'All mitigations';
    header.append(heading);
    if (!isEmbedded) {
      const closeButton = document.createElement('button');
      closeButton.className = 'mitigation-overview-close';
      closeButton.type = 'button';
      closeButton.textContent = '×';
      closeButton.addEventListener('click', () => dialog.close());
      header.append(closeButton);
    }
  
    const content = document.createElement('div');
    content.className = 'mitigation-overview-content';
    const loading = document.createElement('p');
    loading.className = 'mitigation-overview-status';
    const phaseFilterLabel = phaseFilter === 'all'
      ? 'All pulls'
      : phaseFilter === 'clears'
        ? 'Clears'
        : `Phase ${phaseFilter} wipes`;
    loading.textContent = `Loading mitigation histories for ${phaseFilterLabel.toLowerCase()}…`;
    content.append(loading);
    dialog.append(header, content);
    if (isEmbedded) {
      host.replaceChildren(dialog);
    } else {
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
    }
  
    try {
      const configuredRoles = PARTY_SLOT_ORDER.filter((role) =>
        mitigations.some((mitigation) => mitigation.assignedTo === role));
      const savedRole = loadMitigationSlot();
      let activeRole = savedRole === 'all' || configuredRoles.includes(savedRole)
        ? savedRole
        : configuredRoles[0] ?? 'all';
      const tabs = document.createElement('div');
      tabs.className = 'mitigation-tabs mitigation-overview-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Mitigation role');
      const strip = document.createElement('div');
      strip.className = 'mitigation-overview-strip';
      strip.setAttribute('role', 'tabpanel');
      const loadedHistories = new Map();
      const roleLoadPromises = new Map();
      const mitigationOrder = new Map(mitigations.map((mitigation, index) =>
        [mitigationIdentity(mitigation), index]));
  
      const createHistoryCard = ({ mitigation, rows }) => {
        const card = document.createElement('section');
        card.className = 'mitigation-overview-card';
        card.dataset.mitigationOrder = String(mitigationOrder.get(mitigationIdentity(mitigation)));
        const cardHeader = document.createElement('div');
        cardHeader.className = 'mitigation-overview-card-header';
        const title = document.createElement('h4');
        const abilityName = mitigation.nickname ?? mitigation.ability;
        title.append(createMitigationAbilityIcon(mitigation.abilityId, abilityName), abilityName);
        const details = document.createElement('span');
        // History rows already contain the assignment window after its phase start has
        // been resolved for a real pull. Use that fight-relative window in the header;
        // the configured values alone are only offsets within the phase.
        const representativeResult = rows[0]?.result;
        const startMs = representativeResult?.startMs
          ?? Number(mitigation.startElapsedSeconds) * 1000;
        const endMs = representativeResult?.endMs
          ?? Number(mitigation.endElapsedSeconds) * 1000;
        details.textContent = `P${mitigation.phase} · ${mitigation.assignedTo} · ${formatFightDuration(startMs)}–${formatFightDuration(endMs)}`;
        cardHeader.append(title, details);
        card.append(cardHeader, createMitigationHistorySummary(rows), createMitigationHistoryTable(rows, report));
        return card;
      };
  
      const renderRole = () => {
        tabs.querySelectorAll('.mitigation-tab').forEach((tab) => {
          const selected = tab.dataset.mitigationSlot === activeRole;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
        });
        strip.replaceChildren(...[...loadedHistories.values()]
          .filter(({ mitigation }) => activeRole === 'all' || mitigation.assignedTo === activeRole)
          .sort((first, second) => mitigationOrder.get(mitigationIdentity(first.mitigation))
            - mitigationOrder.get(mitigationIdentity(second.mitigation)))
          .map(createHistoryCard));
      };
      const insertHistoryCard = (history) => {
        const card = createHistoryCard(history);
        const order = Number(card.dataset.mitigationOrder);
        const nextCard = [...strip.children]
          .find((candidate) => Number(candidate.dataset.mitigationOrder) > order);
        strip.insertBefore(card, nextCard ?? null);
      };

      const phaseFilterNotice = document.createElement('p');
      phaseFilterNotice.className = 'mitigation-overview-filter-notice';
      const getRoleMitigations = (role) => role === 'all'
        ? mitigations
        : mitigations.filter((mitigation) => mitigation.assignedTo === role);
      const setFinishedRoleStatus = (role) => {
        if (activeRole !== role) return;
        const roleMitigations = getRoleMitigations(role);
        const historiesWithData = roleMitigations.filter((mitigation) => (
          loadedHistories.has(mitigationIdentity(mitigation))
        )).length;
        const roleLabel = role === 'all' ? '' : `${role} `;
        phaseFilterNotice.textContent = historiesWithData > 0
          ? `Phase filter: ${phaseFilterLabel} · ${historiesWithData} of ${roleMitigations.length} ${roleLabel}windows have pull data`
          : `No ${roleLabel}mitigation histories have eligible ${phaseFilterLabel.toLowerCase()} data.`;
      };
      const loadRole = (role) => {
        if (!roleLoadPromises.has(role)) {
          roleLoadPromises.set(role, (async () => {
            const roleMitigations = getRoleMitigations(role);
            let processedCount = 0;
            for (const mitigation of roleMitigations) {
              if (!dialog.isConnected) return;
              const identity = mitigationIdentity(mitigation);
              if (!loadedHistories.has(identity)) {
                const rows = await loadMitigationResultHistory(filteredReport, mitigation);
                if (rows.length > 0) {
                  const history = { mitigation, rows };
                  loadedHistories.set(identity, history);
                  if (activeRole === role) insertHistoryCard(history);
                }
              }
              processedCount += 1;
              if (activeRole === role) {
                const roleLabel = role === 'all' ? '' : `${role} `;
                phaseFilterNotice.textContent = `Loaded ${processedCount} of ${roleMitigations.length} ${roleLabel}mitigation windows · ${phaseFilterLabel}`;
              }
              await new Promise((resolve) => requestAnimationFrame(resolve));
            }
          })());
        }
        return roleLoadPromises.get(role).then(() => setFinishedRoleStatus(role));
      };
  
      for (const role of ['all', ...configuredRoles]) {
        const tab = document.createElement('button');
        tab.className = 'mitigation-tab';
        tab.type = 'button';
        tab.textContent = role === 'all' ? 'All' : role;
        tab.dataset.mitigationSlot = role;
        tab.setAttribute('role', 'tab');
        tab.addEventListener('click', () => {
          activeRole = role;
          setMitigationSlot(role);
          renderRole();
          phaseFilterNotice.textContent = `Loading ${role === 'all' ? '' : `${role} `}${phaseFilterLabel.toLowerCase()} mitigations…`;
          void loadRole(role);
        });
        tabs.append(tab);
      }
      phaseFilterNotice.textContent = `Loading ${activeRole === 'all' ? '' : `${activeRole} `}${phaseFilterLabel.toLowerCase()} mitigations…`;
      renderRole();
      updateWithSmoothHeight(content, () => {
        content.replaceChildren(tabs, phaseFilterNotice, strip);
      });
  
      // Only the active role is evaluated. Other roles are loaded on first selection,
      // avoiding a hidden all-role calculation whenever this report view opens.
      await loadRole(activeRole);
    } catch (error) {
      loading.textContent = `Could not load mitigation histories: ${error.message}`;
    }
  }
  
  function closeOpenMitigationHistoryPopups(except = null) {
    closeMitigationActionPreview();
    document.querySelectorAll('.mitigation-result-history-anchor.open').forEach((anchor) => {
      if (anchor === except) return;
      anchor.classList.remove('open');
      anchor.setAttribute('aria-expanded', 'false');
      anchor.title = anchor.dataset.closedTitle;
      const tooltip = anchor.historyTooltip;
      if (tooltip) {
        tooltip.classList.remove('open', 'above');
        anchor.append(tooltip);
      }
    });
  }

  function closeMitigationActionPreview() {
    openMitigationActionPreview?.remove();
    openMitigationActionPreview = null;
  }

  function showMitigationActionPreview(report, row, tableRow) {
    closeMitigationActionPreview();
    const playerName = row.result.player?.name;
    if (!playerName) return;
    const castElapsedMs = Number(row.result.cast?.elapsedMs);
    const centerMs = Number.isFinite(castElapsedMs)
      ? castElapsedMs
      : Number(row.result.startMs);
    if (!Number.isFinite(centerMs)) return;

    const preview = document.createElement('div');
    preview.className = 'mitigation-action-preview';
    preview.setAttribute('role', 'dialog');
    preview.setAttribute('aria-label', `${playerName} actions surrounding this mitigation`);
    const closeButton = document.createElement('button');
    closeButton.className = 'mitigation-action-preview-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close player actions timeline');
    closeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      closeMitigationActionPreview();
    });
    const timeline = createPlayerActionTimelinePreview(
      report,
      row.fight,
      playerName,
      centerMs - 15_000,
      centerMs + 15_000,
    );
    preview.append(closeButton, timeline);
    (tableRow.closest('dialog') ?? document.body).append(preview);
    openMitigationActionPreview = preview;

    const bounds = tableRow.getBoundingClientRect();
    const previewBounds = preview.getBoundingClientRect();
    const left = Math.max(8, Math.min(
      bounds.left,
      window.innerWidth - previewBounds.width - 8,
    ));
    const top = Math.max(8, Math.min(
      bounds.bottom + 6,
      window.innerHeight - previewBounds.height - 8,
    ));
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }
  
  function positionOpenMitigationHistoryPopup() {
    const anchor = document.querySelector('.mitigation-result-history-anchor.open');
    if (!anchor) return;
    const tooltip = anchor.historyTooltip;
    if (tooltip) positionMitigationHistoryPopup(anchor, tooltip);
  }
  
  function positionMitigationHistoryPopup(anchor, tooltip) {
    if (!anchor.classList.contains('open')) return;
    tooltip.classList.remove('above');
    const anchorRect = anchor.getBoundingClientRect();
    const naturalHeight = tooltip.scrollHeight + 2;
    const directionThresholdHeight = Math.min(naturalHeight, 300);
    const belowSpace = window.innerHeight - anchorRect.bottom - 12;
    const aboveSpace = anchorRect.top - 12;
    const showAbove = belowSpace < directionThresholdHeight && aboveSpace > belowSpace;
    tooltip.classList.toggle('above', showAbove);
    const availableSpace = Math.max(80, showAbove ? aboveSpace : belowSpace);
    tooltip.style.maxHeight = `${Math.min(naturalHeight, availableSpace)}px`;
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.max(12, Math.min(
      anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2,
      window.innerWidth - tooltipRect.width - 12,
    ));
    const top = showAbove
      ? Math.max(12, anchorRect.top - tooltipRect.height - 7)
      : anchorRect.bottom + 7;
    tooltip.style.left = `${left + window.scrollX}px`;
    tooltip.style.top = `${top + window.scrollY}px`;
  }
  
  function createMitigationHistorySummary(rows) {
    const summary = document.createElement('div');
    summary.className = 'mitigation-history-summary';
    const eligibleRows = rows.filter((row) =>
      !['Dead', 'On cooldown'].includes(row.result.status));
    const missedCount = eligibleRows.filter((row) => row.result.status === 'Missed').length;
    const deadCount = rows.filter((row) => row.result.status === 'Dead').length;
    const onCooldownCount = rows.filter((row) => row.result.status === 'On cooldown').length;
  
    const totals = document.createElement('div');
    totals.className = 'mitigation-history-summary-totals';
    const reached = document.createElement('strong');
    reached.textContent = `${rows.length} ${rows.length === 1 ? 'pull' : 'pulls'} reached mit`;
    const missed = document.createElement('span');
    const missedPercent = eligibleRows.length > 0 ? (missedCount / eligibleRows.length) * 100 : 0;
    missed.className = 'mitigation-history-missed-total';
    missed.textContent = `Missed ${missedCount} ${missedCount === 1 ? 'time' : 'times'}`;
    missed.style.setProperty('--miss-rate-color', getMitigationMissRateColor(missedPercent));
    missed.title = `${missedPercent.toFixed(1)}% of eligible pulls`;
    totals.append(reached, missed);
  
    const chart = document.createElement('div');
    chart.className = 'mitigation-history-chart';
    chart.setAttribute('aria-label', 'Mitigation cast timing density from 20 seconds before the minimum to 20 seconds after the maximum, followed by missed, dead, and on cooldown pulls');
    const referenceResult = rows[0]?.result;
    const windowSeconds = referenceResult
      ? Math.max(0, (referenceResult.endMs - referenceResult.startMs) / 1000)
      : 0;
    const chartSeconds = 40 + windowSeconds;
    const chartPosition = (secondsAfterMinimum) =>
      Math.max(0, Math.min(100, ((secondsAfterMinimum + 20) / chartSeconds) * 100));
    const gradientStops = [
      [-20, getMitigationTimingStatusColor(20, 'early')],
      [-4, getMitigationTimingStatusColor(4, 'early')],
      [-2.5, getMitigationTimingStatusColor(2.5, 'early')],
      [-1.5, getMitigationTimingStatusColor(1.5, 'early')],
      [-0.5, getMitigationTimingStatusColor(0.5, 'early')],
      [0, '#34d399'],
      [windowSeconds, '#34d399'],
      [windowSeconds + 1.5, getMitigationTimingStatusColor(1.5, 'late')],
      [windowSeconds + 2.5, getMitigationTimingStatusColor(2.5, 'late')],
      [windowSeconds + 4, getMitigationTimingStatusColor(4, 'late')],
      [windowSeconds + 20, getMitigationTimingStatusColor(20, 'late')],
    ];
    const timedRows = eligibleRows.filter((entry) => entry.result.cast);
    const timedSamples = timedRows.map((row) =>
      (row.result.cast.elapsedMs - row.result.startMs) / 1000);
    const sampleCount = Math.ceil(chartSeconds * 20) + 1;
    const kernelRadiusSeconds = 0.5;
    const densities = Array.from({ length: sampleCount }, (_, index) => {
      const seconds = -20 + (index / (sampleCount - 1)) * chartSeconds;
      return timedSamples.reduce((total, sample) =>
        total + Math.max(1 - Math.abs(seconds - sample) / kernelRadiusSeconds, 0), 0);
    });
    const densityScale = Math.max(1, missedCount, deadCount, onCooldownCount, ...densities);
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const graph = document.createElement('div');
    graph.className = 'mitigation-history-density-layout';
    const formattedDensityScale = Number.isInteger(densityScale)
      ? String(densityScale)
      : densityScale.toFixed(1);
    graph.dataset.scaleLabel = formattedDensityScale;
    const timingGraph = document.createElement('div');
    timingGraph.className = 'mitigation-history-density-graph';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.classList.add('mitigation-history-density-svg');
    svg.setAttribute('viewBox', '0 0 240 56');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(svgNamespace, 'defs');
    const gradient = document.createElementNS(svgNamespace, 'linearGradient');
    const gradientId = `mitigation-density-gradient-${mitigationHistoryPopupId++}`;
    gradient.id = gradientId;
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('x2', '100%');
    for (const [seconds, color] of gradientStops) {
      const stop = document.createElementNS(svgNamespace, 'stop');
      stop.setAttribute('offset', `${chartPosition(seconds)}%`);
      stop.setAttribute('stop-color', color);
      gradient.append(stop);
    }
    defs.append(gradient);
    svg.append(defs);
    const points = densities.map((density, index) => {
      const x = (index / (sampleCount - 1)) * 240;
      const y = 52 - (density / densityScale) * 46;
      return [x, y];
    });
    const area = document.createElementNS(svgNamespace, 'path');
    area.classList.add('mitigation-history-density-area');
    area.setAttribute('fill', `url(#${gradientId})`);
    area.setAttribute('d', `M 0 52 ${points.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')} L 240 52 Z`);
    svg.append(area);
    for (const [seconds, className] of [[0, 'minimum'], [windowSeconds, 'maximum']]) {
      const guide = document.createElementNS(svgNamespace, 'line');
      const x = (chartPosition(seconds) / 100) * 240;
      guide.classList.add('mitigation-history-density-guide', className);
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('y1', '2');
      guide.setAttribute('y2', '56');
      svg.append(guide);
    }
    for (const [index, row] of timedRows.entries()) {
      const tick = document.createElementNS(svgNamespace, 'line');
      const x = (chartPosition(timedSamples[index]) / 100) * 240;
      tick.classList.add('mitigation-history-density-rug');
      tick.setAttribute('x1', x);
      tick.setAttribute('x2', x);
      tick.setAttribute('y1', '49');
      tick.setAttribute('y2', '56');
      tick.setAttribute('stroke', getPullPhaseColor(row.fight));
      const title = document.createElementNS(svgNamespace, 'title');
      title.textContent = `Pull ${row.fight.id}: ${formatFightDuration(row.result.cast.elapsedMs)} (${row.result.status})`;
      tick.append(title);
      svg.append(tick);
    }
    timingGraph.append(svg);
    attachMitigationHistoryZoom(timingGraph, {
      timedRows,
      timedSamples,
      densityScale,
      domainStart: -20,
      domainEnd: windowSeconds + 20,
      minimumElapsedSeconds: Number(referenceResult?.startMs ?? 0) / 1000,
      windowSeconds,
      gradientStops,
      statusCounts: [
        ['missed', missedCount, 'Missed'],
        ['dead', deadCount, 'Dead'],
        ['on-cooldown', onCooldownCount, 'On CD'],
      ],
    });
  
    graph.append(timingGraph);
    for (const [statusClass, count, label] of [
      ['missed', missedCount, 'Missed'],
      ['dead', deadCount, 'Dead'],
      ['on-cooldown', onCooldownCount, 'On cooldown'],
    ]) {
      const statusGraph = document.createElement('div');
      statusGraph.className = `mitigation-history-status-graph ${statusClass}`;
      statusGraph.title = `${count} ${label.toLowerCase()} ${count === 1 ? 'pull' : 'pulls'}`;
      const statusBar = document.createElement('span');
      statusBar.style.height = `${(count / densityScale) * (46 / 56) * 100}%`;
      statusGraph.append(statusBar);
      graph.append(statusGraph);
    }
  
    const labels = document.createElement('div');
    labels.className = 'mitigation-history-chart-labels';
    for (const [label, position, className] of [
      ['−20s', 0, 'start'],
      ['Minimum', chartPosition(0), 'minimum'],
      ['Maximum', chartPosition(windowSeconds), 'maximum'],
      ['+20s', 100, 'end'],
    ]) {
      const span = document.createElement('span');
      span.textContent = label;
      span.className = className;
      span.style.left = `${position}%`;
      labels.append(span);
    }
    for (const [label, className] of [
      ['Missed', 'missed'],
      ['Dead', 'dead'],
      ['On CD', 'on-cooldown'],
    ]) {
      const statusLabel = document.createElement('span');
      statusLabel.className = `mitigation-history-status-label ${className}`;
      statusLabel.textContent = label;
      labels.append(statusLabel);
    }
    chart.append(graph, labels);
    summary.append(totals, chart);
    return summary;
  }
  
  // Hovering the compact density plot opens a pixel-sampled 20-second slice. A click
  // pins it so the expanded graph can report an exact timestamp under its own cursor.
  function attachMitigationHistoryZoom(timingGraph, chartData) {
    let preview = null;
    let pinned = false;
    const closePreview = () => {
      const closingPreview = preview;
      preview = null;
      pinned = false;
      if (!closingPreview) return;
      const pinnedIndex = pinnedMitigationHistoryZoomPreviews
        .findIndex((entry) => entry.preview === closingPreview);
      if (pinnedIndex >= 0) pinnedMitigationHistoryZoomPreviews.splice(pinnedIndex, 1);
      closingPreview.classList.remove('pinned');
      closingPreview.classList.add('closing');
      window.setTimeout(() => closingPreview.remove(), 120);
    };
    const hide = () => {
      if (!pinned) closePreview();
    };
    const show = (event) => {
      if (pinned) return;
      const bounds = timingGraph.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const hoveredSeconds = chartData.domainStart
        + ratio * (chartData.domainEnd - chartData.domainStart);
      const halfRange = 10;
      const zoomStart = Math.max(
        chartData.domainStart,
        Math.min(hoveredSeconds - halfRange, chartData.domainEnd - halfRange * 2),
      );
      const zoomEnd = Math.min(chartData.domainEnd, zoomStart + halfRange * 2);
      preview?.remove();
      preview = createMitigationHistoryZoomPreview(chartData, zoomStart, zoomEnd);
      // A modal dialog lives in the browser's top layer, above every normal body
      // child regardless of z-index. Keep its graph preview inside that dialog so
      // the preview remains above the mitigation overview that owns it.
      const popupHost = timingGraph.closest('dialog') ?? document.body;
      popupHost.append(preview);
      preview.querySelector('.mitigation-history-zoom-close')?.addEventListener('click', (closeEvent) => {
        closeEvent.stopPropagation();
        closePreview();
      });
      positionMitigationHistoryZoomPreview(preview, event);
    };
    const togglePinned = (event) => {
      event.stopPropagation();
      if (!preview) show(event);
      if (pinned) {
        closePreview();
        return;
      }
      pinned = true;
      preview?.classList.add('pinned');
      pinnedMitigationHistoryZoomPreviews.push({ preview, close: closePreview });
      for (let index = pinnedMitigationHistoryZoomPreviews.length - 1; index >= 0; index -= 1) {
        if (!pinnedMitigationHistoryZoomPreviews[index].preview.isConnected) {
          pinnedMitigationHistoryZoomPreviews.splice(index, 1);
        }
      }
      while (pinnedMitigationHistoryZoomPreviews.length > 2) {
        pinnedMitigationHistoryZoomPreviews[0].close();
      }
    };
    timingGraph.classList.add('zoomable');
    timingGraph.addEventListener('mouseenter', show);
    timingGraph.addEventListener('mousemove', show);
    timingGraph.addEventListener('mouseleave', hide);
    timingGraph.addEventListener('click', togglePinned);
  }
  
  function createMitigationHistoryZoomPreview(data, zoomStart, zoomEnd) {
    const graphWidth = 564;
    const graphBaseline = 88;
    const graphTop = 10;
    const preview = document.createElement('div');
    preview.className = 'mitigation-history-zoom-preview';
    preview.setAttribute('role', 'tooltip');
    const previewHeader = document.createElement('div');
    previewHeader.className = 'mitigation-history-zoom-header';
    const heading = document.createElement('strong');
    heading.textContent = `${formatFightDuration((data.minimumElapsedSeconds + zoomStart) * 1000)}–${formatFightDuration((data.minimumElapsedSeconds + zoomEnd) * 1000)}`;
    const closeButton = document.createElement('button');
    closeButton.className = 'mitigation-history-zoom-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.setAttribute('aria-label', 'Close mitigation graph');
    previewHeader.append(heading, closeButton);
    const layout = document.createElement('div');
    layout.className = 'mitigation-history-zoom-layout';
    const timing = document.createElement('div');
    timing.className = 'mitigation-history-zoom-timing';
  
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.classList.add('mitigation-history-zoom-svg');
    svg.setAttribute('viewBox', `0 0 ${graphWidth} 124`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(svgNamespace, 'defs');
    const gradient = document.createElementNS(svgNamespace, 'linearGradient');
    const gradientId = `mitigation-zoom-gradient-${mitigationHistoryPopupId++}`;
    gradient.id = gradientId;
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('x2', '100%');
    for (const [seconds, color] of data.gradientStops) {
      const stop = document.createElementNS(svgNamespace, 'stop');
      const position = ((seconds - zoomStart) / (zoomEnd - zoomStart)) * 100;
      stop.setAttribute('offset', `${Math.max(0, Math.min(100, position))}%`);
      stop.setAttribute('stop-color', color);
      gradient.append(stop);
    }
    defs.append(gradient);
    svg.append(defs);
  
    // One density sample per rendered graph pixel, including both endpoints.
    const sampleCount = graphWidth + 1;
    const densities = Array.from({ length: sampleCount }, (_, index) => {
      const seconds = zoomStart + (index / (sampleCount - 1)) * (zoomEnd - zoomStart);
      return data.timedSamples.reduce((total, sample) =>
        total + Math.max(1 - Math.abs(seconds - sample) / 0.5, 0), 0);
    });
    const points = densities.map((density, index) => [
      index,
      graphBaseline - (density / data.densityScale) * (graphBaseline - graphTop),
    ]);
    const area = document.createElementNS(svgNamespace, 'path');
    area.classList.add('mitigation-history-density-area');
    area.setAttribute('fill', `url(#${gradientId})`);
    area.setAttribute('d', `M 0 ${graphBaseline} ${points.map(([x, y]) => `L ${x} ${y.toFixed(2)}`).join(' ')} L ${graphWidth} ${graphBaseline} Z`);
    svg.append(area);
  
    const maximumGuide = document.createElementNS(svgNamespace, 'line');
    maximumGuide.classList.add('mitigation-history-zoom-maximum-guide');
    maximumGuide.setAttribute('x1', '0');
    maximumGuide.setAttribute('x2', graphWidth);
    maximumGuide.setAttribute('y1', graphTop);
    maximumGuide.setAttribute('y2', graphTop);
    svg.append(maximumGuide);
    const maximumLabel = document.createElementNS(svgNamespace, 'text');
    maximumLabel.classList.add('mitigation-history-zoom-maximum-label');
    maximumLabel.setAttribute('x', graphWidth - 3);
    maximumLabel.setAttribute('y', graphTop - 2);
    maximumLabel.textContent = String(Number.isInteger(data.densityScale)
      ? data.densityScale
      : data.densityScale.toFixed(1));
    svg.append(maximumLabel);
  
    for (const [seconds, className] of [[0, 'minimum'], [data.windowSeconds, 'maximum']]) {
      if (seconds < zoomStart || seconds > zoomEnd) continue;
      const guide = document.createElementNS(svgNamespace, 'line');
      const x = ((seconds - zoomStart) / (zoomEnd - zoomStart)) * graphWidth;
      guide.classList.add('mitigation-history-density-guide', className);
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('y1', '4');
      guide.setAttribute('y2', graphBaseline);
      svg.append(guide);
    }
  
    data.timedSamples.forEach((seconds, index) => {
      if (seconds < zoomStart || seconds > zoomEnd) return;
      const row = data.timedRows[index];
      const tick = document.createElementNS(svgNamespace, 'line');
      const x = ((seconds - zoomStart) / (zoomEnd - zoomStart)) * graphWidth;
      tick.classList.add('mitigation-history-density-rug');
      tick.setAttribute('x1', x);
      tick.setAttribute('x2', x);
      tick.setAttribute('y1', graphBaseline - 5);
      tick.setAttribute('y2', graphBaseline + 5);
      tick.setAttribute('stroke', getPullPhaseColor(row.fight));
      svg.append(tick);
    });
  
    const absoluteStart = data.minimumElapsedSeconds + zoomStart;
    const absoluteEnd = data.minimumElapsedSeconds + zoomEnd;
    const firstEighth = Math.ceil((absoluteStart - 1e-7) * 8);
    const lastEighth = Math.floor((absoluteEnd + 1e-7) * 8);
    for (let eighth = firstEighth; eighth <= lastEighth; eighth += 1) {
      const absoluteSeconds = eighth / 8;
      const x = ((absoluteSeconds - absoluteStart) / (absoluteEnd - absoluteStart)) * graphWidth;
      const remainder = ((eighth % 8) + 8) % 8;
      const tickClass = remainder === 0 ? 'second' : remainder === 4 ? 'half' : remainder % 2 === 0 ? 'quarter' : 'eighth';
      const tick = document.createElementNS(svgNamespace, 'line');
      tick.classList.add('mitigation-history-zoom-axis-tick', tickClass);
      tick.setAttribute('x1', x);
      tick.setAttribute('x2', x);
      tick.setAttribute('y1', graphBaseline);
      tick.setAttribute('y2', graphBaseline + ({ second: 14, half: 10, quarter: 7, eighth: 4 })[tickClass]);
      svg.append(tick);
      if (tickClass === 'second') {
        const label = document.createElementNS(svgNamespace, 'text');
        label.classList.add('mitigation-history-zoom-axis-label');
        label.setAttribute('x', x);
        label.setAttribute('y', '116');
        label.textContent = formatFightDuration(absoluteSeconds * 1000);
        svg.append(label);
      }
    }
  
    const cursor = document.createElement('div');
    cursor.className = 'mitigation-history-zoom-cursor';
    const cursorLabel = document.createElement('span');
    cursor.append(cursorLabel);
    timing.append(svg, cursor);
    timing.addEventListener('mousemove', (event) => {
      if (!preview.classList.contains('pinned')) return;
      const bounds = timing.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const absoluteSeconds = absoluteStart + ratio * (absoluteEnd - absoluteStart);
      cursor.style.left = `${ratio * 100}%`;
      cursorLabel.textContent = formatMitigationHistoryTimestamp(absoluteSeconds * 1000);
      cursor.classList.add('visible');
    });
    timing.addEventListener('mouseleave', () => cursor.classList.remove('visible'));
  
    layout.append(timing);
    for (const [statusClass, count, label] of data.statusCounts) {
      const status = document.createElement('div');
      status.className = `mitigation-history-zoom-status ${statusClass}`;
      const bar = document.createElement('span');
      bar.style.height = `${(count / data.densityScale) * (graphBaseline - graphTop)}px`;
      const statusLabel = document.createElement('small');
      statusLabel.textContent = label;
      status.append(bar, statusLabel);
      layout.append(status);
    }
    preview.append(previewHeader, layout);
    return preview;
  }
  
  function formatMitigationHistoryTimestamp(durationMs) {
    const safeMilliseconds = Math.max(0, Math.round(Number(durationMs) || 0));
    const minutes = Math.floor(safeMilliseconds / 60_000);
    const seconds = Math.floor((safeMilliseconds % 60_000) / 1000);
    const milliseconds = safeMilliseconds % 1000;
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }
  
  function positionMitigationHistoryZoomPreview(preview, event) {
    const gap = 14;
    const bounds = preview.getBoundingClientRect();
    const left = Math.max(10, Math.min(event.clientX - bounds.width / 2, window.innerWidth - bounds.width - 10));
    const roomAbove = event.clientY - gap - bounds.height;
    const top = roomAbove >= 10 ? roomAbove : Math.min(event.clientY + gap, window.innerHeight - bounds.height - 10);
    preview.style.left = `${left}px`;
    preview.style.top = `${Math.max(10, top)}px`;
  }
  
  function getPullPhaseColor(fight) {
    if (fight?.kill) return '#34d399';
    if (fight?.lastPhaseIsIntermission) return '#9aa8bb';
    return ({
      1: '#4f8fd6',
      2: '#d97706',
      3: '#a855c7',
      4: '#60a5fa',
      5: '#db547c',
      6: '#84942b',
    })[Number(fight?.lastPhase)] || '#9aa8bb';
  }
  
  function getMitigationMissRateColor(percent) {
    const green = [52, 211, 153];
    const yellow = [251, 191, 36];
    const orange = [249, 115, 22];
    const red = [251, 113, 133];
    if (percent <= 0) return rgbColor(green);
    if (percent <= 10) return interpolateColor(green, yellow, percent / 10);
    if (percent <= 17.5) return interpolateColor(yellow, orange, (percent - 10) / 7.5);
    if (percent <= 25) return interpolateColor(orange, red, (percent - 17.5) / 7.5);
    return rgbColor(red);
  }
  
  function createMitigationHistoryTable(rows, report = null) {
    if (rows.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = 'No pulls reached this assignment.';
      return empty;
    }
    const table = document.createElement('table');
    table.className = 'mitigation-history-table';
    const headRow = document.createElement('tr');
    for (const label of ['#', 'Badge', 'Player', 'Result']) {
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
      if (report && row.result.player?.name) {
        tableRow.className = 'mitigation-history-action-row';
        tableRow.tabIndex = 0;
        tableRow.title = 'Show player actions surrounding this mitigation';
        const openTimeline = (event) => {
          event.stopPropagation();
          showMitigationActionPreview(report, row, tableRow);
        };
        tableRow.addEventListener('click', openTimeline);
        tableRow.addEventListener('keydown', (event) => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          openTimeline(event);
        });
      }
      const pullCell = document.createElement('td');
      pullCell.textContent = String(row.fight.id);
      const badgeCell = document.createElement('td');
      badgeCell.append(createBestPullBadge(row.fight));
      const playerCell = document.createElement('td');
      playerCell.className = 'mitigation-history-player';
      playerCell.textContent = row.result.player?.name ?? '—';
      if (row.result.player?.job) {
        playerCell.title = `${row.result.player.name} (${row.result.player.job})`;
      }
      const resultCell = document.createElement('td');
      resultCell.className = `mitigation-history-result ${row.result.statusClass}`;
      resultCell.textContent = row.result.status;
      if (row.result.statusColor) resultCell.style.setProperty('--timing-color', row.result.statusColor);
      tableRow.append(pullCell, badgeCell, playerCell, resultCell);
      body.append(tableRow);
    }
    table.append(head, body);
    return table;
  }
  
  function mitigationIdentity(mitigation) {
    return [mitigation.assignedTo, mitigation.abilityId, mitigation.phase ?? '',
      mitigation.startElapsedSeconds, mitigation.endElapsedSeconds].join(':');
  }
  
  

  function nextMitigationHistoryPopupId() {
    mitigationHistoryPopupId += 1;
    return mitigationHistoryPopupId;
  }

  document.addEventListener('click', (event) => {
    if (!openMitigationActionPreview) return;
    if (openMitigationActionPreview.contains(event.target)
      || event.target.closest('.mitigation-history-action-row')) return;
    closeMitigationActionPreview();
  });

  return {
    closeOpenMitigationHistoryPopups,
    createMitigationHistorySummary,
    createMitigationHistoryTable,
    mitigationIdentity,
    nextMitigationHistoryPopupId,
    positionMitigationHistoryPopup,
    positionOpenMitigationHistoryPopup,
    showReportMitigationHistoryOverview,
  };
}
