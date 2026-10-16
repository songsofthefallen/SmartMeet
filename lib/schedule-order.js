function upsertScheduleNewestFirst(schedules, schedule) {
  return [...schedules.filter((item) => item.id !== schedule.id), schedule].sort((left, right) => {
    const leftCreatedAt = Date.parse(left.created_at);
    const rightCreatedAt = Date.parse(right.created_at);
    const leftTimestamp = Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0;
    const rightTimestamp = Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0;
    return rightTimestamp - leftTimestamp || right.id - left.id;
  });
}

module.exports = { upsertScheduleNewestFirst };
