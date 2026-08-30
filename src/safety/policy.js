// 무엇을 늘 허락하고 무엇을 절대 안 할지, 그리고 그것을 누가 정하는지.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 지금까지 승인은 세 가지 모드뿐이었다 — 안 묻거나(auto), 파일을 바꾸는
// 명령만 묻거나(confirm), 바꾸는 도구를 다 묻거나(strict). 그 사이가 없다.
//
//   `npm test` 는 하루에 스무 번 돌린다. 스무 번 묻는다.
//   `curl` 은 한 번도 돌게 하고 싶지 않다. 그런데 물어보기만 한다 — 물어보는
//   것은 막는 것이 아니다. 사람은 스무 번 y 를 친 손으로 스물한 번째도 친다.
//
// 그래서 규칙을 적어 둘 수 있게 한다.
//
//     "permissions": {
//       "allow": ["Bash(npm test*)", "Read", "Grep"],
//       "deny":  ["Bash(curl*)", "Bash(rm -rf*)", "WebFetch"]
//     }
//
// ── 그리고 그것을 누가 정하는가 ────────────────────────────────────────
//
// 설정 파일은 **쓰는 사람의 것**이다. 지우고 고칠 수 있다. 그래서 회사가
// "이번 배포 동안은 이 게이트웨이만" 이라고 정해야 할 때 쓸 자리가 아니다.
// 그 자리가 관리 정책 파일이다 — 사용자가 못 고치는 곳에 둔다.
//
//     %ProgramData%\deel\policy.json   /etc/deel/policy.json   $DEEL_POLICY
//
// 정책은 설정을 **이긴다.** 그리고 정책은 넓히지 못한다 — 금지를 더할 수는
// 있어도 사용자가 적어 둔 금지를 풀어 주지는 못한다. 관리자가 실수로,
// 또는 누가 정책 파일을 바꿔치기해서 안전장치가 헐거워지는 길을 안 낸다.
//
// ── 순서 ───────────────────────────────────────────────────────────────
//
//   금지 > 허락 > 모드
//
// 금지가 제일 세다. 허락과 금지에 같이 걸리면 금지다. 둘 다 아니면 예전처럼
// 모드가 정한다. 그리고 무엇 때문에 막혔는지 **어디에 적힌 규칙인지까지**
// 화면에 말한다 — 그 말이 없으면 사람은 제 설정을 고칠 수도, 관리자에게
// 무엇을 풀어 달라고 할 수도 없다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** 관리 정책 파일을 찾을 자리들. 앞에서부터 처음 있는 것 하나만 쓴다. */
export function 정책자리(env = process.env, platform = process.platform) {
  const 것들 = [];
  if (env.DEEL_POLICY) 것들.push(env.DEEL_POLICY);
  if (platform === 'win32') {
    것들.push(join(env.ProgramData || 'C:\\ProgramData', 'deel', 'policy.json'));
  } else {
    것들.push('/etc/deel/policy.json');
  }
  return 것들;
}

let 읽은정책 = null;      // { 값, 곳 } — 한 번 읽고 이 프로세스 동안 안 다시 읽는다

/*
 * 관리 정책을 읽는다.
 *
 * 못 읽거나 망가져 있으면 **없는 것으로 친다.** 여기서 프로그램을 멈추면
 * 정책 파일 하나가 깨진 것으로 그 PC 의 deel 이 통째로 안 뜬다. 대신 왜
 * 못 읽었는지를 들고 있다가 화면에 적는다 — 조용히 무시하면 관리자는
 * 정책이 걸린 줄 알고, 사용자는 안 걸린 채로 쓴다.
 */
export function 정책읽기({ env = process.env, platform = process.platform, 다시 = false } = {}) {
  if (읽은정책 && !다시) return 읽은정책;
  for (const 곳 of 정책자리(env, platform)) {
    if (!existsSync(곳)) continue;
    try {
      const 값 = JSON.parse(readFileSync(곳, 'utf8'));
      읽은정책 = { 값: 값 && typeof 값 === 'object' ? 값 : {}, 곳, 탈: null };
      return 읽은정책;
    } catch (err) {
      읽은정책 = { 값: {}, 곳, 탈: `정책 파일을 못 읽었습니다 (${err.message})` };
      return 읽은정책;
    }
  }
  읽은정책 = { 값: {}, 곳: null, 탈: null };
  return 읽은정책;
}

/** 검사가 원래대로 돌려놓을 때. */
export function 정책잊기() { 읽은정책 = null; }

/*
 * `Tool(무늬)` 를 읽는다.
 *
 *   Bash            — Bash 는 전부
 *   Bash(npm test*) — 명령이 `npm test` 로 시작하는 것
 *   Bash(*rm -rf*)  — 어디에 있든 그 글자가 든 것
 *   Read(src/**)    — 경로 무늬
 *
 * 무늬가 없으면 그 도구 전체다. 별표만 특별하고 나머지는 글자 그대로다 —
 * 정규식을 받으면 적는 사람이 실수하기 쉽고, 실수한 금지 규칙은 안 걸린다.
 */
export function 규칙읽기(줄) {
  const s = String(줄 ?? '').trim();
  if (!s) return null;
  const m = /^([A-Za-z_][\w-]*)\s*\((.*)\)\s*$/s.exec(s);
  if (!m) return { 도구: s, 무늬: null, 원문: s };
  return { 도구: m[1], 무늬: m[2].trim(), 원문: s };
}

