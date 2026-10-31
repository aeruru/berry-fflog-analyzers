const checklistElement = document.querySelector('#checklist');
const titleElement = document.querySelector('#page-title');
const progressLabel = document.querySelector('#progress-label');
const starProgress = document.querySelector('#star-progress');
const resetButton = document.querySelector('#reset-button');
const errorElement = document.querySelector('#error');
const states = ['off', 'on', 'dash'];
let storageKey = 'static-checklist';

function savedStates() {
  try { return JSON.parse(localStorage.getItem(storageKey)) ?? {}; }
  catch { return {}; }
}

function saveStates() {
  const saved = {};
  document.querySelectorAll('.state-box').forEach((box) => {
    if (box.dataset.state !== 'off') saved[box.id] = box.dataset.state;
  });
  localStorage.setItem(storageKey, JSON.stringify(saved));
}

function setBoxState(box, state) {
  box.dataset.state = state;
  box.textContent = state === 'on' ? '✓' : state === 'dash' ? '−' : '';
  box.setAttribute('aria-checked', state === 'dash' ? 'mixed' : String(state === 'on'));
}

function fraction(boxes) {
  const counted = boxes.filter((box) => box.dataset.state !== 'dash');
  const on = counted.filter((box) => box.dataset.state === 'on').length;
  return `${on}/${counted.length}`;
}

function updateProgress() {
  const boxes = [...document.querySelectorAll('.state-box')];
  progressLabel.textContent = fraction(boxes);
  starProgress.textContent = fraction(boxes.filter((box) => box.closest('.starred')));
}

function cycleBox(box) {
  setBoxState(box, states[(states.indexOf(box.dataset.state) + 1) % states.length]);
  saveStates();
  updateProgress();
}

function makeLine(text, lineIndex, saved) {
  const row = document.createElement('div');
  const isIndented = /^\s/.test(text);
  const trimmed = text.trimStart();
  const match = trimmed.match(/^(?:☐\s*)+/);
  const boxCount = match ? (match[0].match(/☐/g) ?? []).length : 0;
  let labelText = match ? trimmed.slice(match[0].length) : trimmed;
  const isStarred = labelText.endsWith('⭐');
  if (isStarred) labelText = labelText.slice(0, -1).trimEnd();

  row.className = `line${isIndented ? ' indented' : ''}${boxCount ? '' : ' note'}${isStarred ? ' starred' : ''}`;
  for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
    const id = `check-${lineIndex}-${boxIndex}`;
    const box = document.createElement('button');
    box.type = 'button';
    box.id = id;
    box.className = 'state-box';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-label', labelText);
    setBoxState(box, states.includes(saved[id]) ? saved[id] : 'off');
    box.addEventListener('click', () => cycleBox(box));
    row.append(box);
  }

  const content = document.createElement('span');
  content.className = 'line-text';
  content.textContent = labelText;
  row.append(content);
  return row;
}

function render(config) {
  document.title = config.title || 'Checklist';
  titleElement.textContent = config.title || 'Checklist';
  storageKey = `static-checklist:${config.id || config.title || 'default'}`;
  const saved = savedStates();
  const sectionHeadings = new Set(config.sectionHeadings ?? []);
  let section;

  config.lines.forEach((line, lineIndex) => {
    if (!line.trim()) return;
    const isHeading = sectionHeadings.has(line.trim());
    if (isHeading || !section) {
      section = document.createElement('section');
      section.className = 'section';
      checklistElement.append(section);
      if (isHeading) {
        const heading = document.createElement('h2');
        heading.textContent = line.trim();
        section.append(heading);
        return;
      }
    }
    section.append(makeLine(line, lineIndex, saved));
  });
  checklistElement.setAttribute('aria-busy', 'false');
  updateProgress();
}

resetButton.addEventListener('click', () => {
  document.querySelectorAll('.state-box').forEach((box) => setBoxState(box, 'off'));
  saveStates();
  updateProgress();
});

fetch('checklist.json')
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load checklist.json (${response.status})`);
    return response.json();
  })
  .then(render)
  .catch((error) => {
    checklistElement.hidden = true;
    errorElement.hidden = false;
    errorElement.textContent = `${error.message}. Serve this folder through a local web server rather than opening index.html directly.`;
  });
