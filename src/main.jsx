import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { Buffer } from 'buffer'
import process from 'process'

window.Buffer = window.Buffer || Buffer
window.process = window.process || process
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register service worker for PWA (installable on phone)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

