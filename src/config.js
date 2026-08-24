// 연결 프로필 저장/읽기.  ~/.deel/config.json  (프로젝트 폴더의 .deel/config.json 이 우선)
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';

const USER_DIR = join(homedir(), '.deel');
const PROJECT_DIR = join(process.cwd(), '.deel');

export function configPath() {
  const local = join(PROJECT_DIR, 'config.json');
  if (existsSync(local)) return local;
  return join(USER_DIR, 'config.json');
}

const EMPTY = { version: 1, active: null, profiles: [] };

export function load() {
  const p = configPath();
  if (!existsSync(p)) return structuredClone(EMPTY);
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return { ...structuredClone(EMPTY), ...raw };
  } catch (err) {
    throw new Error(`설정 파일을 읽지 못했습니다: ${p}\n  ${err.message}`);
  }
}

export function save(cfg, { toProject = false } = {}) {
  const dir = toProject ? PROJECT_DIR : USER_DIR;
  const p = join(dir, 'config.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  // 키가 들어 있는 파일이므로 가능한 환경에서는 본인만 읽게 잠근다.
  try { chmodSync(p, 0o600); } catch {}
  return p;
}

export function activeProfile(cfg = load()) {
  if (!cfg.profiles.length) return null;
  return cfg.profiles.find((x) => x.id === cfg.active) ?? cfg.profiles[0];
}

// 환경변수가 있으면 파일보다 우선한다 — 사내망에서 키를 파일에 안 남기고 싶을 때 쓴다.
export function resolveKey(profile) {
  const byName = profile?.id ? process.env[`DEEL_KEY_${profile.id.toUpperCase()}`] : null;
  return byName || process.env.DEEL_API_KEY || profile?.apiKey || '';
}

export function upsert(cfg, profile) {
  const i = cfg.profiles.findIndex((x) => x.id === profile.id);
  if (i >= 0) cfg.profiles[i] = { ...cfg.profiles[i], ...profile };
  else cfg.profiles.push(profile);
  if (!cfg.active) cfg.active = profile.id;
  return cfg;
}

export function slug(name) {
  const base = String(name).trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'profile';
}
