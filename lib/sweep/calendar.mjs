import { readFileSync } from "node:fs";

const calendar = JSON.parse(readFileSync(new URL("../../config/sweep/exchange-calendar.json", import.meta.url), "utf8"));
export function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function localParts(epoch, timeZone = "America/New_York") {
  if (!Number.isFinite(epoch)) throw new Error("INVALID_TIME");
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(epoch * 1000)).map(p => [p.type, p.value]));
}
export function marketDate(epoch) {
  const p = localParts(epoch);
  return p.year + "-" + p.month + "-" + p.day;
}
export function localEpoch(date, hour, minute, timezone = "America/New_York") {
  if (!validDate(date)) throw new Error("INVALID_DATE");
  const wanted = Date.parse(date + "T" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":00Z") / 1000;
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, timezone);
    const represented = Date.parse(p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute + ":" + p.second + "Z") / 1000;
    guess += wanted - represented;
  }
  return guess;
}
export function sessionFor(date) {
  if (!validDate(date)) throw new Error("INVALID_DATE");
  if (!calendar.years.includes(Number(date.slice(0, 4)))) throw new Error("CALENDAR_YEAR_UNSUPPORTED:" + date.slice(0, 4));
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  if (weekday === 0 || weekday === 6 || calendar.holidays.includes(date)) return null;
  const earlyClose = calendar.earlyCloses.includes(date);
  return { date, start: localEpoch(date, 9, 30), end: localEpoch(date, earlyClose ? 13 : 16, 0), earlyClose };
}
export function previousSessions(date, count) {
  if (!validDate(date) || !Number.isInteger(count) || count < 1 || count > 60) throw new Error("INVALID_SESSION_REQUEST");
  const sessions = [];
  let day = Date.parse(date + "T12:00:00Z");
  while (sessions.length < count) {
    day -= 86400000;
    const session = sessionFor(new Date(day).toISOString().slice(0, 10));
    if (session) sessions.unshift(session);
  }
  return sessions;
}
// Slots are Chicago-local and DST-safe. Scorecards stay at 15:05 even on
// holidays/early closes; captures stop at the actual equity close.
export function scheduleSlot(epoch) {
  const date = marketDate(epoch), session = sessionFor(date);
  const p = localParts(epoch, "America/Chicago");
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  if (weekday === 0 || weekday === 6) return null;
  const minute = Number(p.hour) * 60 + Number(p.minute);
  if (minute === 15 * 60 + 5) return { key: date + ":score", mode: "--score", date, session };
  if (session && minute % 5 === 0 && epoch >= session.start && epoch < session.end + 60) {
    return { key: date + ":capture:" + minute, mode: "--capture", date, session };
  }
  return null;
}
