/* Mayha Square Pickleball Court staff dashboard: calendar, walk-ins, blocks and payment review on one page. */
const config = { apiKey: "AIzaSyAVboExr93oDx_ClUFPp2fmcMGvOTTNbRo", authDomain: "mayha-courts.firebaseapp.com", databaseURL: "https://mayha-courts-default-rtdb.firebaseio.com", projectId: "mayha-courts", storageBucket: "mayha-courts.firebasestorage.app", messagingSenderId: "697040217308", appId: "1:697040217308:web:92d797a44fb71e97474019" };
const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config), auth = app.auth(), db = app.database();

const SLOTS = ["12:00 AM", "1:00 AM", "2:00 AM", "3:00 AM", "4:00 AM", "5:00 AM", "6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM", "11:00 PM"];
const COURTS = ["Court 1", "Court 2", "Court 3", "Court 4"];
const ROW_H = 46, HEAD_H = 40;
const $ = selector => document.querySelector(selector);
const dateInput = $("#filter-date");

let dayRows = {};          // bookings/{date} raw
let dayBlocks = {};        // blocks/{date} raw
let stopListeners = null;
let scrolledForDate = null;

/* ---------- helpers ---------- */
const safe = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const slotKey = time => time.replaceAll(":", "-").replaceAll(" ", "-").toLowerCase();
const courtKey = court => court.toLowerCase().replaceAll(" ", "-");
const courtName = key => COURTS.find(court => courtKey(court) === key) || key.replace("-", " ");
const METHOD = { gcash: "GCash", maya: "Maya", cash: "Cash" };
const methodName = m => METHOD[m] || m || "";
const peso = amount => `₱${Number(amount || 0).toLocaleString("en-PH")}`;
function localDate(offsetDays = 0, from = new Date()) { const d = new Date(from); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const asDate = value => new Date(`${value}T12:00:00`);
const isWeekend = (value = dateInput.value) => [5, 6, 0].includes(asDate(value).getDay());
function hourlyRate(time, value = dateInput.value) { const hour = SLOTS.indexOf(time), weekend = isWeekend(value); return hour >= 7 && hour < 16 ? (weekend ? 160 : 120) : (weekend ? 200 : 160); }
const rangeFrom = (start, hours) => { const i = SLOTS.indexOf(start); return i < 0 ? [] : SLOTS.slice(i, i + hours); };
const endOf = (start, hours) => SLOTS[(SLOTS.indexOf(start) + Number(hours || 1)) % 24];
const isExpired = b => b.status === "pending_payment" && !b.proofSubmittedAt && Number(b.holdExpiresAt) <= Date.now();
/* occupies(), expectedPrice() and reviewEndsAt() come from site-config.js, shared with the customer pages. */
const reviewTimedOut = b => b.status === "pending_payment" && !!b.proofSubmittedAt && reviewEndsAt(b) <= Date.now();
const priceMismatch = b => !b.staffCreated && Number(b.totalPrice) !== expectedPrice(b.date, b.startTime || b.time, b.durationHours || 1);
const clockTime = ms => new Date(ms).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
const statusName = b => b.status === "pending_payment" ? (b.proofSubmittedAt ? (reviewTimedOut(b) ? "Review timed out" : "Payment to review") : isExpired(b) ? "Expired" : "Awaiting payment") : ({ confirmed: "Confirmed", checked_in: "Checked in", cancelled: "Cancelled", no_show: "No show" }[b.status] || b.status);
const statusClass = b => b.status === "pending_payment" ? (b.proofSubmittedAt ? (reviewTimedOut(b) ? "timeout" : "review") : "pending") : b.status;
function currentHourFraction() { const now = new Date(); return now.getHours() + now.getMinutes() / 60; }
function pastState(hour) { const today = localDate(); if (dateInput.value < today) return true; if (dateInput.value > today) return false; return hour + 1 <= currentHourFraction(); }

/* All rows for the day, flattened. One entry per hour row. */
function hourRows() {
  const out = [];
  Object.entries(dayRows || {}).forEach(([ck, times]) => Object.entries(times || {}).forEach(([tk, b]) => out.push({ ...b, date: dateInput.value, courtKey: ck, timeKey: tk })));
  return out;
}
/* One entry per reservation (the primary row). */
function reservations() { return hourRows().filter(b => b.isPrimary !== false); }


/* ---------- one-time copy into the private layout ---------- */
async function checkMigration() {
  try { if ((await db.ref("meta/privacyMigration").once("value")).val()) return; } catch { return; }
  $("#migration").classList.remove("hidden");
}
async function runMigration(button) {
  button.disabled = true; button.textContent = "Copying…";
  try {
    const all = (await db.ref("bookings").once("value")).val() || {}, updates = {};
    let count = 0;
    Object.entries(all).forEach(([date, courts]) => Object.entries(courts || {}).forEach(([ck, times]) => {
      const byReservation = {};
      Object.entries(times || {}).forEach(([tk, row]) => {
        updates[`availability/${date}/${ck}/${tk}`] = availabilityRow(row);
        if (row.reservationId) (byReservation[row.reservationId] ||= { row: null, keys: [] }).keys.push(tk);
        if (row.reservationId && row.isPrimary !== false) byReservation[row.reservationId].row = row;
      });
      Object.values(byReservation).forEach(({ row, keys }) => {
        if (!row || !row.ownerUid || row.ownerUid === "staff") return;
        updates[`userBookings/${row.ownerUid}/${row.reservationId}`] = { reservationId: row.reservationId, court: row.court, courtKey: ck, timeKeys: keys.sort((a, b) => SLOTS.findIndex(t => slotKey(t) === a) - SLOTS.findIndex(t => slotKey(t) === b)), date, startTime: row.startTime || row.time, durationHours: row.durationHours || keys.length, totalPrice: row.totalPrice || 0, status: row.status, paymentStatus: row.paymentStatus || "unpaid", holdExpiresAt: row.holdExpiresAt || 0, note: row.note || "", createdAt: row.createdAt || "", contactPhone: row.contactPhone || "", ...(row.paymentReference ? { paymentReference: row.paymentReference } : {}), ...(row.paymentMethod ? { paymentMethod: row.paymentMethod } : {}), ...(row.proofSubmittedAt ? { proofSubmittedAt: row.proofSubmittedAt } : {}), ...(row.cancellationReason ? { cancellationReason: row.cancellationReason } : {}) };
        count++;
      });
    }));
    const entries = Object.entries(updates);
    for (let i = 0; i < entries.length; i += 400) await db.ref().update(Object.fromEntries(entries.slice(i, i + 400)));
    await db.ref("meta/privacyMigration").set(Date.now());
    $("#migration").classList.add("hidden");
    toast(`Done · ${count} customer booking${count === 1 ? "" : "s"} copied`);
  } catch (error) {
    console.error(error);
    button.disabled = false; button.textContent = "Try again";
    toast(error?.code === "PERMISSION_DENIED" ? "Publish the new database rules first, then try again." : "Couldn't finish the copy. Try again.", "error");
  }
}

/* ---------- toast + modal ---------- */
let toastTimer;
function toast(message, tone = "ok") {
  const el = $("#toast"); el.textContent = message; el.dataset.tone = tone; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function staffModal({ title, message = "", details = "", confirm = "Confirm", tone = "primary", askReason = false, reasonLabel = "Reason", cancel = "Cancel" }) {
  return new Promise(resolve => {
    const modal = $("#staff-modal");
    modal.innerHTML = `<h2>${safe(title)}</h2>${message ? `<p>${safe(message)}</p>` : ""}${details}${askReason ? `<label class="modal-reason">${safe(reasonLabel)}<textarea rows="2" placeholder="Optional"></textarea></label>` : ""}<div class="modal-actions"><button type="button" class="btn ghost" data-act="no">${safe(cancel)}</button><button type="button" class="btn ${tone}" data-act="yes">${safe(confirm)}</button></div>`;
    const finish = ok => { const reason = modal.querySelector("textarea")?.value.trim() || ""; modal.close(); resolve({ ok, reason }); };
    modal.querySelector('[data-act="yes"]').onclick = () => finish(true);
    modal.querySelector('[data-act="no"]').onclick = () => finish(false);
    modal.oncancel = event => { event.preventDefault(); finish(false); };
    modal.showModal();
    (modal.querySelector("textarea") || modal.querySelector('[data-act="yes"]')).focus();
  });
}

/* ---------- date ---------- */
function setDate(value) {
  dateInput.value = value;
  const today = localDate(), label = value === today ? "Today" : value === localDate(1) ? "Tomorrow" : value === localDate(-1) ? "Yesterday" : "";
  const pretty = asDate(value).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
  $("#date-title").innerHTML = label ? `${label} <span>${pretty}</span>` : pretty;
  $("#today-btn").disabled = value === today;
  if ($("#walkin-time").options.length) updateWalkinPrice();
  subscribe();
}
function shiftDate(days) { setDate(localDate(days, asDate(dateInput.value))); }

/* ---------- live data (re-subscribed on every date change) ---------- */
function subscribe() {
  if (stopListeners) stopListeners();
  dayRows = {}; dayBlocks = {}; render();
  const date = dateInput.value, bookingsRef = db.ref(`bookings/${date}`), blocksRef = db.ref(`blocks/${date}`);
  const onBookings = snap => { if (date === dateInput.value) { dayRows = snap.val() || {}; render(); } };
  const onBlocks = snap => { if (date === dateInput.value) { dayBlocks = snap.val() || {}; render(); } };
  bookingsRef.on("value", onBookings, error => toast("Couldn't load bookings. Check your connection.", "error"));
  blocksRef.on("value", onBlocks, error => toast("Couldn't load blocks.", "error"));
  stopListeners = () => { bookingsRef.off("value", onBookings); blocksRef.off("value", onBlocks); };
}

/* ---------- metrics ---------- */
function renderMetrics(list) {
  const live = list.filter(b => b.status !== "cancelled" && !isExpired(b) && !reviewTimedOut(b));
  const paid = live.filter(b => b.paymentStatus === "paid");
  const awaiting = live.filter(b => b.status === "pending_payment");
  const review = awaiting.filter(b => b.proofSubmittedAt);
  const hours = live.reduce((n, b) => n + Number(b.durationHours || 1), 0);
  $("#m-bookings").textContent = live.length;
  $("#m-bookings-sub").textContent = `${live.filter(b => b.status === "checked_in").length} checked in`;
  $("#m-revenue").textContent = peso(paid.reduce((n, b) => n + Number(b.totalPrice || 0), 0));
  $("#m-revenue-sub").textContent = `${paid.length} paid booking${paid.length === 1 ? "" : "s"}`;
  $("#m-awaiting").textContent = awaiting.length;
  $("#m-awaiting-sub").textContent = review.length ? `${review.length} to review` : "none to review";
  $("#m-awaiting").closest("article").classList.toggle("alert", review.length > 0);
  $("#m-hours").textContent = `${hours}/96`;
  $("#m-hours-sub").textContent = `${Math.round(hours / 96 * 100)}% of court time`;
}

/* ---------- calendar ---------- */
function blockGroups() {
  const groups = [];
  Object.entries(dayBlocks || {}).forEach(([ck, byTime]) => {
    const items = Object.entries(byTime || {}).map(([tk, detail]) => ({ time: SLOTS.find(t => slotKey(t) === tk), reason: detail?.reason || "Unavailable" })).filter(x => x.time).sort((a, b) => SLOTS.indexOf(a.time) - SLOTS.indexOf(b.time));
    let group = null;
    items.forEach(item => {
      const hour = SLOTS.indexOf(item.time);
      if (group && group.reason === item.reason && hour === group.start + group.hours) group.hours++;
      else { group = { courtKey: ck, start: hour, hours: 1, reason: item.reason }; groups.push(group); }
    });
  });
  return groups;
}
function renderCalendar(list) {
  const cal = $("#calendar"), parts = [`<div class="cal-corner"></div>`];
  COURTS.forEach((court, c) => parts.push(`<div class="cal-head" style="grid-column:${c + 2}">${court}<small>Open air</small></div>`));
  const blocked = new Set();
  blockGroups().forEach(g => { for (let h = g.start; h < g.start + g.hours; h++) blocked.add(`${g.courtKey}|${h}`); });
  const taken = new Set();
  hourRows().filter(occupies).forEach(b => taken.add(`${b.courtKey}|${SLOTS.indexOf(b.time)}`));
  SLOTS.forEach((time, h) => {
    const past = pastState(h);
    parts.push(`<div class="cal-time ${past ? "past" : ""}" style="grid-row:${h + 2}">${time.replace(":00", "")}</div>`);
    COURTS.forEach((court, c) => {
      const key = `${courtKey(court)}|${h}`, free = !taken.has(key) && !blocked.has(key);
      parts.push(free && !past
        ? `<button type="button" class="cal-slot" style="grid-row:${h + 2};grid-column:${c + 2}" data-court="${court}" data-time="${time}" aria-label="Add walk-in on ${court} at ${time}"></button>`
        : `<div class="cal-slot ${past ? "past" : ""}" style="grid-row:${h + 2};grid-column:${c + 2}"></div>`);
    });
  });
  blockGroups().forEach(g => {
    const c = COURTS.findIndex(court => courtKey(court) === g.courtKey); if (c < 0) return;
    parts.push(`<div class="cal-event blocked" style="grid-row:${g.start + 2} / span ${g.hours};grid-column:${c + 2}"><b>Blocked</b><small>${safe(g.reason)}</small></div>`);
  });
  list.filter(occupies).forEach(b => {
    const c = COURTS.indexOf(b.court), start = SLOTS.indexOf(b.startTime || b.time), hours = Math.min(Number(b.durationHours || 1), 24 - start);
    if (c < 0 || start < 0) return;
    parts.push(`<button type="button" class="cal-event ${statusClass(b)} ${pastState(start + hours - 1) ? "past" : ""}" style="grid-row:${start + 2} / span ${hours};grid-column:${c + 2}" data-id="${safe(b.reservationId)}"><b>${safe(b.ownerName || "Walk-in")}</b><small>${safe(b.startTime || b.time)} – ${safe(endOf(b.startTime || b.time, b.durationHours))} · ${safe(statusName(b))}</small></button>`);
  });
  if (dateInput.value === localDate()) parts.push(`<div class="now-line" style="top:${HEAD_H + currentHourFraction() * ROW_H}px"><span>Now</span></div>`);
  cal.innerHTML = parts.join("");
  cal.querySelectorAll("button.cal-slot").forEach(slot => slot.onclick = () => prefillWalkin(slot.dataset.court, slot.dataset.time));
  cal.querySelectorAll("button.cal-event").forEach(ev => ev.onclick = () => focusRow(ev.dataset.id));
  if (scrolledForDate !== dateInput.value) {
    scrolledForDate = dateInput.value;
    const target = dateInput.value === localDate() ? Math.max(0, Math.floor(currentHourFraction()) - 1) : 7;
    $("#calendar-scroll").scrollTop = target * ROW_H;
  }
}
function focusRow(id) {
  const row = document.querySelector(`.booking-row[data-id="${CSS.escape(id)}"]`); if (!row) return;
  row.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
}

/* ---------- reservation list ---------- */
function rowHtml(b, all) {
  const duplicate = b.paymentReference && all.some(x => x.reservationId !== b.reservationId && x.paymentReference === b.paymentReference);
  const pending = b.status === "pending_payment";
  const actions = pending
    ? `<div class="row-actions"><button type="button" class="btn primary small" data-act="paid" data-id="${safe(b.reservationId)}">Mark as paid</button><button type="button" class="btn ghost small" data-act="reject" data-id="${safe(b.reservationId)}">Reject</button></div>`
    : `<select class="status-select" data-id="${safe(b.reservationId)}" aria-label="Status for ${safe(b.ownerName || "booking")}">${["confirmed", "checked_in", "no_show", "cancelled"].map(s => `<option value="${s}" ${b.status === s ? "selected" : ""}>${{ confirmed: "Confirmed", checked_in: "Checked in", no_show: "No show", cancelled: "Cancelled" }[s]}</option>`).join("")}</select>`;
  const paidBit = b.paymentStatus === "paid" ? `<span class="paid-tag">Paid${b.paymentMethod ? ` · ${safe(methodName(b.paymentMethod))}` : ""}</span>` : "";
  return `<article class="booking-row ${duplicate ? "has-warning" : ""} ${pending ? "" : "has-select"}" data-id="${safe(b.reservationId)}">
    <div class="row-time"><b>${safe((b.startTime || b.time).replace(":00", ""))}</b><span>${safe(b.durationHours || 1)} hr · ${peso(b.totalPrice)}</span></div>
    <div class="row-main">
      <div class="row-title">${safe(b.ownerName || "Customer")} <span class="muted">· ${safe(b.court)}</span></div>
      <div class="row-meta">${b.contactPhone ? `<a href="tel:${safe(String(b.contactPhone).replace(/[^\d+]/g, ""))}">${safe(b.contactPhone)}</a>` : "No contact"}${b.paymentReference ? `${b.paymentMethod ? ` · ${safe(methodName(b.paymentMethod))}` : ""} · Ref <span class="mono">${safe(b.paymentReference)}</span>` : ""}${b.staffCreated ? " · Walk-in" : ""}</div>
      ${b.note ? `<div class="row-note">${safe(b.note)}</div>` : ""}
      ${duplicate ? `<span class="badge danger">Reference used on another booking</span>` : ""}
      ${priceMismatch(b) && b.status !== "cancelled" ? `<span class="badge danger">Amount doesn't match rates · should be ${peso(expectedPrice(b.date, b.startTime || b.time, b.durationHours || 1))}</span>` : ""}
      ${pending && b.proofSubmittedAt && !reviewTimedOut(b) ? `<div class="row-note">Slot auto-releases at ${clockTime(reviewEndsAt(b))} if not confirmed</div>` : ""}
      ${reviewTimedOut(b) ? `<span class="badge danger">Not reviewed in time · slot released</span>` : ""}
      ${b.cancellationReason && b.status === "cancelled" ? `<div class="row-note">Reason: ${safe(b.cancellationReason)}</div>` : ""}
    </div>
    ${b.hasProof ? `<button type="button" class="proof-thumb proof-btn" data-proof="${safe(b.reservationId)}" aria-label="View payment screenshot" title="View payment screenshot"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="2" fill="currentColor"/><path d="m21 16-5-5-9 9" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>` : b.proofUrl ? `<a class="proof-thumb" href="${safe(b.proofUrl)}" target="_blank" rel="noopener" title="Open payment screenshot"><img src="${safe(b.proofUrl)}" alt="Payment screenshot" loading="lazy"></a>` : `<span class="proof-thumb empty" aria-hidden="true"></span>`}
    <div class="row-status"><span class="status ${statusClass(b)}">${safe(statusName(b))}</span>${paidBit}</div>
    ${actions}
  </article>`;
}
function renderList(list) {
  const filter = $("#filter-status").value;
  const visible = list.filter(b => !isExpired(b) && (filter === "all" || b.status === filter)).sort((a, b) => SLOTS.indexOf(a.startTime || a.time) - SLOTS.indexOf(b.startTime || b.time));
  const dup = b => b.paymentReference && list.some(x => x.reservationId !== b.reservationId && x.paymentReference === b.paymentReference);
  const needs = visible.filter(b => (b.status === "pending_payment" && b.proofSubmittedAt) || (b.status !== "cancelled" && (dup(b) || priceMismatch(b))));
  const rest = visible.filter(b => !needs.includes(b));
  const expiredCount = list.filter(isExpired).length;
  $("#booking-count").textContent = `${visible.length} booking${visible.length === 1 ? "" : "s"}${expiredCount ? ` · ${expiredCount} expired hold${expiredCount === 1 ? "" : "s"} hidden` : ""}`;
  $("#booking-list").innerHTML = (needs.length ? `<h3 class="group-title alert">Needs action <span>${needs.length}</span></h3>${needs.map(b => rowHtml(b, list)).join("")}` : "")
    + (rest.length ? `${needs.length ? `<h3 class="group-title">Everything else</h3>` : ""}${rest.map(b => rowHtml(b, list)).join("")}` : "")
    || `<p class="empty">No bookings ${filter === "all" ? "on this day yet" : "match this filter"}.</p>`;
  const byId = id => list.find(b => b.reservationId === id);
  document.querySelectorAll('[data-act="paid"]').forEach(btn => btn.onclick = () => markPaid(byId(btn.dataset.id)));
  document.querySelectorAll('[data-act="reject"]').forEach(btn => btn.onclick = () => changeStatus(byId(btn.dataset.id), "cancelled", btn));
  document.querySelectorAll(".status-select").forEach(sel => sel.onchange = () => changeStatus(byId(sel.dataset.id), sel.value, sel));
  document.querySelectorAll("#booking-list [data-proof]").forEach(btn => btn.onclick = () => viewProof(btn.dataset.proof, byId(btn.dataset.proof)));
}
/* Screenshots are only downloaded when staff ask for them. */
async function viewProof(reservationId, booking) {
  const modal = $("#staff-modal");
  modal.innerHTML = `<h2>Payment screenshot</h2><p>${safe(booking?.ownerName || "Customer")}${booking?.paymentReference ? ` · Ref <span class="mono">${safe(booking.paymentReference)}</span>` : ""}${booking?.totalPrice ? ` · ${peso(booking.totalPrice)}` : ""}</p><div class="proof-view"><div class="spinner"></div></div><div class="modal-actions"><a class="btn ghost hidden" data-download download="payment-${safe(reservationId)}.jpg">Download</a><button type="button" class="btn primary" data-act="close">Close</button></div>`;
  modal.querySelector('[data-act="close"]').onclick = () => modal.close();
  modal.oncancel = null;
  modal.showModal();
  try {
    const proof = (await db.ref(`paymentProofs/${reservationId}`).once("value")).val();
    const view = modal.querySelector(".proof-view");
    if (!proof?.image) { view.innerHTML = `<p class="empty small">This screenshot is no longer available. Screenshots are kept for ${BOOKING_RULES.proofRetentionDays} days.</p>`; return; }
    view.innerHTML = `<img src="${proof.image}" alt="Payment screenshot">`;
    const download = modal.querySelector("[data-download]"); download.href = proof.image; download.classList.remove("hidden");
  } catch (error) { console.error(error); modal.querySelector(".proof-view").innerHTML = `<p class="empty small">Couldn't load the screenshot. Try again.</p>`; }
}
/* Deletes screenshots older than the retention period, at most once a day. */
async function cleanupProofs() {
  try {
    const last = Number((await db.ref("meta/lastProofCleanup").once("value")).val() || 0);
    if (Date.now() - last < 24 * HOUR_MS) return;
    const cutoff = Date.now() - BOOKING_RULES.proofRetentionDays * 24 * HOUR_MS;
    const old = (await db.ref("paymentProofs").orderByChild("createdAt").endAt(cutoff).limitToFirst(300).once("value")).val() || {};
    const updates = { "meta/lastProofCleanup": Date.now() };
    Object.keys(old).forEach(id => updates[`paymentProofs/${id}`] = null);
    await db.ref().update(updates);
  } catch (error) { console.warn("Screenshot cleanup skipped", error); }
}

/* ---------- actions ---------- */
async function updateReservation(booking, fields) {
  const root = `bookings/${booking.date}/${booking.courtKey}`;
  const schedule = (await db.ref(root).once("value")).val() || {}, updates = {};
  const keys = Object.entries(schedule).filter(([, row]) => row.reservationId === booking.reservationId).map(([k]) => k);
  if (!keys.length) keys.push(booking.timeKey);
  keys.forEach(k => {
    Object.entries(fields).forEach(([f, v]) => updates[`${root}/${k}/${f}`] = v);
    if ("status" in fields) updates[`availability/${booking.date}/${booking.courtKey}/${k}/status`] = fields.status;
  });
  if (booking.ownerUid && booking.ownerUid !== "staff") {
    const mine = `userBookings/${booking.ownerUid}/${booking.reservationId}`;
    ["status", "paymentStatus", "paymentMethod", "paidAt", "cancellationReason"].forEach(f => { if (f in fields) updates[`${mine}/${f}`] = fields[f]; });
  }
  if (booking.ownerUid && booking.ownerUid !== "staff" && booking.holdSlot !== undefined && "status" in fields && fields.status !== "pending_payment") {
    const ticket = (await db.ref(`holdSlots/${booking.ownerUid}/${booking.holdSlot}`).once("value")).val();
    if (ticket && ticket.rid === booking.reservationId) updates[`holdSlots/${booking.ownerUid}/${booking.holdSlot}`] = null;
  }
  const log = (await db.ref(`paymentLog/${booking.reservationId}`).once("value")).val();
  if (log) {
    if (fields.paymentStatus === "paid") updates[`paymentLog/${booking.reservationId}/state`] = "paid";
    else if (fields.status === "cancelled" && booking.status === "pending_payment") updates[`paymentLog/${booking.reservationId}/state`] = "rejected";
  }
  await db.ref().update(updates);
}
async function markPaid(b) {
  if (!b) return;
  const expected = expectedPrice(b.date, b.startTime || b.time, b.durationHours || 1), wrong = priceMismatch(b);
  const details = `${wrong ? `<p class="modal-warning">This booking says ${peso(b.totalPrice)}, but your rates for this time come to ${peso(expected)}. Check you received ${peso(expected)} before confirming.</p>` : ""}${reviewTimedOut(b) ? `<p class="modal-warning">This review timed out and the slot was released. Confirming takes it back, if nobody else has booked it.</p>` : ""}<dl class="modal-details"><dt>Amount</dt><dd>${peso(b.totalPrice)}</dd>${wrong ? `<dt>Rates say</dt><dd>${peso(expected)}</dd>` : ""}<dt>Method</dt><dd>${safe(methodName(b.paymentMethod) || "Not given")}</dd><dt>Reference</dt><dd class="mono">${safe(b.paymentReference || "Not submitted")}</dd><dt>Customer</dt><dd>${safe(b.ownerName || "Customer")}</dd></dl>`;
  const { ok } = await staffModal({ title: "Mark as paid?", message: "Only confirm once you've seen this payment in your own GCash or Maya app.", details, confirm: wrong ? "Mark paid anyway" : `Mark ${peso(b.totalPrice)} paid`, tone: wrong ? "danger" : "primary" });
  if (!ok) return;
  try { await updateReservation(b, { status: "confirmed", paymentStatus: "paid", paidAt: Date.now(), verifiedBy: auth.currentUser.email }); toast(`Marked as paid · ${b.ownerName || "Customer"}`); }
  catch (error) { console.error(error); toast("Couldn't save. Try again.", "error"); }
}
async function changeStatus(b, status, control) {
  if (!b) return;
  if (status === "cancelled") {
    const { ok, reason } = await staffModal({ title: b.status === "pending_payment" ? "Reject this booking?" : "Cancel this booking?", message: `${b.ownerName || "Customer"} · ${b.court} · ${b.startTime || b.time}. The slot becomes free again.`, confirm: b.status === "pending_payment" ? "Reject booking" : "Cancel booking", cancel: "Keep booking", tone: "danger", askReason: true, reasonLabel: "Reason (shown to staff)" });
    if (!ok) { if (control.tagName === "SELECT") control.value = b.status; return; }
    try { await updateReservation(b, { status: "cancelled", cancellationReason: reason || "Cancelled by staff" }); toast("Booking cancelled"); }
    catch (error) { console.error(error); toast("Couldn't save. Try again.", "error"); control.value = b.status; }
    return;
  }
  control.disabled = true;
  try { await updateReservation(b, { status }); toast(`Saved · ${statusName({ status })}`); }
  catch (error) { console.error(error); toast("Couldn't save. Try again.", "error"); control.value = b.status; }
  finally { control.disabled = false; }
}

/* ---------- side panel: walk-ins ---------- */
function showTab(name) {
  document.querySelectorAll(".segmented button").forEach(b => { const on = b.dataset.tab === name; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
  document.querySelectorAll("[data-panel]").forEach(p => p.classList.toggle("hidden", p.dataset.panel !== name));
}
function walkinTotal() { const range = rangeFrom($("#walkin-time").value, Number($("#walkin-hours").value)); return range.reduce((n, t) => n + hourlyRate(t), 0); }
function updateWalkinPrice() {
  const total = walkinTotal(), input = $("#walkin-price");
  input.placeholder = peso(total);
  $("#walkin-price-hint").textContent = `Standard rate ${peso(total)}. Type a different amount for promos.`;
}
function prefillWalkin(court, time) {
  showTab("walkin");
  $("#walkin-court").value = court; $("#walkin-time").value = time; updateWalkinPrice(); hideError("#walkin-error");
  const panel = $("#tools"); panel.classList.remove("pulse"); void panel.offsetWidth; panel.classList.add("pulse");
  if (matchMedia("(max-width: 980px)").matches) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#walkin-name").focus({ preventScroll: true });
}
const showError = (sel, msg) => { const el = $(sel); el.textContent = msg; el.classList.remove("hidden"); };
const hideError = sel => $(sel).classList.add("hidden");
function conflictsFor(court, range) {
  const ck = courtKey(court), hours = range.map(t => SLOTS.indexOf(t));
  const booked = hourRows().filter(b => b.courtKey === ck && occupies(b) && range.includes(b.time));
  const blocked = blockGroups().filter(g => g.courtKey === ck && hours.some(h => h >= g.start && h < g.start + g.hours));
  return { booked, blocked };
}
async function walkin(event) {
  event.preventDefault(); hideError("#walkin-error");
  const court = $("#walkin-court").value, start = $("#walkin-time").value, hours = Number($("#walkin-hours").value), range = rangeFrom(start, hours);
  const name = $("#walkin-name").value.trim(), payment = $("#walkin-payment").value, override = Number($("#walkin-price").value);
  if (!name) return showError("#walkin-error", "Add the customer's name.");
  if (range.length !== hours) return showError("#walkin-error", "This booking would run past midnight. Pick an earlier start or fewer hours.");
  if (pastState(SLOTS.indexOf(start))) return showError("#walkin-error", "That start time has already passed.");
  const { blocked } = conflictsFor(court, range);
  if (blocked.length) return showError("#walkin-error", `${court} is blocked then (${blocked[0].reason}).`);
  const button = event.target.querySelector('[type="submit"]'); button.disabled = true; button.textContent = "Saving…";
  const id = `staff-${Date.now()}`, paid = payment !== "unpaid";
  const base = { court, date: dateInput.value, players: "Walk-in", contactPhone: $("#walkin-phone").value.trim(), note: $("#walkin-note").value.trim(), createdAt: new Date().toISOString(), status: "confirmed", paymentStatus: paid ? "paid" : "unpaid", ownerUid: "staff", ownerName: name, startTime: start, durationHours: hours, totalPrice: override > 0 ? override : walkinTotal(), reservationId: id, staffCreated: true };
  if (paid) Object.assign(base, { paymentMethod: payment, paidAt: Date.now(), verifiedBy: auth.currentUser.email });
  try {
    const result = await db.ref(`bookings/${dateInput.value}/${courtKey(court)}`).transaction(current => {
      current = current || {};
      if (range.some(t => occupies(current[slotKey(t)]))) return;
      range.forEach((t, n) => { current[slotKey(t)] = { ...base, time: t, isPrimary: n === 0 }; });
      return current;
    });
    if (!result.committed) { showError("#walkin-error", "Someone booked part of that time. Pick another slot."); return; }
    const publicRows = {};
    range.forEach(t => publicRows[`availability/${dateInput.value}/${courtKey(court)}/${slotKey(t)}`] = availabilityRow(base));
    await db.ref().update(publicRows);
    event.target.reset(); $("#walkin-court").value = court; updateWalkinPrice();
    toast(`Walk-in added · ${name}, ${court} at ${start.replace(":00", "")}`);
  } catch (error) { console.error(error); showError("#walkin-error", "Couldn't save. Check your connection and try again."); }
  finally { button.disabled = false; button.textContent = "Create walk-in"; }
}

/* ---------- side panel: blocks ---------- */
async function blockTime(event) {
  event.preventDefault(); hideError("#block-error");
  const chosen = $("#block-court").value, hours = Number($("#block-hours").value), start = $("#block-time").value;
  const range = hours === 24 ? SLOTS : rangeFrom(start, hours), reason = $("#block-reason").value.trim();
  if (!reason) return showError("#block-error", "Add a reason so staff know why.");
  if (range.length !== hours && hours !== 24) return showError("#block-error", "That would run past midnight. Pick an earlier start or fewer hours.");
  const targets = chosen === "All courts" ? COURTS : [chosen];
  const overlapping = targets.flatMap(c => conflictsFor(c, range).booked).map(b => b.reservationId).filter((v, i, a) => a.indexOf(v) === i);
  if (overlapping.length) {
    const { ok } = await staffModal({ title: "Block over existing bookings?", message: `${overlapping.length} booking${overlapping.length === 1 ? "" : "s"} overlap this time. Blocking won't cancel them; contact those customers separately.`, confirm: "Block anyway", tone: "danger" });
    if (!ok) return;
  }
  const updates = {};
  targets.forEach(c => range.forEach(t => updates[`blocks/${dateInput.value}/${courtKey(c)}/${slotKey(t)}`] = { reason, createdAt: new Date().toISOString() }));
  try { await db.ref().update(updates); event.target.reset(); toast(`Blocked · ${chosen}, ${hours === 24 ? "full day" : `${start.replace(":00", "")} for ${hours} hr`}`); }
  catch (error) { console.error(error); showError("#block-error", "Couldn't save. Check your connection and try again."); }
}
function renderActiveBlocks() {
  const groups = blockGroups().sort((a, b) => a.start - b.start || a.courtKey.localeCompare(b.courtKey));
  $("#active-block-list").innerHTML = groups.length ? groups.map(g => `<div class="active-block"><div><b>${safe(courtName(g.courtKey))}</b><span>${SLOTS[g.start].replace(":00", "")} – ${SLOTS[(g.start + g.hours) % 24].replace(":00", "")} · ${safe(g.reason)}</span></div><button type="button" class="btn ghost small" data-court="${safe(g.courtKey)}" data-start="${g.start}" data-hours="${g.hours}">Remove</button></div>`).join("") : `<p class="empty small">No blocks.</p>`;
  $("#active-block-list").querySelectorAll("button").forEach(btn => btn.onclick = () => removeBlock(btn.dataset.court, Number(btn.dataset.start), Number(btn.dataset.hours)));
}
async function removeBlock(ck, start, hours) {
  const { ok } = await staffModal({ title: "Remove this block?", message: `${courtName(ck)} will be bookable again from ${SLOTS[start].replace(":00", "")}.`, confirm: "Remove block" });
  if (!ok) return;
  const updates = {};
  for (let h = start; h < start + hours; h++) updates[`blocks/${dateInput.value}/${ck}/${slotKey(SLOTS[h])}`] = null;
  try { await db.ref().update(updates); toast("Block removed"); } catch (error) { console.error(error); toast("Couldn't remove the block. Try again.", "error"); }
}

/* ---------- payments to resolve (money received for a slot the customer no longer has) ---------- */
let paymentLog = {};
async function renderResolve() {
  const since = localDate(-14), items = [];
  for (const [rid, entry] of Object.entries(paymentLog || {})) {
    if (!["submitted", "paid", "slot_lost"].includes(entry.state) || entry.date < since) continue;
    if (entry.state === "slot_lost") { items.push({ rid, entry, why: "Paid after their hold ran out and the slot was taken" }); continue; }
    const row = (await db.ref(`bookings/${entry.date}/${entry.courtKey}/${entry.first}`).once("value")).val();
    if (!row || row.reservationId !== rid) items.push({ rid, entry, why: "Slot was released before the payment was reviewed, and someone else booked it" });
    else if (row.status === "cancelled") items.push({ rid, entry, why: entry.state === "paid" ? "Cancelled after paying" : "Cancelled with a payment submitted" });
  }
  $("#resolve").classList.toggle("hidden", !items.length);
  $("#resolve-count").textContent = items.length ? `${items.length} to sort out` : "";
  $("#resolve-list").innerHTML = items.map(({ rid, entry, why }) => `<article class="resolve-row"><div><b>${safe(entry.name || "Customer")} · ${peso(entry.amount)}</b><span>${safe(asDate(entry.date).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }))} · ${safe(entry.court)} · ${safe(String(entry.startTime || "").replace(":00", ""))} · ${safe(methodName(entry.method))} ref <span class="mono">${safe(entry.reference)}</span></span><small>${safe(why)}</small></div><div class="row-actions">${entry.hasProof ? `<button type="button" class="btn ghost small" data-proof="${safe(rid)}">Screenshot</button>` : ""}<button type="button" class="btn primary small" data-resolve="refunded" data-rid="${safe(rid)}">Refund sent</button><button type="button" class="btn ghost small" data-resolve="dismissed" data-rid="${safe(rid)}">No refund needed</button></div></article>`).join("");
  $("#resolve-list").querySelectorAll("[data-proof]").forEach(btn => btn.onclick = () => { const e = paymentLog[btn.dataset.proof]; viewProof(btn.dataset.proof, { ownerName: e.name, paymentReference: e.reference, totalPrice: e.amount }); });
  $("#resolve-list").querySelectorAll("[data-resolve]").forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    try { await db.ref(`paymentLog/${btn.dataset.rid}`).update({ state: btn.dataset.resolve, resolvedAt: Date.now(), resolvedBy: auth.currentUser.email }); toast(btn.dataset.resolve === "refunded" ? "Marked as refunded" : "Dismissed"); }
    catch (error) { console.error(error); btn.disabled = false; toast("Couldn't save. Try again.", "error"); }
  });
}

/* ---------- render all ---------- */
function render() {
  const list = reservations();
  renderMetrics(list); renderCalendar(list); renderList(list); renderActiveBlocks();
}

/* ---------- boot ---------- */
function start() {
  $("#loading").classList.add("hidden"); $("#dashboard").classList.remove("hidden");
  const options = SLOTS.map(t => `<option value="${t}">${t}</option>`).join("");
  $("#walkin-time").innerHTML = options; $("#block-time").innerHTML = options;
  $("#walkin-time").value = SLOTS[Math.min(23, Math.ceil(currentHourFraction()))];
  updateWalkinPrice();
  db.ref(".info/connected").on("value", snap => { const live = $("#live"), on = snap.val() === true; live.dataset.state = on ? "live" : "offline"; live.querySelector("span").textContent = on ? "Live" : "Offline"; });
  setDate(localDate());
  checkMigration();
  cleanupProofs();
  db.ref("paymentLog").on("value", snap => { paymentLog = snap.val() || {}; renderResolve().catch(console.error); }, () => {});
  setInterval(() => renderResolve().catch(console.error), 120000);
  $("#run-migration").onclick = event => runMigration(event.currentTarget);
  if (location.hash === "#tools") $("#tools").scrollIntoView();
  setInterval(() => { if (dateInput.value === localDate()) render(); }, 60000);
}
auth.onAuthStateChanged(user => {
  if (!user) { location.href = "./index.html"; return; }
  $("#admin-email").textContent = user.email;
  db.ref(`admins/${user.uid}`).once("value").then(snap => {
    if (snap.val() === true) start();
    else { $("#loading").classList.add("hidden"); $("#denied").classList.remove("hidden"); }
  });
});
$("#sign-out").onclick = () => auth.signOut();
$("#prev-day").onclick = () => shiftDate(-1);
$("#next-day").onclick = () => shiftDate(1);
$("#today-btn").onclick = () => setDate(localDate());
dateInput.onchange = () => { if (dateInput.value) setDate(dateInput.value); };
$("#filter-status").onchange = () => renderList(reservations());
document.querySelectorAll(".segmented button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
["#walkin-time", "#walkin-hours"].forEach(sel => $(sel).addEventListener("change", updateWalkinPrice));
$("#walk-in-form").onsubmit = walkin;
$("#block-form").onsubmit = blockTime;
