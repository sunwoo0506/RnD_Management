import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: vi.fn(() => `id-${Math.random().toString(36).slice(2)}`) },
  configurable: true,
});

Object.defineProperty(window, 'alert', { value: vi.fn(), configurable: true });
Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), configurable: true });
