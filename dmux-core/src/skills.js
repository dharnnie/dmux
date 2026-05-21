import yaml from 'js-yaml';

/**
 * Skill schema + templating for Wave 2B.
 *
 * A skill.yml describes a reusable agent team. It has the metadata fields
 * (name, description, tags, provider) plus an optional `inputs:` block that
 * declares parameters the user fills in when applying the skill, plus an
 * `agents:` block that uses `{{var}}` placeholders to reference those
 * inputs.
 *
 * Two evaluation modes for placeholders:
 *   - Embedded in a string ("Implement {{feature_name}}.") — the value is
 *     stringified and substituted. Lists become comma-separated; booleans
 *     become "true" / "false".
 *   - Whole-string placeholder ("{{files_in_scope}}") — replaced by the
 *     native value. A `paths` input expands to a YAML list; a `boolean`
 *     becomes a YAML boolean; etc. This is the only way to substitute a
 *     value of a non-string type into a YAML field.
 *
 * Reserved placeholder: `{{project_name}}` — always available without a
 * schema entry. Other reserved names may be added later.
 */

const VALID_INPUT_TYPES = new Set([
  'text',
  'textarea',
  'select',
  'boolean',
  'paths',
  'agents',
]);

const RESERVED_NAMES = new Set(['project_name']);

export class SkillSchemaError extends Error {
  constructor(message, { input, field } = {}) {
    super(message);
    this.name = 'SkillSchemaError';
    this.input = input;
    this.field = field;
  }
}

/**
 * Parse + validate a skill.yml. Returns the structured skill plus the raw
 * text so callers can re-render if needed.
 */
export function parseSkillYaml(yamlText) {
  let raw;
  try {
    raw = yaml.load(yamlText);
  } catch (e) {
    throw new SkillSchemaError(`Invalid YAML: ${e.message}`);
  }
  if (raw == null || typeof raw !== 'object') {
    throw new SkillSchemaError('Skill must be a YAML mapping');
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new SkillSchemaError('Skill `name` is required', { field: 'name' });
  }

  const skill = {
    name: raw.name.trim(),
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    provider: typeof raw.provider === 'string' ? raw.provider.trim() : 'claude',
    inputs: validateInputs(raw.inputs),
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    rawYaml: yamlText,
  };

  if (skill.agents.length === 0) {
    throw new SkillSchemaError('Skill must declare at least one agent', { field: 'agents' });
  }

  return skill;
}

function validateInputs(rawInputs) {
  if (rawInputs == null) return [];
  if (!Array.isArray(rawInputs)) {
    throw new SkillSchemaError('`inputs` must be a list', { field: 'inputs' });
  }
  const seen = new Set();
  return rawInputs.map((entry, i) => {
    if (entry == null || typeof entry !== 'object') {
      throw new SkillSchemaError(`inputs[${i}] must be a mapping`, { field: `inputs[${i}]` });
    }
    const name = entry.name;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new SkillSchemaError(`inputs[${i}] requires \`name\``, {
        field: `inputs[${i}].name`,
      });
    }
    if (RESERVED_NAMES.has(name)) {
      throw new SkillSchemaError(`Input name '${name}' is reserved`, {
        input: name,
        field: 'name',
      });
    }
    if (seen.has(name)) {
      throw new SkillSchemaError(`Duplicate input name: ${name}`, {
        input: name,
        field: 'name',
      });
    }
    seen.add(name);

    const type = entry.type ?? 'text';
    if (!VALID_INPUT_TYPES.has(type)) {
      throw new SkillSchemaError(
        `Input '${name}' has unknown type '${type}'. Valid: ${[...VALID_INPUT_TYPES].join(', ')}`,
        { input: name, field: 'type' },
      );
    }
    if (type === 'select') {
      if (!Array.isArray(entry.choices) || entry.choices.length === 0) {
        throw new SkillSchemaError(
          `Input '${name}' of type select requires non-empty \`choices\``,
          { input: name, field: 'choices' },
        );
      }
    }

    return {
      name,
      type,
      description: typeof entry.description === 'string' ? entry.description : '',
      required: entry.required === true,
      default: entry.default,
      choices: type === 'select' ? entry.choices : undefined,
    };
  });
}

