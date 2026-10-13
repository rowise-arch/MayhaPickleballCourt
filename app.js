// Firebase setup. The booking controls still work in demo mode if Firebase is unavailable.

const firebaseConfig = {
  apiKey: "AIzaSyAVboExr93oDx_ClUFPp2fmcMGvOTTNbRo",
  authDomain: "mayha-courts.firebaseapp.com",
  databaseURL: "https://mayha-courts-default-rtdb.firebaseio.com",
  projectId: "mayha-courts",
  storageBucket: "mayha-courts.firebasestorage.app",
  messagingSenderId: "697040217308",
  appId: "1:697040217308:web:92d797a44fb71e97474019"
};
const firebaseReady = !Object.values(firebaseConfig).some(value => value.startsWith("YOUR_"));
let db = null;
let auth = null;
let currentUser = null;
let creatingAccount = false;
let isAdmin = false;
const slots = ["12:00 AM", "1:00 AM", "2:00 AM", "3:00 AM", "4:00 AM", "5:00 AM", "6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM", "11:00 PM"];
const CLOSED_DAYS = [3, 5, 0];
// PAYMENT and SITE live in site-config.js (shared with My Bookings).
// Put real photos in a "photos" folder: hero.jpg, court-1.jpg ... court-4.jpg. Missing photos fall back to drawings.
const COURTS = [
  { name: "Court 1", type: "Covered", photo: "./photos/court-1.jpg" },
  { name: "Court 2", type: "Open air", photo: "./photos/court-2.jpg" },
  { name: "Court 3", type: "Open air", photo: "./photos/court-3.jpg" },
  { name: "Court 4", type: "Open air", photo: "./photos/court-4.jpg" }
];
const USER_ICON = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const demoBooked = new Set(["Court 1|9:00 AM", "Court 1|3:00 PM", "Court 2|10:00 AM", "Court 3|5:00 PM", "Court 4|7:00 PM"]);
let selectedCourt = "Court 1";
let selectedTime = null;
let unavailable = new Set();
let blockedSlots = new Set();
let activeReservation = null;
let paymentMethodId = PAYMENT.methods[0].id;
let stopAvailabilityListener = null;
let dayBookings = {};
let dayBlocks = {};
const loadedPhotos = {};
const dateInput = document.querySelector("#booking-date");
const durationInput = document.querySelector("#duration");
function localDateValue() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function dateAsLocal(value) { return new Date(`${value}T12:00:00`); }
function isClosedDate(value = dateInput.value) { return CLOSED_DAYS.includes(dateAsLocal(value).getDay()); }
function nextOpenDate(value = localDateValue()) { const next = dateAsLocal(value); while (CLOSED_DAYS.includes(next.getDay())) next.setDate(next.getDate() + 1); return next.toISOString().slice(0, 10); }
dateInput.min = localDateValue();
dateInput.value = nextOpenDate();

