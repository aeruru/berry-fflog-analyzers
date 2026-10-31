const checklist = document.querySelector('#checklist');
const title = document.querySelector('#page-title');
const progress = document.querySelector('#progress-label');
const starProgress = document.querySelector('#star-progress');
const error = document.querySelector('#error');
const undoButton = document.querySelector('#undo-button');
const markXButton = document.querySelector('#mark-x-button');
const zoomSlider = document.querySelector('#zoom-slider');
const zoomValue = document.querySelector('#zoom-value');

const states = ['off', 'on', 'dash', 'x'];
const history = [];
const longPressed = new WeakSet();
let storageKey = 'static-checklist';
let config;
let markAllUsed = false;
let holdTimer;

function loadSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey)) ?? {};
    return value.boxes ? value : { boxes: value, markAllUsed: false, zoom: 100 };
  } catch {
    return { boxes: {}, markAllUsed: false, zoom: 100 };
  }
}

function boxValue(box) {
  return { state: box.dataset.state, locked: box.dataset.locked === 'true' };
}

function setState(box, state, locked = false) {
  box.dataset.state = state;
  box.dataset.locked = String(locked);
  box.textContent = state === 'on' ? '✓' : state === 'dash' ? '−' : state === 'x' ? '×' : '';
  box.setAttribute('aria-checked', state === 'dash' ? 'mixed' : String(state === 'on'));
}

function snapshot() {
  const boxes = {};
  document.querySelectorAll('.state-box').forEach((box) => { boxes[box.id] = boxValue(box); });
  return { boxes, markAllUsed };
}

function pushHistory() {
  history.push(snapshot());
  if (history.length > 3) history.shift();
  undoButton.disabled = false;
}

function persist() {
  const boxes = {};
  document.querySelectorAll('.state-box').forEach((box) => {
    const value = boxValue(box);
    if (value.state !== 'off' || value.locked) boxes[box.id] = value;
  });
  localStorage.setItem(storageKey, JSON.stringify({ boxes, markAllUsed, zoom: Number(zoomSlider.value) }));
}

function fraction(boxes) {
  const counted = boxes.filter((box) => box.dataset.state !== 'dash');
  return `${counted.filter((box) => box.dataset.state === 'on').length}/${counted.length}`;
}

function update() {
  const boxes = [...document.querySelectorAll('.state-box')];
  progress.textContent = fraction(boxes);
  starProgress.textContent = fraction(boxes.filter((box) => box.closest('.starred')));
  markXButton.disabled = markAllUsed;
  undoButton.disabled = history.length === 0;
}

function markEarlierEmptyBoxes(box) {
  const boxes = [...box.closest('.line').querySelectorAll('.state-box')];
  boxes.slice(0, boxes.indexOf(box)).forEach((earlier) => {
    if (earlier.dataset.state === 'off' && earlier.dataset.locked !== 'true') setState(earlier, 'x');
  });
}

function cycle(box) {
  pushHistory();
  markEarlierEmptyBoxes(box);
  const state = box.dataset.state;
  if (state === 'x') setState(box, 'off', true);
  else setState(box, states[states.indexOf(state) + 1], false);
  persist();
  update();
}

function dashAhead(box) {
  const boxes = [...box.closest('.line').querySelectorAll('.state-box')];
  const ahead = boxes.slice(boxes.indexOf(box) + 1);
  if (!ahead.some((candidate) => ['off', 'x'].includes(candidate.dataset.state))) return;
  pushHistory();
  ahead.forEach((candidate) => {
    if (['off', 'x'].includes(candidate.dataset.state)) setState(candidate, 'dash');
  });
  persist();
  update();
}

