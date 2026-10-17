export type AssistantSaveFields = {
  timeIntent: string;
  targetDateTime: string;
  timezone: string;
  preparationMinutes: number | null;
  travelMinutes: number | null;
  timezoneConflictConfirmed: boolean;
  originDescription?: string | null;
  destinationDescription?: string | null;
  originResolved?: boolean;
  destinationResolved?: boolean;
};

export function isAssistantAutosaveEligible(fields: AssistantSaveFields): boolean {
  return Boolean(
    (fields.timeIntent === "arrival" || fields.timeIntent === "departure") &&
    fields.targetDateTime &&
    fields.timezone.trim() &&
    fields.timezoneConflictConfirmed &&
    (!fields.originDescription?.trim() || fields.originResolved === true) &&
    (!fields.destinationDescription?.trim() || fields.destinationResolved === true) &&
    [fields.preparationMinutes, fields.travelMinutes].every(
      (duration) => duration === null || (Number.isInteger(duration) && duration >= 0),
    ),
  );
}
