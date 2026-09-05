import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initInputLanguageManager } from './services/inputLanguageManager';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Initialize centralized automatic input language manager
initInputLanguageManager();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

