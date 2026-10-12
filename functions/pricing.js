"use strict";

const SLOTS = ["12:00 AM", "1:00 AM", "2:00 AM", "3:00 AM", "4:00 AM", "5:00 AM", "6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM", "11:00 PM"];
const COURTS = ["Court 1", "Court 2", "Court 3", "Court 4"];
const CLOSED_DAYS = [3, 5, 0];
const TIME_ZONE = "Asia/Manila";

function hourFor(time) {
  const match = /^(\d{1,2}):00 (AM|PM)$/.exec(String(time));
  if (!match) return -1;
  let hour = Number(match[1]);
  if (hour < 1 || hour > 12) return -1;
  if (match[2] === "PM" && hour !== 12) hour += 12;
  if (match[2] === "AM" && hour === 12) hour = 0;
  return hour;
}
function dateParts(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error("Date must be YYYY-MM-DD.");
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error("Invalid booking date.");
  return { year, month, day, weekday: parsed.getUTCDay() };
}
function isClosedDate(date) { return CLOSED_DAYS.includes(dateParts(date).weekday); }
function isWeekendDate(date) { const day = dateParts(date).weekday; return day === 5 || day === 6 || day === 0; }
function minHoursFor(time) { const hour = hourFor(time); return hour >= 18 || hour < 7 ? 4 : 2; }
function hourlyRate(date, time) {
  const hour = hourFor(time), weekend = isWeekendDate(date);
  if (hour < 0) throw new Error("Invalid start time.");
  return hour >= 7 && hour < 16 ? (weekend ? 160 : 120) : (weekend ? 200 : 160);
}
function slotsFor(startTime, durationHours) {
  const start = SLOTS.indexOf(startTime);
  return start < 0 ? [] : SLOTS.slice(start, start + Number(durationHours));
}
function totalFor(date, startTime, durationHours) { return slotsFor(startTime, durationHours).reduce((total, time) => total + hourlyRate(date, time), 0); }
function timeKey(time) { return time.replaceAll(":", "-").replaceAll(" ", "-").toLowerCase(); }
function courtKey(court) { return court.toLowerCase().replaceAll(" ", "-"); }
function manilaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function isPastSlot(date, time, now = manilaNow()) { return date < now.date || (date === now.date && hourFor(time) <= now.hour); }

module.exports = { SLOTS, COURTS, CLOSED_DAYS, TIME_ZONE, hourFor, isClosedDate, minHoursFor, hourlyRate, slotsFor, totalFor, timeKey, courtKey, manilaNow, isPastSlot };
