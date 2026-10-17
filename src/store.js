// In-memory care store with a controllable demo clock. All data is fictional.
const MIN = 60e3, HOUR = 36e5, DAY = 864e5, GRACE = 60 * MIN;

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const at = (dayStart, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return dayStart + h * HOUR + m * MIN; };
const fmt = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function createStore() {
  let S;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(); } catch {} });
  const seed = () => {
    const today = startOfDay(Date.now());
    const meds = [
      { id: "m1", name: "Metformin", dose: "500 mg", times: ["08:30", "20:00"] },
      { id: "m2", name: "Lisinopril", dose: "10 mg", times: ["08:30"] },
    ];
    const doses = []; let n = 1;
    for (let k = 6; k >= 0; k--) {
      const day = today - k * DAY;
      for (const m of meds) for (const t of m.times) {
        const due = at(day, t);
        const missed = (k === 2 && m.id === "m1" && t === "20:00") || (k === 1 && m.id === "m2");
        doses.push({ id: "d" + n++, med: m.name, dose: m.dose, due, status: k === 0 ? "pending" : missed ? "missed" : "taken", takenAt: k === 0 || missed ? null : due + 5 * MIN });
      }
    }
    const moods = [4, 4, 3, 3, 2, 2];
    S = {
      now: at(today, "08:00"), patient: { name: "Amina", age: 78 }, caregiver: { name: "Salma", relation: "daughter" },
      meds, doses, nextId: n,
      checkins: moods.map((mood, i) => ({ at: at(today - (6 - i) * DAY, "12:00"), mood, note: "" })),
      signals: [], outbox: [],
      // minutes after midnight of the first morning activity on the previous 6 days
      wake: [425, 440, 430, 450, 435, 445],
    };
  };
  seed();

  const median = (a) => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.round(mins % 60)).padStart(2, "0")}`;
  const baseline = () => { const med = median(S.wake), mad = median(S.wake.map((w) => Math.abs(w - med))); const limit = med + Math.max(60, 4 * mad); return { typical: hhmm(med), alertAfter: hhmm(limit), limit }; };
  const statusOf = (d) => d.status === "taken" || d.status === "skipped" ? d.status : S.now > d.due + GRACE ? "missed" : S.now >= d.due - 30 * MIN ? "due" : "upcoming";
  const view = (d) => ({ id: d.id, medication: d.med, dose: d.dose, time: fmt(d.due), status: statusOf(d), takenAt: d.takenAt ? fmt(d.takenAt) : null });
  const todays = () => S.doses.filter((d) => d.due >= startOfDay(S.now) && d.due < startOfDay(S.now) + DAY);

  return {
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    reset() { seed(); emit(); },
    now: () => S.now,
    nowLabel: () => new Date(S.now).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }),
    advance(minutes) { S.now += minutes * MIN; emit(); return S.now; },

    addMedication({ name, dose, times }) {
      const ok = times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
      if (!ok) return { ok: false, error: "Times must be HH:MM in 24h format." };
      if (S.meds.some((m) => m.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} is already on the list.` };
      S.meds.push({ id: "m" + (S.meds.length + 1), name, dose, times });
      const day = startOfDay(S.now);
      for (const t of times) S.doses.push({ id: "d" + S.nextId++, med: name, dose, due: at(day, t), status: "pending", takenAt: null });
      emit(); return { ok: true, medication: { name, dose, times } };
    },

    listToday() { return todays().sort((a, b) => a.due - b.due).map(view); },

    logDose(name) {
      const q = name.toLowerCase();
      const cand = todays().filter((d) => d.med.toLowerCase().includes(q) && d.status === "pending" && d.due <= S.now + 30 * MIN).sort((a, b) => a.due - b.due)[0];
      if (!cand) return { ok: false, message: `No ${name} dose is waiting to be logged right now.` };
      const late = S.now > cand.due + GRACE;
      cand.status = "taken"; cand.takenAt = S.now; emit();
      return { ok: true, dose: view(cand), late };
    },

    checkin(mood, note) { S.checkins.push({ at: S.now, mood, note: note || "" }); emit(); return { ok: true, mood }; },
    signal(kind) { S.signals.push({ at: S.now, kind }); emit(); return { ok: true, kind, time: fmt(S.now) }; },

    summary(days) {
      const from = S.now - days * DAY;
      const ds = S.doses.filter((d) => d.due >= from && d.due <= S.now).map((d) => ({ ...d, st: statusOf(d) }));
      const taken = ds.filter((d) => d.st === "taken").length, missed = ds.filter((d) => d.st === "missed").length;
      const adherence = taken + missed ? Math.round((taken / (taken + missed)) * 100) : null;
      const missed24h = ds.filter((d) => d.st === "missed" && d.due >= S.now - DAY).map((d) => `${d.med} at ${fmt(d.due)}`);
      const cks = S.checkins.filter((c) => c.at >= from);
      const avg = cks.length ? +(cks.reduce((a, c) => a + c.mood, 0) / cks.length).toFixed(1) : null;
      const last3 = S.checkins.slice(-3).map((c) => c.mood);
      const lowStreak = last3.length === 3 && last3.every((m) => m <= 2);
      const b = baseline(), minsNow = (S.now - startOfDay(S.now)) / MIN;
      const first = S.signals.filter((x) => x.kind === "morning_activity" && x.at >= startOfDay(S.now)).sort((x, y) => x.at - y.at)[0];
      const flags = [];
      if (missed24h.length >= 2) flags.push({ level: "attention", code: "MISSED_DOSES", text: `${missed24h.length} doses missed in the last 24h: ${missed24h.join(", ")}.` });
      if (lowStreak) flags.push({ level: "attention", code: "LOW_MOOD_STREAK", text: "Last 3 check-ins reported low mood (2 or below)." });
      if (!first && minsNow >= b.limit) flags.push({ level: "attention", code: "NO_MORNING_ACTIVITY", text: `No morning activity yet. Usually active by ${b.typical}; alert threshold ${b.alertAfter}.` });
      if (first && (first.at - startOfDay(S.now)) / MIN > b.limit) flags.push({ level: "attention", code: "LATE_START", text: `Started the day at ${fmt(first.at)}, well after the usual ${b.typical}.` });
      const trend = cks.length >= 4 ? (cks.slice(-2).reduce((a, c) => a + c.mood, 0) / 2 < cks.slice(0, -2).reduce((a, c) => a + c.mood, 0) / (cks.length - 2) - 0.5 ? "declining" : "stable") : "not enough data";
      return { window_days: days, adherence_percent: adherence, doses_taken: taken, doses_missed: missed, mood_average: avg, mood_trend: trend, baseline: { typical_first_activity: b.typical, alert_after: b.alertAfter }, flags, suggested_action: flags.length ? "Consider a friendly call and, if the pattern continues, mention it to the clinician." : "All good. No action needed." };
    },

    notify({ reason, severity }) {
      const item = { at: fmt(S.now), to: `${S.caregiver.name} (${S.caregiver.relation})`, severity, reason, channel: "push + SMS (simulated)" };
      S.outbox.push(item); emit(); return { ok: true, sent: item };
    },

    snapshot() {
      return { now: this.nowLabel(), patient: S.patient, caregiver: S.caregiver, today: this.listToday(), summary: this.summary(7),
        moods: S.checkins.slice(-8).map((c) => c.mood), outbox: [...S.outbox].reverse(), signals: S.signals.slice(-5).map((s) => ({ kind: s.kind, time: fmt(s.at) })) };
    },
  };
}
