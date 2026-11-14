/** sfc32 generator state: four unsigned 32-bit integers stored as plain numbers. */
export type Rng = { a: number; b: number; c: number; d: number };

const UINT32_RANGE = 2 ** 32;
const SEED_WARMUP_ROUNDS = 12;

function nextUint32(rng: Rng): [number, Rng] {
  const t = (((rng.a + rng.b) | 0) + rng.d) | 0;
  const d = (rng.d + 1) | 0;
  const a = rng.b ^ (rng.b >>> 9);
  const b = (rng.c + (rng.c << 3)) | 0;
  const rotated = (rng.c << 21) | (rng.c >>> 11);
  const c = (rotated + t) | 0;
  return [t >>> 0, { a: a >>> 0, b: b >>> 0, c: c >>> 0, d: d >>> 0 }];
}

export function seedRng(seed: number): Rng {
  let rng: Rng = { a: 0x9e3779b9, b: 0x243f6a88, c: 0xb7e15162, d: seed >>> 0 };
  for (let round = 0; round < SEED_WARMUP_ROUNDS; round++) {
    [, rng] = nextUint32(rng);
  }
  return rng;
}

/** Returns a float in [0, 1) and the advanced generator. */
export function next(rng: Rng): [number, Rng] {
  const [value, advanced] = nextUint32(rng);
  return [value / UINT32_RANGE, advanced];
}

/** Returns an unbiased integer in [0, bound) using rejection sampling. */
export function nextInt(rng: Rng, bound: number): [number, Rng] {
  if (!Number.isInteger(bound) || bound <= 0 || bound > UINT32_RANGE) {
    throw new RangeError(`bound must be an integer in 1..2^32, got ${bound}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  let current = rng;
  for (;;) {
    const [value, advanced] = nextUint32(current);
    current = advanced;
    if (value < limit) {
      return [value % bound, current];
    }
  }
}

export function shuffle<T>(rng: Rng, items: readonly T[]): [T[], Rng] {
  const result = [...items];
  let current = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, advanced] = nextInt(current, i + 1);
    current = advanced;
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return [result, current];
}
