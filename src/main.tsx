import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AdminApp from './admin/AdminApp';
import './styles.css';

// 시스템 관리자 화면은 일반 로그인/사용자 계정과 완전히 분리된 별도 화면이다 — /admin 경로로만 접근.
const isAdminRoute = window.location.pathname.replace(/\/$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdminRoute ? <AdminApp /> : <App />}</StrictMode>,
);
