import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initInputLanguageManager } from './services/inputLanguageManager';
import { runPhase25UITestSuite } from './utils/phase25UITestSuite';
import { runPhase52DailyDepositsForensicTests } from './utils/phase52DailyDepositsForensicTests';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Initialize centralized automatic input language manager
initInputLanguageManager();

// Expose Test Suites globally for verification
(window as any).runPhase25UITestSuite = runPhase25UITestSuite;
(window as any).runPhase52DailyDepositsForensicTests = runPhase52DailyDepositsForensicTests;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

