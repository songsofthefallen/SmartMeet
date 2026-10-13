/** Build display rows from backend-calculated instants; this module does no time arithmetic. */
function suggestedTimeRows(schedule, formatDate) {
  const wakeUnavailable = schedule.wake_unavailable_reason || "Wake-up time is unavailable.";
  const wakeUnknown = schedule.preparation_duration_minutes === null
    ? "Wake-up time cannot be calculated because preparation duration is unknown."
    : wakeUnavailable;
  const wakeValue = schedule.calculated_wake_time
    ? formatDate(schedule.calculated_wake_time, schedule.timezone)
    : wakeUnknown;

  if (schedule.time_intent === "departure") {
    return [
      { label: "Departure time", value: formatDate(schedule.target_datetime, schedule.timezone) },
      {
        label: "Estimated arrival",
        value: schedule.calculated_arrival_time
          ? formatDate(schedule.calculated_arrival_time, schedule.timezone)
          : schedule.travel_duration_minutes === null
            ? "Estimated arrival is unavailable because travel duration is unknown."
            : schedule.arrival_unavailable_reason || "Estimated arrival is unavailable.",
      },
      { label: "Wake-up / preparation start", value: wakeValue },
    ];
  }

  return [
    {
      label: "Suggested departure",
      value: schedule.calculated_departure_time
        ? formatDate(schedule.calculated_departure_time, schedule.timezone)
        : schedule.departure_unavailable_reason || "Suggested departure is unavailable.",
    },
    { label: "Wake-up / preparation start", value: wakeValue },
  ];
}

function arrivalPreparationNote(schedule) {
  return schedule.time_intent === "arrival" &&
    !schedule.calculated_departure_time &&
    schedule.calculated_wake_time
    ? "Travel duration is unknown. This preparation-start suggestion is measured back from the target arrival time."
    : null;
}

module.exports = { suggestedTimeRows, arrivalPreparationNote };
