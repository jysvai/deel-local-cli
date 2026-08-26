// 연결 프로필 저장/읽기.  ~/.deel/config.json  (프로젝트 폴더의 .deel/config.json 이 우선)
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';

// 설정이 놓이는 자리.
//
// DEEL_HOME 을 주면 그 폴더를 쓴다. 두 군데서 필요했다 —
//   1) 사내에서 USB·공유폴더에 통째로 넣어 쓰는 휴대용 설치.
//      집 폴더가 로밍 프로필이면 설정이 엉뚱한 데로 따라다닌다.
//   2) 검사. 예전에는 검사가 진짜 설정 파일에 값을 써 버렸다.
//      실제로 /level 검사가 사용자 설정을 바꾼 것을 보고 이걸 넣었다.
//
// 모듈을 읽을 때가 아니라 쓸 때마다 본다. 그래야 부르는 쪽에서 언제 정하든 먹는다.
function userDir() {
  return process.env.DEEL_HOME ? resolve(process.env.DEEL_HOME) : join(homedir(), '.deel');
}
function projectDir() {
  return join(process.cwd(), '.deel');
}

/**
 * 이 PC 의 설정 폴더 (`~/.deel` 또는 DEEL_HOME).
 *
 * configPath() 와 다르다 — 저쪽은 프로젝트에 설정이 있으면 그쪽을 준다.
 * 여기는 언제나 **이 PC 것**이다. 모델에 대해 알아낸 것처럼 폴더를 옮겨도
 * 따라와야 하는 것을 여기 둔다 (agent/evolve.js).
 */
export function homeDir() { return userDir(); }

export function configPath() {
  const local = join(projectDir(), 'config.json');
  if (existsSync(local)) return local;
  return join(userDir(), 'config.json');
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
  const dir = toProject ? projectDir() : userDir();
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
