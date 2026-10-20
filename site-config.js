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

/* ---------- reading the reference number from a receipt screenshot ----------
   Runs on the customer's phone with Tesseract.js (free, no server). It only downloads the first time
   someone picks a screenshot, then the browser keeps it. The customer can always edit what it fills in,
   and staff should still check the reference in the GCash or Maya app: screenshots can be edited. */
const RECEIPT_READER = {
  script: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
  langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
  timeoutMs: 45000
};
let receiptWorker = null;
function loadReceiptWorker() {
  if (receiptWorker) return receiptWorker;
  receiptWorker = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const script = document.createElement("script");
    script.src = RECEIPT_READER.script; script.async = true;
    script.onload = () => resolve(window.Tesseract); script.onerror = () => reject(new Error("Couldn't load the screenshot reader."));
    document.head.append(script);
  }).then(T => T.createWorker("eng", 1, { workerPath: RECEIPT_READER.workerPath, corePath: RECEIPT_READER.corePath, langPath: RECEIPT_READER.langPath }));
  receiptWorker.catch(() => { receiptWorker = null; }); // let the next screenshot try again
  return receiptWorker;
}
/* Big, grey, high-contrast copy of the screenshot. Dark-mode receipts are flipped to dark text on light. */
async function receiptCanvas(file) {
  const image = await createImageBitmap(file), scale = Math.min(1, 1100 / image.width);
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), d = pixels.data;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; total += g; }
  const invert = total / (d.length / 4) < 110;
  for (let i = 0; i < d.length; i += 4) { let g = invert ? 255 - d[i] : d[i]; g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128)); d[i] = d[i + 1] = d[i + 2] = g; }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
