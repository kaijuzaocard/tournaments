import { firebaseRuntimeInfo, isFirebaseEmulatorRuntime } from '../firebaseRuntime.js';

export default function FirebaseEmulatorBanner() {
  if (!isFirebaseEmulatorRuntime) return null;
  return (
    <aside
      data-testid="firebase-emulator-banner"
      className="bg-slate-950 px-4 py-3 text-white shadow-lg"
      aria-label="Local Firebase emulator preview"
    >
      <div className="mx-auto max-w-6xl">
        <div className="font-black tracking-wider text-amber-300">LOCAL FIREBASE EMULATOR PREVIEW</div>
        <dl className="mt-2 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="inline font-bold text-slate-400">Project </dt><dd className="inline font-mono">{firebaseRuntimeInfo.projectId}</dd></div>
          <div><dt className="inline font-bold text-slate-400">Auth </dt><dd className="inline font-mono">{firebaseRuntimeInfo.authEndpoint}</dd></div>
          <div><dt className="inline font-bold text-slate-400">Firestore </dt><dd className="inline font-mono">{firebaseRuntimeInfo.firestoreEndpoint}</dd></div>
          <div><dt className="inline font-bold text-slate-400">Functions </dt><dd className="inline font-mono">{firebaseRuntimeInfo.functionsEndpoint}</dd></div>
        </dl>
      </div>
    </aside>
  );
}
