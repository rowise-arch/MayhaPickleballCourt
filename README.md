# Mayha Courts

## PayMongo payments (test mode)

Bookings are now held for 15 minutes while the customer completes a full-payment PayMongo Payment Link. Only the Firebase Cloud Functions service creates, confirms, expires, or cancels customer bookings; the browser never receives a PayMongo secret key.

### One-time deployment setup

1. Upgrade the Firebase project to the **Blaze** plan (scheduled Functions and outbound API calls require it).
2. Install the Firebase CLI, sign in, and from this folder run `firebase use mayha-courts` then `cd functions && npm install && cd ..`.
3. Store test-mode credentials securely — never in a browser file or Git:

   ```powershell
   firebase functions:secrets:set PAYMONGO_SECRET_KEY
   firebase functions:secrets:set PAYMONGO_WEBHOOK_SECRET
   ```

4. Deploy: `firebase deploy --only functions,hosting`.
5. Copy the deployed `paymongoWebhook` URL from the Firebase CLI output. In the **PayMongo Dashboard → Settings → Webhooks** while in **Test** mode, register that HTTPS URL and subscribe to `link.payment.paid`. Copy that endpoint's signing secret into `PAYMONGO_WEBHOOK_SECRET`.

Open the site through Firebase Hosting (`https://mayha-courts.web.app`) or a local HTTP server such as `firebase emulators:start --only hosting`. Do **not** double-click `index.html`: a `file:///` page has a `null` origin and browsers will reject secure callable-payment requests before they reach Firebase.

The Function uses PayMongo's current `POST /v1/payment_links` endpoint, sends the price in centavos, and sets a one-payment limit. The webhook verifies the raw body against the timestamped `Paymongo-Signature` header before processing it.

### Going live

Activate the PayMongo account, create live-mode API credentials and a separate live webhook, replace both Firebase secrets with their live equivalents, redeploy the Functions, then run one small real payment. Test and live webhook endpoints are separate in PayMongo.

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
      ".write": "auth != null && root.child('admins').child(auth.uid).val() === true",
      "$date": { "$court": { "$time": {
        ".validate": "!newData.exists() || (newData.hasChildren(['court','date','time','createdAt','status','ownerUid']) && newData.child('court').isString() && newData.child('date').isString() && newData.child('time').isString())"
      }}}
    },
    "reservations": {
      ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
      ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
    }
  }
}
```

Bookings are saved under `bookings/{date}/{court}/{time}`. The app supports four courts and 24-hour bookings in one-hour time slots. Customer writes are intentionally denied by the rules: Cloud Functions use the Admin SDK and bypass rules, while staff accounts retain direct admin-only access for walk-ins. Payment holds block slots until they are paid, cancelled, or expired.

Court pricing is calculated per hour from the selected Philippine date: Monday–Thursday is ₱120 from 7 AM to 4 PM and ₱160 overnight; Friday–Sunday is ₱160 from 7 AM to 4 PM and ₱200 overnight. Customers can book 2 or 4 hours only, and starts from 6 PM through 6 AM require 4 hours. Wednesday, Friday, and Sunday are closed to customer bookings. The Cloud Function recalculates the charge independently of the displayed browser price.

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