function 무늬맞나(무늬, 값) {
  if (!무늬) return true;
  const 글 = String(값 ?? '');
  // 별표만 뜻을 갖는다. 나머지는 글자 그대로.
  const re = new RegExp(`^${무늬.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
  return re.test(글);
}

/*
 * 이 규칙이 이 호출에 걸리나.
 *
 * 무엇을 무늬에 맞춰 보는지는 도구마다 다르다. Bash 는 명령, 파일 도구는
 * 경로다. 도구가 여러 인자를 받는 경우 **첫 번째로 뜻이 통하는 것**을 본다.
 */
export function 걸리나(규칙, 도구, 인자) {
  if (!규칙 || 규칙.도구 !== 도구) return false;
  if (!규칙.무늬) return true;
  const a = 인자 ?? {};
  const 볼것 = [a.command, a.file_path, a.path, a.pattern, a.url, a.query]
    .filter((x) => typeof x === 'string');
  if (!볼것.length) return false;
  return 볼것.some((v) => 무늬맞나(규칙.무늬, v));
}

function 목록(값) {
  return (Array.isArray(값) ? 값 : []).map(규칙읽기).filter(Boolean);
}

/**
 * 지금 걸려 있는 규칙 전부. 어디에 적힌 것인지를 같이 들고 다닌다.
 *
 * @returns {{allow:Array, deny:Array, 정책곳:string|null, 탈:string|null, baseUrl:string|null, offline:boolean}}
 */
export function 규칙모으기(cfg, { env = process.env, platform = process.platform } = {}) {
  const 정책 = 정책읽기({ env, platform });
  const p = 정책.값?.permissions ?? {};
  const c = cfg?.permissions ?? {};
  return {
    allow: [
      ...목록(c.allow).map((r) => ({ ...r, 출처: '설정' })),
      // 정책은 허락도 적을 수 있다 — 사내 표준 명령을 미리 풀어 두는 자리다.
      ...목록(p.allow).map((r) => ({ ...r, 출처: '관리 정책' })),
    ],
    deny: [
      ...목록(c.deny).map((r) => ({ ...r, 출처: '설정' })),
      ...목록(p.deny).map((r) => ({ ...r, 출처: '관리 정책' })),
    ],
    정책곳: 정책.곳,
    탈: 정책.탈,
    baseUrl: typeof 정책.값?.baseUrl === 'string' ? 정책.값.baseUrl : null,
    offline: 정책.값?.offline === true,
  };
}

/**
 * 이 도구 호출을 어떻게 할까.
 *
 * @returns {{답: 'deny'|'allow'|'모름', 출처: string|null, 규칙: string|null}}
 *   deny  — 하지 않는다. 물어보지도 않는다.
 *   allow — 모드가 뭐든 안 묻고 한다.
 *   모름  — 예전대로 모드가 정한다.
 */
export function 어떻게할까(규칙들, 도구, 인자) {
  // 금지가 먼저다. 허락과 금지에 같이 걸리면 금지다 — 반대로 하면 규칙 하나를
  // 잘못 적어 둔 것으로 금지가 통째로 무력해진다.
  for (const r of 규칙들?.deny ?? []) {
    if (걸리나(r, 도구, 인자)) return { 답: 'deny', 출처: r.출처, 규칙: r.원문 };
  }
  for (const r of 규칙들?.allow ?? []) {
    if (걸리나(r, 도구, 인자)) return { 답: 'allow', 출처: r.출처, 규칙: r.원문 };
  }
  return { 답: '모름', 출처: null, 규칙: null };
}

/**
 * 늘 허락할 것에 한 줄 더한다 (ACP 의 '이건 앞으로 묻지 마세요').
 *
 * 이미 금지에 적혀 있으면 **안 더한다.** 더해 봐야 금지가 이기니 아무 일도
 * 안 일어나는데, 목록에는 허락으로 적혀 있어 사람이 풀린 줄 안다.
 * 그 어긋남이 규칙표를 못 믿게 만든다.
 */
export function 늘허락(cfg, 줄, 규칙들 = null) {
  const 규칙 = 규칙읽기(줄);
  if (!규칙) return { ok: false, 왜: '규칙이 비었습니다' };
  if (규칙들) {
    for (const d of 규칙들.deny ?? []) {
      if (d.도구 === 규칙.도구 && (!d.무늬 || d.무늬 === 규칙.무늬)) {
        return { ok: false, 왜: `${d.출처}의 금지(${d.원문})와 부딪칩니다 — 금지가 이깁니다` };
      }
    }
  }
  cfg.permissions = cfg.permissions ?? {};
  cfg.permissions.allow = Array.isArray(cfg.permissions.allow) ? cfg.permissions.allow : [];
  if (!cfg.permissions.allow.includes(규칙.원문)) cfg.permissions.allow.push(규칙.원문);
  return { ok: true, 규칙: 규칙.원문 };
}

/** 화면에 한 줄로 적을 말. 아무것도 안 걸려 있으면 빈 글. */
export function 규칙말(규칙들) {
  if (!규칙들) return '';
  const 조각 = [];
  if (규칙들.allow.length) 조각.push(`허락 ${규칙들.allow.length}`);
  if (규칙들.deny.length) 조각.push(`금지 ${규칙들.deny.length}`);
  if (규칙들.정책곳) 조각.push(`관리 정책 ${규칙들.정책곳}`);
  if (규칙들.탈) 조각.push(규칙들.탈);
  return 조각.join(' · ');
}
