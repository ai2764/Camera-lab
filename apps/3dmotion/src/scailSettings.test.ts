import { describe, expect, it } from 'vitest';
import { makeScailSeed, resolveScailSize } from './scailSettings';

describe('resolveScailSize', () => {
  it('uses the custom frame size at 100 percent scale', () => {
    expect(resolveScailSize('480x832', 100)).toEqual({ width: 480, height: 832 });
  });

  it('scales the frame size and aligns to video-friendly multiples of 8', () => {
    expect(resolveScailSize('480x832', 75)).toEqual({ width: 360, height: 624 });
  });

  it('falls back to the vertical preset when size text is invalid', () => {
    expect(resolveScailSize('big', 100)).toEqual({ width: 480, height: 832 });
  });
});

describe('makeScailSeed', () => {
  it('uses a typed seed when provided', () => {
    expect(makeScailSeed('123')).toBe(123);
  });

  it('creates a valid random seed when left blank', () => {
    expect(makeScailSeed('', () => 0.5)).toBe(1_073_500_001);
  });
});
