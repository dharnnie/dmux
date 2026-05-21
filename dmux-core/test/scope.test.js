import { describe, it, expect } from 'vitest';
import { fileMatchesScope, parseNumstat, computeViolations } from '../src/scope.js';

describe('fileMatchesScope', () => {
  describe('empty scope', () => {
    it('matches anything (no restriction)', () => {
      expect(fileMatchesScope('any/file.ts', [])).toBe(true);
      expect(fileMatchesScope('any/file.ts', null)).toBe(true);
      expect(fileMatchesScope('any/file.ts', undefined)).toBe(true);
    });
  });

  describe('directory entries (trailing slash)', () => {
    it('matches files under the directory', () => {
      expect(fileMatchesScope('src/auth/oauth.ts', ['src/auth/'])).toBe(true);
      expect(fileMatchesScope('src/auth/sub/dir/x.ts', ['src/auth/'])).toBe(true);
    });

    it('does not match siblings of the directory', () => {
      expect(fileMatchesScope('src/authz/oauth.ts', ['src/auth/'])).toBe(false);
      expect(fileMatchesScope('src/auth-other/file.ts', ['src/auth/'])).toBe(false);
    });
  });

  describe('non-trailing-slash entries', () => {
    it('matches the exact file', () => {
      expect(fileMatchesScope('src/middleware/auth.ts', ['src/middleware/auth.ts'])).toBe(true);
    });

    it('also matches as a directory prefix', () => {
      // Common case: user writes `src/auth` expecting it to mean the directory.
      expect(fileMatchesScope('src/auth/oauth.ts', ['src/auth'])).toBe(true);
    });

    it('does not match an unrelated file with the same prefix in name', () => {
      // `src/auth` should not match `src/authz.ts` — that's a different file.
      expect(fileMatchesScope('src/authz.ts', ['src/auth'])).toBe(false);
    });
  });

  describe('multiple scope entries', () => {
    it('matches if any entry matches', () => {
      const scope = ['src/auth/', 'src/types/', 'tests/auth/'];
      expect(fileMatchesScope('src/auth/x.ts', scope)).toBe(true);
      expect(fileMatchesScope('src/types/User.ts', scope)).toBe(true);
      expect(fileMatchesScope('tests/auth/x.test.ts', scope)).toBe(true);
      expect(fileMatchesScope('src/billing/x.ts', scope)).toBe(false);
    });
  });

  describe('normalization', () => {
    it('strips leading ./ from scope and path', () => {
      expect(fileMatchesScope('./src/auth/x.ts', ['./src/auth/'])).toBe(true);
    });

    it('strips leading / from paths', () => {
      expect(fileMatchesScope('/src/auth/x.ts', ['src/auth/'])).toBe(true);
    });
  });
});

describe('parseNumstat', () => {
  it('parses standard added/removed entries', () => {
    const text = '1\t0\tsrc/a.ts\n18\t2\tsrc/b.ts\n';
    expect(parseNumstat(text)).toEqual([
      { path: 'src/a.ts', added: 1, removed: 0 },
      { path: 'src/b.ts', added: 18, removed: 2 },
    ]);
  });

  it('handles binary files (-\\t-)', () => {
    const text = '-\t-\tassets/logo.png\n';
    expect(parseNumstat(text)).toEqual([{ path: 'assets/logo.png', added: null, removed: null }]);
  });

  it('handles the plain rename form', () => {
    const text = '0\t0\told/path.ts => new/path.ts\n';
    expect(parseNumstat(text)).toEqual([{ path: 'new/path.ts', added: 0, removed: 0 }]);
  });

  it('handles the brace rename form', () => {
    const text = '12\t3\tpkg/{old => new}/file.ts\n';
    expect(parseNumstat(text)).toEqual([{ path: 'pkg/new/file.ts', added: 12, removed: 3 }]);
  });

  it('ignores blank lines and malformed entries', () => {
    const text = '\n1\t0\tsrc/a.ts\nnot a numstat line\n2\t1\tsrc/b.ts\n';
    expect(parseNumstat(text)).toEqual([
      { path: 'src/a.ts', added: 1, removed: 0 },
      { path: 'src/b.ts', added: 2, removed: 1 },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseNumstat('')).toEqual([]);
    expect(parseNumstat(null)).toEqual([]);
    expect(parseNumstat(undefined)).toEqual([]);
  });
});

describe('computeViolations', () => {
  const numstat = [
    '1\t0\tsrc/auth/oauth.ts',
    '18\t2\tsrc/middleware/auth.ts',
    '3\t0\tsrc/billing/checkout.ts',
    '-\t-\tassets/logo.png',
  ].join('\n');

  it('returns an empty array when scope is empty', () => {
    expect(computeViolations(numstat, [])).toEqual([]);
    expect(computeViolations(numstat, null)).toEqual([]);
  });

  it('filters out files in scope, keeps the rest', () => {
    const scope = ['src/auth/'];
    const result = computeViolations(numstat, scope);
    expect(result.map((v) => v.path)).toEqual([
      'src/middleware/auth.ts',
      'src/billing/checkout.ts',
      'assets/logo.png',
    ]);
  });

  it('returns nothing when every changed file is in scope', () => {
    const scope = ['src/', 'assets/'];
    expect(computeViolations(numstat, scope)).toEqual([]);
  });

  it('preserves +N/-M stats on the returned entries', () => {
    const scope = ['src/auth/'];
    const result = computeViolations(numstat, scope);
    const middleware = result.find((v) => v.path === 'src/middleware/auth.ts');
    expect(middleware).toEqual({
      path: 'src/middleware/auth.ts',
      added: 18,
      removed: 2,
    });
  });
});
