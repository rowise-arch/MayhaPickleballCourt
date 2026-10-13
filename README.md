# Mayha Square Pickleball Court

A responsive pickleball-court booking interface with a Firebase Realtime Database integration.

## Connect Firebase

1. In the Firebase console, open **Build → Realtime Database** and create a database if it has not been created already.
2. Open **Build → Authentication → Sign-in method**, enable **Email/Password**, and save.
3. The Firebase web configuration has already been added to `app.js`.
4. In Realtime Database, open the **Rules** tab and publish the rules below. They keep customer details private:

- `bookings` holds the full booking rows (names, phone numbers, payment references). Only admins can read it.
- `availability` is the public copy the booking page uses to show free and taken slots. It has no personal details.
- `userBookings/{uid}` is each customer's own copy, read by My Bookings. A customer can only read their own.
- Customers can rebook a slot that was cancelled or whose payment hold expired.
- **Prices:** a customer booking must cost ₱240–₱400 for 2 hours or ₱480–₱800 for 4 hours, so a tampered ₱1 booking is refused. The staff dashboard also recalculates the exact price and flags any booking that doesn't match the rates.
- **Hold limit:** each account can have at most 2 unpaid holds at once (`holdSlots`). Paying or cancelling frees one.
- **Payment review timeout:** once a customer submits a payment, the slot is held for up to 6 hours, or until play starts if that's sooner. If staff haven't confirmed it by then, the slot becomes bookable again and the staff dashboard flags it as "Not reviewed in time".
- **Late payments:** if a customer's 30-minute hold runs out, the site checks the slot before accepting a payment. If it's still free it holds it again; if someone else took it, the payment is saved to `paymentLog` and shown to staff under **Payments to resolve** so they can refund it.

These limits live in `BOOKING_RULES` in `site-config.js`. If you change the review time or the hold limit there, change the matching numbers in the rules too (`21600000` is 6 hours in milliseconds; `$n === '0' || $n === '1'` allows 2 holds).

