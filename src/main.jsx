import './utils/managementTokenBootstrap.js';

try {
  await import('./renderApp.jsx');
} catch (error) {
  const runtime = String(import.meta.env.VITE_FIREBASE_RUNTIME || '').trim();
  if (runtime && runtime !== 'production') {
    const code = typeof error?.code === 'string' ? error.code : (error?.message || 'EMULATOR_RUNTIME_FAILED');
    const root = document.getElementById('root');
    root.replaceChildren();
    const container = document.createElement('main');
    container.dataset.testid = 'firebase-emulator-fatal';
    container.style.cssText = 'min-height:100vh;background:#fff7ed;color:#7c2d12;display:grid;place-items:center;padding:2rem;font-family:system-ui,sans-serif';
    const panel = document.createElement('section');
    panel.style.cssText = 'max-width:42rem;border:2px solid #fb923c;border-radius:1rem;background:white;padding:2rem;box-shadow:0 10px 30px rgba(124,45,18,.12)';
    const heading = document.createElement('h1');
    heading.textContent = 'LOCAL FIREBASE EMULATOR PREVIEW FAILED';
    heading.style.cssText = 'margin:0 0 1rem;font-size:1.25rem;font-weight:900';
    const message = document.createElement('p');
    message.textContent = `Preview stopped safely: ${code}`;
    message.style.cssText = 'margin:0;font-family:ui-monospace,monospace;overflow-wrap:anywhere';
    panel.append(heading, message);
    container.append(panel);
    root.append(container);
  } else {
    throw error;
  }
}
