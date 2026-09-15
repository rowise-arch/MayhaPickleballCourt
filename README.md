# Mayha Courts

A responsive pickleball-court booking interface with a Firebase Realtime Database integration.

## Connect Firebase

1. In the Firebase console, open **Build → Realtime Database** and create a database if it has not been created already.
2. The Firebase web configuration has already been added to `app.js`.
3. Before testing a booking, open the **Rules** tab and publish the following temporary development rules. Do **not** use these rules in production; the next build phase should add Firebase Authentication and stricter role-based rules.

```text
{
  "rules": {
    "bookings": {
      ".read": true,
      ".write": true
    }
  }
}
```

Bookings are saved under `bookings/{date}/{court}/{time}`. Each time slot is committed with a Realtime Database transaction, preventing two users from confirming the same slot at once. Without Firebase configuration, the site remains usable in demo mode.

## Run locally

You can open `index.html` by double-clicking it. The app uses Firebase's classic browser SDK so no developer tools or local web server are required for a basic test. For a public launch, deploy it through Firebase Hosting or another web host.
