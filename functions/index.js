"use strict";

const crypto = require("crypto");
const admin = require("firebase-admin");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const { COURTS, isClosedDate, isPastSlot, minHoursFor, slotsFor, totalFor, timeKey, courtKey } = require("./pricing");

admin.initializeApp();
const database = admin.database();
const paymongoSecret = defineSecret("PAYMONGO_SECRET_KEY");
const webhookSecret = defineSecret("PAYMONGO_WEBHOOK_SECRET");
const REGION = "asia-southeast1";
const HOLD_MS = 15 * 60 * 1000;

function fail(code, message) { throw new HttpsError(code, message); }
function string(value, field, max = 140, required = false) {
  const result = String(value || "").trim();
  if (required && !result) fail("invalid-argument", `${field} is required.`);
  if (result.length > max) fail("invalid-argument", `${field} is too long.`);
  return result;
}
function description(date, court, startTime, duration) {
  const day = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00+08:00`));
  const range = slotsFor(startTime, duration);
  return `${court} · ${day} · ${startTime}-${range[range.length - 1] === "11:00 PM" ? "12:00 AM" : slotsFor(startTime, duration + 1).slice(-1)[0]}`;
}
function paymentHeaders(key) { return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" }; }
async function createPaymentLink({ amount, description: text, reservationId }) {
  const response = await fetch("https://api.paymongo.com/v1/payment_links", {
    method: "POST", headers: paymentHeaders(paymongoSecret.value()),
    body: JSON.stringify({ amount: amount * 100, currency: "PHP", description: text, remarks: `Mayha reservation ${reservationId}`, metadata: { reservationId }, restrictions: { completed_sessions: { limit: 1 } } })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.data?.id || !payload.data?.url) {
    logger.error("PayMongo Payment Link creation failed", { status: response.status, errors: payload.errors });
    fail("internal", "We could not create your payment link. Your hold has been released; please try again.");
  }
  return { id: payload.data.id, url: payload.data.url };
}
async function setReservationRows(reservation, changes, requireMatching = false) {
  const updates = {};
  for (const row of reservation.rows || []) {
    const snapshot = await database.ref(row.path).once("value");
    const booking = snapshot.val();
    if (!booking || (requireMatching && booking.reservationId !== reservation.reservationId)) return false;
    Object.entries(changes).forEach(([name, value]) => { updates[`${row.path}/${name}`] = value; });
  }
  if (Object.keys(updates).length) await database.ref().update(updates);
  return true;
}
async function archivePaymentLink(id) {
  if (!id) return;
  try {
    await fetch(`https://api.paymongo.com/v1/payment_links/${encodeURIComponent(id)}`, { method: "PATCH", headers: paymentHeaders(paymongoSecret.value()), body: JSON.stringify({ archive: true }) });
  } catch (error) { logger.warn("Could not archive expired Payment Link", error); }
}

exports.createBooking = onCall({ region: REGION, cors: true, secrets: [paymongoSecret] }, async request => {
  if (!request.auth) fail("unauthenticated", "Please sign in before booking.");
  const data = request.data || {};
  const date = string(data.date, "Date", 10, true);
  const court = string(data.court, "Court", 20, true);
  const startTime = string(data.startTime, "Start time", 12, true);
  const durationHours = Number(data.durationHours);
  const contactPhone = string(data.contactPhone, "Contact number", 40, true);
  const note = string(data.note, "Note", 140);
  if (!COURTS.includes(court)) fail("invalid-argument", "Choose a valid court.");
  if (![2, 4].includes(durationHours)) fail("invalid-argument", "Customer bookings must be 2 or 4 hours.");
  if (isClosedDate(date)) fail("failed-precondition", "Courts are closed on Wednesdays, Fridays and Sundays.");
  if (durationHours < minHoursFor(startTime)) fail("failed-precondition", "Bookings starting 6 PM onwards are 4 hours.");
  const reservedSlots = slotsFor(startTime, durationHours);
  if (reservedSlots.length !== durationHours) fail("failed-precondition", "Choose a time that does not run past midnight.");
  if (reservedSlots.some(time => isPastSlot(date, time))) fail("failed-precondition", "That time has already passed.");
  const schedulePath = `bookings/${date}/${courtKey(court)}`;
  const blockSnapshot = await database.ref(`blocks/${date}`).once("value");
  const blocks = blockSnapshot.val() || {};
  if (reservedSlots.some(time => blocks[courtKey(court)]?.[timeKey(time)] || blocks.all?.[timeKey(time)])) fail("failed-precondition", "One or more selected hours are blocked.");
  const now = Date.now(), reservationId = `res_${crypto.randomUUID()}`, holdExpiresAt = now + HOLD_MS;
  const totalPrice = totalFor(date, startTime, durationHours);
  const ownerName = request.auth.token.name || request.auth.token.email || "Customer";
  const base = { court, date, contactPhone, note, createdAt: new Date(now).toISOString(), status: "pending_payment", paymentStatus: "unpaid", holdExpiresAt, ownerUid: request.auth.uid, ownerName, startTime, durationHours, totalPrice, reservationId };
  const transaction = await database.ref(schedulePath).transaction(current => {
    const schedule = current || {};
    if (reservedSlots.some(time => { const existing = schedule[timeKey(time)]; return existing && existing.status !== "cancelled"; })) return;
    const next = { ...schedule };
    reservedSlots.forEach((time, index) => { next[timeKey(time)] = { ...base, time, isPrimary: index === 0 }; });
    return next;
  });
  if (!transaction.committed) fail("already-exists", "That time was just booked. Please select another slot.");
  const rows = reservedSlots.map(time => ({ path: `${schedulePath}/${timeKey(time)}`, time }));
  const reservation = { ...base, rows, paymentLinkId: null, checkoutUrl: null };
  await database.ref(`reservations/${reservationId}`).set(reservation);
  try {
    const link = await createPaymentLink({ amount: totalPrice, description: description(date, court, startTime, durationHours), reservationId });
    await database.ref().update({ [`reservations/${reservationId}/paymentLinkId`]: link.id, [`reservations/${reservationId}/checkoutUrl`]: link.url, ...Object.fromEntries(rows.flatMap(row => [[`${row.path}/paymentLinkId`, link.id], [`${row.path}/checkoutUrl`, link.url]])) });
    return { checkoutUrl: link.url, reservationId };
  } catch (error) {
    await setReservationRows(reservation, { status: "cancelled", cancellationReason: "Payment link could not be created", cancelledAt: Date.now() });
    await database.ref(`reservations/${reservationId}`).update({ status: "cancelled", cancellationReason: "Payment link could not be created" });
    throw error;
  }
});

