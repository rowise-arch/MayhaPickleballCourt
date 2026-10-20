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
          ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (auth.uid === $uid && ($n === '0' || $n === '1') && ((newData.exists() && (!data.exists() || data.child('expiresAt').val() <= now) && newData.child('expiresAt').isNumber() && newData.child('expiresAt').val() <= now + 3600000 && newData.child('rid').isString()) || (!newData.exists() && !data.exists()) || (!newData.exists() && data.exists() && (data.child('expiresAt').val() <= now || ((newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('status').val() === 'cancelled' || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('proofSubmittedAt').exists() || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('ownerUid').val() !== $uid || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('first').val()).child('reservationId').val() !== data.child('rid').val()) && (newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('status').val() === 'cancelled' || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('proofSubmittedAt').exists() || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('ownerUid').val() !== $uid || newData.parent().parent().parent().child('bookings').child(data.child('date').val()).child(data.child('court').val()).child(data.child('last').val()).child('reservationId').val() !== data.child('rid').val())))))))"
        }
      }
    },
    "paymentLog": {
      ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
      "$reservationId": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (newData.exists() && newData.child('uid').val() === auth.uid && (!data.exists() || data.child('uid').val() === auth.uid) && (!data.exists() || data.child('state').val() === 'submitted' || data.child('state').val() === 'slot_lost') && (newData.child('state').val() === 'submitted' || newData.child('state').val() === 'slot_lost')))"
      }
    },
    "paymentProofs": {
      ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
      ".indexOn": [
        "createdAt"
      ],
      "$reservationId": {
        ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || (newData.exists() && $reservationId.beginsWith(auth.uid + '-') && newData.child('uid').val() === auth.uid && (!data.exists() || data.child('uid').val() === auth.uid)))",
        ".validate": "!newData.exists() || (newData.hasChildren(['uid','image','createdAt']) && newData.child('image').isString() && newData.child('image').val().beginsWith('data:image/jpeg;base64,') && newData.child('image').val().length <= 150000 && newData.child('createdAt').isNumber() && newData.child('createdAt').val() <= now + 60000)"
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

Customers choose a court, receive a 30-minute hold, pay the exact displayed amount in GCash or Maya, then enter the payment reference and optionally attach a screenshot. Staff must check the reference and amount in their own GCash/Maya app before using **Mark as paid**. A screenshot is optional, and a failed screenshot never stops the reference from being submitted.

### Payment screenshots

Screenshots are saved in the Realtime Database under `paymentProofs`, not Firebase Storage, so the free Spark plan is enough (Storage now requires the Blaze plan). Before saving, the browser shrinks each screenshot to a small JPEG of about 30–80 KB, still sharp enough to read a GCash receipt. The rules above make sure that:

- only the customer who owns the booking can save its screenshot, and only images under about 110 KB;
- only staff can view screenshots. They load one at a time when staff tap the screenshot button on a booking, so the list doesn't use up the database's download allowance;
- the staff dashboard deletes screenshots older than 60 days, at most once a day. Change `proofRetentionDays` in `site-config.js` to keep them longer.

If saving a screenshot fails or takes longer than 15 seconds, the reference number is still sent.

When a customer picks a screenshot, the page reads it on their phone (with Tesseract.js, loaded from a CDN only at that moment, about 7 MB the first time) and fills in the reference number. It never overwrites a reference the customer typed, and it warns them if the amount on the receipt doesn't match the booking. This is a convenience for customers, not a check: screenshots can be edited, so staff still confirm the payment in the GCash or Maya app.

You no longer need Firebase Storage. If you published Storage rules earlier, you can leave them; the site doesn't use Storage any more.

### Rules Playground tests

In Realtime Database **Rules → Rules Playground**, simulate a signed-in normal UID creating a `pending_payment` row with its own `ownerUid`; it should allow. Change `paymentStatus` to `paid` or `status` to `confirmed`; it should deny. Simulate an admin UID under `/admins/UID: true`; it should allow. Then simulate a write to `paymentProofs/UID-123` as that UID with a small `data:image/jpeg;base64,…` image (allow), and the same write from another UID (deny).

## Operations pages

- `index.html` is the booking page. The sign-in dialog has **Forgot password?**, which sends Firebase's password reset email (Authentication → Templates controls its wording, if your project allows editing). After paying, customers can tap **Add to calendar**.
- `my-bookings.html` shows a signed-in customer their upcoming and past bookings, lets them pay or update payment details for a held booking, cancel, add a booking to their calendar, and get directions.
- `admin.html` is the staff dashboard:
  - a four-court calendar. Tap an empty slot to add a walk-in, or drag down across empty slots to pick the length (on a phone, press and hold first). With the **Block court** tab open, the drag fills in a block instead;
  - walk-ins, with **Repeat** for groups who play the same slot every week (4, 8 or 12 weeks). Weeks where the court is already booked or blocked are skipped and listed;
  - court blocks, payment review with a Needs action group, daily metrics and **Payments to resolve**;
  - a warning when a payment reference was already used on another booking, on any day (spaces and dashes are ignored);
  - **Export CSV**: every booking between two dates, with a paid total, for Excel or Google Sheets.
- `staff-tools.html` forwards to `admin.html`.

All three pages follow the phone or computer's light or dark setting (Auto). Customers can choose **Light**, **Dark** or **Auto** in the account menu; staff have a sun/moon button in the top bar of the dashboard. The choice is remembered on that device. Dark styles are written twice in the CSS, once for Auto and once for a manual Dark choice. If you change a dark colour, change it in both copies.

Walk-ins are written one hour at a time, which is what the rules above allow. The app checks the hours are free just before writing; before a public launch with heavy traffic, consider moving booking creation to a Cloud Function so the server can reserve multi-hour slots atomically.

### Facebook previews and the home screen

`share-image.jpg` is the picture shown when someone shares the site on Facebook, Messenger or Viber. The tags in the `<head>` of `index.html` point at `https://mayha-pickleball-court.vercel.app`; if you move to your own domain, change the two URLs there. Facebook caches previews: after changing them, paste the link into Facebook's Sharing Debugger and press **Scrape Again**.

`site.webmanifest`, `icon-192.png` and `icon-512.png` let customers add the site to their home screen. It opens full screen with your logo, like an app.

- After a customer sends a payment, and on My bookings once they have a booking, a **Get the Mayha Square app** card appears. On Android and desktop Chrome or Edge, **Install** adds it in one tap; on iPhone the card shows the two steps (Share → **Add to Home Screen**). "Not now" hides it for 30 days, and it never shows once installed.
- `sw.js` (the service worker) keeps a copy of the site on the phone. Pages, code and styles are always fetched fresh when there's a connection, so a new deploy shows up on the next visit; the saved copy is only used offline or when the network takes more than 4 seconds. Images and fonts load from the saved copy. Bookings, sign-in and payments always use the live database and are never cached.
- Offline, pages that were opened before still load, a "You're offline" notice shows at the top, and a page never opened before shows a friendly offline screen.
- To force every phone to drop its saved copy (rarely needed), change `VERSION` at the top of `sw.js`.

The staff dashboard on a phone shows one court at a time (tabs above the calendar, with a count of that court's bookings), and puts Payments to resolve and Reservations above the calendar.

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
