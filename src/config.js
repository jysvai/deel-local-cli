// 연결 프로필 저장/읽기.  ~/.deel/config.json  (프로젝트 폴더의 .deel/config.json 이 우선)
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { 프록시정하기 } from './backend/proxy.js';
import { 셸정하기 } from './tools/shell.js';
import { 애저정하기 } from './backend/azure.js';
import { 정책읽기 } from './safety/policy.js';
import { 잠그기, 풀기, 잠긴것인가, 쓸수있나, 보관방식 } from './safety/keystore.js';

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

/*
 * 열쇠를 이 PC 의 잠금장치에 옮긴다 (safety/keystore.js).
 *
 * 예전 판이 평문으로 적어 둔 설정이 그대로 남아 있다. 사람더러 다시 넣으라고
 * 하면 대부분 안 한다 — 지금 잘 되고 있으니까. 그래서 **처음 읽을 때 한 번**
 * 조용히 옮기고, 옮겼다는 것만 한 줄로 알린다.
 *
 * 못 잠그면 파일을 아예 안 건드린다. 반쯤 잠근 파일을 남기면 그 뒤로는
 * 무엇이 잠긴 것이고 무엇이 평문인지 아무도 모른다.
 *
 * DEEL_KEYSTORE=off 면 안 한다 — 잠금장치가 정책으로 막힌 곳에서 매번
 * 파워셸을 두드리며 느려지는 것을 사람이 끌 수 있어야 한다.
 */
let 옮겨봤나 = false;
let 소식 = null;

/** 열쇠를 옮겼으면 그 한 줄을 준다. 한 번 읽으면 지워진다 (두 번 안 알린다). */
export function 잠금소식() { const s = 소식; 소식 = null; return s; }

/** 화면·심사서에 그대로 쓰는 '열쇠를 어디에 두나' 한 줄. */
export function 열쇠보관(cfg = null) {
  const p = cfg ? activeProfile(cfg) : null;
  return 보관방식(p?.apiKey ?? null);
}

function 잠금옮기기(cfg) {
  if (옮겨봤나 || process.env.DEEL_KEYSTORE === 'off') return;
  옮겨봤나 = true;
  const 평문 = (cfg.profiles ?? []).filter((p) => p?.apiKey && !잠긴것인가(p.apiKey));
  if (!평문.length) return;
  if (!쓸수있나().되나) return;

  let 옮김 = 0;
  for (const p of 평문) {
    const 잠근것 = 잠그기(p.apiKey);
    if (잠근것) { p.apiKey = 잠근것; 옮김 += 1; }
  }
  if (!옮김) return;
  try {
    // 읽은 자리에 그대로 되쓴다. 프로젝트 설정을 홈으로 옮겨 버리면
    // 이 폴더에서만 쓰던 열쇠가 온 컴퓨터의 기본값이 된다.
    const 프로젝트것 = configPath() === join(projectDir(), 'config.json');
    save(cfg, { toProject: 프로젝트것 });
    const 방식 = 쓸수있나().방식 === 'keychain' ? '키체인' : 'DPAPI';
    소식 = 옮김 === 1
      ? `게이트웨이 열쇠를 이 PC 계정에서만 풀리게 잠갔습니다 (${방식})`
      : `게이트웨이 열쇠 ${옮김}개를 이 PC 계정에서만 풀리게 잠갔습니다 (${방식})`;
  } catch { /* 못 쓰면 그냥 둔다 — 메모리에만 잠긴 채로 이번 판을 쓴다 */ }
}

export function load() {
  const cfg = 읽기();
  잠금옮기기(cfg);
  // 프록시는 설정을 읽는 자리에서 정한다. run · acp · setup · diagnose 어느 문으로
  // 들어와도 한 번은 여기를 지나므로, 여기가 빠뜨리지 않는 유일한 자리다.
  프록시정하기({ config: cfg });
  // 명령을 돌릴 셸도 같은 까닭으로 여기서 정한다 (tools/shell.js).
  셸정하기({ config: cfg });
  // Azure 판 번호(api-version)도 같은 자리에서 정한다 (backend/azure.js).
  애저정하기({ config: cfg });
  // 관리 정책이 걸려 있으면 여기서 덮어쓴다 (safety/policy.js).
  정책덮기(cfg);
  return cfg;
}

