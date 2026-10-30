import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import AppUpdateNotice from './components/AppUpdateNotice'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppUpdateNotice />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
