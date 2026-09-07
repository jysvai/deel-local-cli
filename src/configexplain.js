// `deel config explain <칸>` — 이 값은 **어디서 왔나**.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 설정을 읽는 자리가 넷이다 — 관리 정책 · 환경변수 · 프로젝트 설정 · 이 PC
// 설정. 겹치는 규칙은 문서에 적어 두었지만, 문서를 읽는 것과 **지금 이 자리에서
// 무엇이 이겼는지 아는 것**은 다른 일이다.
//
// 막히는 모양은 늘 같다. 파일에 분명히 적어 놨는데 안 먹는다. 그러면 사람은
// 그 파일을 고치고, 또 고치고, 결국 설정이라는 것을 안 믿게 된다. 실제로 값을
// 쥐고 있던 것은 환경변수 하나이거나, 프로젝트 설정을 안 믿는 폴더여서
// 읽지도 않은 것이다. 둘 다 **말해 주면 5초에 끝나는** 일이다.
//
// 그래서 층을 하나씩 열어서 「이 칸을 적어 둔 곳」 을 다 보여 주고, 어느 것이
// 이겼는지 표시한다. 값이 겹칠 때만 쓸모 있는 화면이 아니라, **아무 데도 안
// 적혀 있다**는 것을 보여 줄 때도 똑같이 쓸모 있다.
//
// ── 비밀은 안 보여 준다 ────────────────────────────────────────────────
//
// 열쇠 칸(apiKey)은 값을 안 적고 「적혀 있음」 만 적는다. 이 화면은 그대로
// 캡처되어 사내 메신저로 간다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeDir } from './config.js';
import { 믿나 } from './safety/trust.js';
import { 정책읽기, 정책자리 } from './safety/policy.js';

/** 값을 안 보여 줄 칸. 이름만 봐도 알 수 있는 것만 넣는다. */
const 가릴칸 = new Set(['apiKey', 'key', 'passphrase', '암호']);

/**
 * 이 칸을 정할 수 있는 환경변수.
 *
 * 손으로 적는다. 자동으로 긁으면 「무엇이 이 칸을 이길 수 있나」 가 코드를
 * 읽어야만 아는 것이 되는데, 그건 이 명령이 없애려는 바로 그 상태다.
 */
const 환경변수 = {
  apiKey: ['DEEL_API_KEY', 'DEEL_KEY_<프로필ID>'],
  shell: ['DEEL_SHELL'],
  offline: [],
  proxy: ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'],
  lang: ['DEEL_LANG'],
};

/*
 * 비밀 칸의 값은 **읽는 자리에서** 바꿔치기한다.
 *
 * 그리는 자리에서만 가리면 `--json` 이 날것을 그대로 낸다. 그 출력은
 * 파이프를 타고 로그로, 사내 티켓으로 간다 — 화면만 가려 놓고 안전하다고
 * 하는 것이 이런 자리에서 제일 흔한 사고다.
 */
export const 비밀표시 = '(적혀 있음 — 값은 안 보여 줍니다)';
const 지운값 = (칸, v) => (v !== undefined && 가릴칸.has(칸) ? 비밀표시 : v);

