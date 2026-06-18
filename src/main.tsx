import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppRouter from './src/AppRouter.tsx';
import { AuthProvider } from './src/context/AuthContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  </StrictMode>,
);
