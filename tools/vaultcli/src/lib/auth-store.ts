import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { config } from '../utils/config.js';
import type { AuthData } from '../utils/types.js';

export function saveAuth(data: AuthData): void {
  const dir = dirname(config.authFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(config.authFile, JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
}

export function loadAuth(): AuthData | null {
  try {
    if (!existsSync(config.authFile)) return null;
    const content = readFileSync(config.authFile, 'utf-8');
    return JSON.parse(content) as AuthData;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  try {
    if (existsSync(config.authFile)) unlinkSync(config.authFile);
  } catch { /* ignore */ }
}