```text
{
  "rules": {
    "admins": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    },
    "meta": {
      ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
      ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
    },
    "blocks": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
    },
    "bookings": {
      ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
      "$date": {
        "$court": {
          "$time": {
            ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (newData.exists() && (!data.exists() || data.child('status').val() === 'cancelled' || (data.child('status').val() === 'pending_payment' && !data.child('proofSubmittedAt').exists() && data.child('holdExpiresAt').val() <= now) || (data.child('status').val() === 'pending_payment' && data.child('proofSubmittedAt').exists() && ((data.child('reviewExpiresAt').exists() && data.child('reviewExpiresAt').val() <= now) || (!data.child('reviewExpiresAt').exists() && data.child('proofSubmittedAt').val() + 21600000 <= now)))) && newData.child('ownerUid').val() === auth.uid && newData.child('status').val() === 'pending_payment' && newData.child('paymentStatus').val() === 'unpaid' && newData.child('holdExpiresAt').isNumber() && newData.child('holdExpiresAt').val() <= now + 3600000 && ((newData.child('durationHours').val() === 2 && newData.child('totalPrice').val() >= 240 && newData.child('totalPrice').val() <= 400) || (newData.child('durationHours').val() === 4 && newData.child('totalPrice').val() >= 480 && newData.child('totalPrice').val() <= 800)) && (!newData.child('proofSubmittedAt').exists() || (newData.child('proofSubmittedAt').val() <= now + 60000 && newData.child('reviewExpiresAt').exists())) && newData.child('holdSlot').isString() && newData.parent().parent().parent().parent().child('holdSlots').child(auth.uid).child(newData.child('holdSlot').val()).child('rid').val() === newData.child('reservationId').val() && newData.parent().parent().parent().parent().child('holdSlots').child(auth.uid).child(newData.child('holdSlot').val()).child('expiresAt').val() === newData.child('holdExpiresAt').val()) || (newData.exists() && data.child('ownerUid').val() === auth.uid && newData.child('ownerUid').val() === auth.uid && newData.child('court').val() === data.child('court').val() && newData.child('date').val() === data.child('date').val() && newData.child('time').val() === data.child('time').val() && newData.child('totalPrice').val() === data.child('totalPrice').val() && newData.child('paymentStatus').val() === data.child('paymentStatus').val() && newData.child('holdExpiresAt').val() === data.child('holdExpiresAt').val() && newData.child('reservationId').val() === data.child('reservationId').val() && (newData.child('status').val() === data.child('status').val() || newData.child('status').val() === 'cancelled') && (!data.child('proofSubmittedAt').exists() || newData.child('proofSubmittedAt').val() === data.child('proofSubmittedAt').val()) && (!data.child('reviewExpiresAt').exists() || newData.child('reviewExpiresAt').val() === data.child('reviewExpiresAt').val()) && (!newData.child('proofSubmittedAt').exists() || (newData.child('proofSubmittedAt').val() <= now + 60000 && newData.child('reviewExpiresAt').exists()))))",
            ".validate": "!newData.exists() || (newData.hasChildren(['court','date','time','createdAt','status','ownerUid','paymentStatus']) && newData.child('court').isString() && newData.child('date').isString() && newData.child('time').isString() && (newData.child('status').val() === 'pending_payment' || newData.child('status').val() === 'confirmed' || newData.child('status').val() === 'checked_in' || newData.child('status').val() === 'cancelled' || newData.child('status').val() === 'no_show') && (!newData.child('reviewExpiresAt').exists() || (newData.child('proofSubmittedAt').exists() && newData.child('reviewExpiresAt').val() <= newData.child('proofSubmittedAt').val() + 21600000)))"
          }
        }
      }
    },
    "availability": {
      ".read": "auth != null",
      "$date": {
        "$court": {
          "$time": {
            ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (newData.exists() && newData.child('ownerUid').val() === auth.uid && newData.parent().parent().parent().parent().child('bookings').child($date).child($court).child($time).child('ownerUid').val() === newData.child('ownerUid').val() && newData.parent().parent().parent().parent().child('bookings').child($date).child($court).child($time).child('status').val() === newData.child('status').val() && newData.parent().parent().parent().parent().child('bookings').child($date).child($court).child($time).child('holdExpiresAt').val() === newData.child('holdExpiresAt').val() && newData.parent().parent().parent().parent().child('bookings').child($date).child($court).child($time).child('proofSubmittedAt').val() === newData.child('proofSubmittedAt').val() && newData.parent().parent().parent().parent().child('bookings').child($date).child($court).child($time).child('reviewExpiresAt').val() === newData.child('reviewExpiresAt').val() && ((!data.exists() || data.child('status').val() === 'cancelled' || (data.child('status').val() === 'pending_payment' && !data.child('proofSubmittedAt').exists() && data.child('holdExpiresAt').val() <= now) || (data.child('status').val() === 'pending_payment' && data.child('proofSubmittedAt').exists() && ((data.child('reviewExpiresAt').exists() && data.child('reviewExpiresAt').val() <= now) || (!data.child('reviewExpiresAt').exists() && data.child('proofSubmittedAt').val() + 21600000 <= now)))) || data.child('ownerUid').val() === auth.uid)))",
            ".validate": "!newData.exists() || newData.hasChildren(['status'])"
          }
        }
      }
    },
    "userBookings": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || root.child('admins').child(auth.uid).val() === true)",
        "$reservationId": {
          ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (auth.uid === $uid && newData.exists() && ((!data.exists() && newData.child('status').val() === 'pending_payment' && newData.child('paymentStatus').val() === 'unpaid' && ((newData.child('durationHours').val() === 2 && newData.child('totalPrice').val() >= 240 && newData.child('totalPrice').val() <= 400) || (newData.child('durationHours').val() === 4 && newData.child('totalPrice').val() >= 480 && newData.child('totalPrice').val() <= 800))) || (data.exists() && newData.child('paymentStatus').val() === data.child('paymentStatus').val() && newData.child('totalPrice').val() === data.child('totalPrice').val() && (newData.child('status').val() === data.child('status').val() || newData.child('status').val() === 'cancelled' || (data.child('status').val() === 'cancelled' && newData.child('status').val() === 'pending_payment'))))))"
        }
      }
    },
    "holdSlots": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || root.child('admins').child(auth.uid).val() === true)",
        "$n": {
          ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (auth.uid === $uid && ($n === '0' || $n === '1') && ((newData.exists() && (!data.exists() || data.child('expiresAt').val() <= now) && newData.child('expiresAt').isNumber() && newData.child('expiresAt').val() <= now + 3600000 && newData.child('rid').isString()) || (!newData.exists() && data.exists() && (data.child('expiresAt').val() <= now || ((newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('status').val() === 'cancelled' || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('proofSubmittedAt').exists() || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('ownerUid').val() !== $uid || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('reservationId').val() !== data.child('rid').val()) && (newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('status').val() === 'cancelled' || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('proofSubmittedAt').exists() || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('ownerUid').val() !== $uid || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('reservationId').val() !== data.child('rid').val())))))))"
        }
      }
    },
    "paymentLog": {
      ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
      "$reservationId": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (newData.exists() && newData.child('uid').val() === auth.uid && (!data.exists() || data.child('uid').val() === auth.uid) && (!data.exists() || data.child('state').val() === 'submitted' || data.child('state').val() === 'slot_lost') && (newData.child('state').val() === 'submitted' || newData.child('state').val() === 'slot_lost')))"
      }
    }
  }
}
```

