/* A small JSON Schema validator (draft 2020-12 subset) shared by the Worker and, from
   phase 3, by ScriptForge in the browser. Supported keywords:
   type, enum, const, required, properties, additionalProperties, items, minItems, maxItems,
   uniqueItems, minLength, maxLength, pattern, minimum, maximum, format, $ref (#/$defs/...).
   Keywords starting with "x-" are annotations and are ignored here.
   Returns { valid, errors: [ "path: message", ... ] } with at most 50 errors. */

const FORMATS = {
  "date-time": (s) => s === "" || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !isNaN(Date.parse(s))),
  date: (s) => s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s),
  email: (s) => s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uri: (s) => {
    if (s === "") return true;
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch (e) {
      return false;
    }
  }
};

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(actual, wanted) {
  if (wanted === actual) return true;
  if (wanted === "number" && actual === "integer") return true;
  return false;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error("Only local $ref is supported: " + ref);
  return ref
    .slice(2)
    .split("/")
    .reduce((node, key) => (node ? node[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), root);
}

export function validate(schema, data) {
  const errors = [];
  walk(schema, schema, data, "$", errors);
  return { valid: errors.length === 0, errors: errors.slice(0, 50) };
}

function walk(root, s, v, path, errors) {
  if (errors.length >= 50 || s === true || s == null) return;
  if (s === false) {
    errors.push(path + ": is not allowed");
    return;
  }
  if (s.$ref) {
    const target = resolveRef(root, s.$ref);
    if (!target) {
      errors.push(path + ": unknown $ref " + s.$ref);
      return;
    }
    walk(root, target, v, path, errors);
  }
  const t = typeOf(v);
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((w) => typeMatches(t, w))) {
      errors.push(path + ": expected " + types.join(" or ") + ", got " + t);
      return;
    }
  }
  if (s.enum && !s.enum.some((e) => e === v)) errors.push(path + ": must be one of " + s.enum.join(", "));
  if ("const" in s && s.const !== v) errors.push(path + ": must equal " + JSON.stringify(s.const));

  if (t === "string") {
    if (s.minLength != null && v.length < s.minLength) errors.push(path + ": shorter than " + s.minLength);
    if (s.maxLength != null && v.length > s.maxLength) errors.push(path + ": longer than " + s.maxLength);
    if (s.pattern && !new RegExp(s.pattern, "u").test(v)) errors.push(path + ": does not match " + s.pattern);
    if (s.format && FORMATS[s.format] && !FORMATS[s.format](v)) errors.push(path + ": is not a valid " + s.format);
  }
  if (t === "integer" || t === "number") {
    if (s.minimum != null && v < s.minimum) errors.push(path + ": below " + s.minimum);
    if (s.maximum != null && v > s.maximum) errors.push(path + ": above " + s.maximum);
  }
  if (t === "array") {
    if (s.minItems != null && v.length < s.minItems) errors.push(path + ": needs at least " + s.minItems + " items");
    if (s.maxItems != null && v.length > s.maxItems) errors.push(path + ": allows at most " + s.maxItems + " items");
    if (s.uniqueItems) {
      const seen = new Set(v.map((x) => JSON.stringify(x)));
      if (seen.size !== v.length) errors.push(path + ": items must be unique");
    }
    if (s.items) v.forEach((item, i) => walk(root, s.items, item, path + "[" + i + "]", errors));
  }
  if (t === "object") {
    for (const k of s.required || []) {
      if (!(k in v)) errors.push(path + ": missing " + k);
    }
    const props = s.properties || {};
    for (const [k, val] of Object.entries(v)) {
      if (props[k]) walk(root, props[k], val, path + "." + k, errors);
      else if (s.additionalProperties === false) errors.push(path + ": unknown field " + k);
      else if (s.additionalProperties && typeof s.additionalProperties === "object")
        walk(root, s.additionalProperties, val, path + "." + k, errors);
    }
  }
}