/* Pulls the reference number and the peso amounts out of the text on a GCash or Maya receipt. */
function parseReceipt(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const label = /\b(?:ref(?:erence)?\.?\s*(?:no|number|id|#|code)?|(?:txn|transaction)\s*(?:no|number|id|#|code))\.?\s*[:#.]?/i;
  const toDigitLike = s => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  const candidate = raw => { // the run of number-like chunks right after the label, e.g. "1234 567 890123"
    const chunks = [];
    for (const token of raw.trim().split(/\s+/)) { const t = toDigitLike(token).replace(/[:#.,]+$/, ""); if (/^[A-Z0-9-]+$/.test(t) && /\d/.test(t)) chunks.push(t); else if (chunks.length || t) break; }
    const cleaned = chunks.join("").replace(/-/g, "");
    return cleaned.length >= 6 && cleaned.length <= 24 && (cleaned.match(/\d/g) || []).length >= 4 ? cleaned : "";
  };
  let reference = "";
  for (let i = 0; i < lines.length && !reference; i++) {
    const match = lines[i].match(label);
    if (!match) continue;
    // the number usually sits after the label on the same line, sometimes on the next one
    const rest = lines[i].slice(match.index + match[0].length).replace(/\b\d{1,2}[:/]\d{2}.*$/, "");
    reference = candidate(rest) || candidate(lines[i + 1] || "");
  }
  if (!reference) { // no label found: a GCash reference is 13 digits, often printed as 4-3-6
    const loose = toDigitLike(lines.join(" ")).match(/(?<!\d)\d{4}\s?\d{3}\s?\d{6}(?!\d)/);
    if (loose) reference = loose[0].replace(/\s/g, "");
  }
  const money = /(?:₱|PHP|P|B)?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
  const amounts = [], labelled = [];
  lines.forEach((line, i) => {
    if (/balance/i.test(line)) return; // a wallet balance isn't what was paid
    for (const m of line.matchAll(money)) {
      const value = Number(m[1].replace(/,/g, "") + "." + m[2]);
      if (!(value > 0)) continue;
      amounts.push(value);
      if (/total|amount|sent|paid/i.test(line) || /total|amount|sent|paid/i.test(lines[i - 1] || "")) labelled.push(value);
    }
  });
  return { reference, amounts, amount: labelled.length ? Math.max(...labelled) : null };
}
async function readReceipt(file) {
  const worker = await loadReceiptWorker();
  const canvas = await receiptCanvas(file);
  const { data } = await withTimeout(worker.recognize(canvas), RECEIPT_READER.timeoutMs);
  return parseReceipt(data.text);
}
/* Hooks a screenshot picker to a reference field. Fills the field only if it's empty or was filled by us,
   so it never overwrites what the customer typed, and warns when the paid amount doesn't match. */
function attachReceiptReader({ fileInput, refInput, note, expectedAmount }) {
  let run = 0, autoValue = "";
  const show = (kind, html) => { note.className = `receipt-note ${kind}`; note.innerHTML = html; note.hidden = !html; };
  const fill = value => { refInput.value = value; autoValue = value; refInput.dispatchEvent(new Event("input", { bubbles: true })); };
  const reset = () => { run++; autoValue = ""; show("", ""); };
  refInput.addEventListener("input", () => { if (refInput.value !== autoValue) autoValue = ""; });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0], mine = ++run;
    if (!file || !file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) return show("", "");
    show("reading", '<span class="receipt-spinner" aria-hidden="true"></span>Reading your screenshot…');
    let result;
    try { result = await readReceipt(file); } catch (error) { console.warn(error); if (mine === run) show("muted", "Couldn't read the screenshot. Type the reference number instead."); return; }
    if (mine !== run) return; // a newer screenshot was picked, or this one was removed
    const messages = [];
    const typed = refInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!result.reference) messages.push(["muted", "Couldn't find a reference number in the screenshot. Type it in."]);
    else if (!typed || refInput.value === autoValue) { fill(result.reference); messages.push(["filled", "Filled in from your screenshot. Check it matches your receipt."]); }
    else if (typed !== result.reference) messages.push(["muted", `Your screenshot shows <b>${result.reference}</b>. <button type="button" class="receipt-use">Use this</button>`]);
    const expected = Number(expectedAmount());
    if (result.amount !== null && expected && !result.amounts.includes(expected) && Math.abs(result.amount - expected) >= 1)
      messages.push(["warn", `Your screenshot shows <b>₱${result.amount.toLocaleString("en-PH")}</b>, but this booking is <b>₱${expected.toLocaleString("en-PH")}</b>. Make sure you sent the full amount.`]);
    const worst = messages.some(m => m[0] === "warn") ? "warn" : messages[0]?.[0] || "";
    show(worst, messages.map(m => `<span>${m[1]}</span>`).join(""));
    note.querySelector(".receipt-use")?.addEventListener("click", () => { fill(result.reference); show("filled", "<span>Filled in from your screenshot. Check it matches your receipt.</span>"); });
  });
  return { reset };
}

/* ---------- add a booking to the customer's calendar ----------
   Android opens Google Calendar with the details filled in; iPhone, Mac and Windows get an .ics file,
   which opens straight in their calendar app. The .ics also sets a reminder one hour before. */
function addToCalendar(b) {
  const start = startTimestamp(b.date, b.startTime || b.time), end = start + Number(b.durationHours || 1) * HOUR_MS;
  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const where = SITE.address || SITE.mapsQuery, title = `Pickleball · ${b.court}`;
  const details = `Mayha Square Pickleball Court · ${b.court} · ₱${Number(b.totalPrice || 0).toLocaleString("en-PH")}\nYour bookings: ${location.origin}/my-bookings.html`;
  if (/Android/i.test(navigator.userAgent)) {
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${stamp(start)}/${stamp(end)}&location=${encodeURIComponent(where)}&details=${encodeURIComponent(details)}`;
    window.open(url, "_blank", "noopener"); return;
  }
  const esc = text => String(text).replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mayha Square Pickleball Court//Booking//EN", "BEGIN:VEVENT", `UID:${b.reservationId}@mayha-square`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(title)}`, `LOCATION:${esc(where)}`, `DESCRIPTION:${esc(details)}`, "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)} in 1 hour`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `mayha-${String(b.court).toLowerCase().replace(/\s+/g, "-")}-${b.date}.ics` });
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
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

/* ---------- app on the home screen (PWA) ----------
   sw.js keeps a copy of the site on the phone for fast, offline-friendly opening. Pages and code are still
   fetched fresh whenever there's a connection, so deploys show up on the next visit. */
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Offline support unavailable", error)));
}
const isInstalledApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/* A small notice while the phone has no connection. */
(function offlineNotice() {
  const show = () => {
    let el = document.querySelector(".offline-notice");
    if (navigator.onLine) { el?.classList.remove("show"); return; }
    if (!el) { el = document.createElement("div"); el.className = "offline-notice"; el.setAttribute("role", "status"); el.textContent = "You're offline. Bookings and payments need internet."; document.body.append(el); }
    requestAnimationFrame(() => el.classList.add("show"));
  };
  addEventListener("online", show); addEventListener("offline", show);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", show); else show();
})();

/* "Get the app" card. Android and desktop Chrome or Edge install with one tap; iPhone shows the two steps.
   Hidden once installed, or for 30 days after "Not now". */
let installPrompt = null;
const INSTALL_SNOOZE = "mayha-install-snoozed";
addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; document.querySelectorAll(".install-slot[data-wanted]").forEach(renderInstallCard); });
addEventListener("appinstalled", () => { installPrompt = null; document.querySelectorAll(".install-card").forEach(card => card.remove()); });
function installSnoozed() { try { return Date.now() - Number(localStorage.getItem(INSTALL_SNOOZE) || 0) < 30 * 24 * HOUR_MS; } catch { return false; } }
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function renderInstallCard(slot) {
  if (!slot || isInstalledApp() || installSnoozed()) return;
  slot.dataset.wanted = "1";
  const ios = isIos();
  if (!installPrompt && !ios) return; // this browser can't install; try again if it offers later
  const shareIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  slot.innerHTML = `<section class="install-card" aria-label="Add Mayha Square to your home screen">
    <img src="./icon-192.png" width="48" height="48" alt="">
    <div class="install-text"><strong>Get the Mayha Square app</strong>
      ${ios ? `<span>Tap ${shareIcon} <b>Share</b>, then <b>Add to Home Screen</b>.</span>` : `<span>Book from your home screen. No app store, nothing to download.</span>`}</div>
    <div class="install-actions">${ios ? "" : '<button type="button" class="install-yes">Install</button>'}<button type="button" class="install-no">${ios ? "Got it" : "Not now"}</button></div>
  </section>`;
  slot.querySelector(".install-no").onclick = () => { try { localStorage.setItem(INSTALL_SNOOZE, String(Date.now())); } catch {} slot.innerHTML = ""; };
  const yes = slot.querySelector(".install-yes");
  if (yes) yes.onclick = async () => {
    const prompt = installPrompt; if (!prompt) return;
    installPrompt = null; prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") slot.innerHTML = "";
  };
}

