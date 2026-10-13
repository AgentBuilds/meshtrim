export const PRESETS = Object.freeze([
  Object.freeze({ id: 'quality', name: 'Quality', description: 'Preserve visual detail', maxTextureSize: 4096, textureQuality: 0.95, deduplicate: true, compression: 'meshopt' }),
  Object.freeze({ id: 'balanced', name: 'Balanced', description: 'Detail meets delivery', maxTextureSize: 2048, textureQuality: 0.85, deduplicate: true, compression: 'meshopt' }),
  Object.freeze({ id: 'compact', name: 'Compact', description: 'Prioritize smaller assets', maxTextureSize: 1024, textureQuality: 0.7, deduplicate: true, compression: 'meshopt' }),
]);
