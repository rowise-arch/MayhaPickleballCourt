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
let storage = null;
let currentUser = null;
let creatingAccount = false;
let isAdmin = false;
const slots = ["12:00 AM", "1:00 AM", "2:00 AM", "3:00 AM", "4:00 AM", "5:00 AM", "6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM", "11:00 PM"];
const CLOSED_DAYS = [3, 5, 0];
const PAYMENT = {
  holdMinutes: 30,
  methods: [
    { id: "gcash", label: "GCash", accountName: "Jeffrey Rouisse Factor", number: "09393593728", qr: "./gcash-qr.png" },
    { id: "maya", label: "Maya", accountName: "YOUR NAME HERE", number: "09XX XXX XXXX", qr: "./maya-qr.png" }
  ]
};
const demoBooked = new Set(["Court 1|9:00 AM", "Court 1|3:00 PM", "Court 2|10:00 AM", "Court 3|5:00 PM", "Court 4|7:00 PM"]);
let selectedCourt = "Court 1";
let selectedTime = null;
let unavailable = new Set();
let blockedSlots = new Set();
let activeReservation = null;
let paymentMethodId = PAYMENT.methods[0].id;
let stopAvailabilityListener = null;
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
function updateRateDisplay() { const weekend = isWeekend(); const day = weekend ? 160 : 120, night = weekend ? 200 : 160; document.querySelector("#rate-label").textContent = `₱${day}–₱${night} / hour`; document.querySelector("#rate-note").innerHTML = `7 AM–4 PM: ₱${day}/hr &nbsp;·&nbsp; 4 PM–7 AM: ₱${night}/hr`; }
function isPastSlot(time) { if (dateInput.value !== localDateValue()) return false; const now = new Date(); const slotStart = new Date(); slotStart.setHours(slotHour(time), 0, 0, 0); return slotStart <= now; }
function isBookedSlot(time) { return unavailable.has(time) || blockedSlots.has(time) || (!db && demoBooked.has(`${selectedCourt}|${time}`)); }
function occupiesSlot(booking) { return booking && booking.status !== "cancelled" && (booking.status !== "pending_payment" || !!booking.proofSubmittedAt || Number(booking.holdExpiresAt) > Date.now()); }
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
    storage = app.storage();
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
    accountButton.textContent = (currentUser.displayName || currentUser.email || "A").charAt(0).toUpperCase();
    document.querySelector("#account-email").textContent = currentUser.email;
    note.textContent = `Signed in as ${currentUser.email}`;
  } else {
    accountButton.textContent = "⌁";
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
  document.querySelector("#auth-submit").innerHTML = register ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  document.querySelector("#auth-switch").innerHTML = register ? "Already have an account? <button type=\"button\" id=\"switch-auth\">Sign in</button>" : "New to Mayha Courts? <button type=\"button\" id=\"switch-auth\">Create an account</button>";
  document.querySelector("#switch-auth").addEventListener("click", () => setAuthMode(!creatingAccount));
}
function renderSlots() {
  const closed = isClosedDate();
  document.querySelector("#book-btn").disabled = closed;
  document.querySelector("#time-grid").innerHTML = slots.map(time => {
    const unavailableSlot = !isSlotAvailable(time);
    return `<button class="slot ${unavailableSlot ? "booked" : ""} ${time === selectedTime ? "selected" : ""}" data-time="${time}" ${unavailableSlot ? "disabled" : ""}>${slotLabel(time)}</button>`;
  }).join("");
  document.querySelectorAll(".slot:not(.booked)").forEach(button => button.addEventListener("click", () => { selectedTime = button.dataset.time; renderSlots(); updateSummary(); }));
}
function updateSummary() {
  const empty = document.querySelector("#summary-empty"), details = document.querySelector("#summary-details");
  empty.classList.toggle("hidden", !!selectedTime); details.classList.toggle("hidden", !selectedTime);
  if (!selectedTime) return;
  document.querySelector("#summary-court").textContent = selectedCourt;
  document.querySelector("#summary-date").textContent = prettyDate(dateInput.value);
  const duration = selectedDuration();
  document.querySelector("#summary-time").textContent = `${selectedTime} – ${endTime(selectedTime, duration)}`;
  document.querySelector("#rental-label").textContent = `${duration} ${duration === 1 ? "hour" : "hours"} court rental`;
  document.querySelector("#summary-total").textContent = `₱${bookingPrice(selectedTime, duration)}`;
}
async function loadAvailability() {
  selectedTime = null; unavailable = new Set(); blockedSlots = new Set(); updateRateDisplay();
  if (isClosedDate()) { renderBlockNotice({ closed: { reason:"Courts are closed on Wednesdays, Fridays and Sundays. Please choose another date." } }); document.querySelector("#block-notice").classList.remove("hidden"); document.querySelector("#block-notice").textContent = "Courts are closed on Wednesdays, Fridays and Sundays. Please choose another date."; renderSlots(); updateSummary(); return; }
  renderSlots(); updateSummary();
  if (!db) return;
  if (stopAvailabilityListener) stopAvailabilityListener();
  const scheduleRef = db.ref(bookingPath());
  const listener = snapshot => {
    unavailable = new Set(Object.values(snapshot.val() || {}).filter(occupiesSlot).map(booking => booking.time));
    renderSlots();
  };
  scheduleRef.on("value", listener, error => console.warn("Could not load bookings from Firebase", error));
  stopAvailabilityListener = () => scheduleRef.off("value", listener);
  db.ref(`blocks/${dateInput.value}/${courtKey(selectedCourt)}`).on("value", snapshot => { const blockData = snapshot.val() || {}; blockedSlots = new Set(Object.keys(blockData).map(savedKey => slots.find(time => timeKey(time) === savedKey)).filter(Boolean)); renderBlockNotice(blockData); renderSlots(); });
}
document.querySelectorAll(".court-tab").forEach(tab => tab.addEventListener("click", () => { selectedCourt = tab.dataset.court; document.querySelectorAll(".court-tab").forEach(item => item.classList.toggle("active", item === tab)); loadAvailability(); }));
dateInput.addEventListener("change", loadAvailability);
durationInput.addEventListener("change", () => { selectedTime = null; renderSlots(); updateSummary(); });
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
  if (isClosedDate()) { alert("Courts are closed on Wednesdays, Fridays and Sundays. Please choose another date."); return; }
  if (!selectedTime) return;
  const duration = selectedDuration();
  const reservedSlots = bookingSlots(selectedTime, duration);
  if (reservedSlots.length !== duration) { alert("Choose a time that leaves enough hours before midnight."); return; }
  const phone = document.querySelector("#contact-phone").value.trim();
  if (!phone) { alert("Please enter a contact number."); return; }
  if (duration < minHoursFor(selectedTime)) { alert("Bookings starting 6 PM onwards are 4 hours."); return; }
  const button = document.querySelector("#book-btn"); button.disabled = true; button.textContent = "Saving…";
  try {
    const reservationId = `${currentUser.uid}-${Date.now()}`;
    const holdExpiresAt = Date.now() + PAYMENT.holdMinutes * 60 * 1000;
    const booking = { court:selectedCourt, date:dateInput.value, contactPhone:phone, note:document.querySelector("#booking-note").value.trim(), createdAt:new Date().toISOString(), status:"pending_payment", paymentStatus:"unpaid", holdExpiresAt, ownerUid:currentUser.uid, ownerName:currentUser.displayName || "Customer", startTime:selectedTime, durationHours:duration, totalPrice:bookingPrice(selectedTime, duration), reservationId };
    const updates = {};
    reservedSlots.forEach((slot, index) => { updates[`bookings/${dateInput.value}/${courtKey(selectedCourt)}/${timeKey(slot)}`] = { ...booking, time:slot, isPrimary:index === 0 }; });
    if (db) await db.ref().update(updates); else reservedSlots.forEach(slot => demoBooked.add(`${selectedCourt}|${slot}`));
    activeReservation = { ...booking, slots: reservedSlots };
    openPaymentDialog(activeReservation);
    loadAvailability();
  }
  catch (error) { alert(error?.code === "PERMISSION_DENIED" ? "That time was just booked by someone else." : "We couldn't save this booking. Please try again."); loadAvailability(); console.error(error); }
  finally { button.disabled = false; button.innerHTML = "Confirm booking <span>→</span>"; }
});
function renderPaymentMethod() { const method = PAYMENT.methods.find(item => item.id === paymentMethodId); const holder = document.querySelector("#payment-method-details"); holder.innerHTML = `<p><strong>${method.accountName}</strong><br /><span id="payment-number">${method.number}</span> <button class="outline" id="copy-payment-number" type="button">Copy number</button></p>`; const qr = new Image(); qr.src = method.qr; qr.alt = `${method.label} QR code`; qr.className = "payment-qr"; qr.onload = () => holder.prepend(qr); document.querySelector("#copy-payment-number").onclick = async () => { try { await navigator.clipboard.writeText(method.number); document.querySelector("#copy-payment-number").textContent = "Copied"; } catch { } }; }
function openPaymentDialog(reservation) { activeReservation = reservation; paymentMethodId = PAYMENT.methods[0].id; document.querySelector("#confirmation-text").textContent = `${reservation.court} · ${prettyDate(reservation.date)} · ${reservation.startTime} – ${endTime(reservation.startTime, reservation.durationHours)}`; document.querySelector("#payment-amount").textContent = `₱${reservation.totalPrice}`; document.querySelector("#payment-reference").value = reservation.paymentReference || ""; document.querySelector("#payment-tabs").innerHTML = PAYMENT.methods.map(method => `<button type="button" class="court-tab ${method.id === paymentMethodId ? "active" : ""}" data-method="${method.id}">${method.label}</button>`).join(""); document.querySelectorAll("#payment-tabs button").forEach(button => button.onclick = () => { paymentMethodId = button.dataset.method; document.querySelectorAll("#payment-tabs button").forEach(item => item.classList.toggle("active", item === button)); renderPaymentMethod(); }); renderPaymentMethod(); updatePaymentHold(); if (!document.querySelector("#booking-dialog").open) document.querySelector("#booking-dialog").showModal(); }
function updatePaymentHold() { if (!activeReservation) return; const remaining = Math.max(0, Math.ceil((Number(activeReservation.holdExpiresAt) - Date.now()) / 1000)); document.querySelector("#payment-hold").textContent = remaining ? `Held for you: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "This hold has expired and the slot may be taken."; }
async function compressProof(file) { if (!file || !file.type.startsWith("image/")) throw new Error("Choose an image file."); if (file.size > 5 * 1024 * 1024) throw new Error("The image must be under 5 MB."); const image = await createImageBitmap(file), scale = Math.min(1, 1280 / image.width), canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82)); }
document.querySelector("#submit-payment").addEventListener("click", async () => { const reference = document.querySelector("#payment-reference").value.trim(), errorBox = document.querySelector("#payment-error"); errorBox.classList.add("hidden"); if (!activeReservation || reference.length < 6) { errorBox.textContent = "Enter a payment reference with at least 6 characters."; errorBox.classList.remove("hidden"); return; } const button = document.querySelector("#submit-payment"); button.disabled = true; button.textContent = "Submitting…"; let proofUrl = ""; try { const file = document.querySelector("#payment-proof").files[0]; if (file && storage) { try { const blob = await compressProof(file); const result = await storage.ref(`payment-proofs/${currentUser.uid}/${activeReservation.reservationId}.jpg`).put(blob, { contentType:"image/jpeg" }); proofUrl = await result.ref.getDownloadURL(); } catch (uploadError) { document.querySelector("#payment-upload-note").textContent = "Screenshot could not be uploaded. Your reference number will still be submitted."; document.querySelector("#payment-upload-note").classList.remove("hidden"); } } const updates = {}; activeReservation.slots.forEach(slot => { const base = `bookings/${activeReservation.date}/${courtKey(activeReservation.court)}/${timeKey(slot)}`; updates[`${base}/paymentReference`] = reference; updates[`${base}/paymentMethod`] = paymentMethodId; updates[`${base}/proofSubmittedAt`] = Date.now(); if (proofUrl) updates[`${base}/proofUrl`] = proofUrl; }); await db.ref().update(updates); document.querySelector("#confirmation-text").textContent = "Payment submitted. We'll confirm your booking once staff verify it."; document.querySelector("#submit-payment").classList.add("hidden"); } catch (error) { errorBox.textContent = error.message || "We could not submit payment details."; errorBox.classList.remove("hidden"); } finally { button.disabled = false; button.innerHTML = "Submit payment <span>→</span>"; } });
document.querySelector("#dialog-close").addEventListener("click", () => document.querySelector("#booking-dialog").close());
document.querySelector("#done-btn").addEventListener("click", () => document.querySelector("#booking-dialog").close());
setInterval(updatePaymentHold, 1000);
setAuthMode(false);
renderSlots();
connectFirebase();
