// Animates changing layouts and coordinates responsive fight panels and timeline-event collision rendering.
export function createTimelineInteractions(dependencies) {
  const {
    calculateTimelineGroupLayout,
    createTimelineEventGroupMarker,
    createTimelineEventKindGroups,
    createTimelineEventMarker,
    getTimelineItemCollisionBounds,
    getTimelineTickLabelBounds,
    groupOverlappingTimelineEvents,
    timelineIntervalsTouch,
  } = dependencies;
  const smoothHeightAnimations = new WeakMap();
  let timelineCollisionFrame = null;
  let fightPanelLayoutFrame = null;

  function updateWithSmoothHeight(element, update) {
    if (!element?.isConnected
      || typeof element.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update();
      return;
    }
    const existing = smoothHeightAnimations.get(element);
    const startHeight = element.getBoundingClientRect().height;
    const originalOverflow = existing?.originalOverflow ?? element.style.overflow;
    const originalOverflowClipMargin = existing?.originalOverflowClipMargin
      ?? element.style.overflowClipMargin;
    existing?.animation.cancel();
    update();
    const endHeight = element.getBoundingClientRect().height;
    if (startHeight < 1 || Math.abs(endHeight - startHeight) < 1) return;

    element.style.overflow = 'clip';
    element.style.overflowClipMargin = '24px';
    const animation = element.animate([
      { height: `${startHeight}px` },
      { height: `${endHeight}px` },
    ], { duration: 170, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' });
    smoothHeightAnimations.set(element, {
      animation,
      originalOverflow,
      originalOverflowClipMargin,
    });
    animation.addEventListener('finish', () => {
      if (smoothHeightAnimations.get(element)?.animation !== animation) return;
      element.style.overflow = originalOverflow;
      element.style.overflowClipMargin = originalOverflowClipMargin;
      smoothHeightAnimations.delete(element);
    }, { once: true });
  }

  function scheduleResponsiveFightPanelLayout() {
    cancelAnimationFrame(fightPanelLayoutFrame);
    fightPanelLayoutFrame = requestAnimationFrame(() => {
      for (const panels of document.querySelectorAll('.fight-panels')) {
        panels.classList.remove('side-by-side');
        const detailsTable = panels.querySelector('.fight-details-table');
        const mitigationTable = panels.querySelector('.mitigation-table');
        if (!detailsTable || !mitigationTable) continue;
        const requiredWidth = detailsTable.scrollWidth + mitigationTable.scrollWidth + 49;
        if (requiredWidth <= panels.clientWidth) {
          panels.classList.add('side-by-side');
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

  function scheduleTimelineCollisionCheck() {
    cancelAnimationFrame(timelineCollisionFrame);
    timelineCollisionFrame = requestAnimationFrame(() => {
      renderTimelineEventGroups();
      for (const row of document.querySelectorAll('.fight-timeline-row.last-phase-row')) {
        row.classList.remove('crowded-end');
        const endTick = row.querySelector('.fight-timeline-tick.boundary-end');
        endTick?.classList.remove('crowded');
        if (!endTick) continue;
        const endBounds = getTimelineTickLabelBounds(endTick);
        const endTickLeft = endTick.getBoundingClientRect().left;
        const precedingTick = [...row.querySelectorAll('.fight-timeline-tick')]
          .filter((tick) => tick !== endTick && tick.getBoundingClientRect().left < endTickLeft - 1)
          .sort((first, second) => second.getBoundingClientRect().left - first.getBoundingClientRect().left)[0];
        const precedingBounds = getTimelineTickLabelBounds(precedingTick);
        if (endBounds && precedingBounds && precedingBounds.right - endBounds.left > 1) {
          endTick.classList.add('crowded');
          row.classList.add('crowded-end');
        }
      }
    });
  }

  function renderTimelineEventGroups() {
    for (const canvas of document.querySelectorAll('.fight-timeline-canvas')) {
      const sourceItems = canvas.timelineEventItems ?? [];
      canvas.querySelectorAll('.fight-timeline-event, .fight-timeline-event-member-preview')
        .forEach((marker) => marker.remove());
      if (sourceItems.length === 0 || canvas.clientWidth === 0) continue;

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
          if (absorbedOrMerged) break;
        }
        if (absorbedOrMerged) continue;
        for (const item of initialSingles) {
          if (absorbedSingles.has(item)) continue;
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

  return { scheduleResponsiveFightPanelLayout, scheduleTimelineCollisionCheck, updateWithSmoothHeight };
}
