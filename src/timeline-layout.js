// Measures timeline collisions and produces stable grouped-marker layouts for responsive canvases.
const TIMELINE_GROUP_EPSILON_PX = 0.01;
const TIMELINE_EVENT_COLLISION_WIDTH_PX = {
  'Damage down': 13,
  Death: 16,
};

export function createTimelineLayout({ createGroupSummaryBox }) {
  function getItemCollisionBounds(item, canvasWidth) {
    const center = item.position / 100 * canvasWidth;
    const halfWidth = TIMELINE_EVENT_COLLISION_WIDTH_PX[item.event.kind] / 2;
    return { left: center - halfWidth, right: center + halfWidth };
  }

  function intervalsTouch(first, second) {
    return first.left <= second.right + TIMELINE_GROUP_EPSILON_PX
      && second.left <= first.right + TIMELINE_GROUP_EPSILON_PX;
  }

  function groupOverlappingEvents(sourceItems, canvasWidth) {
    const remaining = sourceItems.map((item) => ({
      item,
      bounds: getItemCollisionBounds(item, canvasWidth),
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
          if (!intervalsTouch({ left: clusterLeft, right: clusterRight }, candidate.bounds)) continue;
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

  function createEventKindGroups(items) {
    return ['Damage down', 'Death']
      .map((kind) => ({ kind, items: items.filter((item) => item.event.kind === kind) }))
      .filter((group) => group.items.length > 0);
  }

  function measureGroupBoxWidth(groups, canvas) {
    const box = createGroupSummaryBox(groups);
    box.style.position = 'absolute';
    box.style.visibility = 'hidden';
    canvas.append(box);
    const width = box.getBoundingClientRect().width;
    box.remove();
    return width;
  }

  function calculateGroupLayout(items, canvas) {
    const collisionBounds = items.map((item) => getItemCollisionBounds(item, canvas.clientWidth));
    const eventLeft = Math.min(...collisionBounds.map((bounds) => bounds.left));
    const eventRight = Math.max(...collisionBounds.map((bounds) => bounds.right));
    const eventWidth = eventRight - eventLeft;
    const groups = createEventKindGroups(items);
    const intrinsicWidth = measureGroupBoxWidth(groups, canvas);
    const expandsToEvents = eventWidth > intrinsicWidth;
    const center = expandsToEvents
      ? (eventLeft + eventRight) / 2
      : items.reduce((sum, item) => sum + item.position / 100 * canvas.clientWidth, 0)
        / items.length;
    const width = Math.max(eventWidth, intrinsicWidth);
    return {
      left: center - width / 2,
      right: center + width / 2,
      position: center / canvas.clientWidth * 100,
      width,
      expandsToEvents,
    };
  }

  function getTickLabelBounds(tick) {
    if (!tick) return null;
    const labels = [...tick.querySelectorAll('.fight-timeline-time, .fight-timeline-mechanic')];
    if (labels.length === 0) return null;
    const rectangles = labels.map((label) => label.getBoundingClientRect());
    return {
      left: Math.min(...rectangles.map((rectangle) => rectangle.left)),
      right: Math.max(...rectangles.map((rectangle) => rectangle.right)),
    };
  }

  return {
    calculateTimelineGroupLayout: calculateGroupLayout,
    createTimelineEventKindGroups: createEventKindGroups,
    getTimelineItemCollisionBounds: getItemCollisionBounds,
    getTimelineTickLabelBounds: getTickLabelBounds,
    groupOverlappingTimelineEvents: groupOverlappingEvents,
    timelineIntervalsTouch: intervalsTouch,
  };
}
