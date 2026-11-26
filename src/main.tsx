import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import AppUpdateNotice from './components/AppUpdateNotice'

if ('serviceWorker' in navigator) {
  registerSW({ immediate: true })
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  window.__orcaDeferredInstallPrompt = event as unknown as import('./components/doctors/PwaInstallBanner').BeforeInstallPromptEvent
})

// Keep native numeric validation and keyboard editing, while preventing the
// browser wheel default from silently stepping a focused monetary/quantity field.
// Do not blur: several forms commit edits on blur.
document.addEventListener('wheel', (event) => {
  const input = event.target
  if (input instanceof HTMLInputElement && input.type === 'number' && document.activeElement === input) {
    event.preventDefault()
  }
}, { capture: true, passive: false })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppUpdateNotice />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
