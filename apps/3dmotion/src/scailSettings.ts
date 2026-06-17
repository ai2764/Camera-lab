export type ScailSize = {
  width: number;
  height: number;
};

export const scailSizePresets = [
  { label: '1:1 512x512', value: '512x512' },
  { label: '9:16 480x832', value: '480x832' },
  { label: '9:16 720x1280', value: '720x1280' },
  { label: '16:9 832x480', value: '832x480' },
] as const;

const fallbackScailSize: ScailSize = { width: 480, height: 832 };
const maxScailSeed = 2_147_000_000;

function alignToEight(value: number) {
  return Math.round(value / 8) * 8;
}

function parseScailSizeText(text: string): ScailSize | null {
  const match = text.trim().match(/^(\d{2,4})\s*x\s*(\d{2,4})$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 64 || height < 64 || width > 2304 || height > 2304) return null;
  return { width, height };
}

export function resolveScailSize(sizeText: string, scalePercent: number): ScailSize {
  const base = parseScailSizeText(sizeText) ?? fallbackScailSize;
  const scale = Number.isFinite(scalePercent) ? scalePercent / 100 : 1;
  return {
    width: Math.min(2304, Math.max(64, alignToEight(base.width * scale))),
    height: Math.min(2304, Math.max(64, alignToEight(base.height * scale))),
  };
}

export function makeScailSeed(seedText: string, random = Math.random) {
  const typedSeed = Number.parseInt(seedText.trim(), 10);
  if (Number.isFinite(typedSeed) && typedSeed >= 1 && typedSeed <= maxScailSeed) return typedSeed;
  return Math.floor(random() * maxScailSeed) + 1;
}
