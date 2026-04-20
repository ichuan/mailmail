import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n'
import { ToastProvider } from './components/Toast'
import { AlertDialogProvider } from './components/AlertDialog'

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <ToastProvider>
      <AlertDialogProvider>
        <App />
      </AlertDialogProvider>
    </ToastProvider>
  </I18nProvider>,
)
