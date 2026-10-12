# Mayha Courts

A responsive pickleball-court booking interface with a Firebase Realtime Database integration.

## Connect Firebase

1. In the Firebase console, open **Build → Realtime Database** and create a database if it has not been created already.
2. Open **Build → Authentication → Sign-in method**, enable **Email/Password**, and save.
3. The Firebase web configuration has already been added to `app.js`.
4. In Realtime Database, open the **Rules** tab and publish the following rules. They require customers to create an account before reading availability or creating a booking, while approved administrators can update booking statuses.

```text
{
  "rules": {
    "admins": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    },
    "blocks": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
    },
    "bookings": {
      ".read": "auth != null",
      "$date": { "$court": { "$time": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (!data.exists() && newData.child('ownerUid').val() === auth.uid && newData.child('status').val() === 'pending_payment' && newData.child('paymentStatus').val() === 'unpaid' && newData.child('holdExpiresAt').isNumber() && newData.child('holdExpiresAt').val() <= now + 3600000) || (data.exists() && data.child('status').val() === 'pending_payment' && !data.child('proofSubmittedAt').exists() && data.child('holdExpiresAt').val() <= now && newData.child('ownerUid').val() === auth.uid && newData.child('status').val() === 'pending_payment' && newData.child('paymentStatus').val() === 'unpaid' && newData.child('holdExpiresAt').val() <= now + 3600000) || (data.child('ownerUid').val() === auth.uid && newData.child('court').val() === data.child('court').val() && newData.child('date').val() === data.child('date').val() && newData.child('time').val() === data.child('time').val() && newData.child('totalPrice').val() === data.child('totalPrice').val() && newData.child('paymentStatus').val() === data.child('paymentStatus').val() && (newData.child('status').val() === data.child('status').val() || newData.child('status').val() === 'cancelled')))",
        ".validate": "!newData.exists() || (newData.hasChildren(['court','date','time','createdAt','status','ownerUid','paymentStatus']) && newData.child('court').isString() && newData.child('date').isString() && newData.child('time').isString() && (newData.child('status').val() === 'pending_payment' || newData.child('status').val() === 'confirmed' || newData.child('status').val() === 'checked_in' || newData.child('status').val() === 'cancelled' || newData.child('status').val() === 'no_show'))"
      }}}
    }
  }
}
```

Bookings are saved under `bookings/{date}/{court}/{time}`. New customer bookings stay `pending_payment` for 30 minutes. An expired pending booking without submitted proof becomes available again; a submitted proof remains reserved until staff verify or reject it. Admins can create walk-ins and manage any booking.

Court pricing is calculated per hour from the selected Philippine date: Monday–Thursday is ₱120 from 7 AM to 4 PM and ₱160 overnight; Friday–Sunday is ₱160 from 7 AM to 4 PM and ₱200 overnight. Customers can book 2 or 4 hours only, and starts from 6 PM through 6 AM require 4 hours. Wednesday, Friday, and Sunday are closed to customer bookings.

## Manual GCash / Maya payment

Edit the `PAYMENT` object near the top of `app.js`. Replace each `YOUR NAME HERE` and `09XX XXX XXXX` placeholder. Put your optional QR images in the project root as `gcash-qr.png` and `maya-qr.png`; a missing file simply hides the QR and still shows the account details.

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

- `my-bookings.html` lets signed-in customers see their reservations, payment state, reference number, and cancel a confirmed booking.
- `admin.html` provides a four-court, 24-hour calendar plus customer name, contact number, notes, booking reference, live status controls, revenue, peak-time, and utilization summaries.
- Staff can make walk-in reservations and block a court (or all courts) for maintenance. Admins can set a manual total for a walk-in to handle promotions or special-event pricing.

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