/*
 * 관리 정책이 정한 것을 설정 위에 덮는다.
 *
 * 정책은 설정을 **이긴다.** 설정 파일은 쓰는 사람 것이라 지우고 고칠 수 있고,
 * 그래서 "이번 배포 동안은 이 게이트웨이만" 같은 것을 적어 둘 자리가 아니다.
 *
 * 그렇다고 정책이 **풀어 주지는 못한다.** offline 을 켤 수는 있어도 끌 수는
 * 없고, 금지를 더할 수는 있어도 사용자가 적어 둔 금지를 지우지는 못한다.
 * 정책 파일 한 줄로 안전장치가 헐거워지는 길을 안 낸다.
 */
function 정책덮기(cfg) {
  const 정책 = 정책읽기().값;
  if (!정책 || typeof 정책 !== 'object') return cfg;

  if (typeof 정책.baseUrl === 'string' && 정책.baseUrl.trim()) {
    for (const 프로필 of cfg.profiles ?? []) 프로필.baseUrl = 정책.baseUrl.trim();
    cfg.정책주소 = 정책.baseUrl.trim();
  }
  if (정책.offline === true) cfg.offline = true;      // 끄지는 못한다 — 켜기만
  if (Array.isArray(정책.permissions?.deny)) {
    cfg.permissions = cfg.permissions ?? {};
    const 있던것 = Array.isArray(cfg.permissions.deny) ? cfg.permissions.deny : [];
    cfg.permissions.deny = [...new Set([...있던것, ...정책.permissions.deny])];
  }
  return cfg;
}

function 읽기() {
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
  // 평문 열쇠는 여기서 잠근다. 설정을 쓰는 길이 여기 하나뿐이라, 여기만
  // 지키면 평문이 새 파일로 나갈 자리가 없다. 못 잠그면 평문으로 두되
  // (아무것도 못 하는 것보다 낫다) 화면과 심사서에 그렇게 적는다.
  if (process.env.DEEL_KEYSTORE !== 'off') {
    for (const 프로필 of cfg?.profiles ?? []) {
      if (!프로필?.apiKey || 잠긴것인가(프로필.apiKey)) continue;
      const 잠근것 = 잠그기(프로필.apiKey);
      if (잠근것) 프로필.apiKey = 잠근것;
    }
  }
  writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  // 키가 들어 있는 파일이므로 가능한 환경에서는 본인만 읽게 잠근다.
  try { chmodSync(p, 0o600); } catch {}
  return p;
}

/**
 * 설정을 남긴다. 못 남겨도 던지지 않고, **왜 못 남겼는지를 돌려준다.**
 *
 * 부르는 자리가 아홉 군데인데 전부 `try { save(cfg) } catch {}` 였다. 「못
 * 남겨도 이번 세션에는 먹는다」 는 맞는 말이지만, 그 뒤에 화면은 `✓` 를
 * 찍는다 — 사람은 정해진 줄 알고 다음에 창을 열었다가 옛 값을 본다. 그리고
 * 그때는 무엇 때문인지 알 길이 없다(홈이 읽기 전용인지, 디스크가 찼는지).
 *
 * 던지는 것은 안 바꾼다. 설정 하나 못 적었다고 대화가 끊기면 본말이 뒤집힌다.
 *
 * @returns {{ok: true, 자리: string} | {ok: false, 왜: string}}
 */
export function 저장시도(cfg, 옵션 = {}) {
  try { return { ok: true, 자리: save(cfg, 옵션) }; }
  catch (err) { return { ok: false, 왜: err?.message ?? String(err) }; }
}

export function activeProfile(cfg = load()) {
  if (!cfg.profiles.length) return null;
  return cfg.profiles.find((x) => x.id === cfg.active) ?? cfg.profiles[0];
}

// 환경변수가 있으면 파일보다 우선한다 — 사내망에서 키를 파일에 안 남기고 싶을 때 쓴다.
const 푼것 = new Map();     // 잠긴 값 → 푼 글. 한 판에 한 번만 풀면 된다.

