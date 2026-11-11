// JSON Schema dialect conversion.
//
// Callers write one plain JSON Schema. Two providers need different shapes:
//   * OpenAI strict mode: every object needs `additionalProperties: false`,
//     every property must be listed in `required`, and optionality is expressed
//     as `type: ["string", "null"]`. Unsupported keywords (minLength, maxItems
//     on some paths, pattern) are dropped rather than sent, because a 400 on a
//     schema keyword is indistinguishable from an outage to the caller.
//   * Gemini responseSchema: an OpenAPI 3 subset. Optionality is `nullable:
//     true`, type must be a single string, `additionalProperties` is rejected,
//     and nested `maxItems` inside an outer `maxItems` array once produced a
//     400 INVALID_ARGUMENT that a source swallowed into "zero competitors".
//
// The canonical form is therefore: all properties required, optional values
// nullable, no size constraints (bounds are applied after parsing in code).

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Keywords no provider needs for our purposes; stripping them avoids 400s. */
const STRIP_EVERYWHERE = new Set(["minLength", "maxLength", "pattern", "format", "minimum", "maximum", "minItems", "maxItems", "default", "examples", "$schema", "title"]);

/** OpenAI strict-mode conversion. */
export function toOpenAiStrictSchema(schema: Json): Json {
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (!isObject(node)) return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (STRIP_EVERYWHERE.has(key)) continue;
      if (key === "nullable") continue; // expressed through type arrays below
      out[key] = key === "properties" && isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)])) : convert(value);
    }
    if (node.nullable === true && out.type !== undefined) {
      const types = Array.isArray(out.type) ? (out.type as string[]) : [out.type as string];
      if (!types.includes("null")) out.type = [...types, "null"];
    }
    const type = Array.isArray(out.type) ? (out.type as string[]) : [out.type as string];
    if (type.includes("object")) {
      out.additionalProperties = false;
      const props = isObject(out.properties) ? out.properties : {};
      out.properties = props;
      out.required = Object.keys(props);
    }
    return out;
  };
  return convert(schema) as Json;
}

/** Gemini (OpenAPI subset) conversion. */
export function toGeminiSchema(schema: Json): Json {
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (!isObject(node)) return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (STRIP_EVERYWHERE.has(key) || key === "additionalProperties") continue;
      out[key] = key === "properties" && isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)])) : convert(value);
    }
    if (Array.isArray(out.type)) {
      const types = out.type as string[];
      const nonNull = types.filter((t) => t !== "null");
      out.type = nonNull[0] ?? "string";
      if (types.includes("null")) out.nullable = true;
    }
    if (out.type === "object" && isObject(out.properties) && !Array.isArray(out.required)) {
      // Gemini treats missing `required` as optional-everything, which lets
      // the model omit fields the validator then treats as absent. Require
      // every non-nullable property, matching the canonical contract.
      out.required = Object.entries(out.properties)
        .filter(([, v]) => !(isObject(v) && v.nullable === true))
        .map(([k]) => k);
    }
    return out;
  };
  return convert(schema) as Json;
}

/** Plain JSON Schema with nullable folded into type arrays (for JSON-mode providers). */
export function toPlainJsonSchema(schema: Json): Json {
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (!isObject(node)) return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "nullable") continue;
      out[key] = key === "properties" && isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)])) : convert(value);
    }
    if (node.nullable === true && out.type !== undefined) {
      const types = Array.isArray(out.type) ? (out.type as string[]) : [out.type as string];
      if (!types.includes("null")) out.type = [...types, "null"];
    }
    return out;
  };
  return convert(schema) as Json;
}
