import { describe, it, expect } from 'vitest';
import { applyPatches } from '../../src/engine/patches';

describe('applyPatches', () => {
  it('replaces a unique match', () => {
    const r = applyPatches(
      [{ path: 'a.js', content: 'hello world' }],
      [{ path: 'a.js', search: 'world', replace: 'there' }],
    );
    expect(r.ok).toBe(true);
    expect(r.files[0].content).toBe('hello there');
  });

  it('flags E_PATCH_AMBIGUOUS on multiple matches', () => {
    const r = applyPatches(
      [{ path: 'a.js', content: 'ooops' }],
      [{ path: 'a.js', search: 'o', replace: '0' }],
    );
    expect(r.ok).toBe(false);
    expect(r.violations[0].code).toBe('E_PATCH_AMBIGUOUS');
  });

  it('flags when zero matches', () => {
    const r = applyPatches(
      [{ path: 'a.js', content: 'abc' }],
      [{ path: 'a.js', search: 'zzz', replace: 'y' }],
    );
    expect(r.violations[0].code).toBe('E_PATCH_AMBIGUOUS');
  });

  it('flags when target file is missing', () => {
    const r = applyPatches(
      [{ path: 'a.js', content: 'abc' }],
      [{ path: 'missing.js', search: 'a', replace: 'b' }],
    );
    expect(r.violations[0].code).toBe('E_PATCH_AMBIGUOUS');
  });
});