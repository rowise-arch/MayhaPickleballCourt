/* Shared by the booking page and My Bookings. Edit your venue and payment details here. */
// Venue details shown in the footer and on My Bookings. Empty values are simply hidden.
const SITE = { address: "", phone: "", mapsQuery: "Mayha Square Pickleball Court" };
const PAYMENT = {
  holdMinutes: 30,
  // A method whose number still contains "X" is treated as not set up and hidden from customers.
  methods: [
    { id: "gcash", label: "GCash", accountName: "Jeffrey Rouisse Factor", number: "09393593728", qr: "./gcash-qr.png" },
    { id: "maya", label: "Maya", accountName: "YOUR NAME HERE", number: "09XX XXX XXXX", qr: "./maya-qr.png" }
  ].filter(method => !/X/i.test(method.number))
};
const SLOT_TIMES = ["12:00 AM", "1:00 AM", "2:00 AM", "3:00 AM", "4:00 AM", "5:00 AM", "6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM", "11:00 PM"];
const mapsUrl = () => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SITE.address || SITE.mapsQuery)}`;

/* ---------- Booking rules shared by the booking page, My Bookings and the staff dashboard ---------- */
const BOOKING_RULES = {
  maxUnpaidHolds: 2,          // unpaid holds one account can have at once (also enforced by the database rules)
  reviewHours: 6,             // a submitted payment holds the slot this long at most, or until play starts
  lastCallMs: 2 * 60 * 1000,  // in the last 2 minutes of a hold, customers are told not to send money
  proofRetentionDays: 60      // payment screenshots older than this are deleted by the staff dashboard
};
const HOUR_MS = 3600000;

/* Rates: Fri–Sun ₱160 day / ₱200 night; Mon–Thu ₱120 day / ₱160 night. Day is 7 AM–4 PM. */
function hourlyRateFor(date, hour) {
  const weekend = [5, 6, 0].includes(new Date(`${date}T12:00:00`).getDay());
  return hour >= 7 && hour < 16 ? (weekend ? 160 : 120) : (weekend ? 200 : 160);
}
function expectedPrice(date, startTime, hours) {
  const from = SLOT_TIMES.indexOf(startTime); let total = 0;
  for (let h = from; h < from + Number(hours || 1); h++) total += hourlyRateFor(date, h % 24);
  return total;
}
function startTimestamp(date, startTime) { return new Date(`${date}T${String(Math.max(0, SLOT_TIMES.indexOf(startTime))).padStart(2, "0")}:00:00+08:00`).getTime(); }

/* When a submitted payment stops holding the slot: 6 hours, or the start of play if sooner (never under 30 minutes). */
function reviewDeadline(date, startTime, submittedAt) {
  return Math.max(submittedAt + 30 * 60000, Math.min(submittedAt + BOOKING_RULES.reviewHours * HOUR_MS, startTimestamp(date, startTime)));
}
function reviewEndsAt(row) { return Number(row.reviewExpiresAt) || (Number(row.proofSubmittedAt) + BOOKING_RULES.reviewHours * HOUR_MS); }

/* Does this row still block the slot? Mirrors the "free" condition in the database rules. */
function occupies(row, now = Date.now()) {
  if (!row || row.status === "cancelled") return false;
  if (row.status !== "pending_payment") return true;
  return row.proofSubmittedAt ? reviewEndsAt(row) > now : Number(row.holdExpiresAt) > now;
}

/* Public availability row: no names, phones or payment details. */
const availabilityRow = booking => ({
  status: booking.status, ownerUid: booking.ownerUid, holdExpiresAt: booking.holdExpiresAt || 0,
  ...(booking.proofSubmittedAt ? { proofSubmittedAt: booking.proofSubmittedAt } : {}),
  ...(booking.reviewExpiresAt ? { reviewExpiresAt: booking.reviewExpiresAt } : {})
});
/* The customer's own copy, read by My Bookings. */
const USER_FIELDS = ["reservationId", "court", "date", "startTime", "durationHours", "totalPrice", "status", "paymentStatus", "holdExpiresAt", "note", "createdAt", "contactPhone", "holdSlot", "paymentReference", "paymentMethod", "proofSubmittedAt", "reviewExpiresAt", "cancellationReason"];
const userBookingRow = (booking, courtKeyValue, timeKeys) => {
  const row = { courtKey: courtKeyValue, timeKeys };
  USER_FIELDS.forEach(field => { if (booking[field] !== undefined && booking[field] !== null && booking[field] !== "") row[field] = booking[field]; });
  row.note = booking.note || ""; row.holdExpiresAt = booking.holdExpiresAt || 0;
  return row;
};

/* Every path written when a customer holds a slot: the private rows, the public availability, their own copy and a hold ticket. */
function holdUpdates(uid, booking, courtKeyValue, timeKeys) {
  const updates = {};
  timeKeys.forEach((tk, i) => {
    updates[`bookings/${booking.date}/${courtKeyValue}/${tk}`] = { ...booking, time: SLOT_TIMES.find(t => slotKeyOf(t) === tk), isPrimary: i === 0 };
    updates[`availability/${booking.date}/${courtKeyValue}/${tk}`] = availabilityRow(booking);
  });
  updates[`userBookings/${uid}/${booking.reservationId}`] = userBookingRow(booking, courtKeyValue, timeKeys);
  updates[`holdSlots/${uid}/${booking.holdSlot}`] = { rid: booking.reservationId, date: booking.date, court: courtKeyValue, first: timeKeys[0], last: timeKeys[timeKeys.length - 1], expiresAt: booking.holdExpiresAt };
  return updates;
}
const slotKeyOf = time => time.replaceAll(":", "-").replaceAll(" ", "-").toLowerCase();

/* Finds a free hold ticket ("0" or "1"), or null when the account already has the maximum number of unpaid holds. */
async function freeHoldSlot(db, uid) {
  const tickets = (await db.ref(`holdSlots/${uid}`).once("value")).val() || {};
  for (let n = 0; n < BOOKING_RULES.maxUnpaidHolds; n++) { const t = tickets[n]; if (!t || Number(t.expiresAt) <= Date.now()) return String(n); }
  return null;
}

/* Is this reservation still the customer's? "held" | "lapsed" (hold ran out but nobody took it) | "taken" | "cancelled" */
async function holdStatus(db, uid, booking, courtKeyValue, timeKeys) {
  const rows = (await db.ref(`availability/${booking.date}/${courtKeyValue}`).once("value")).val() || {};
  let lapsed = false;
  for (const tk of timeKeys) {
    const row = rows[tk];
    if (row && row.ownerUid === uid) { if (row.status === "cancelled") return "cancelled"; if (!occupies(row)) lapsed = true; }
    else if (occupies(row)) return "taken";
    else lapsed = true;
  }
  return lapsed ? "lapsed" : "held";
}

/* Paths written when a customer submits a payment reference for a slot they still hold. */
function paymentUpdates(uid, booking, courtKeyValue, timeKeys, payment) {
  const now = Date.now(), updates = {}, first = !booking.proofSubmittedAt;
  const reviewExpiresAt = first ? reviewDeadline(booking.date, booking.startTime, now) : booking.reviewExpiresAt;
  const legacy = !first && !booking.reviewExpiresAt, legacyDeadline = Number(booking.proofSubmittedAt) + BOOKING_RULES.reviewHours * HOUR_MS;
  const fields = { paymentReference: payment.reference, paymentMethod: payment.method, ...(first ? { proofSubmittedAt: now, reviewExpiresAt } : {}), ...(legacy ? { reviewExpiresAt: legacyDeadline } : {}), ...(payment.hasProof ? { hasProof: true } : {}) };
  timeKeys.forEach(tk => {
    Object.entries(fields).forEach(([f, v]) => updates[`bookings/${booking.date}/${courtKeyValue}/${tk}/${f}`] = v);
    if (first) { updates[`availability/${booking.date}/${courtKeyValue}/${tk}/proofSubmittedAt`] = now; updates[`availability/${booking.date}/${courtKeyValue}/${tk}/reviewExpiresAt`] = reviewExpiresAt; }
    if (legacy) updates[`availability/${booking.date}/${courtKeyValue}/${tk}/reviewExpiresAt`] = legacyDeadline;
  });
  const mine = `userBookings/${uid}/${booking.reservationId}`;
  updates[`${mine}/paymentReference`] = payment.reference; updates[`${mine}/paymentMethod`] = payment.method;
  if (first) { updates[`${mine}/proofSubmittedAt`] = now; updates[`${mine}/reviewExpiresAt`] = reviewExpiresAt; }
  /* The first payment releases the hold ticket. Later updates leave tickets alone: this one is already gone and may now belong to another booking. */
  if (first && booking.holdSlot !== undefined && booking.holdSlot !== null) updates[`holdSlots/${uid}/${booking.holdSlot}`] = null;
  updates[`paymentLog/${booking.reservationId}`] = paymentLogEntry(uid, booking, courtKeyValue, timeKeys, payment, "submitted");
  return { updates, reviewExpiresAt: reviewExpiresAt || legacyDeadline };
}
/* A record staff can see even if the booking itself is later released or rebooked. */
function paymentLogEntry(uid, booking, courtKeyValue, timeKeys, payment, state) {
  return { uid, name: payment.name || "Customer", reference: payment.reference, method: payment.method, amount: Number(booking.totalPrice || 0), date: booking.date, court: booking.court, courtKey: courtKeyValue, first: timeKeys[0], startTime: booking.startTime, durationHours: Number(booking.durationHours || 1), state, submittedAt: Date.now(), ...(payment.hasProof ? { hasProof: true } : {}) };
}

/* Turns a booking (or the customer's own copy of it) into a clean private row for re-holding. */
function cleanBooking(booking, uid, name) {
  const row = { ...booking, ownerUid: uid, ownerName: booking.ownerName || name || "Customer", createdAt: booking.createdAt || new Date().toISOString(), contactPhone: booking.contactPhone || "", note: booking.note || "" };
  ["timeKeys", "courtKey", "slotLost", "time", "isPrimary"].forEach(f => delete row[f]);
  return row;
}

/* Full submit flow with the late-payment checks. Returns { outcome: "submitted" | "reheld" | "lost" | "noHold" | "cancelled", reviewExpiresAt }. */
async function submitPaymentSafely(db, uid, booking, courtKeyValue, timeKeys, payment) {
  const state = await holdStatus(db, uid, booking, courtKeyValue, timeKeys);
  if (state === "cancelled") return { outcome: "cancelled" };
  if (state === "held") { const { updates, reviewExpiresAt } = paymentUpdates(uid, booking, courtKeyValue, timeKeys, payment); await db.ref().update(updates); return { outcome: "submitted", reviewExpiresAt }; }
  if (state === "lapsed") {
    const ticket = await freeHoldSlot(db, uid);
    if (ticket !== null) {
      const now = Date.now(), reviewExpiresAt = reviewDeadline(booking.date, booking.startTime, now);
      const fresh = { ...cleanBooking(booking, uid, payment.name), status: "pending_payment", paymentStatus: "unpaid", holdSlot: ticket, holdExpiresAt: now + PAYMENT.holdMinutes * 60000, paymentReference: payment.reference, paymentMethod: payment.method, proofSubmittedAt: now, reviewExpiresAt, ...(payment.hasProof ? { hasProof: true } : {}) };
      const updates = holdUpdates(uid, fresh, courtKeyValue, timeKeys);
      updates[`paymentLog/${booking.reservationId}`] = paymentLogEntry(uid, fresh, courtKeyValue, timeKeys, payment, "submitted");
      try { await db.ref().update(updates); return { outcome: "reheld", reviewExpiresAt }; } catch (error) { if (error?.code !== "PERMISSION_DENIED") throw error; }
    } else return { outcome: "noHold" };
  }
  /* The slot was taken: keep the payment on record so staff can refund it. */
  const mine = `userBookings/${uid}/${booking.reservationId}`;
  await db.ref().update({ [`paymentLog/${booking.reservationId}`]: paymentLogEntry(uid, booking, courtKeyValue, timeKeys, payment, "slot_lost"), [`${mine}/paymentReference`]: payment.reference, [`${mine}/paymentMethod`]: payment.method, [`${mine}/slotLost`]: true });
  return { outcome: "lost" };
}

/* Puts a lapsed hold back for another 30 minutes, if nobody has taken the slot. Returns "reheld" | "taken" | "noHold" | "held". */
async function reholdSafely(db, uid, booking, courtKeyValue, timeKeys, name) {
  const state = await holdStatus(db, uid, booking, courtKeyValue, timeKeys);
  if (state === "held") return { outcome: "held" };
  if (state !== "lapsed") return { outcome: "taken" };
  const ticket = await freeHoldSlot(db, uid);
  if (ticket === null) return { outcome: "noHold" };
  const fresh = { ...cleanBooking(booking, uid, name), status: "pending_payment", paymentStatus: "unpaid", holdSlot: ticket, holdExpiresAt: Date.now() + PAYMENT.holdMinutes * 60000 };
  ["paymentReference", "paymentMethod", "proofSubmittedAt", "reviewExpiresAt", "proofUrl", "hasProof", "paidAt", "verifiedBy", "cancellationReason"].forEach(f => delete fresh[f]);
  try { await db.ref().update(holdUpdates(uid, fresh, courtKeyValue, timeKeys)); return { outcome: "reheld", holdExpiresAt: fresh.holdExpiresAt, holdSlot: ticket }; }
  catch (error) { if (error?.code === "PERMISSION_DENIED") return { outcome: "taken" }; throw error; }
}

/* ---------- payment screenshots (kept in the Realtime Database, readable by staff only) ---------- */
/* Shrinks a receipt screenshot to a small JPEG data URL: about 80 KB, never more than about 110 KB. */
async function shrinkProof(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Choose a JPG or PNG image.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is too large.");
  const image = await createImageBitmap(file), canvas = document.createElement("canvas"), context = canvas.getContext("2d");
  let width = Math.min(720, image.width), quality = 0.72, dataUrl = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = width; canvas.height = Math.round(image.height * width / image.width);
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= 110000) return dataUrl;
    if (quality > 0.5) quality -= 0.1; else width = Math.round(width * 0.8);
  }
  if (dataUrl.length <= 150000) return dataUrl;
  throw new Error("Couldn't make that image small enough.");
}
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
/* Saves the screenshot for a booking. Gives up after 15 seconds so it never holds up the reference number. */
async function saveProof(db, uid, reservationId, file) {
  const image = await shrinkProof(file);
  await withTimeout(db.ref(`paymentProofs/${reservationId}`).set({ uid, image, createdAt: Date.now() }), 15000);
  return true;
}

/* ---------- interface helpers shared by the booking page and My Bookings ---------- */
/* A short buzz on success. Android only; iPhone browsers ignore it. Used only when a hold or payment goes through. */
function haptic() { try { navigator.vibrate?.(12); } catch {} }

/* Frosted header: adds a soft edge shadow only once content is scrolling underneath it. */
function frostOnScroll(header) {
  if (!header) return;
  const update = () => header.classList.toggle("scrolled", window.scrollY > 4);
  addEventListener("scroll", update, { passive: true }); update();
}

/* Bottom sheet on phones: drag the top bar to move it, flick or pull down to close.
   It follows the finger 1:1, resists when pulled upward, can be grabbed mid-animation,
   and hands the finger's speed over to the settle animation so there's no seam. */
const SHEET_EASE = "cubic-bezier(0.32, 0.72, 0, 1)"; // starts at ~2.25x its average speed
function sheetY(el) { const t = getComputedStyle(el).transform; return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0; }
function rubberband(distance, dimension, constant = 0.55) { return (distance * dimension * constant) / (dimension + constant * Math.abs(distance)); }
function projectFlick(velocityPxPerMs, rate = 0.99) { return velocityPxPerMs * rate / (1 - rate); }
function prepareSheet(dialog) {
  if (!dialog.querySelector(":scope > .sheet-grabber")) dialog.insertAdjacentHTML("afterbegin", '<div class="sheet-grabber" aria-hidden="true"></div>');
  dialog.style.transform = ""; dialog.classList.remove("sheet-closing");
  if (dialog.dataset.sheet) return;
  dialog.dataset.sheet = "1";
  const phone = matchMedia("(max-width: 600px)");
  let drag = null;
  const settle = (target, velocity, then) => {
    const from = sheetY(dialog), distance = Math.abs(target - from);
    dialog.getAnimations().forEach(a => a.cancel());
    if (!distance) { then && then(); return; }
    const speed = Math.max(Math.abs(velocity), 0.6); // px per ms
    const duration = Math.min(450, Math.max(180, 2.25 * distance / speed));
    dialog.style.transform = `translateY(${from}px)`;
    const run = dialog.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${target}px)` }], { duration, easing: SHEET_EASE, fill: "forwards" });
    run.onfinish = () => { dialog.style.transform = `translateY(${target}px)`; run.cancel(); then && then(); };
  };
  dialog.addEventListener("pointerdown", event => {
    if (!phone.matches || event.button > 0) return;
    if (!event.target.closest(".sheet-grabber, .payment-modal-header") || event.target.closest("button, a, input, select, textarea")) return;
    const current = sheetY(dialog);
    dialog.getAnimations().forEach(a => a.cancel());
    dialog.style.transform = `translateY(${current}px)`; // grab it where it is, even mid-animation
    drag = { id: event.pointerId, offset: event.clientY - current, height: dialog.getBoundingClientRect().height, history: [{ y: event.clientY, t: event.timeStamp }] };
    try { dialog.setPointerCapture(event.pointerId); } catch {}
    dialog.classList.add("dragging");
  });
  dialog.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    let y = event.clientY - drag.offset;
    if (y < 0) y = -rubberband(-y, drag.height);
    dialog.style.transform = `translateY(${y}px)`;
    drag.history.push({ y: event.clientY, t: event.timeStamp });
    if (drag.history.length > 6) drag.history.shift();
  });
  const release = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const { history, height } = drag; drag = null;
    dialog.classList.remove("dragging");
    const first = history[0], last = history[history.length - 1];
    const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    const y = sheetY(dialog), projected = y + projectFlick(velocity);
    if (velocity > 0.5 || projected > height * 0.5) {
      settle(height + 24, velocity, () => { dialog.classList.add("sheet-closing"); dialog.close(); requestAnimationFrame(() => { dialog.style.transform = ""; dialog.classList.remove("sheet-closing"); }); });
    } else settle(0, velocity, () => { dialog.style.transform = ""; });
  };
  dialog.addEventListener("pointerup", release);
  dialog.addEventListener("pointercancel", release);
}
