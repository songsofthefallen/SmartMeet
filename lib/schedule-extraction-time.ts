export function localTimeInputFromExtraction(value: string | null): string | null {
  if (!value) return null;
  const normalizedTime = /^(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  return normalizedTime?.[1] ?? null;
}

export function localDateTimeFromExtraction(date: string | null, time: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const localTime = localTimeInputFromExtraction(time);
  return localTime ? `${date}T${localTime}` : null;
}
