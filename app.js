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
const slots = ["7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM"];
const demoBooked = new Set(["Court 1|9:00 AM", "Court 1|3:00 PM", "Court 2|10:00 AM", "Court 3|5:00 PM", "Court 4|7:00 PM"]);
let selectedCourt = "Court 1";
let selectedTime = null;
let unavailable = new Set();
let stopAvailabilityListener = null;
const dateInput = document.querySelector("#booking-date");
dateInput.min = new Date().toISOString().slice(0, 10);
dateInput.value = dateInput.min;

function prettyDate(value) { return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", { weekday:"long", month:"long", day:"numeric" }); }
function courtKey(court) { return court.toLowerCase().replaceAll(" ", "-"); }
function timeKey(time) { return time.replaceAll(":", "-").replaceAll(" ", "-").toLowerCase(); }
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
      loadAvailability();
      if (user) db.ref(`admins/${user.uid}`).once("value").then(snapshot => {
        isAdmin = snapshot.val() === true;
        if (isAdmin) window.location.replace("./admin.html");
        else updateAccountUi();
      });
      if (!user && !document.querySelector("#account-dialog").open) document.querySelector("#account-dialog").showModal();
    });
    loadAvailability();
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
  document.querySelector("#time-grid").innerHTML = slots.map(time => {
    const unavailableSlot = unavailable.has(time) || (!firebaseReady && demoBooked.has(`${selectedCourt}|${time}`));
    return `<button class="slot ${unavailableSlot ? "booked" : ""} ${time === selectedTime ? "selected" : ""}" data-time="${time}" ${unavailableSlot ? "disabled" : ""}>${time}</button>`;
  }).join("");
  document.querySelectorAll(".slot:not(.booked)").forEach(button => button.addEventListener("click", () => { selectedTime = button.dataset.time; renderSlots(); updateSummary(); }));
}
function updateSummary() {
  const empty = document.querySelector("#summary-empty"), details = document.querySelector("#summary-details");
  empty.classList.toggle("hidden", !!selectedTime); details.classList.toggle("hidden", !selectedTime);
  if (!selectedTime) return;
  document.querySelector("#summary-court").textContent = selectedCourt;
  document.querySelector("#summary-date").textContent = prettyDate(dateInput.value);
  document.querySelector("#summary-time").textContent = `${selectedTime} – ${slots[slots.indexOf(selectedTime) + 1] || "8:00 PM"}`;
  document.querySelector("#summary-players").textContent = `${document.querySelector("#players").value} players`;
}
async function loadAvailability() {
  selectedTime = null; unavailable = new Set(); renderSlots(); updateSummary();
  if (!db) return;
  if (stopAvailabilityListener) stopAvailabilityListener();
  const scheduleRef = db.ref(bookingPath());
  const listener = snapshot => {
    unavailable = new Set(Object.values(snapshot.val() || {}).map(booking => booking.time));
    renderSlots();
  };
  scheduleRef.on("value", listener, error => console.warn("Could not load bookings from Firebase", error));
  stopAvailabilityListener = () => scheduleRef.off("value", listener);
}
document.querySelectorAll(".court-tab").forEach(tab => tab.addEventListener("click", () => { selectedCourt = tab.dataset.court; document.querySelectorAll(".court-tab").forEach(item => item.classList.toggle("active", item === tab)); loadAvailability(); }));
dateInput.addEventListener("change", loadAvailability);
document.querySelector("#players").addEventListener("change", updateSummary);
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
  if (!selectedTime) return;
  const booking = { court:selectedCourt, date:dateInput.value, time:selectedTime, players:document.querySelector("#players").value, createdAt:new Date().toISOString(), status:"confirmed", ownerUid:currentUser.uid, ownerName:currentUser.displayName || "Customer" };
  const button = document.querySelector("#book-btn"); button.disabled = true; button.textContent = "Saving…";
  try {
    if (db) {
      const result = await db.ref(`${bookingPath()}/${timeKey(selectedTime)}`).transaction(current => current === null ? booking : undefined);
      if (!result.committed) { alert("That time was just booked by someone else. Please choose another slot."); loadAvailability(); return; }
    } else demoBooked.add(`${selectedCourt}|${selectedTime}`);
    document.querySelector("#confirmation-text").textContent = `${selectedCourt} is reserved for ${prettyDate(booking.date)} at ${booking.time}.`;
    document.querySelector("#booking-dialog").showModal(); loadAvailability();
  }
  catch (error) { alert("We couldn't save this booking. Please try again."); console.error(error); }
  finally { button.disabled = false; button.innerHTML = "Confirm booking <span>→</span>"; }
});
document.querySelector("#dialog-close").addEventListener("click", () => document.querySelector("#booking-dialog").close());
document.querySelector("#done-btn").addEventListener("click", () => document.querySelector("#booking-dialog").close());
setAuthMode(false);
renderSlots();
connectFirebase();
