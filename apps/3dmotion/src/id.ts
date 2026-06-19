type RandomSource = {
  randomUUID?: () => string;
};

export function makeId(
  randomSource: RandomSource = globalThis.crypto ?? {},
  random = Math.random,
  now = Date.now(),
) {
  if (typeof randomSource.randomUUID === 'function') {
    return randomSource.randomUUID();
  }
  return `m-${now.toString(36)}-${Math.floor(random() * 0xfffffff).toString(36)}`;
}
