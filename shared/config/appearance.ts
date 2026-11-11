/** Appearance IDs 0–3 retain their original looks; 4–7 use the second athlete. */
export const APPEARANCE_PALETTE_COUNT = 4;
export const CHARACTERS = [
  { id: 0, key: 'river', label: 'River', assetUrl: '/assets/player/streetball-player.glb' },
  { id: 1, key: 'sky', label: 'Sky', assetUrl: '/assets/player/athlete-sky.glb' },
] as const;
export type CharacterId = (typeof CHARACTERS)[number]['id'];
export const APPEARANCE_COUNT = CHARACTERS.length * APPEARANCE_PALETTE_COUNT;

export function normaliseAppearancePreset(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < APPEARANCE_COUNT
    ? value : fallback;
}

export function appearanceFor(character: number, palette: number): number {
  const c = CHARACTERS.some(option => option.id === character) ? character : 0;
  const p = Number.isInteger(palette) && palette >= 0 && palette < APPEARANCE_PALETTE_COUNT ? palette : 0;
  return c * APPEARANCE_PALETTE_COUNT + p;
}

export function characterForAppearance(value: unknown) {
  return CHARACTERS[Math.floor(normaliseAppearancePreset(value) / APPEARANCE_PALETTE_COUNT)];
}

export function paletteForAppearance(value: unknown): number {
  return normaliseAppearancePreset(value) % APPEARANCE_PALETTE_COUNT;
}

/** A different character and palette, with exactly the same basketball attributes. */
export function opponentAppearance(value: number): number {
  return appearanceFor(1 - characterForAppearance(value).id, (paletteForAppearance(value) + 1) % APPEARANCE_PALETTE_COUNT);
}
