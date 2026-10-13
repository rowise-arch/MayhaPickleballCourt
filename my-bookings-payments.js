/* Pay now dialog for My Bookings. Same layout as the booking page; payment details come from site-config.js. */
const storage = app.storage();
let payingId = null, methodId = PAYMENT.methods[0]?.id;

/* ---------- payment dialog (same layout as the booking page) ---------- */
function openPayment(b) {
  if (!b) return;
  payingId = b.reservationId; methodId = b.paymentMethod && PAYMENT.methods.some(m => m.id === b.paymentMethod) ? b.paymentMethod : PAYMENT.methods[0]?.id;
  const dialog = $("#booking-dialog");
  dialog.innerHTML = `<div class="payment-modal-header"><div><h2 id="payment-title">${b.proofSubmittedAt ? "Update payment details" : "Complete your payment"}</h2></div><button type="button" class="dialog-close" data-close aria-label="Close payment dialog">×</button></div>
  <div class="payment-modal-body">
    <section class="payment-summary"><div class="summary-row"><span>COURT</span><strong>${safe(b.court)}</strong></div><div class="summary-row"><span>DATE</span><strong>${dayLabel(b.date)}</strong></div><div class="summary-row"><span>TIME</span><strong>${timeRange(b.startTime, b.durationHours)}</strong></div></section>
    <section class="payment-due"><span>AMOUNT TO PAY</span><strong class="payment-amount">${peso(b.totalPrice)}</strong>${!b.proofSubmittedAt ? `<p class="payment-hold hold-pill" data-expires="${Number(b.holdExpiresAt)}">${holdText(b.holdExpiresAt)}</p>` : ""}</section>
    <div class="payment-tabs" role="tablist" aria-label="Payment method">${PAYMENT.methods.map(m => `<button type="button" role="tab" data-method="${m.id}" class="${m.id === methodId ? "active" : ""}" aria-selected="${m.id === methodId}">${m.label}</button>`).join("")}</div>
    <section class="payment-qr-card" id="method-details"></section>
    <p class="payment-helper">Pay the exact amount, then enter your reference number below.</p>
    <div class="payment-field"><label for="pay-reference">REFERENCE NUMBER</label><input id="pay-reference" type="text" minlength="6" autocomplete="off" autocapitalize="characters" placeholder="Enter your payment reference" value="${safe(b.paymentReference || "")}"><p>Find this in your payment confirmation (at least 6 characters).</p></div>
    <div class="payment-field"><span>SCREENSHOT (OPTIONAL)</span><input id="pay-proof" class="visually-hidden" type="file" accept="image/png,image/jpeg"><label class="proof-dropzone" for="pay-proof"><b>↑ Upload screenshot</b><small>JPG or PNG, up to 5 MB</small></label><div class="proof-preview hidden" id="proof-preview"></div></div>
    <p class="auth-error hidden" id="pay-error" role="alert"></p>
    <div class="payment-submitted hidden" id="pay-done"><div>✓</div><strong>Payment sent</strong><p>We'll confirm your booking once staff verify it.</p></div>
  </div>
  <div class="payment-modal-footer" id="pay-footer"><button type="button" class="book-btn" id="pay-submit" disabled>Submit payment</button><button type="button" class="payment-later" data-close>Close</button></div>`;
  const renderMethod = () => {
    const m = PAYMENT.methods.find(x => x.id === methodId); if (!m) { $("#method-details").innerHTML = "<p>Payment details aren't set up yet. Please contact staff.</p>"; return; }
    $("#method-details").innerHTML = `<img class="payment-qr" src="${safe(m.qr)}" alt="${safe(m.label)} QR code"><strong>${safe(m.accountName)}</strong><span id="payment-number">${safe(m.number)}</span><button id="copy-payment-number" type="button">⧉ <span>Copy number</span></button><p>Scan the QR in your ${safe(m.label)} app, or send to the number above.</p>`;
    const qr = $("#method-details img"); qr.onerror = () => qr.remove();
    $("#copy-payment-number").onclick = async event => { try { await navigator.clipboard.writeText(m.number); const label = event.currentTarget.querySelector("span"); label.textContent = "Copied ✓"; setTimeout(() => label.textContent = "Copy number", 2000); } catch {} };
  };
  renderMethod();
  dialog.querySelectorAll(".payment-tabs button").forEach(tab => tab.onclick = () => { methodId = tab.dataset.method; dialog.querySelectorAll(".payment-tabs button").forEach(t => { const on = t === tab; t.classList.toggle("active", on); t.setAttribute("aria-selected", on); }); renderMethod(); });
  dialog.querySelectorAll("[data-close]").forEach(el => el.onclick = () => dialog.close());
  const ref = $("#pay-reference"), submit = $("#pay-submit");
  const sync = () => submit.disabled = ref.value.trim().length < 6; sync(); ref.oninput = sync;
  $("#pay-proof").onchange = event => {
    const file = event.target.files[0], preview = $("#proof-preview"), error = $("#pay-error"); error.classList.add("hidden");
    if (!file) { preview.classList.add("hidden"); preview.innerHTML = ""; return; }
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { error.textContent = "Use a JPG or PNG image under 5 MB."; error.classList.remove("hidden"); event.target.value = ""; return; }
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" alt="Selected screenshot"><span>${safe(file.name)}<small>${Math.ceil(file.size / 1024)} KB</small></span><button type="button">Remove</button>`;
    preview.classList.remove("hidden");
    preview.querySelector("button").onclick = () => { URL.revokeObjectURL(url); event.target.value = ""; preview.classList.add("hidden"); preview.innerHTML = ""; };
  };
  submit.onclick = () => submitPayment(b);
  dialog.showModal();
}
async function compressProof(file) {
  const image = await createImageBitmap(file), scale = Math.min(1, 1280 / image.width), canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82));
}
async function submitPayment(b) {
  const reference = $("#pay-reference").value.trim(), error = $("#pay-error"), button = $("#pay-submit");
  error.classList.add("hidden");
  if (reference.length < 6) { error.textContent = "Enter a reference with at least 6 characters."; error.classList.remove("hidden"); return; }
  button.disabled = true; button.textContent = "Sending…";
  try {
    let proofUrl = "";
    const file = $("#pay-proof").files[0];
    if (file) {
      try { const blob = await compressProof(file); const result = await storage.ref(`payment-proofs/${user.uid}/${b.reservationId}.jpg`).put(blob, { contentType: "image/jpeg" }); proofUrl = await result.ref.getDownloadURL(); }
      catch (uploadError) { console.warn(uploadError); toast("Screenshot didn't upload. Your reference was still sent.", "error"); }
    }
    const now = Date.now(), ck = b.courtKey || b.court.toLowerCase().replace(" ", "-"), updates = {};
    slotKeysFor(b).forEach(tk => {
      const base = `bookings/${b.date}/${ck}/${tk}`;
      Object.assign(updates, { [`${base}/paymentReference`]: reference, [`${base}/paymentMethod`]: methodId, [`${base}/proofSubmittedAt`]: now, [`availability/${b.date}/${ck}/${tk}/proofSubmittedAt`]: now });
      if (proofUrl) updates[`${base}/proofUrl`] = proofUrl;
    });
    const mine = `userBookings/${user.uid}/${b.reservationId}`;
    Object.assign(updates, { [`${mine}/paymentReference`]: reference, [`${mine}/paymentMethod`]: methodId, [`${mine}/proofSubmittedAt`]: now });
    await db.ref().update(updates);
    $("#pay-done").classList.remove("hidden");
    document.querySelectorAll("#booking-dialog .payment-summary,#booking-dialog .payment-due,#booking-dialog .payment-tabs,#booking-dialog .payment-qr-card,#booking-dialog .payment-helper,#booking-dialog .payment-field").forEach(el => el.classList.add("hidden"));
    button.classList.add("hidden");
  } catch (exception) {
    console.error(exception);
    error.textContent = "Couldn't send your payment details. Check your connection and try again."; error.classList.remove("hidden");
  } finally { button.disabled = false; button.textContent = "Submit payment"; }
}

