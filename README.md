# Mayha Courts

A responsive pickleball-court booking interface with a Firebase Realtime Database integration.

## Connect Firebase

1. In the Firebase console, open **Build → Realtime Database** and create a database if it has not been created already.
2. Open **Build → Authentication → Sign-in method**, enable **Email/Password**, and save.
3. The Firebase web configuration has already been added to `app.js`.
4. In Realtime Database, open the **Rules** tab and publish the following rules. They require customers to create an account before reading availability or creating a booking.

```text
{
  "rules": {
    "bookings": {
      ".read": "auth != null",
      "$date": {
        "$court": {
          "$time": {
            ".write": "auth != null && !data.exists() && newData.child('ownerUid').val() === auth.uid",
            ".validate": "newData.hasChildren(['court', 'date', 'time', 'players', 'createdAt', 'status', 'ownerUid']) && newData.child('court').isString() && newData.child('date').isString() && newData.child('time').isString() && newData.child('players').isString() && newData.child('status').val() === 'confirmed'"
          }
        }
      }
    }
  }
}
```

Bookings are saved under `bookings/{date}/{court}/{time}`. Each time slot is committed with a Realtime Database transaction, preventing two users from confirming the same slot at once. Each booking is tied to the authenticated account that made it.

## Run locally

You can open `index.html` by double-clicking it. The app uses Firebase's classic browser SDK so no developer tools or local web server are required for a basic test. For a public launch, deploy it through Firebase Hosting or another web host.
