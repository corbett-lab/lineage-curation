import React from 'react';
import { createRoot } from 'react-dom/client';
import { LineageManager } from './LineageManager';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <LineageManager />
  </React.StrictMode>
);