/* ---------- Light / Dark / Auto ----------
   Auto (the default) follows the phone or computer. A choice of Light or Dark is remembered on this device.
   A tiny script in each page's <head> applies the saved choice before the page shows, so there's no flash. */
const THEME_KEY = "mayha-theme";
const THEME_COLORS = { light: "#f3f8fc", dark: "#101826" };
const systemDark = matchMedia("(prefers-color-scheme: dark)");
function savedTheme() { try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; } }
const themeNow = () => { const t = savedTheme(); return t === "auto" ? (systemDark.matches ? "dark" : "light") : t; };
function applyTheme() {
  const t = savedTheme(), root = document.documentElement;
  if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.dataset.original ||= meta.content;
    meta.content = t === "auto" ? meta.dataset.original : THEME_COLORS[t];
  });
  document.querySelectorAll(".theme-switch button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.theme === t)));
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) { const dark = themeNow() === "dark"; toggle.innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon; toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode"); toggle.title = toggle.getAttribute("aria-label"); }
}
function setTheme(t) { try { if (t === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch {} applyTheme(); }
const THEME_ICONS = {
  sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  auto: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>'
};
function mountThemeSwitches() {
  document.querySelectorAll(".theme-slot").forEach(slot => {
    slot.innerHTML = `<p class="theme-label" id="theme-label">Appearance</p><div class="theme-switch" role="radiogroup" aria-labelledby="theme-label">${[["light", "Light", "sun"], ["dark", "Dark", "moon"], ["auto", "Auto", "auto"]].map(([t, label, icon]) => `<button type="button" role="radio" data-theme="${t}" aria-checked="false">${THEME_ICONS[icon]}<span>${label}</span></button>`).join("")}</div><p class="theme-hint">Auto matches your phone's setting.</p>`;
    slot.querySelectorAll("button").forEach(b => b.onclick = () => setTheme(b.dataset.theme));
  });
  // Staff: one button. Picking the same as the phone's own setting goes back to Auto.
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) toggle.onclick = () => { const next = themeNow() === "dark" ? "light" : "dark"; setTheme(next === (systemDark.matches ? "dark" : "light") ? "auto" : next); };
  applyTheme();
}
systemDark.addEventListener?.("change", applyTheme);
addEventListener("storage", event => { if (event.key === THEME_KEY) applyTheme(); }); // another tab changed it
if (document.readyState === "loading") addEventListener("DOMContentLoaded", mountThemeSwitches); else mountThemeSwitches();
