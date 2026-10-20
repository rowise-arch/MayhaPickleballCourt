/* My Bookings list: reads only this customer's own copy (userBookings/{uid}).
   The Pay now dialog lives in my-bookings-payments.js. */
const config = { apiKey: "AIzaSyAVboExr93oDx_ClUFPp2fmcMGvOTTNbRo", authDomain: "mayha-courts.firebaseapp.com", databaseURL: "https://mayha-courts-default-rtdb.firebaseio.com", projectId: "mayha-courts", storageBucket: "mayha-courts.firebasestorage.app", messagingSenderId: "697040217308", appId: "1:697040217308:web:92d797a44fb71e97474019" };
const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config), auth = app.auth(), db = app.database();
const $ = selector => document.querySelector(selector);

let user = null, bookings = [], stopListener = null, pendingCancel = null;

/* ---------- formatting ---------- */
const safe = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const peso = amount => `₱${Number(amount || 0).toLocaleString("en-PH")}`;
const slotKey = time => time.replaceAll(":", "-").replaceAll(" ", "-").toLowerCase();
const hourOf = time => SLOT_TIMES.indexOf(time);
const METHOD_NAMES = { gcash: "GCash", maya: "Maya", cash: "Cash" };
const methodName = id => METHOD_NAMES[id] || id || "";
function dayLabel(date) { return new Date(`${date}T12:00:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }); }
function clock(hour, withMeridiem = true) { const h = ((hour % 24) + 24) % 24, twelve = h % 12 || 12; return withMeridiem ? `${twelve} ${h < 12 ? "AM" : "PM"}` : String(twelve); }
function timeRange(start, hours) { const from = hourOf(start), to = from + Number(hours || 1), sameHalf = (from < 12) === ((to % 24) < 12) && to < 24; return `${sameHalf ? clock(from, false) : clock(from)}–${clock(to)}`; }
function startsAt(b) { return new Date(`${b.date}T${String(Math.max(0, hourOf(b.startTime))).padStart(2, "0")}:00:00+08:00`); }
function endsAt(b) { return new Date(startsAt(b).getTime() + Number(b.durationHours || 1) * 3600000); }
const isExpired = b => b.status === "pending_payment" && !b.proofSubmittedAt && Number(b.holdExpiresAt) <= Date.now();
const reviewTimedOut = b => b.status === "pending_payment" && !!b.proofSubmittedAt && reviewEndsAt(b) <= Date.now();
const isUpcoming = b => !["cancelled", "no_show"].includes(b.status) && !b.slotLost && !isExpired(b) && !reviewTimedOut(b) && endsAt(b) > new Date();
const clockTime = ms => new Date(ms).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
function pill(b, upcoming) {
  if (b.status === "cancelled") return ["cancelled", "Cancelled"];
  if (b.status === "no_show") return ["muted", "No show"];
  if (b.slotLost) return ["cancelled", "Refund pending"];
  if (reviewTimedOut(b)) return ["muted", "Not confirmed in time"];
  if (isExpired(b)) return ["muted", "Hold expired"];
  if (b.status === "pending_payment") return b.proofSubmittedAt ? ["review", "Payment under review"] : ["pending", "Awaiting payment"];
  if (!upcoming) return ["muted", "Played"];
  return b.status === "checked_in" ? ["checked", "Checked in"] : ["confirmed", "Confirmed"];
}
function holdText(expires) { const ms = Number(expires) - Date.now(), s = Math.max(0, Math.ceil(ms / 1000)), left = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; return ms <= BOOKING_RULES.lastCallMs ? `Time's almost up · ${left} · don't send money now` : `Held for you · ${left}`; }
function initials(text) { const words = String(text).split("@")[0].trim().split(/[\s._-]+/).filter(Boolean); const picked = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] || "A"]; return picked.map(w => Array.from(w)[0]).join("").toUpperCase(); }

/* ---------- toast ---------- */
let toastTimer;
function hideToast() { $("#toast").classList.remove("show"); }
/* toast("Saved") or toast("Booking cancelled", "ok", { label: "Undo", ms: 5000, onClick }) */
function toast(message, tone = "ok", action = null) {
  const el = $("#toast"); clearTimeout(toastTimer);
  el.dataset.tone = tone; el.classList.toggle("has-action", !!action);
  el.innerHTML = `<span>${safe(message)}</span>${action ? `<button type="button">${safe(action.label)}</button><i class="toast-progress" style="animation-duration:${action.ms}ms"></i>` : ""}`;
  if (action) el.querySelector("button").onclick = () => { hideToast(); action.onClick(); };
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  toastTimer = setTimeout(hideToast, action ? action.ms : 2800);
}

/* ---------- cards ---------- */
function upcomingCard(b) {
  const [tone, label] = pill(b, true), pending = b.status === "pending_payment", cancelling = pendingCancel?.b.reservationId === b.reservationId;
  const canPay = pending && !b.proofSubmittedAt && Number(b.holdExpiresAt) > Date.now();
  const paid = b.paymentStatus === "paid";
  return `<article class="bk ${cancelling ? "cancelling" : ""}" data-id="${safe(b.reservationId)}">
    <div class="bk-top"><div><h3>${dayLabel(b.date)}</h3><p class="bk-sub">${timeRange(b.startTime, b.durationHours)} · ${safe(b.court)} · ${peso(b.totalPrice)}</p></div><span class="pill ${cancelling ? "cancelled" : tone}">${cancelling ? "Cancelling…" : label}</span></div>
    ${canPay ? `<p class="hold-pill" data-expires="${Number(b.holdExpiresAt)}">${holdText(b.holdExpiresAt)}</p>` : ""}
    ${pending && b.proofSubmittedAt ? `<p class="bk-info">Payment sent. Staff will confirm by ${clockTime(reviewEndsAt(b))}.</p>` : ""}
    ${b.paymentReference ? `<p class="bk-meta">${safe(methodName(b.paymentMethod))} ref <span class="mono">${safe(b.paymentReference)}</span>${paid ? " · Paid" : ""}</p>` : paid ? `<p class="bk-meta">Paid${b.paymentMethod ? ` · ${safe(methodName(b.paymentMethod))}` : ""}</p>` : ""}
    ${b.note ? `<p class="bk-meta">Note: ${safe(b.note)}</p>` : ""}
    <div class="bk-actions">
      ${canPay ? `<button type="button" class="book-btn bk-pay" data-act="pay">Pay ${peso(b.totalPrice)}</button>` : ""}
      ${pending && b.proofSubmittedAt ? `<button type="button" class="bk-link" data-act="pay">Update payment details</button>` : ""}
      ${!canPay ? `<button type="button" class="bk-link" data-act="ics">Add to calendar</button><a class="bk-link" href="${mapsUrl()}" target="_blank" rel="noopener">Get directions</a>` : ""}
      <button type="button" class="bk-cancel" data-act="cancel">Cancel</button>
    </div>
  </article>`;
}
function pastCard(b) {
  const [tone, label] = pill(b, false), refund = b.status === "cancelled" && b.paymentStatus === "paid";
  return `<article class="bk past" data-id="${safe(b.reservationId)}">
    <div class="bk-top"><div><h3>${dayLabel(b.date)}</h3><p class="bk-sub">${timeRange(b.startTime, b.durationHours)} · ${safe(b.court)} · ${peso(b.totalPrice)}</p></div><span class="pill ${tone}">${label}</span></div>
    ${refund ? `<p class="bk-info">Refund pending. Staff will contact you.</p>` : ""}
    ${b.slotLost ? `<p class="bk-info">Your hold ran out and someone else booked this time before your payment came through. Staff will refund ${peso(b.totalPrice)}.</p>` : ""}
    ${!b.slotLost && reviewTimedOut(b) ? `<p class="bk-info">Staff couldn't confirm your payment in time, so the slot was released. If you paid, staff will contact you about a refund.</p>` : ""}
    ${b.cancellationReason && b.status === "cancelled" ? `<p class="bk-meta">Reason: ${safe(b.cancellationReason)}</p>` : ""}
    ${isExpired(b) && !b.slotLost && startsAt(b) > new Date() ? `<div class="bk-actions"><button type="button" class="book-btn bk-pay" data-act="rehold">Hold again</button><a class="bk-link" href="./index.html#book">Pick another time</a></div>` : isExpired(b) || b.status === "cancelled" || b.slotLost || reviewTimedOut(b) ? `<div class="bk-actions"><a class="bk-link" href="./index.html#book">Book again</a></div>` : ""}
  </article>`;
}
function render() {
  const upcoming = bookings.filter(isUpcoming).sort((a, b) => startsAt(a) - startsAt(b));
  const past = bookings.filter(b => !isUpcoming(b)).sort((a, b) => startsAt(b) - startsAt(a));
  $("#upcoming").innerHTML = upcoming.length ? upcoming.map(upcomingCard).join("") : `<div class="mb-empty inline"><h2>No games booked yet</h2><p>Pick a court and a time. It takes under a minute.</p><a class="btn-primary" href="./index.html#book">Book a court</a></div>`;
  $("#past").innerHTML = past.map(pastCard).join("");
  $("#past-count").textContent = past.length;
  $("#past-wrap").classList.toggle("hidden", !past.length);
  document.querySelectorAll(".bk [data-act]").forEach(el => el.onclick = () => {
    const b = bookings.find(x => x.reservationId === el.closest(".bk").dataset.id);
    if (el.dataset.act === "pay") openPayment(b);
    if (el.dataset.act === "cancel") cancelTap(b);
    if (el.dataset.act === "ics") addToCalendar(b);
    if (el.dataset.act === "rehold") holdAgain(b, el);
  });
}
/* Only the countdown text changes each second; the list is rebuilt when a hold actually runs out. */
setInterval(() => {
  let expiredNow = false;
  document.querySelectorAll(".hold-pill[data-expires]").forEach(el => {
    const left = Number(el.dataset.expires) - Date.now();
    if (left <= 0) expiredNow = true;
    el.textContent = holdText(el.dataset.expires);
    el.classList.toggle("warning", left < 300000);
    el.classList.toggle("last-call", left <= BOOKING_RULES.lastCallMs);
  });
  if (expiredNow) render();
}, 1000);

/* ---------- cancel, with 5 seconds to undo ---------- */
function slotKeysFor(b) { if (Array.isArray(b.timeKeys) && b.timeKeys.length) return b.timeKeys; const from = hourOf(b.startTime); return SLOT_TIMES.slice(from, from + Number(b.durationHours || 1)).map(slotKey); }
const UNDO_MS = 5000;
function cancelTap(b) {
  if (pendingCancel) commitCancel(); // only one pending cancel at a time
  pendingCancel = { b, timer: setTimeout(commitCancel, UNDO_MS) };
  render();
  const message = b.paymentStatus === "paid" ? "Booking cancelled. Staff will contact you about your refund." : "Booking cancelled";
  toast(message, "ok", { label: "Undo", ms: UNDO_MS, onClick: () => { if (pendingCancel?.b.reservationId !== b.reservationId) return; clearTimeout(pendingCancel.timer); pendingCancel = null; render(); toast("Kept your booking"); } });
}
/* Leaving the page doesn't lose a cancel: it's sent right away. */
addEventListener("pagehide", () => commitCancel());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") commitCancel(); });
async function commitCancel() {
  const pending = pendingCancel; if (!pending) return;
  pendingCancel = null; clearTimeout(pending.timer);
  const b = pending.b, updates = {}, ck = b.courtKey || b.court.toLowerCase().replace(" ", "-");
  slotKeysFor(b).forEach(tk => { updates[`bookings/${b.date}/${ck}/${tk}/status`] = "cancelled"; updates[`availability/${b.date}/${ck}/${tk}/status`] = "cancelled"; });
  updates[`userBookings/${user.uid}/${b.reservationId}/status`] = "cancelled";
  try {
    /* Free this booking's hold ticket, but only if the ticket still belongs to it. */
    if (b.holdSlot !== undefined && b.holdSlot !== null && !b.proofSubmittedAt) {
      const ticket = (await db.ref(`holdSlots/${user.uid}/${b.holdSlot}`).once("value")).val();
      if (ticket && ticket.rid === b.reservationId) updates[`holdSlots/${user.uid}/${b.holdSlot}`] = null;
    }
    await db.ref().update(updates);
  }
  catch (error) { console.error(error); toast("Couldn't cancel. Try again.", "error"); render(); }
}

/* ---------- hold again after a hold runs out ---------- */
async function holdAgain(b, button) {
  button.disabled = true; button.textContent = "Checking…";
  try {
    const result = await reholdSafely(db, user.uid, b, b.courtKey || b.court.toLowerCase().replace(" ", "-"), slotKeysFor(b), user.displayName || user.email);
    if (result.outcome === "reheld" || result.outcome === "held") { haptic(); toast("Held again for 30 minutes"); }
    else if (result.outcome === "noHold") toast("You already have 2 unpaid holds. Pay for or cancel one first.", "error");
    else toast("Someone else booked this time. Pick another slot.", "error");
  } catch (error) { console.error(error); toast("Couldn't hold it again. Try again.", "error"); }
  finally { button.disabled = false; button.textContent = "Hold again"; }
}

/* ---------- calendar file ---------- */

/* ---------- account ---------- */
$("#account-btn").onclick = () => $("#account-dialog").showModal();
$("#account-close").onclick = () => $("#account-dialog").close();
$("#sign-out-btn").onclick = () => auth.signOut().then(() => $("#account-dialog").close());

auth.onAuthStateChanged(current => {
  user = current;
  if (stopListener) { stopListener(); stopListener = null; }
  $("#account-btn").classList.toggle("hidden", !user);
  if (!user) { $("#loading").classList.add("hidden"); $("#content").classList.add("hidden"); $("#signed-out").classList.remove("hidden"); return; }
  $("#account-btn").textContent = initials(user.displayName || user.email || "A");
  $("#account-email").textContent = user.email;
  $("#signed-out").classList.add("hidden");
  const ref = db.ref(`userBookings/${user.uid}`);
  const onValue = snap => {
    bookings = Object.entries(snap.val() || {}).map(([id, b]) => ({ ...b, reservationId: b.reservationId || id }));
    $("#loading").classList.add("hidden"); $("#content").classList.remove("hidden");
    render();
    if (bookings.length && !$("#install-slot").dataset.wanted) renderInstallCard($("#install-slot")); // only for people who have booked
  };
  ref.on("value", onValue, error => { console.error(error); $("#loading").classList.add("hidden"); toast("Couldn't load your bookings. Try refreshing.", "error"); });
  stopListener = () => ref.off("value", onValue);
});

frostOnScroll(document.querySelector(".mb-bar"));