function prettyDate(value) { return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", { weekday:"long", month:"long", day:"numeric" }); }
function courtKey(court) { return court.toLowerCase().replaceAll(" ", "-"); }
function timeKey(time) { return time.replaceAll(":", "-").replaceAll(" ", "-").toLowerCase(); }
function slotHour(time) { const [clock, meridiem] = time.split(" "); let hour = Number(clock.split(":")[0]); if (meridiem === "PM" && hour !== 12) hour += 12; if (meridiem === "AM" && hour === 12) hour = 0; return hour; }
function endTime(time, duration = 1) { return slots[(slots.indexOf(time) + duration) % slots.length]; }
function slotLabel(time) { return `${time} – ${endTime(time)}`; }
function selectedDuration() { return Number(durationInput.value); }
function bookingSlots(time, duration = selectedDuration()) { const start = slots.indexOf(time); return start < 0 ? [] : slots.slice(start, start + duration); }
function minHoursFor(time) { const hour = slotHour(time); return hour >= 18 || hour < 7 ? 4 : 2; }
function isWeekend(value = dateInput.value) { const day = dateAsLocal(value).getDay(); return day === 5 || day === 6 || day === 0; }
function hourlyRate(time, value = dateInput.value) { const hour = slotHour(time), weekend = isWeekend(value); return hour >= 7 && hour < 16 ? (weekend ? 160 : 120) : (weekend ? 200 : 160); }
function bookingPrice(time, duration = selectedDuration()) { return bookingSlots(time, duration).reduce((total, slot) => total + hourlyRate(slot), 0); }
function dayRates(value = dateInput.value) { const weekend = isWeekend(value); return { day: weekend ? 160 : 120, night: weekend ? 200 : 160 }; }
function updateRateDisplay() { renderDateStrip(); }
function isPastSlot(time) { if (dateInput.value !== localDateValue()) return false; const now = new Date(); const slotStart = new Date(); slotStart.setHours(slotHour(time), 0, 0, 0); return slotStart <= now; }
function isBookedSlot(time) { return unavailable.has(time) || blockedSlots.has(time) || (!db && demoBooked.has(`${selectedCourt}|${time}`)); }
function occupiesSlot(booking) { return occupies(booking); }
function renderBlockNotice(data) {
  const notice = document.querySelector("#block-notice");
  const entries = Object.entries(data || {}).map(([savedKey, detail]) => ({ time:slots.find(time => timeKey(time) === savedKey), reason:detail.reason || "Court unavailable" })).filter(item => item.time);
  if (!entries.length) { notice.classList.add("hidden"); notice.innerHTML = ""; return; }
  const groups = entries.reduce((result, item) => { (result[item.reason] ||= []).push(item.time); return result; }, {});
  notice.innerHTML = Object.entries(groups).map(([reason, times]) => {
    const ordered = times.sort((a, b) => slots.indexOf(a) - slots.indexOf(b));
    const start = ordered[0], end = endTime(ordered[ordered.length - 1]);
    return `<div><strong>${start} – ${end}</strong> · ${reason}</div>`;
  }).join("");
  notice.classList.remove("hidden");
}
function isSlotAvailable(time) { const range = bookingSlots(time); return !isClosedDate() && selectedDuration() >= minHoursFor(time) && range.length === selectedDuration() && range.every(slot => !isPastSlot(slot) && !isBookedSlot(slot)); }
function bookingPath() { return `bookings/${dateInput.value}/${courtKey(selectedCourt)}`; }
async function connectFirebase() {
  if (!firebaseReady) return;
  try {
    if (!window.firebase) throw new Error("Firebase SDK did not load");
    const app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(firebaseConfig);
    db = app.database();
    auth = app.auth();
    auth.onAuthStateChanged(user => {
      currentUser = user;
      isAdmin = false;
      updateAccountUi();
      if (user) {
        loadAvailability();
        db.ref(`admins/${user.uid}`).once("value").then(snapshot => {
          isAdmin = snapshot.val() === true;
          if (isAdmin) window.location.replace("./admin.html");
          else updateAccountUi();
        });
      } else if (!document.querySelector("#account-dialog").open) document.querySelector("#account-dialog").showModal();
    });
  } catch (error) {
    console.warn("Firebase could not be reached; running in local demo mode.", error);
  }
}
function updateAccountUi() {
  const accountButton = document.querySelector("#account-btn");
  const note = document.querySelector("#login-note");
  document.querySelector("#auth-panel").classList.toggle("hidden", !!currentUser);
  document.querySelector("#signed-in-panel").classList.toggle("hidden", !currentUser);
  document.querySelector("#admin-link").classList.toggle("hidden", !isAdmin);
  if (currentUser) {
    accountButton.textContent = initials(currentUser.displayName || currentUser.email || "A");
    document.querySelector("#account-email").textContent = currentUser.email;
    note.textContent = `Signed in as ${currentUser.email}`;
  } else {
    accountButton.innerHTML = USER_ICON;
    note.textContent = "Create an account to reserve your slot.";
  }
}
function showAccountDialog() {
  const dialog = document.querySelector("#account-dialog");
  if (!dialog.open) dialog.showModal();
}
function setAuthMode(register) {
  creatingAccount = register;
  document.querySelector("#auth-title").textContent = register ? "Create your account" : "Welcome back";
  document.querySelector("#auth-intro").textContent = register ? "Save your bookings and get ready to play." : "Sign in to manage your court bookings.";
  document.querySelector("#name-field").classList.toggle("hidden", !register);
  document.querySelector("#auth-password").autocomplete = register ? "new-password" : "current-password";
  document.querySelector("#auth-submit").textContent = register ? "Create account" : "Sign in";
  document.querySelector("#auth-switch").innerHTML = register ? "Already have an account? <button type=\"button\" id=\"switch-auth\">Sign in</button>" : "New to Mayha Square Pickleball Court? <button type=\"button\" id=\"switch-auth\">Create an account</button>";
  document.querySelector("#switch-auth").addEventListener("click", () => setAuthMode(!creatingAccount));
}
const SLOT_GROUPS = [
  { name: "Early morning", from: 0, to: 7, hours: "12 AM – 7 AM", rate: "night", note: "4-hour bookings" },
  { name: "Daytime", from: 7, to: 16, hours: "7 AM – 4 PM", rate: "day" },
  { name: "Evening", from: 16, to: 24, hours: "4 PM – 12 AM", rate: "night", note: "4 hours from 6 PM" }
];
function slotState(time) {
  if (isClosedDate()) return { kind: "closed", text: "Closed" };
  if (isBookedSlot(time)) return { kind: "booked", text: blockedSlots.has(time) ? "Unavailable" : "Booked" };
  const range = bookingSlots(time);
  const firstTaken = range.findIndex(slot => isBookedSlot(slot));
  if (firstTaken > 0) return { kind: "short", text: `${firstTaken} hr free` };
  if (range.length !== selectedDuration()) return { kind: "short", text: "Past midnight" };
  if (selectedDuration() < minHoursFor(time)) return { kind: "short", text: "4 hrs only" };
  return { kind: "open", text: `₱${bookingPrice(time)}` };
}
function shortTime(time) { return time.replace(":00", ""); }
function renderSlots() {
  document.querySelector("#book-btn").disabled = isClosedDate();
  const rates = dayRates();
  const groups = SLOT_GROUPS.map(group => {
    const times = slots.filter(time => { const hour = slotHour(time); return hour >= group.from && hour < group.to && !isPastSlot(time); });
    if (!times.length) return "";
    const buttons = times.map(time => {
      const state = slotState(time), open = state.kind === "open", picked = time === selectedTime;
      return `<button type="button" class="slot ${open ? "" : `booked ${state.kind}`} ${picked ? "selected" : ""}" data-time="${time}" ${open ? "" : "disabled"} aria-pressed="${picked}"><b>${shortTime(time)}</b><small>${state.text}</small></button>`;
    }).join("");
    return `<section class="slot-group"><header><strong>${group.name}</strong><span>${group.hours} · ₱${rates[group.rate]}/hr${group.note ? ` · ${group.note}` : ""}</span></header><div class="time-grid">${buttons}</div></section>`;
  }).join("");
  document.querySelector("#time-grid").innerHTML = groups || `<p class="slots-empty">No start times left today. Pick another date.</p>`;
  document.querySelectorAll(".slot:not(.booked)").forEach(button => button.addEventListener("click", () => { selectedTime = button.dataset.time; clearBookingError(); renderSlots(); updateSummary(); }));
}
function renderDateStrip() {
  const strip = document.querySelector("#date-strip"), start = dateAsLocal(localDateValue());
  const days = Array.from({ length: 14 }, (_, offset) => { const day = new Date(start); day.setDate(start.getDate() + offset); return day; });
  strip.innerHTML = days.map(day => {
    const value = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const closed = isClosedDate(value), active = value === dateInput.value;
    return `<button type="button" class="day-chip ${active ? "active" : ""}" data-date="${value}" ${closed ? "disabled" : ""} aria-pressed="${active}" aria-label="${day.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" })}${closed ? ", closed" : ""}"><span>${day.toLocaleDateString("en-PH", { weekday: "short" })}</span><b>${day.getDate()}</b><small>${closed ? "Closed" : day.toLocaleDateString("en-PH", { month: "short" })}</small></button>`;
  }).join("");
  strip.querySelectorAll(".day-chip:not(:disabled)").forEach(chip => chip.addEventListener("click", () => { if (dateInput.value === chip.dataset.date) return; dateInput.value = chip.dataset.date; loadAvailability(); }));
  const active = strip.querySelector(".day-chip.active");
  if (active) strip.scrollLeft = Math.max(0, active.offsetLeft - strip.offsetLeft - 8);
}
function courtVisual(court, extraClass = "") {
  const info = COURTS.find(item => item.name === court) || COURTS[0];
  const photo = loadedPhotos[info.photo] === true;
  return `<div class="court-visual ${info.type === "Covered" ? "covered" : ""} ${photo ? "has-photo" : ""} ${extraClass}" ${photo ? `style="--photo:url('${info.photo}')"` : ""} aria-hidden="true"><i class="kitchen"></i><i class="net"></i><span>${court.replace("Court ", "")}</span></div>`;
}
function openHoursFor(court) {
  const key = courtKey(court);
  const taken = new Set(Object.entries(dayBookings[key] || {}).filter(([, row]) => occupiesSlot(row)).map(([saved]) => slots.find(time => timeKey(time) === saved)).filter(Boolean));
  Object.keys(dayBlocks[key] || {}).forEach(saved => { const time = slots.find(item => timeKey(item) === saved); if (time) taken.add(time); });
  if (!db) demoBooked.forEach(entry => { const [name, time] = entry.split("|"); if (name === court) taken.add(time); });
  return slots.filter(time => !isPastSlot(time) && !taken.has(time)).length;
}
function renderCourtCards() {
  const holder = document.querySelector("#court-cards"); if (!holder) return;
  const rates = dayRates(), known = !db || !!currentUser;
  const dayName = dateAsLocal(dateInput.value).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
  holder.innerHTML = COURTS.map(court => {
    const hours = known && !isClosedDate() ? openHoursFor(court.name) : null;
    const availability = isClosedDate() ? "Closed this day" : hours === null ? "Sign in to see open times" : hours ? `${hours} open hour${hours === 1 ? "" : "s"} on ${dayName}` : `Fully booked on ${dayName}`;
    return `<article class="court-card">${courtVisual(court.name)}<div class="court-card-body"><div class="court-card-title"><h3>${court.name}</h3><span class="court-type ${court.type === "Covered" ? "covered" : ""}">${court.type}</span></div><p class="court-availability">${availability}</p><p class="court-price">₱${rates.day}–₱${rates.night} per hour</p><button type="button" class="court-card-btn" data-court="${court.name}">Book ${court.name}</button></div></article>`;
  }).join("");
  holder.querySelectorAll(".court-card-btn").forEach(button => button.addEventListener("click", () => {
    selectCourt(button.dataset.court);
    document.querySelector("#book").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));
}
function selectCourt(court) {
  selectedCourt = court; selectedTime = null; clearBookingError();
  document.querySelectorAll(".court-tab").forEach(item => { const active = item.dataset.court === court; item.classList.toggle("active", active); item.setAttribute("aria-selected", active); });
  applyDayData();
}
function loadPhoto(src, done) { if (loadedPhotos[src] !== undefined) return; loadedPhotos[src] = false; const image = new Image(); image.onload = () => { loadedPhotos[src] = true; done(); }; image.src = src; }
function initials(text) {
  const words = String(text).split("@")[0].trim().split(/[\s._-]+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] || "A"];
  return picked.map(word => Array.from(word)[0]).join("").toUpperCase();
}
function showBookingError(message, withLink = false) { const box = document.querySelector("#booking-error"); if (document.querySelector("#confirm-bar")?.classList.contains("show")) box.closest(".summary-card")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); box.textContent = message; if (withLink) box.insertAdjacentHTML("beforeend", ' <a href="./my-bookings.html">Open My bookings</a>'); box.classList.remove("hidden"); }
function clearBookingError() { document.querySelector("#booking-error").classList.add("hidden"); document.querySelector("#phone-error").classList.add("hidden"); document.querySelector("#phone-field").classList.remove("invalid"); }
function showPhoneError(message) {
  const field = document.querySelector("#phone-field"), error = document.querySelector("#phone-error");
  error.textContent = message; error.classList.remove("hidden"); field.classList.add("invalid");
  field.querySelector("input").focus();
}
/* Phones: a floating bar with the picked time, shown while the summary card is off screen. */
let summaryOnScreen = false;
function updateConfirmBar() {
  const bar = document.querySelector("#confirm-bar"); if (!bar) return;
  const show = !!selectedTime && !summaryOnScreen && !document.querySelector("#booking-dialog").open;
  if (selectedTime) {
    const day = new Date(`${dateInput.value}T12:00:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
    const duration = selectedDuration();
    document.querySelector("#cb-title").textContent = `${selectedCourt} · ${day}`;
    document.querySelector("#cb-sub").textContent = `${selectedTime.replace(":00", "")} – ${endTime(selectedTime, duration).replace(":00", "")} · ₱${bookingPrice(selectedTime, duration)}`;
  }
  bar.classList.toggle("show", show); bar.setAttribute("aria-hidden", String(!show));
  document.body.classList.toggle("has-confirm-bar", show);
}
function updateSummary() {
  queueMicrotask(updateConfirmBar);
  const empty = document.querySelector("#summary-empty"), details = document.querySelector("#summary-details");
  empty.classList.toggle("hidden", !!selectedTime); details.classList.toggle("hidden", !selectedTime);
  if (!selectedTime) return;
  document.querySelector("#summary-court").textContent = selectedCourt;
  document.querySelector("#summary-visual").innerHTML = courtVisual(selectedCourt);
  document.querySelector("#summary-date").textContent = prettyDate(dateInput.value);
  const duration = selectedDuration();
  document.querySelector("#summary-time").textContent = `${selectedTime} – ${endTime(selectedTime, duration)}`;
  document.querySelector("#rental-label").textContent = `${duration} ${duration === 1 ? "hour" : "hours"} court rental`;
  document.querySelector("#summary-total").textContent = `₱${bookingPrice(selectedTime, duration)}`;
}
function applyDayData() {
  const key = courtKey(selectedCourt);
  unavailable = new Set(Object.entries(dayBookings[key] || {}).filter(([, row]) => occupiesSlot(row)).map(([saved]) => slots.find(time => timeKey(time) === saved)).filter(Boolean));
  const blockData = dayBlocks[key] || {};
  blockedSlots = new Set(Object.keys(blockData).map(saved => slots.find(time => timeKey(time) === saved)).filter(Boolean));
  if (isClosedDate()) { const notice = document.querySelector("#block-notice"); notice.textContent = "Online booking is closed on Wednesdays, Fridays and Sundays. Pick another date."; notice.classList.remove("hidden"); }
  else renderBlockNotice(blockData);
  if (selectedTime && slotState(selectedTime).kind !== "open") selectedTime = null;
  renderSlots(); updateSummary(); renderCourtCards();
}
async function loadAvailability() {
  selectedTime = null; unavailable = new Set(); blockedSlots = new Set(); dayBookings = {}; dayBlocks = {};
  clearBookingError(); updateRateDisplay();
  if (stopAvailabilityListener) { stopAvailabilityListener(); stopAvailabilityListener = null; }
  applyDayData();
  if (!db || !currentUser || isClosedDate()) return;
  const date = dateInput.value, bookingsRef = db.ref(`availability/${date}`), blocksRef = db.ref(`blocks/${date}`);
  const onBookings = snapshot => { if (date !== dateInput.value) return; dayBookings = snapshot.val() || {}; applyDayData(); };
  const onBlocks = snapshot => { if (date !== dateInput.value) return; dayBlocks = snapshot.val() || {}; applyDayData(); };
  bookingsRef.on("value", onBookings, error => console.warn("Could not load bookings from Firebase", error));
  blocksRef.on("value", onBlocks, error => console.warn("Could not load blocks from Firebase", error));
  stopAvailabilityListener = () => { bookingsRef.off("value", onBookings); blocksRef.off("value", onBlocks); };
}
document.querySelectorAll(".court-tab").forEach(tab => { tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", tab.classList.contains("active")); tab.addEventListener("click", () => selectCourt(tab.dataset.court)); });
document.querySelector("#contact-phone").addEventListener("input", () => { document.querySelector("#phone-error").classList.add("hidden"); document.querySelector("#phone-field").classList.remove("invalid"); });
durationInput.addEventListener("change", () => { const keep = selectedTime; selectedTime = null; if (keep && slotState(keep).kind === "open") selectedTime = keep; clearBookingError(); renderSlots(); updateSummary(); });
document.querySelector("#account-btn").addEventListener("click", showAccountDialog);
document.querySelector("#auth-close").addEventListener("click", () => document.querySelector("#account-dialog").close());
document.querySelector("#account-close").addEventListener("click", () => document.querySelector("#account-dialog").close());
document.querySelector("#sign-out-btn").addEventListener("click", () => auth.signOut().then(() => document.querySelector("#account-dialog").close()));
document.querySelector("#auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const errorBox = document.querySelector("#auth-error");
  const submit = document.querySelector("#auth-submit");
  errorBox.classList.add("hidden");
  if (!auth) { errorBox.textContent = "Firebase is unavailable. Check your internet connection and try again."; errorBox.classList.remove("hidden"); return; }
  submit.disabled = true;
  try {
    const email = document.querySelector("#auth-email").value.trim();
    const password = document.querySelector("#auth-password").value;
    if (creatingAccount) {
      const credential = await auth.createUserWithEmailAndPassword(email, password);
      const name = document.querySelector("#auth-name").value.trim();
      if (name) await credential.user.updateProfile({ displayName:name });
    } else await auth.signInWithEmailAndPassword(email, password);
    document.querySelector("#account-dialog").close();
    document.querySelector("#auth-form").reset();
  } catch (error) {
    const messages = { "auth/email-already-in-use":"An account already exists with this email. Please sign in.", "auth/invalid-email":"Enter a valid email address.", "auth/weak-password":"Use a password with at least 6 characters.", "auth/invalid-credential":"Email or password is incorrect." };
    errorBox.textContent = messages[error.code] || "We couldn't complete that request. Please try again.";
    errorBox.classList.remove("hidden");
  } finally { submit.disabled = false; }
});
document.querySelector("#book-btn").addEventListener("click", async () => {
  if (!currentUser) { showAccountDialog(); return; }
  clearBookingError();
  if (isClosedDate()) { showBookingError("Online booking is closed on Wednesdays, Fridays and Sundays. Pick another date."); return; }
  if (!selectedTime) return;
  const duration = selectedDuration();
  const reservedSlots = bookingSlots(selectedTime, duration);
  if (reservedSlots.length !== duration) { showBookingError("That booking would run past midnight. Pick an earlier start time."); return; }
  const phone = document.querySelector("#contact-phone").value.trim();
  if (!phone) { showPhoneError("Add a number so staff can reach you."); return; }
  if (phone.replace(/\D/g, "").length < 10) { showPhoneError("That number looks too short."); return; }
  if (duration < minHoursFor(selectedTime)) { showBookingError("Bookings that start from 6 PM to 6 AM are 4 hours. Switch play time to 4 hours."); return; }
  const button = document.querySelector("#book-btn"); button.disabled = true; button.textContent = "Saving…";
  try {
    const ticket = db ? await freeHoldSlot(db, currentUser.uid) : "0";
    if (ticket === null) { showBookingError("You already have 2 unpaid holds. Pay for or cancel one in My bookings first.", true); return; }
    const reservationId = `${currentUser.uid}-${Date.now()}`;
    const holdExpiresAt = Date.now() + PAYMENT.holdMinutes * 60 * 1000;
    const booking = { court:selectedCourt, date:dateInput.value, contactPhone:phone, note:document.querySelector("#booking-note").value.trim(), createdAt:new Date().toISOString(), status:"pending_payment", paymentStatus:"unpaid", holdExpiresAt, ownerUid:currentUser.uid, ownerName:currentUser.displayName || "Customer", startTime:selectedTime, durationHours:duration, totalPrice:bookingPrice(selectedTime, duration), reservationId, holdSlot: ticket };
    const keysForHold = reservedSlots.map(timeKey);
    if (db) await db.ref().update(holdUpdates(currentUser.uid, booking, courtKey(selectedCourt), keysForHold)); else reservedSlots.forEach(slot => demoBooked.add(`${selectedCourt}|${slot}`));
    activeReservation = { ...booking, slots: reservedSlots, courtKey: courtKey(selectedCourt), timeKeys: keysForHold };
    haptic();
    openPaymentDialog(activeReservation);
    loadAvailability();
  }
  catch (error) { const message = error?.code === "PERMISSION_DENIED" ? "Someone just took that time. Pick another slot." : "We couldn't save this booking. Check your connection and try again."; loadAvailability(); showBookingError(message); console.error(error); }
  finally { button.disabled = false; button.innerHTML = "Confirm booking <span>→</span>"; }
});
function renderPaymentMethod() { const method = PAYMENT.methods.find(item => item.id === paymentMethodId); const holder = document.querySelector("#payment-method-details"); holder.innerHTML = `<img class="payment-qr" src="${method.qr}" alt="${method.label} QR code" /><strong>${method.accountName}</strong><span id="payment-number">${method.number}</span><button id="copy-payment-number" type="button">⧉ <span>Copy number</span></button><p>Scan the QR in your ${method.label} app, or send to the number above.</p>`; const qr = holder.querySelector("img"); qr.onerror = () => { qr.remove(); }; const copy = document.querySelector("#copy-payment-number"); copy.onclick = async () => { try { if (navigator.clipboard) await navigator.clipboard.writeText(method.number); else { const area=document.createElement("textarea"); area.value=method.number; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); } copy.querySelector("span").textContent = "Copied ✓"; setTimeout(() => copy.querySelector("span").textContent = "Copy number", 2000); } catch { } }; }
function openPaymentDialog(reservation) { activeReservation = reservation; paymentMethodId = PAYMENT.methods[0].id; document.querySelector("#payment-court").textContent = reservation.court; document.querySelector("#payment-date").textContent = new Date(`${reservation.date}T12:00:00`).toLocaleDateString("en-PH", {weekday:"short",month:"short",day:"numeric"}); document.querySelector("#payment-time").textContent = `${reservation.startTime} – ${endTime(reservation.startTime, reservation.durationHours)}`; document.querySelector("#payment-amount").textContent = `₱${reservation.totalPrice}`; document.querySelector("#payment-reference").value = reservation.paymentReference || ""; document.querySelector("#payment-submitted").classList.add("hidden"); ["#payment-summary", ".payment-due", "#payment-tabs", ".payment-qr-card", "#payment-helper"].forEach(sel => document.querySelector(sel)?.classList.remove("hidden")); document.querySelectorAll("#payment-modal-body .payment-field").forEach(el => el.classList.remove("hidden")); document.querySelector("#submit-payment").classList.remove("hidden"); setPaymentAlert("", ""); document.querySelector("#payment-footer").classList.remove("hidden"); document.querySelector("#payment-tabs").innerHTML = PAYMENT.methods.map(method => `<button type="button" role="tab" aria-selected="${method.id === paymentMethodId}" class="${method.id === paymentMethodId ? "active" : ""}" data-method="${method.id}">${method.label}</button>`).join(""); document.querySelectorAll("#payment-tabs button").forEach(button => button.onclick = () => { paymentMethodId = button.dataset.method; document.querySelectorAll("#payment-tabs button").forEach(item => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-selected", active); }); renderPaymentMethod(); }); renderPaymentMethod(); updatePaymentHold(); updateSubmitState(); const sheet = document.querySelector("#booking-dialog"); prepareSheet(sheet); if (!sheet.open) sheet.showModal(); updateConfirmBar(); }
function setPaymentAlert(kind, html) {
  const alert = document.querySelector("#payment-alert"), body = document.querySelector("#payment-modal-body");
  alert.className = `payment-alert ${kind || ""} ${kind ? "" : "hidden"}`; alert.innerHTML = html || "";
  body.classList.toggle("payment-paused", kind === "expired" || kind === "taken");
  const hold = alert.querySelector("[data-hold-again]"); if (hold) hold.onclick = holdAgain;
}
function updatePaymentHold() {
  if (!activeReservation) return;
  const pill = document.querySelector("#payment-hold");
  if (activeReservation.proofSubmittedAt) { pill.textContent = "Payment sent"; pill.className = "payment-hold"; return; }
  if (activeReservation.lost) return;
  const left = Number(activeReservation.holdExpiresAt) - Date.now(), remaining = Math.max(0, Math.ceil(left / 1000));
  pill.classList.toggle("warning", remaining > 0 && remaining < 300); pill.classList.toggle("expired", !remaining);
  pill.textContent = remaining ? `● Held for you · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Hold expired";
  const alertKind = document.querySelector("#payment-alert").classList;
  if (!remaining && !alertKind.contains("expired") && !alertKind.contains("taken")) setPaymentAlert("expired", "<strong>Your hold ran out.</strong> Don't send money yet. Hold the slot again first. If you've already paid, enter your reference below. <button type=\"button\" class=\"alert-btn\" data-hold-again>Hold again</button>");
  else if (remaining && left <= BOOKING_RULES.lastCallMs && !alertKind.contains("last-call")) setPaymentAlert("last-call", "<strong>Time's almost up.</strong> Don't send money now. When the timer ends, tap Hold again for a fresh 30 minutes.");
  else if (left > BOOKING_RULES.lastCallMs && !alertKind.contains("hidden")) setPaymentAlert("", "");
}
async function holdAgain(event) {
  const button = event.currentTarget; button.disabled = true; button.textContent = "Checking…";
  try {
    const result = await reholdSafely(db, currentUser.uid, activeReservation, activeReservation.courtKey, activeReservation.timeKeys, currentUser.displayName || currentUser.email);
    if (result.outcome === "reheld" || result.outcome === "held") { if (result.holdExpiresAt) Object.assign(activeReservation, { holdExpiresAt: result.holdExpiresAt, holdSlot: result.holdSlot }); setPaymentAlert("", ""); updatePaymentHold(); loadAvailability(); }
    else if (result.outcome === "noHold") setPaymentAlert("taken", "<strong>You have 2 other unpaid holds.</strong> Pay for or cancel one in <a href=\"./my-bookings.html\">My bookings</a>, then try again.");
    else { activeReservation.lost = true; setPaymentAlert("taken", "<strong>Someone else booked this slot.</strong> Don't send money. Close this and pick another time."); }
  } catch (error) { console.error(error); button.disabled = false; button.textContent = "Hold again"; }
}
function updateSubmitState() { document.querySelector("#submit-payment").disabled = document.querySelector("#payment-reference").value.trim().length < 6; }
document.querySelector("#submit-payment").addEventListener("click", async () => {
  const reference = document.querySelector("#payment-reference").value.trim(), errorBox = document.querySelector("#payment-error");
  errorBox.classList.add("hidden");
  if (!activeReservation || reference.length < 6) { errorBox.textContent = "Enter a payment reference with at least 6 characters."; errorBox.classList.remove("hidden"); return; }
  const button = document.querySelector("#submit-payment"); button.disabled = true; button.textContent = "Checking your slot…";
  let hasProof = false;
  try {
    const file = document.querySelector("#payment-proof").files[0];
    if (file && db) { button.textContent = "Saving screenshot…"; try { hasProof = await saveProof(db, currentUser.uid, activeReservation.reservationId, file); } catch (proofError) { console.warn(proofError); document.querySelector("#payment-upload-note").textContent = "Your screenshot couldn't be saved, but your reference number will still be sent."; document.querySelector("#payment-upload-note").classList.remove("hidden"); } button.textContent = "Checking your slot…"; }
    const payment = { reference, method: paymentMethodId, hasProof, name: currentUser.displayName || currentUser.email };
    const result = await submitPaymentSafely(db, currentUser.uid, activeReservation, activeReservation.courtKey, activeReservation.timeKeys, payment);
    if (result.outcome === "noHold") { errorBox.innerHTML = "Your hold ran out and you already have 2 other unpaid holds. Cancel one in <a href=\"./my-bookings.html\">My bookings</a>, then submit again."; errorBox.classList.remove("hidden"); return; }
    if (result.outcome === "cancelled") { errorBox.textContent = "This booking was cancelled, so we can't take a payment for it."; errorBox.classList.remove("hidden"); return; }
    const done = document.querySelector("#payment-submitted");
    if (result.outcome === "lost") {
      done.querySelector("strong").textContent = "Slot was taken";
      document.querySelector("#confirmation-text").textContent = `Your hold ran out and someone else booked this time before your payment came through. We've saved your reference, and staff will refund ₱${activeReservation.totalPrice}.`;
    } else {
      activeReservation.proofSubmittedAt = Date.now(); activeReservation.reviewExpiresAt = result.reviewExpiresAt;
      done.querySelector("strong").textContent = "Payment submitted";
      document.querySelector("#confirmation-text").textContent = `Staff will check your payment and confirm by ${new Date(result.reviewExpiresAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}. You'll see it in My bookings.`;
    }
    if (result.outcome !== "lost") haptic();
    setPaymentAlert("", ""); updatePaymentHold();
    ["#payment-summary", ".payment-due", "#payment-tabs", ".payment-qr-card", "#payment-helper"].forEach(sel => document.querySelector(sel)?.classList.add("hidden"));
    document.querySelectorAll("#payment-modal-body .payment-field").forEach(el => el.classList.add("hidden"));
    done.classList.remove("hidden"); button.classList.add("hidden"); loadAvailability();
  } catch (error) { console.error(error); errorBox.textContent = "We couldn't send your payment details. Check your connection and try again."; errorBox.classList.remove("hidden"); }
  finally { button.disabled = false; button.textContent = "Submit payment"; }
});
document.querySelector("#dialog-close").addEventListener("click", () => document.querySelector("#booking-dialog").close());
document.querySelector("#done-btn").addEventListener("click", () => document.querySelector("#booking-dialog").close());
setInterval(updatePaymentHold, 1000);
document.querySelector("#payment-reference").addEventListener("input", updateSubmitState);
document.querySelector("#payment-reference").addEventListener("focus", event => event.target.scrollIntoView({ block:"center", behavior:"smooth" }));
document.querySelector("#payment-proof").addEventListener("change", event => { const preview = document.querySelector("#proof-preview"), file = event.target.files[0]; if (!file) { preview.classList.add("hidden"); preview.innerHTML = ""; return; } if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) { document.querySelector("#payment-error").textContent = "Use a JPG or PNG image under 15 MB."; document.querySelector("#payment-error").classList.remove("hidden"); event.target.value = ""; return; } const url = URL.createObjectURL(file); preview.innerHTML = `<img src="${url}" alt="Selected screenshot" /><span>${file.name}<small>${Math.ceil(file.size / 1024)} KB</small></span><button type="button">Remove</button>`; preview.classList.remove("hidden"); preview.querySelector("button").onclick = () => { URL.revokeObjectURL(url); event.target.value = ""; preview.classList.add("hidden"); preview.innerHTML = ""; }; });
function initConfirmBar() {
  const card = document.querySelector(".summary-card");
  if (card && "IntersectionObserver" in window) new IntersectionObserver(entries => { summaryOnScreen = entries[0].isIntersecting; updateConfirmBar(); }, { threshold: 0.35 }).observe(card);
  document.querySelector("#cb-confirm")?.addEventListener("click", () => document.querySelector("#book-btn").click());
  document.querySelector("#booking-dialog").addEventListener("close", updateConfirmBar);
}
function initSite() {
  frostOnScroll(document.querySelector(".topbar"));
  initConfirmBar();
  if (SITE.address) document.querySelector("#footer-address").textContent = SITE.address;
  document.querySelector("#footer-directions").href = mapsUrl();
  if (SITE.phone) { const link = document.querySelector("#footer-phone"); link.textContent = SITE.phone; link.href = `tel:${SITE.phone.replace(/[^\d+]/g, "")}`; link.classList.remove("hidden"); }
  const hero = document.querySelector("#hero-art");
  loadPhoto(hero.dataset.photo, () => { hero.style.setProperty("--photo", `url('${hero.dataset.photo}')`); hero.classList.add("has-photo"); });
  COURTS.forEach(court => loadPhoto(court.photo, () => { renderCourtCards(); updateSummary(); }));
}
setAuthMode(false);
initSite();
updateAccountUi();
loadAvailability();
connectFirebase();
