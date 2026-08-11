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

4. Seed the fictional E1-E6 fixtures in terminal B:

   ```sh
   npm run seed:browser
   ```

   The ignored manifest is written to
   `artifacts/b4a-p1/browser-preview-manifest.json`.

5. Start the fixed frontend in terminal C:

   ```sh
   npm run preview:emulator
   ```

   Preview startup refuses a missing, malformed, non-demo, or remote-endpoint
   build attestation before starting Vite preview.

6. Open `http://127.0.0.1:4174/`. Verify the
   `LOCAL FIREBASE EMULATOR PREVIEW` banner and the three loopback endpoints.

### Auth Emulator mock Google administrator

The app first signs in anonymously against Auth Emulator. To test the admin UI,
open **店家後台**, choose the Google sign-in button, and use the Auth Emulator
mock identity page. Choose the Google provider and enter only fictional values:

- User ID / `sub`: `z1JOoARRRsSFavRlGbnhZmM4NMQ2`
- Email: `b4a-admin@example.test`
- Display name: `B4A Preview Admin`
- Provider: `google.com`

This UID is the existing Rules allowlist UID. The harness does not change Rules,
does not add a production administrator, and does not use a real Google account
or token.

### Stop and cleanup

Keep the emulators running while cleaning data:

1. Stop the frontend with Ctrl+C.
2. Run `npm run cleanup:browser` in terminal B. It removes only the demo
   project's `artifacts` collection, the ignored manifest, and exact temporary
   files created by the harness. It is idempotent and may be run again.
3. Run `npm run stop:browser` in terminal B. It uses the ignored process-state
   manifest to request a clean shutdown and removes only recorded listeners on
   the four fixed harness ports. The emulator terminal then exits.

If the emulators already stopped, use `npm run cleanup:browser:files` to remove
only harness-owned local files and the ignored manifest.

Emulator mode disables LINE/GAS notifications. Swiss opening is disabled unless
an explicit loopback `VITE_SWISS_APP_URL` is supplied; it never falls back to
the production Swiss URL.
