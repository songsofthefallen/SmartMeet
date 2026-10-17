import type { ScheduleExtractionReview } from "@/lib/schedule-api";

const intentQuestion = "Is this time for arriving or leaving?";

const missingQuestions: Record<string, string> = {
  title: "What should this schedule be called?",
  time_intent: intentQuestion,
  target_date_local: "What date should this schedule use?",
  target_time_local: "What local time should this schedule use?",
  timezone: "Which timezone should interpret the target time?",
  schedule_request: "What event or plan should be scheduled?",
  origin_description: "Where are you travelling from?",
  destination_description: "Where are you going?",
};

const fieldPhrases: Record<string, string> = {
  title: "schedule title",
  time_intent: "arrival or departure time",
  target_date_local: "target date",
  target_time_local: "target time",
  timezone: "timezone",
  preparation_duration_minutes: "preparation duration",
  travel_duration_minutes: "travel duration",
  origin_description: "starting location",
  destination_description: "destination",
  target_time_offset: "time offset",
};

function friendlyAmbiguity(value: string): string {
  const exactQuestion = missingQuestions[value];
  if (exactQuestion) return exactQuestion;

  return Object.entries(fieldPhrases).reduce(
    (message, [field, phrase]) => message.replaceAll(field, phrase),
    value,
  );
}

export function clarificationQuestions(
  review: ScheduleExtractionReview,
  selectedTimezone: string,
): string[] {
  const questions: string[] = [];
  for (const field of review.missing_fields) {
    if (missingQuestions[field]) questions.push(missingQuestions[field]);
  }
  if (review.ambiguous_fields.includes("time_intent")) questions.push(intentQuestion);
  if (review.ambiguous_fields.includes("target_time_local")) {
    questions.push("This local time occurs twice. Choose a time outside the repeated hour.");
  }
  if (review.ambiguous_fields.includes("timezone")) {
    const modelTimezone = review.extraction?.timezone;
    questions.push(
      `The model identified ${modelTimezone ?? "a different timezone"}, while you selected ${selectedTimezone}. Confirm or change the timezone before saving.`,
    );
  }
  if (review.invalid_fields.includes("target_time_local")) {
    questions.push("That local time does not exist in this timezone. Choose another time.");
  }
  if (review.invalid_fields.includes("target_time_offset")) {
    questions.push("The extracted time offset does not match the selected timezone. Review the local time and timezone.");
  }
  if (review.invalid_fields.includes("target_date_local")) {
    questions.push("The extracted date is invalid. Enter a valid date.");
  }
  if (review.invalid_fields.includes("model_output")) {
    questions.push("The extracted response could not be validated. Retry extraction or enter the schedule manually.");
  }
  if (review.invalid_fields.includes("title")) questions.push("Enter a valid schedule title.");
  if (review.invalid_fields.includes("time_intent")) questions.push(intentQuestion);
  if (review.invalid_fields.includes("timezone")) questions.push("Select a valid timezone for this schedule.");
  if (review.invalid_fields.some((field) => ![
    "model_output", "title", "time_intent", "timezone", "target_date_local",
    "target_time_local", "target_time_offset",
  ].includes(field))) {
    questions.push("Some extracted values could not be validated. Review and correct the schedule fields below.");
  }
  questions.push(...(review.extraction?.ambiguities ?? []).map(friendlyAmbiguity));

  const uniqueQuestions = new Map<string, string>();
  for (const question of questions) {
    const key = question.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (key && !uniqueQuestions.has(key)) uniqueQuestions.set(key, question);
  }
  return [...uniqueQuestions.values()];
}