### Switching an existing site to the private layout (one time)

Do these in order, close together, because old pages and new rules don't work with each other:

1. Publish the rules above.
2. Deploy the updated site (all files, including `site-config.js`).
3. Sign in as an admin and open `admin.html`. A banner says **One-time update needed**. Click **Copy bookings**. This copies existing bookings into `availability` and each customer's `userBookings`. The banner disappears once it's done.

Until step 3 is done, the booking page shows every slot as free and customers won't see older bookings in My Bookings.

Bookings are saved under `bookings/{date}/{court}/{time}`. New customer bookings stay `pending_payment` for 30 minutes. An expired pending booking without submitted proof becomes available again; a submitted proof remains reserved until staff verify or reject it. Admins can create walk-ins and manage any booking.

Court pricing is calculated per hour from the selected Philippine date: Monday–Thursday is ₱120 from 7 AM to 4 PM and ₱160 overnight; Friday–Sunday is ₱160 from 7 AM to 4 PM and ₱200 overnight. Customers can book 2 or 4 hours only, and starts from 6 PM through 6 AM require 4 hours. Wednesday, Friday, and Sunday are closed to customer bookings.

## Manual GCash / Maya payment

Edit `SITE` and `PAYMENT` in `site-config.js` (shared by the booking page and My Bookings). Replace each `YOUR NAME HERE` and `09XX XXX XXXX` placeholder; a method whose number still contains X is hidden from customers. Put your optional QR images in the project root as `gcash-qr.png` and `maya-qr.png`; a missing file simply hides the QR and still shows the account details.

Customers choose a court, receive a 30-minute hold, pay the exact displayed amount in GCash or Maya, then enter the payment reference and optionally upload a screenshot. Staff must check the reference and amount in their own GCash/Maya app before using **Mark as paid**. A screenshot is optional, so Firebase Storage failure never prevents reference submission.

### Firebase Storage rules

In **Build → Storage → Rules**, publish:

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /payment-proofs/{uid}/{fileName} {
      allow write: if request.auth != null && request.auth.uid == uid
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
      allow read: if request.auth != null && (request.auth.uid == uid || request.auth.token.admin == true);
    }
  }
}
```

Storage rules cannot read Realtime Database `admins`. To let staff open proof files, give staff an Auth custom claim `admin: true` (requires the Admin SDK once) and have them sign out/in; otherwise staff can use the proof URL stored on the booking. The customer upload restriction above remains essential.

### Rules Playground tests

In Realtime Database **Rules → Rules Playground**, simulate a signed-in normal UID creating a `pending_payment` row with its own `ownerUid`; it should allow. Change `paymentStatus` to `paid` or `status` to `confirmed`; it should deny. Simulate an admin UID under `/admins/UID: true`; it should allow. In Storage **Rules → Rules Playground**, test an `image/jpeg` below 5 MB to `payment-proofs/UID/x.jpg` as UID (allow), then a PDF, 6 MB file, and another UID path (deny).

## Operations pages

- `my-bookings.html` shows a signed-in customer their upcoming and past bookings, lets them pay or update payment details for a held booking, cancel, add a booking to their calendar, and get directions.
- `admin.html` is the staff dashboard: a four-court calendar (tap an empty slot to add a walk-in), walk-ins and court blocks in the side panel, payment review with a Needs action group, and daily metrics. `staff-tools.html` now forwards to it.

After this update, publish the rules above again. The `blocks` rule is required for the court-maintenance controls. The court-level booking write permission is necessary because the browser performs one atomic transaction to reserve a multi-hour schedule. Before public launch, move booking creation to a Cloud Function so the server can enforce owner-level permissions while retaining atomic multi-hour reservations.

## Give an account administrator access

1. Create the account through `index.html`, then sign in.
2. In Firebase Console, go to **Build → Authentication → Users** and copy that account's **User UID**.
3. Go to **Build → Realtime Database → Data** and add this data at the root:

```json
{ "admins": { "YOUR_USER_UID": true } }
```

4. Sign out and back in, then open `admin.html`. Only UIDs listed under `admins` can access the dashboard.

## Run locally

You can open `index.html` by double-clicking it. The app uses Firebase's classic browser SDK so no developer tools or local web server are required for a basic test. For a public launch, deploy it through Firebase Hosting or another web host.