const 값보이기 = (칸, v) => {
  if (v === undefined) return null;
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * 한 칸이 어느 층에 적혀 있나.
 *
 * @param {string} 칸  `offline` 처럼 맨 위 칸, 또는 `profiles.사내.model` 처럼
 *                     프로필 안의 칸
 * @returns {{칸:string, 층들:Array, 이긴층:object|null, 환경변수:string[]}}
 */
export function 설명(칸, { root = process.cwd(), env = process.env } = {}) {
  const 조각 = String(칸 ?? '').split('.').filter(Boolean);
  const 층들 = [];

  const 파일읽기 = (자리) => {
    if (!existsSync(자리)) return { 있나: false };
    try { return { 있나: true, 값: JSON.parse(readFileSync(자리, 'utf8')) }; }
    catch (err) { return { 있나: true, 탈: err?.message ?? String(err) }; }
  };

  const 파고들기 = (덩이) => {
    let 여기 = 덩이;
    for (let i = 0; i < 조각.length; i++) {
      if (여기 == null || typeof 여기 !== 'object') return undefined;
      const 이름 = 조각[i];
      /*
       * `profiles.<이름>.<칸>` 은 배열을 이름으로 뒤진다.
       *
       * 사람이 설정에서 프로필을 부르는 이름은 배열 번호가 아니라 name 이다.
       * 번호로 적게 하면 프로필 하나를 지웠을 때 이 명령이 조용히 딴 것을
       * 가리킨다.
       */
      if (Array.isArray(여기)) {
        여기 = 여기.find((x) => x?.name === 이름 || x?.id === 이름);
        continue;
      }
      여기 = 여기[이름];
    }
    return 여기;
  };

  const 끝칸이름지금 = 조각[조각.length - 1] ?? '';

  // ── 1. 이 PC 설정 (제일 아래) ───────────────────────────────────────
  const 집자리 = join(homeDir(), 'config.json');
  const 집 = 파일읽기(집자리);
  if (집.있나) {
    층들.push({
      층: '이 PC 설정', 자리: 집자리, 읽나: !집.탈,
      값: 집.탈 ? undefined : 지운값(끝칸이름지금, 파고들기(집.값)), 탈: 집.탈 ?? null,
    });
  }

  // ── 2. 프로젝트 설정 (믿는 폴더에서만) ──────────────────────────────
  const 방자리 = join(root, '.deel', 'config.json');
  if (existsSync(방자리)) {
    const 믿나결과 = 믿나(root);
    const 방 = 파일읽기(방자리);
    층들.push({
      층: '프로젝트 설정', 자리: 방자리, 읽나: 믿나결과 && !방.탈,
      값: 방.탈 ? undefined : 지운값(끝칸이름지금, 파고들기(방.값)), 탈: 방.탈 ?? null,
      // 읽지도 않는 파일에 적어 둔 것이 이 화면에서 제일 자주 나오는 답이다.
      왜못읽나: 믿나결과 ? null : '믿는 폴더가 아닙니다 (deel trust)',
    });
  }

  // ── 3. 환경변수 ─────────────────────────────────────────────────────
  const 끝칸 = 조각[조각.length - 1] ?? '';
  const 볼환경 = 환경변수[끝칸] ?? [];
  const 켜진환경 = 볼환경.filter((이름) => !이름.includes('<') && env[이름]);
  if (켜진환경.length) {
    층들.push({
      층: '환경변수', 자리: 켜진환경.join(' · '), 읽나: true,
      값: 지운값(끝칸, env[켜진환경[0]]),
    });
  }

  // ── 4. 관리 정책 (제일 위) ──────────────────────────────────────────
  const 정책 = 정책읽기({ env, 다시: true });
  if (정책.값 && typeof 정책.값 === 'object') {
    const 그값 = 정책.값[끝칸];
    if (그값 !== undefined) {
      층들.push({ 층: '관리 정책', 자리: 정책.곳 ?? 정책자리(env)[0], 읽나: true, 값: 지운값(끝칸, 그값) });
    }
  }

  // 이긴 층 — 뒤에 온 것이 이긴다. 다만 **읽는 층** 중에서만 고른다.
  const 쓸수있는것 = 층들.filter((x) => x.읽나 && x.값 !== undefined);
  const 이긴층 = 쓸수있는것.length ? 쓸수있는것[쓸수있는것.length - 1] : null;

  return { 칸, 층들, 이긴층, 환경변수: 볼환경 };
}

/** 화면에 그릴 줄들. 색은 부르는 쪽이 입힌다. */
export function 설명줄들(r) {
  const 줄 = [];
  if (r.이긴층) 줄.push({ 갈래: '값', 글: `${값보이기(끝칸이름(r.칸), r.이긴층.값)}`, 곁: `${r.이긴층.층}` });
  else 줄.push({ 갈래: '없음', 글: '아무 데도 안 적혀 있습니다 (기본값으로 돕니다)', 곁: null });

  for (const 층 of r.층들) {
    const 값 = 값보이기(끝칸이름(r.칸), 층.값);
    줄.push({
      갈래: 층 === r.이긴층 ? '이김' : (층.읽나 ? '아래' : '안읽음'),
      글: `${층.층}`,
      곁: [
        층.자리,
        값 !== null ? `= ${값}` : '(이 칸은 없음)',
        층.왜못읽나 ? `— ${층.왜못읽나}` : null,
        층.탈 ? `— 못 읽었습니다: ${층.탈}` : null,
      ].filter(Boolean).join('  '),
    });
  }
  if (r.환경변수.length) {
    줄.push({ 갈래: '참고', 글: '이 칸을 이길 수 있는 환경변수', 곁: r.환경변수.join(' · ') });
  }
  return 줄;
}

const 끝칸이름 = (칸) => String(칸 ?? '').split('.').filter(Boolean).pop() ?? '';