exports.cancelBooking = onCall({ region: REGION, cors: true }, async request => {
  if (!request.auth) fail("unauthenticated", "Please sign in first.");
  const reservationId = string(request.data?.reservationId, "Reservation", 100, true);
  const snap = await database.ref(`reservations/${reservationId}`).once("value");
  const reservation = snap.val();
  if (!reservation || reservation.ownerUid !== request.auth.uid) fail("permission-denied", "This reservation cannot be cancelled from this account.");
  if (["cancelled", "needs_refund"].includes(reservation.status)) return { status: reservation.status };
  const paid = reservation.paymentStatus === "paid";
  await setReservationRows(reservation, { status: "cancelled", paymentStatus: paid ? "refund_requested" : reservation.paymentStatus, cancellationReason: "Cancelled by customer", cancelledAt: Date.now() }, true);
  await database.ref(`reservations/${reservationId}`).update({ status: "cancelled", paymentStatus: paid ? "refund_requested" : reservation.paymentStatus, cancellationReason: "Cancelled by customer", cancelledAt: Date.now() });
  return { status: "cancelled", refundRequested: paid };
});

function signatureIsValid(rawBody, header, secret) {
  const values = Object.fromEntries(String(header || "").split(",").map(part => part.trim().split("=")).filter(([key, value]) => key && value));
  if (!values.t || (!values.te && !values.li)) return false;
  if (Math.abs(Date.now() / 1000 - Number(values.t)) > 10 * 60) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${values.t}.${rawBody}`).digest("hex");
  return [values.te, values.li].filter(Boolean).some(signature => signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)));
}
function findReservationId(payload) {
  const text = JSON.stringify(payload);
  const direct = /res_[0-9a-f-]{20,}/i.exec(text);
  return direct?.[0] || null;
}
exports.paymongoWebhook = onRequest({ region: REGION, secrets: [webhookSecret] }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const raw = (req.rawBody || Buffer.from("")).toString("utf8");
  if (!raw || !signatureIsValid(raw, req.get("Paymongo-Signature"), webhookSecret.value())) return res.status(401).send("Invalid signature");
  const event = JSON.parse(raw);
  if (event?.data?.attributes?.type !== "link.payment.paid") return res.status(200).send({ received: true });
  const reservationId = findReservationId(event);
  if (!reservationId) { logger.error("Paid link event did not contain reservation ID", { eventId: event?.data?.id }); return res.status(200).send({ received: true }); }
  const snap = await database.ref(`reservations/${reservationId}`).once("value");
  const reservation = snap.val();
  if (!reservation) return res.status(200).send({ received: true });
  if (reservation.paymentStatus === "paid" && reservation.status === "confirmed") return res.status(200).send({ received: true });
  const payment = event.data.attributes.data || {};
  const paymentReference = payment.id || event.data.id;
  const stillHeld = reservation.status === "pending_payment" && Number(reservation.holdExpiresAt) > Date.now() && await setReservationRows(reservation, {}, true);
  if (!stillHeld) {
    await database.ref(`reservations/${reservationId}`).update({ status: "needs_refund", paymentStatus: "paid", paidAt: Date.now(), paymentReference, webhookEventId: event.data.id });
    return res.status(200).send({ received: true });
  }
  await setReservationRows(reservation, { status: "confirmed", paymentStatus: "paid", paidAt: Date.now(), paymentReference, holdExpiresAt: null }, true);
  await database.ref(`reservations/${reservationId}`).update({ status: "confirmed", paymentStatus: "paid", paidAt: Date.now(), paymentReference, webhookEventId: event.data.id });
  return res.status(200).send({ received: true });
});

exports.expirePaymentHolds = onSchedule({ region: REGION, schedule: "every 5 minutes", secrets: [paymongoSecret] }, async () => {
  const snapshot = await database.ref("reservations").once("value");
  const expired = Object.entries(snapshot.val() || {}).filter(([, booking]) => booking.status === "pending_payment" && Number(booking.holdExpiresAt) <= Date.now());
  await Promise.all(expired.map(async ([reservationId, reservation]) => {
    await setReservationRows(reservation, { status: "cancelled", cancellationReason: "Payment hold expired", cancelledAt: Date.now() }, true);
    await database.ref(`reservations/${reservationId}`).update({ status: "cancelled", cancellationReason: "Payment hold expired", cancelledAt: Date.now() });
    await archivePaymentLink(reservation.paymentLinkId);
  }));
});