/**
 * Apply input values to a skill, returning the rendered agents YAML string.
 *
 * `ctx` adds reserved placeholders: { project_name }. Callers supply
 * `{ project_name }`; this function fills in user-declared inputs from
 * `values`.
 *
 * Throws SkillSchemaError on:
 *   - Missing required input
 *   - Unknown placeholder name (referenced in agents but not in inputs
 *     or reserved)
 *   - Type mismatch (e.g. user provides a string where the schema says
 *     boolean) — soft for v1; we coerce when possible.
 */
export function applyInputs(skill, values, ctx = {}) {
  if (skill == null || typeof skill !== 'object') {
    throw new SkillSchemaError('applyInputs requires a parsed skill');
  }

  const v = values ?? {};
  const inputsByName = new Map(skill.inputs.map((i) => [i.name, i]));

  // Resolve effective values: provided > default; check required.
  const resolved = {};
  for (const input of skill.inputs) {
    if (Object.prototype.hasOwnProperty.call(v, input.name)) {
      resolved[input.name] = coerce(v[input.name], input);
    } else if (input.default !== undefined) {
      resolved[input.name] = input.default;
    } else if (input.required) {
      throw new SkillSchemaError(`Required input '${input.name}' is missing`, {
        input: input.name,
      });
    } else {
      resolved[input.name] = defaultForType(input.type);
    }
  }

  // Merge reserved context
  const context = { ...resolved, ...ctx };

  // Walk the agents block and substitute. Use Object.fromEntries so the
  // result is a plain object suitable for yaml.dump.
  const rendered = walkAndSubstitute(skill.agents, context, inputsByName);

  // Dump back to YAML, preserving block style for readability.
  return yaml.dump(rendered, { lineWidth: -1, noRefs: true });
}

function coerce(value, input) {
  if (value == null) return defaultForType(input.type);
  switch (input.type) {
    case 'text':
    case 'textarea':
    case 'select':
      return String(value);
    case 'boolean':
      return Boolean(value);
    case 'paths':
    case 'agents':
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === 'string') {
        return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      }
      return [];
    default:
      return value;
  }
}

function defaultForType(type) {
  switch (type) {
    case 'boolean': return false;
    case 'paths':
    case 'agents': return [];
    default: return '';
  }
}

const WHOLE_PLACEHOLDER = /^\{\{\s*(\w+)\s*\}\}$/;
const EMBEDDED_PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

function walkAndSubstitute(node, context, inputsByName) {
  if (typeof node === 'string') {
    return substituteString(node, context, inputsByName);
  }
  if (Array.isArray(node)) {
    return node.map((item) => walkAndSubstitute(item, context, inputsByName));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = walkAndSubstitute(v, context, inputsByName);
    }
    return out;
  }
  return node;
}

function substituteString(str, context, inputsByName) {
  const whole = str.match(WHOLE_PLACEHOLDER);
  if (whole) {
    const name = whole[1];
    requireKnown(name, context, inputsByName);
    return context[name];
  }
  return str.replace(EMBEDDED_PLACEHOLDER, (_, name) => {
    requireKnown(name, context, inputsByName);
    const v = context[name];
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  });
}

function requireKnown(name, context, inputsByName) {
  if (Object.prototype.hasOwnProperty.call(context, name)) return;
  // Distinguish "schema doesn't declare it" from "user didn't provide it"
  if (!inputsByName.has(name) && !RESERVED_NAMES.has(name)) {
    throw new SkillSchemaError(
      `Skill references unknown placeholder '{{${name}}}'. Declare it in inputs or use a reserved name.`,
      { input: name },
    );
  }
  throw new SkillSchemaError(
    `Placeholder '{{${name}}}' has no value (no default and not provided).`,
    { input: name },
  );
}
