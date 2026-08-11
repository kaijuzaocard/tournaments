const pad = (value) => String(value).padStart(2, '0');

function taipeiFutureDates(nowMillis) {
  const taipei = new Date(nowMillis + (8 * 60 * 60 * 1000));
  const base = Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate() + 7);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(base + (index * 24 * 60 * 60 * 1000));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  });
}

export function buildB4ABrowserPreviewBlueprint(nowMillis = Date.now()) {
  const dates = taipeiFutureDates(nowMillis);
  const shared = {
    gameType: 'B4A Preview',
    gameCode: 'b4a-preview',
    time: '19:00',
    fee: 'NT$0（虛構測試）',
    entryFee: 0,
    images: [],
    prizeImages: [],
  };
  const events = [
    { id: 'b4a-preview-e1-legacy-open', title: 'E1 Legacy Open', date: dates[0], capacity: 4, preRegistration: { enabled: true, capacity: 4, deadline: null } },
    { id: 'b4a-preview-e2-full-no-waitlist', title: 'E2 Full Waitlist Off', date: dates[1], capacity: 2, preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: false, capacity: 2, deadline: null } },
    { id: 'b4a-preview-e3-full-waitlist', title: 'E3 Full Waitlist On', date: dates[2], capacity: 1, preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } },
    { id: 'b4a-preview-e4-last-seat-race', title: 'E4 Last Seat Race', date: dates[3], capacity: 2, preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 2, deadline: null } },
    { id: 'b4a-preview-e5-ranked-waitlist', title: 'E5 Ranked Waitlist', date: dates[4], capacity: 1, preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } },
    { id: 'b4a-preview-e6-malformed-rank', title: 'E6 Malformed Rank', date: dates[5], capacity: 1, preRegistration: { schemaVersion: 2, enabled: true, waitlistEnabled: true, capacity: 1, deadline: null } },
  ].map((event) => ({ ...shared, ...event, description: `${event.title} — local emulator fictitious data only.` }));

  return Object.freeze({
    schemaVersion: 1,
    events,
    scenarios: Object.freeze({
      [events[0].id]: { active: 1, waitlisted: 0 },
      [events[1].id]: { active: 2, waitlisted: 0 },
      [events[2].id]: { active: 1, waitlisted: 0 },
      [events[3].id]: { active: 1, waitlisted: 0 },
      [events[4].id]: { active: 1, waitlisted: 3 },
      [events[5].id]: { active: 1, waitlisted: 2, duplicateWaitlistSequence: true },
    }),
  });
}
