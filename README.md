# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## B4A local Firebase emulator browser preview

This harness is only for a local browser preview. It is explicitly enabled by
`.env.emulator`, requires the fixed `demo-kaijuzaocard-calendar-browser`
project, and refuses non-loopback Auth, Firestore, or Functions endpoints. It
never deploys Firebase resources.

Use Node 22 and Java 21. From the repository root, run these commands in order:

1. Build the explicitly opted-in frontend:

   ```sh
   npm run build:emulator
   ```

   This command uses the harness build wrapper, not a bare Vite command. It
   removes inherited `VITE_FIREBASE_*` and Swiss values, supplies the canonical
   demo project plus loopback endpoints, and runs `vite build --mode emulator`.
   `.env.emulator` remains documentation and a Vite fallback; it is not the
   build authority. A successful build writes the safe exact-shape attestation
   `dist/b4a-emulator-build.json`.

2. Create the temporary Functions emulator parameters. This stops rather than
   overwriting an existing `functions/.env.local` or
   `functions/.secret.local`:

   ```sh
   npm run prepare:browser
   ```

3. Start Auth, Firestore, and Functions in terminal A:

   ```sh
   npm run emulators:browser
   ```

   Port listeners are not readiness. The launcher fixes Firebase Functions
   discovery to 60 seconds and uses the CLI's manifest-output discovery mode
   so a transient Windows `localhost` admin-server fetch race cannot terminate
   discovery before the module finishes loading. It tees the complete output into the ignored
   harness log, rejects fatal discovery markers, and then sends six bounded
   zero-write HTTP probes through the real loopback Functions endpoints. Do not
   continue until terminal A prints exactly this readiness prefix:

   ```text
   B4A Browser Functions READY
   ```

4. In terminal B, revalidate the live session, listener ownership, exact
   readiness attestation, fatal-marker-free log, unchanged Auth/Firestore
   state, and all six Functions probes:

   ```sh
   npm run verify:browser:ready
   ```

   A JSON file alone is never sufficient; this command always performs a live
   re-probe and prints `B4A Browser Functions readiness verified.` only after
   it succeeds.

5. Seed the fictional E1-E6 fixtures in terminal B:

   ```sh
   npm run seed:browser
   ```

   Seed startup runs the same live verifier before importing Auth fixtures or
   calling the service-layer fixture builder. A service-layer seed cannot stand
   in for Functions readiness. The ignored manifest is written to
   `artifacts/b4a-p1/browser-preview-manifest.json`. The seed also imports one
   fixed fictional Google-provider user into Auth Emulator. The manifest keeps
   only public fixture metadata; it contains no Firebase token, management
   token, credential, or HMAC secret.

6. Start the fixed frontend in terminal C:

   ```sh
   npm run preview:emulator
   ```

   Preview startup first runs the same live Functions verifier, then refuses a
   missing, malformed, non-demo, or remote-endpoint build attestation before
   starting Vite preview. It never falls back to Production.

7. Open `http://127.0.0.1:4174/`. Verify the
   `LOCAL FIREBASE EMULATOR PREVIEW` banner and the three loopback endpoints.

### Auth Emulator mock Google administrator

The app first signs in anonymously against Auth Emulator. To test the admin UI,
open **店家後台** and choose **使用本機測試管理員登入**. This deterministic
button appears only in the explicit emulator build and does not open the
Production Google popup. It uses this seeded fictional identity:

- User ID / `sub`: `z1JOoARRRsSFavRlGbnhZmM4NMQ2`
- Email: `b4a-admin@example.test`
- Display name: `B4A Preview Admin`
- Provider: `google.com`

This UID is the existing Rules allowlist UID. The harness does not change Rules,
does not add a production administrator, and does not use a real Google account
or token. Login is accepted only after the client verifies the exact UID,
`google.com` provider data and token sign-in provider, then successfully calls
the existing Functions admin boundary. A mismatch signs out and fails closed.

### Corrected preregistration customer-field contract

The canonical customer fields are exactly `playerName`, `officialId`,
`deckName`, and `honorId`. There is no `note`, `notes`, `remark`, or `memo`
field. For the E4 full-race Browser check, fill all four canonical fields and
verify that all four remain unchanged when the full-race waitlist offer appears.
The expected record is **P4 PASS — corrected four-field contract**; a fifth
note field must not be requested or added.

Waitlist surfaces share one notice: this stage does not auto-promote or send a
notification, so the player must save the management link and check the latest
rank themselves.

### Administrator preregistration management

An allowlisted, non-anonymous Google administrator can edit the same four
canonical customer fields or cancel an active/waitlisted entry from the private
preregistration list. These actions use the dedicated
`adminManageTournamentPreRegistration` callable; they never accept or reveal a
player management token and never write directly from the client to Firestore.

Cancellation marks the entry as cancelled instead of deleting it. It releases
the entry's identity locks and decrements only the matching live counter. There
is no status editor, promotion, automatic waitlist fill, notification, check-in,
or bulk action. Event start and deadline policy remains authoritative.

### Stop and cleanup

Keep the emulators running while cleaning data:

1. Stop the frontend with Ctrl+C.
2. Save Browser evidence, then run `npm run cleanup:browser` in terminal B. It removes only the demo
   project's `artifacts` collection, only the fixed Auth Emulator fixture UID,
   the ignored manifest, and exact temporary files created by the harness. It
   is idempotent and may be run again; other Auth Emulator users are untouched.
3. Run `npm run stop:browser` in terminal B. It validates the session-bound
   ignored process state, requests a clean shutdown, and removes only recorded
   listeners on the four fixed harness ports. It also removes readiness and
   process state; a successful-session diagnostic log is removed, while a
   failed-startup log remains available until explicit files cleanup. The
   emulator terminal then exits.

If the emulators already stopped, use `npm run cleanup:browser:files` to remove
only harness-owned local files and the ignored manifest.

After cleanup and stop, confirm that ports 4174, 4400, 5001, 8080, and 9099
have no listeners and that `functions/.env.local`, `functions/.secret.local`,
the readiness attestation, fixture manifest, and process state are gone. Only
then run the isolated regression sequence:

```sh
npm test
npm run test:functions
node scripts/runPreRegistrationEmulatorTests.js
node scripts/runRulesEmulatorTests.js
npm run build
npm run build:emulator
npm run lint
git diff --check
```

The independent Functions and Rules runners intentionally fail closed when the
Browser harness still owns override files or fixed ports. They must not share
the Browser emulator process; post-cleanup execution is the canonical isolated
regression lifecycle.

Emulator mode disables LINE/GAS notifications. Its Swiss handoff target and
allowed origin are pinned to the loopback frontend so active-only selection can
be inspected without contacting the production Swiss app; it never falls back
to the production Swiss URL.
