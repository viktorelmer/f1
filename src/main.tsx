import '@fontsource-variable/roboto-condensed';
import '@fontsource-variable/jetbrains-mono';
import './ui/design/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initI18n } from './i18n';
import { App } from './ui/App';
import { createAppRouter } from './ui/router';

initI18n();
const router = createAppRouter();

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);
