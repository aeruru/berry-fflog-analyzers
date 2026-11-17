// Small, shared DOM primitives belong here; feature-specific views stay in their
// own modules so this file does not become a second app.js.
export function createLinkGroup(label, links) {
  const group = document.createElement('span');
  group.className = 'detailed-fight-link-group';
  group.append(`${label} `, ...links);
  return group;
}

export function createExternalLink(label, href) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
}

export function createMetric(label, value, className) {
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
