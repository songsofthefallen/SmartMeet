function compareTargetTime(left, right) {
  const leftTime = Date.parse(left.target_datetime);
  const rightTime = Date.parse(right.target_datetime);
  return (Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY)
    - (Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY);
}

function groupSchedules(schedules) {
  const items = Array.isArray(schedules) ? schedules.filter(Boolean) : [];
  const upcoming = items.filter((item) => item.status === "active" && item.is_past === false).sort(compareTargetTime);
  const past = items.filter((item) => item.status === "active" && item.is_past === true).sort(compareTargetTime);
  const inactive = items.filter((item) => item.status !== "active").sort(compareTargetTime);
  return { upcoming, past, inactive };
}

module.exports = { groupSchedules };
