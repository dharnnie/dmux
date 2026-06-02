/**
 * Skill catalogue manifest parsing — Wave 3F Slice 1.
 *
 * The catalogue is a YAML/JSON manifest hosted at a configurable URL
 * (default: github.com/dharnnie/dmux-skills). dmux fetches it, caches it
 * locally, and lets users browse + install from it.
 *
 * Manifest shape:
 *
 *   version: 1
 *   skills:
 *     - name: react-tdd
 *       description: TDD-driven React component generation
 *       author: dharnnie         # optional
 *       tags: [react, tdd]       # optional
 *       raw_url: https://raw.githubusercontent.com/.../react-tdd/skill.yml
 *
 * The raw_url points at a skill.yml in the existing Wave 2B parameterized-
 * skill format — no new schema to learn for skill authors.
 *
 * This module only handles the catalogue manifest itself. Fetching the
 * raw_url and parsing the skill.yml lives in the server's catalogue helper.
 */

import yaml from 'js-yaml';

export class CatalogueError extends Error {
  constructor(message, { field, entry } = {}) {
    super(message);
    this.name = 'CatalogueError';
    this.field = field;
    this.entry = entry;
  }
}

const SUPPORTED_VERSIONS = new Set([1]);

/**
 * Parse + validate a catalogue manifest. Accepts YAML or JSON text (YAML's
 * parser handles both). Returns a normalized object:
 *
 *   { version, skills: [{ name, description, author?, tags, raw_url }] }
 *
 * Throws CatalogueError on schema violations. Permissive on optional
 * fields: missing `author` becomes null; missing `tags` becomes [].
 */
export function parseCatalogueManifest(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new CatalogueError('Manifest is empty');
  }
  let raw;
  try {
    raw = yaml.load(text);
  } catch (e) {
    throw new CatalogueError(`Manifest could not be parsed: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CatalogueError('Manifest must be an object');
  }

  const version = raw.version;
  if (!SUPPORTED_VERSIONS.has(version)) {
    throw new CatalogueError(
      `Unsupported manifest version: ${JSON.stringify(version)}. Supported: ${[...SUPPORTED_VERSIONS].join(', ')}`,
      { field: 'version' },
    );
  }

  if (!Array.isArray(raw.skills)) {
    throw new CatalogueError("'skills' must be an array", { field: 'skills' });
  }

  const skills = [];
  const seenNames = new Set();
  for (const entry of raw.skills) {
    const normalized = normalizeEntry(entry);
    if (seenNames.has(normalized.name)) {
      throw new CatalogueError(`Duplicate skill name in catalogue: '${normalized.name}'`, {
        field: 'name', entry: normalized.name,
      });
    }
    seenNames.add(normalized.name);
    skills.push(normalized);
  }

  return { version, skills };
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new CatalogueError('Skill entry must be an object');
  }
  const name = entry.name;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new CatalogueError(
      `Skill 'name' must be a lowercase slug (a-z, 0-9, -). Got: ${JSON.stringify(name)}`,
      { field: 'name' },
    );
  }
  const description = entry.description;
  if (typeof description !== 'string' || description.trim() === '') {
    throw new CatalogueError(`Skill '${name}': 'description' is required`, {
      field: 'description', entry: name,
    });
  }
  const rawUrl = entry.raw_url;
  if (typeof rawUrl !== 'string' || !/^https?:\/\//i.test(rawUrl)) {
    throw new CatalogueError(
      `Skill '${name}': 'raw_url' must be an http(s) URL`,
      { field: 'raw_url', entry: name },
    );
  }

  // Optional fields with defaults.
  const author = typeof entry.author === 'string' && entry.author.trim() !== ''
    ? entry.author.trim()
    : null;
  const tags = Array.isArray(entry.tags)
    ? entry.tags.filter((t) => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
    : [];

  return { name, description: description.trim(), author, tags, raw_url: rawUrl };
}
