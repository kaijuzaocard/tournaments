import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import FirebaseEmulatorBanner from './components/FirebaseEmulatorBanner.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FirebaseEmulatorBanner />
    <App />
  </StrictMode>,
);