function attachBoxEvents(box) {
  box.addEventListener('click', (event) => {
    if (longPressed.delete(box) || event.detail > 1) return;
    cycle(box);
  });
  box.addEventListener('dblclick', (event) => event.preventDefault());
  box.addEventListener('pointerdown', () => {
    if (box.dataset.state !== 'dash') return;
    holdTimer = setTimeout(() => {
      longPressed.add(box);
      dashAhead(box);
    }, 600);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => {
    box.addEventListener(name, () => clearTimeout(holdTimer));
  });
}

function makeLine(text, lineIndex, stored) {
  const row = document.createElement('div');
  const indented = /^\s/.test(text);
  const trimmed = text.trimStart();
  const match = trimmed.match(/^(?:☐\s*)+/);
  const count = match ? (match[0].match(/☐/g) ?? []).length : 0;
  let label = match ? trimmed.slice(match[0].length) : trimmed;
  const starred = label.endsWith('⭐');
  if (starred) label = label.slice(0, -1).trimEnd();
  row.className = `line${indented ? ' indented' : ''}${count ? '' : ' note'}${starred ? ' starred' : ''}`;

  for (let index = 0; index < count; index += 1) {
    const box = document.createElement('button');
    const id = `check-${lineIndex}-${index}`;
    const savedValue = stored[id];
    const value = typeof savedValue === 'string'
      ? { state: savedValue, locked: false }
      : savedValue ?? { state: 'off', locked: false };
    box.type = 'button';
    box.id = id;
    box.className = 'state-box';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-label', label);
    setState(box, states.includes(value.state) ? value.state : 'off', Boolean(value.locked));
    attachBoxEvents(box);
    row.append(box);
  }
  const span = document.createElement('span');
  span.textContent = label;
  row.append(span);
  return row;
}

function setZoom(value, save = true) {
  const zoom = Math.min(500, Math.max(50, Number(value) || 100));
  zoomSlider.value = String(zoom);
  zoomValue.textContent = `${zoom}%`;
  checklist.style.zoom = `${zoom}%`;
  if (save) persist();
}

function render(value) {
  config = value;
  document.title = value.title || 'Checklist';
  title.textContent = document.title;
  storageKey = `static-checklist:${value.id || value.title || 'default'}`;
  const saved = loadSaved();
  markAllUsed = Boolean(saved.markAllUsed);
  const headings = new Set(value.sectionHeadings ?? []);
  let section;
  value.lines.forEach((line, lineIndex) => {
    if (!line.trim()) return;
    const heading = headings.has(line.trim());
    if (heading || !section) {
      section = document.createElement('section');
      section.className = 'section';
      checklist.append(section);
      if (heading) {
        const h = document.createElement('h2');
        h.textContent = line.trim();
        section.append(h);
        return;
      }
    }
    section.append(makeLine(line, lineIndex, saved.boxes));
  });
  setZoom(saved.zoom ?? 100, false);
  checklist.setAttribute('aria-busy', 'false');
  update();
}

function exportText() {
  if (!config) return;
  const lines = config.lines.map((text, lineIndex) => {
    const indent = text.match(/^\s*/)[0];
    const trimmed = text.slice(indent.length);
    const match = trimmed.match(/^(?:☐\s*)+/);
    if (!match) return text;
    const count = (match[0].match(/☐/g) ?? []).length;
    const symbols = Array.from({ length: count }, (_, index) => {
      const state = document.querySelector(`#check-${lineIndex}-${index}`)?.dataset.state ?? 'off';
      return state === 'on' ? '☒ ' : state === 'dash' ? '- ' : '☐ ';
    }).join('');
    return `${indent}${symbols}${trimmed.slice(match[0].length)}`;
  });
  const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = config.downloadFileName || `${config.id || 'checklist'}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

document.querySelector('#save-button').addEventListener('click', exportText);
zoomSlider.addEventListener('input', () => setZoom(zoomSlider.value));
markXButton.addEventListener('click', () => {
  if (markAllUsed) return;
  pushHistory();
  document.querySelectorAll('.state-box[data-state="off"]').forEach((box) => setState(box, 'x'));
  markAllUsed = true;
  persist();
  update();
});
document.querySelector('#reset-button').addEventListener('click', () => {
  pushHistory();
  document.querySelectorAll('.state-box').forEach((box) => setState(box, 'off'));
  markAllUsed = false;
  persist();
  update();
});
undoButton.addEventListener('click', () => {
  const previous = history.pop();
  if (!previous) return;
  Object.entries(previous.boxes).forEach(([id, value]) => {
    const box = document.getElementById(id);
    if (box) setState(box, value.state, value.locked);
  });
  markAllUsed = previous.markAllUsed;
  persist();
  update();
});

fetch('checklist.json')
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load checklist.json (${response.status})`);
    return response.json();
  })
  .then(render)
  .catch((reason) => {
    checklist.hidden = true;
    error.hidden = false;
    error.textContent = `${reason.message}. Serve this folder through a local web server.`;
  });
