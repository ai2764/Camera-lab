import { describe, expect, it } from 'vitest';
import { makeImportedClipId, normalizeImportedClipName } from './importedClips';

describe('imported clip helpers', () => {
  it('normalizes animation names for UI display', () => {
    expect(normalizeImportedClipName('mixamorig|Walking Forward')).toBe('Walking Forward');
    expect(normalizeImportedClipName('Armature|wave_right')).toBe('wave_right');
  });

  it('creates stable imported clip ids', () => {
    expect(makeImportedClipId('Walking Forward')).toBe('imported:walking-forward');
  });
});
