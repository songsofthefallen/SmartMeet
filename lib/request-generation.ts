export function isCurrentGeneration(generation: number, currentGeneration: number): boolean {
  return generation === currentGeneration;
}

export function isCurrentGenerationForKey(
  generation: number,
  currentGeneration: number,
  requestKey: string,
  currentKey: string,
): boolean {
  return isCurrentGeneration(generation, currentGeneration) && requestKey === currentKey;
}
