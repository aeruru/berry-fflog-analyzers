import { CACHE_STORAGE_PREFIX } from './config.js';

export function makeCacheKey(queryName, inputs) {
  return `${CACHE_STORAGE_PREFIX}${queryName}:${encodeURIComponent(stableStringify(inputs))}`;
}

export function readCacheEntry(cacheKey) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    return cached?.payload ?? null;
  } catch {
    localStorage.removeItem(cacheKey);
    return null;
  }
}

export function writeCacheEntry(cacheKey, payload) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      cachedAt: Date.now(),
      payload,
    }));
  } catch (error) {
    console.info('Could not write FFLogs cache entry.', error);
  }
}

export function clearCacheEntries(predicate = null) {
  const keys = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(CACHE_STORAGE_PREFIX)) {
      keys.push(key);
    }
  }

  const keysToClear = predicate ? keys.filter((key) => predicate(readCacheKeyParts(key))) : keys;
  keysToClear.forEach((key) => localStorage.removeItem(key));
  return keysToClear.length;
}

function readCacheKeyParts(key) {
  const withoutPrefix = key.slice(CACHE_STORAGE_PREFIX.length);
  const separatorIndex = withoutPrefix.indexOf(':');
  const queryName = separatorIndex >= 0 ? withoutPrefix.slice(0, separatorIndex) : withoutPrefix;
  const encodedInputs = separatorIndex >= 0 ? withoutPrefix.slice(separatorIndex + 1) : '';

  try {
    return {
      queryName,
      inputs: JSON.parse(decodeURIComponent(encodedInputs)),
    };
  } catch {
    return {
      queryName,
      inputs: null,
    };
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export function hashString(value) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}
