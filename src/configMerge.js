import path from "node:path";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function mergeArray(base, ours, theirs) {
  if (deepEqual(ours, theirs)) {
    return { value: ours, unresolved: 0 };
  }
  if (deepEqual(ours, base)) {
    return { value: theirs, unresolved: 0 };
  }
  if (deepEqual(theirs, base)) {
    return { value: ours, unresolved: 0 };
  }
  const allPrimitive = [...ours, ...theirs].every(
    (item) => !isObject(item) && !Array.isArray(item)
  );
  if (!allPrimitive) {
    return { value: ours, unresolved: 1 };
  }
  const merged = [];
  for (const entry of [...ours, ...theirs]) {
    if (!merged.some((value) => deepEqual(value, entry))) {
      merged.push(entry);
    }
  }
  return { value: merged, unresolved: 0 };
}

function mergeThreeWay(base, ours, theirs) {
  if (deepEqual(ours, theirs)) {
    return { value: ours, unresolved: 0 };
  }
  if (deepEqual(ours, base)) {
    return { value: theirs, unresolved: 0 };
  }
  if (deepEqual(theirs, base)) {
    return { value: ours, unresolved: 0 };
  }
  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
    return mergeArray(base, ours, theirs);
  }
  if (isObject(base) && isObject(ours) && isObject(theirs)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
    const value = {};
    let unresolved = 0;
    for (const key of keys) {
      const merged = mergeThreeWay(base[key], ours[key], theirs[key]);
      value[key] = merged.value;
      unresolved += merged.unresolved;
    }
    return { value, unresolved };
  }
  return { value: ours, unresolved: 1 };
}

function parseScalar(raw) {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw === "null") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseFlatYaml(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (/^\s*[-?]/.test(line)) {
      return null;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) {
      return null;
    }
    const [, key, value] = match;
    result[key] = parseScalar(value.trim());
  }
  return result;
}

function stringifyFlatYaml(obj) {
  const keys = Object.keys(obj).sort();
  return `${keys.map((key) => `${key}: ${formatYamlValue(obj[key])}`).join("\n")}\n`;
}

function formatYamlValue(value) {
  if (typeof value === "string") {
    if (value === "" || /[:#\s]/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  return String(value);
}

export function tryThreeWayConfigMerge({
  filePath,
  baseContent,
  oursContent,
  theirsContent
}) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    try {
      const base = JSON.parse(baseContent);
      const ours = JSON.parse(oursContent);
      const theirs = JSON.parse(theirsContent);
      const merged = mergeThreeWay(base, ours, theirs);
      if (merged.unresolved > 0) {
        return null;
      }
      return {
        resolvedContent: `${JSON.stringify(merged.value, null, 2)}\n`,
        confidence: 0.96,
        method: "json-three-way"
      };
    } catch {
      return null;
    }
  }

  if (ext === ".yaml" || ext === ".yml") {
    const base = parseFlatYaml(baseContent);
    const ours = parseFlatYaml(oursContent);
    const theirs = parseFlatYaml(theirsContent);
    if (!base || !ours || !theirs) {
      return null;
    }
    const merged = mergeThreeWay(base, ours, theirs);
    if (merged.unresolved > 0 || !isObject(merged.value)) {
      return null;
    }
    return {
      resolvedContent: stringifyFlatYaml(merged.value),
      confidence: 0.9,
      method: "yaml-flat-three-way"
    };
  }

  return null;
}

