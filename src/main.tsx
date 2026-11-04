import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import AppUpdateNotice from './components/AppUpdateNotice'

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
