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
    "bookings": {
      ".read": "auth != null",
      "$date": {
        "$court": {
          "$time": {
            ".write": "auth != null && ((!data.exists() && newData.child('ownerUid').val() === auth.uid) || root.child('admins').child(auth.uid).val() === true)",
            ".validate": "newData.hasChildren(['court', 'date', 'time', 'players', 'createdAt', 'status', 'ownerUid']) && newData.child('court').isString() && newData.child('date').isString() && newData.child('time').isString() && newData.child('players').isString() && (!newData.child('ownerName').exists() || newData.child('ownerName').isString()) && (newData.child('status').val() === 'confirmed' || newData.child('status').val() === 'checked_in' || newData.child('status').val() === 'cancelled' || newData.child('status').val() === 'no_show')"
          }
        }
      }
    }
  }
}
```

Bookings are saved under `bookings/{date}/{court}/{time}`. The app supports four courts and 24-hour bookings in one-hour time slots. Each time slot is committed with a Realtime Database transaction, preventing two users from confirming the same slot at once. Each booking is tied to the authenticated account that made it.

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
