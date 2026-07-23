import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AdminApp from './admin/AdminApp';
import './styles.css';

// 배포 직후 문제: 무거운 기능(docx·excel·OCR·규정추출)은 동적 import로 나눠 담는데,
// 새로 배포하면 청크 파일명(해시)이 바뀐다. 그 전에 페이지를 열어둔 브라우저는 사라진 옛
// 청크를 찾다가 실패한다("문서 생성에 실패했습니다"의 진짜 원인). 이때는 새 index.html을
// 받도록 페이지를 한 번 새로고침하면 풀린다. 무한 새로고침을 막으려 세션당 한 번만 시도한다.
const RELOAD_ONCE_KEY = 'gwajeon.chunk-reload';
const reloadForStaleChunk = () => {
  if (sessionStorage.getItem(RELOAD_ONCE_KEY)) return;   // 새로고침해도 안 풀리면 진짜 오류다 — 무한루프 방지
  try { sessionStorage.setItem(RELOAD_ONCE_KEY, '1'); } catch { /* 저장 안 돼도 아래에서 새로고침은 한다 */ }
  window.location.reload();
};
// Vite가 청크 preload 실패를 이 이벤트로 알린다.
window.addEventListener('vite:preloadError', (event) => { event.preventDefault(); reloadForStaleChunk(); });
// 동적 import가 던지는 청크 로드 실패도 잡는다 (preloadError로 안 걸리는 경로 대비).
window.addEventListener('unhandledrejection', (event) => {
  const message = String((event.reason as { message?: string })?.message ?? event.reason ?? '');
  if (/dynamically imported module|Importing a module script failed|Failed to fetch dynamically/.test(message)) reloadForStaleChunk();
});

// 시스템 관리자 화면은 일반 로그인/사용자 계정과 완전히 분리된 별도 화면이다 — /admin 경로로만 접근.
const isAdminRoute = window.location.pathname.replace(/\/$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdminRoute ? <AdminApp /> : <App />}</StrictMode>,
);