/**
 * 잠근 열쇠를 못 푼 까닭. 화면이 한 번 읽어 가면 지워진다.
 *
 * ── 왜 있어야 하나 ──────────────────────────────────────────────────────
 *
 * keystore.js 의 풀기() 는 왜 못 풀었는지를 성실하게 만들어 돌려준다 —
 * 「이 PC 의 이 계정에서 잠근 것만 풀립니다」 같은 말이다. 그 함수 머리말이
 * 그렇게 하는 까닭까지 적어 뒀다: **빈 글자만 돌려주면 사람은 401 만 보고
 * 게이트웨이를 의심한다.**
 *
 * 그런데 부르는 쪽이 그 말을 버리고 있었다. 빈 열쇠가 나가면 http.js 는
 * Authorization 머리말을 아예 안 붙이고, 게이트웨이는 401 을 준다. 사람은
 * 방화벽·주소·계정을 뒤진다. 진짜 까닭은 「설정 파일을 다른 PC 로 옮겼다」 인데.
 */
let 열쇠탈 = null;
export function 열쇠탈소식() { const s = 열쇠탈; 열쇠탈 = null; return s; }

/**
 * 이 이름의 환경변수는 **열쇠를 담나.**
 *
 * ── 왜 이 자가 있어야 하나 ────────────────────────────────────────────
 *
 * 열쇠는 두 이름으로 들어온다 — `DEEL_API_KEY` 하나, 그리고 프로필마다
 * `DEEL_KEY_<프로필>`. 아래 resolveKey 가 그 둘을 다 읽는다.
 *
 * 그런데 **막는 쪽은 하나만 알고 있었다.** 자식에게 넘길 환경을 씻는 자
 * (backend/mcp.js 의 열쇠뺀환경)도, 도구 출력에서 값을 가리는 자
 * (agent/loop.js)도 `DEEL_API_KEY` 만 지웠다. 그래서 프로필 열쇠를 쓰는
 * 사람은 `Bash({command:'env'})` 한 줄로 열쇠가 화면에 찍히고, 그 화면이
 * 대화에 실려 **그 열쇠의 주인인 게이트웨이로** 나가고 `.deel/sessions/*.jsonl`
 * 에 남는다.
 *
 * 하필 그 방법을 우리가 권한다 — pack/sbom.js 와 pack/sheet.en.js 의 사내
 * 심사용 명세가 「환경변수를 쓰면 파일에 아예 안 남습니다」 라고 적어 뒀다.
 * 권한 대로 한 사람만 샌 셈이다.
 *
 * 읽는 자리와 막는 자리가 **같은 자에게 물어야** 이런 일이 안 난다. 이름이
 * 하나 늘면 여기만 고친다.
 *
 * 윈도우는 환경변수 이름의 대소문자를 안 가린다(`deel_api_key` 도 같은 값이다).
 * 그래서 견줄 때 대문자로 올린다.
 */
export function 열쇠환경인가(이름) {
  const n = String(이름 ?? '').toUpperCase();
  return n === 'DEEL_API_KEY' || n.startsWith('DEEL_KEY_');
}

/** 환경에 실제로 들어 있는 **열쇠 값들.** 가릴 때 쓴다. */
export function 환경속열쇠들(env = process.env) {
  const out = [];
  for (const [k, v] of Object.entries(env ?? {})) {
    if (열쇠환경인가(k) && typeof v === 'string' && v) out.push(v);
  }
  return out;
}

export function resolveKey(profile) {
  const byName = profile?.id ? process.env[`DEEL_KEY_${profile.id.toUpperCase()}`] : null;
  const 값 = byName || process.env.DEEL_API_KEY || profile?.apiKey || '';
  if (!잠긴것인가(값)) return 값;
  // 푸는 데 파워셸을 한 번 부른다(0.2초쯤). 한마디마다 부르면 그게 다 사람이
  // 기다리는 시간이라, 판에 한 번만 풀고 들고 있는다.
  if (푼것.has(값)) return 푼것.get(값);
  const r = 풀기(값);
  if (!r.ok) {
    /*
     * **실패는 안 담아 둔다.**
     *
     * 담아 두면 그 판 내내 다시 시도조차 안 한다. 사람이 그 사이에
     * `deel setup` 으로 열쇠를 다시 넣어도 이 판에서는 영영 안 풀린다.
     * 푸는 값이 0.2초라, 안 되는 것을 아껴서 얻을 것이 없다.
     */
    열쇠탈 = r.why || '잠근 열쇠를 못 풀었습니다';
    return '';
  }
  푼것.set(값, r.text);
  return r.text;
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
