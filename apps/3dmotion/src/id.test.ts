import { describe, expect, it } from 'vitest';
import { makeId } from './id';

describe('makeId', () => {
  it('creates an id when randomUUID is unavailable', () => {
    const id = makeId({ randomUUID: undefined }, () => 0.123456789, 42);

    expect(id).toMatch(/^m-/);
    expect(id).toContain('16');
  });
});
