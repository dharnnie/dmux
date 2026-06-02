/**
 * Skill catalogue fetcher + cache — Wave 3F Slice 1.
 *
 * Reads a remote manifest, validates via dmux-core, caches locally. Used
 * by:
 *   - GET /api/skills/catalogue (read with auto-stale refresh)
 *   - POST /api/skills/refresh-catalogue (force refetch)
 *   - POST /api/skills/install-from-catalogue (fetch raw_url + install)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  parseCatalogueManifest,
  CatalogueError,
} from '../../../dmux-core/src/catalogue.js';
import {
  parseSkillYaml,
  SkillSchemaError,
} from '../../../dmux-core/src/skills.js';

const DEFAULT_CATALOGUE_URL =
  'https://raw.githubusercontent.com/dharnnie/dmux-skills/main/catalogue.yml';

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'dmux')
  : join(homedir(), '.config', 'dmux');
const CATALOGUE_URL_FILE = join(CONFIG_DIR, 'catalogue.url');
const CATALOGUE_CACHE_FILE = join(CONFIG_DIR, 'catalogue.cache.json');
const USER_SKILLS_DIR = join(homedir(), '.local', 'share', 'dmux', 'skills');

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_STALE_MS = 24 * 60 * 60 * 1000;  // 24h

/**
 * Resolve the catalogue URL with this precedence:
 *   1. DMUX_SKILL_CATALOGUE_URL env var
 *   2. ~/.config/dmux/catalogue.url file (single line)
 *   3. Hardcoded default
 */
export function getCatalogueUrl() {
  const env = process.env.DMUX_SKILL_CATALOGUE_URL?.trim();
  if (env) return env;
  if (existsSync(CATALOGUE_URL_FILE)) {
    const fromFile = readFileSync(CATALOGUE_URL_FILE, 'utf-8').trim();
    if (fromFile) return fromFile;
  }
  return DEFAULT_CATALOGUE_URL;
}

/**
 * Read the cached catalogue manifest (if any). Returns
 * { catalogue, fetchedAt, url } or null.
 */
export function readCachedCatalogue() {
  if (!existsSync(CATALOGUE_CACHE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CATALOGUE_CACHE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(catalogue, url) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const payload = { catalogue, fetchedAt: new Date().toISOString(), url };
  const tmp = CATALOGUE_CACHE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, CATALOGUE_CACHE_FILE);
  return payload;
}

/**
 * Fetch the catalogue from the configured URL, validate, cache, return.
 * On network failure: throw an Error with .status=503 and an attached
 * .cached property if a stale copy exists. Callers can decide whether to
 * fall through.
 */
export async function fetchCatalogueFresh() {
  const url = getCatalogueUrl();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(`Couldn't reach catalogue at ${url}: ${e.message}`);
    err.status = 503;
    err.cached = readCachedCatalogue();
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) {
    const err = new Error(`Catalogue fetch returned HTTP ${res.status} from ${url}`);
    err.status = 503;
    err.cached = readCachedCatalogue();
    throw err;
  }
  const text = await res.text();

  let parsed;
  try {
    parsed = parseCatalogueManifest(text);
  } catch (e) {
    if (e instanceof CatalogueError) {
      const err = new Error(`Catalogue at ${url} is malformed: ${e.message}`);
      err.status = 422;
      err.cached = readCachedCatalogue();
      throw err;
    }
    throw e;
  }

  return writeCache(parsed, url);
}

/**
 * Default read path: serve the cache, kick off a background refresh if
 * stale or missing. Returns { catalogue, fetchedAt, url, warning? } —
 * never throws (network failures become warnings on a stale or empty
 * result).
 */
export async function getCatalogueForRead() {
  const cached = readCachedCatalogue();
  const now = Date.now();
  const cachedAt = cached?.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0;
  const stale = !cached || (now - cachedAt) > CACHE_STALE_MS;

  if (stale) {
    try {
      const fresh = await fetchCatalogueFresh();
      return fresh;
    } catch (e) {
      // Fall through with stale cache + warning. Caller still gets data.
      if (cached) {
        return { ...cached, warning: e.message };
      }
      return {
        catalogue: { version: 1, skills: [] },
        fetchedAt: null,
        url: getCatalogueUrl(),
        warning: e.message,
      };
    }
  }

  return cached;
}

/**
 * Look up an entry in the cached catalogue, fetch its raw_url, validate
 * via parseSkillYaml, write the skill.yml into ~/.local/share/dmux/skills.
 * Returns { ok: true, name, installPath } or throws with .status.
 */
export async function installSkillFromCatalogue(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    const e = new Error('skill name is required');
    e.status = 400;
    throw e;
  }

  // Always start from a fresh-or-cached read so newly-added catalogue
  // entries are discoverable without a manual refresh first.
  const read = await getCatalogueForRead();
  const entry = (read.catalogue?.skills ?? []).find((s) => s.name === name);
  if (!entry) {
    const e = new Error(`Skill '${name}' not in catalogue${read.warning ? ` (warning: ${read.warning})` : ''}`);
    e.status = 404;
    throw e;
  }

  // Fetch the raw_url.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(entry.raw_url, { signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(`Couldn't fetch ${entry.raw_url}: ${e.message}`);
    err.status = 503;
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) {
    const err = new Error(`Skill fetch returned HTTP ${res.status} from ${entry.raw_url}`);
    err.status = 503;
    throw err;
  }
  const skillYaml = await res.text();

  // Validate via dmux-core's existing parameterized-skill parser.
  try {
    parseSkillYaml(skillYaml);
  } catch (e) {
    if (e instanceof SkillSchemaError) {
      const err = new Error(`Fetched skill.yml is malformed: ${e.message}`);
      err.status = 422;
      throw err;
    }
    throw e;
  }

  // Write to the user-installed skills dir.
  const destDir = join(USER_SKILLS_DIR, name);
  if (!existsSync(destDir)) {
    execSync(`mkdir -p "${destDir}"`, { stdio: 'pipe' });
  }
  const destPath = join(destDir, 'skill.yml');
  writeFileSync(destPath, skillYaml);

  return {
    ok: true,
    name: entry.name,
    installPath: destPath,
    source: entry.raw_url,
  };
}
