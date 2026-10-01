import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { refreshChatGpt } from './actions';
import './styles.css';

// Is "Sign in with ChatGPT" available (only when Amble runs on your computer)?
void refreshChatGpt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
