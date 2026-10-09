import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, MemoryRouter } from 'react-router-dom';
import { IS_ARTIFACT } from './env';
import App from './App';
import { ToastProvider } from './components/ui';
import { startAutosave, useStore } from './store/store';
import './index.css';

useStore.getState().init();
startAutosave();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A sandboxed viewer must not have its URL rewritten, so the artifact build keeps the route in memory. */}
    {IS_ARTIFACT ? (
      <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </MemoryRouter>
    ) : (
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </HashRouter>
    )}
  </StrictMode>,
);
