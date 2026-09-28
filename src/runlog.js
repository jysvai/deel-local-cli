// `deel run` 이 밖으로 내는 두 가지 — 바뀐 파일 목록과 사건 흐름 (2.1.3).
//
// oneshot.js 에서 따로 둔다. 거기는 이미 천 줄이 넘고, 이 둘은 「루프가 내는 사건을 받아 밖에 적는다」
// 는 한 가지 일만 한다 — 루프의 속을 몰라도 되고, 그래서 따로 잴 수 있다.

import { openSync, writeSync, closeSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

/*
 * ── 바뀐 파일 ─────────────────────────────────────────────────────────
 *
 * 루프는 턴이 끝날 때 손댄 파일을 `done` · `stuck` · `limit` 에 실어 준다(agent/loop.js 의 마무리).
 * 그런데 끊기거나(aborted) 터진(error) 턴은 그 목록 없이 끝난다 — 스크립트가 제일 알고 싶은 것이
 * 「반쯤 하다 멈췄는데 무엇을 건드렸나」 인데. 그래서 도구 사건마다 루프와 같은 세 칸을 보고 모은다.
 * 끝 사건이 준 목록도 합친다 — 하위 작업이 바꾼 것은 거기에만 온다.
 *
 * 작업 폴더 기준 경로로, 슬래시로 적는다. 스크립트는 `jq -r '.files[]' | xargs git add` 처럼 쓴다 —
 * 윈도우 역슬래시나 절대 경로가 섞이면 그 한 줄이 운영체제마다 달라진다. 폴더 밖은 절대 경로 그대로 둔다.
 */
export function 바뀐파일모음(root) {
  const 모음 = new Set();
  const 담기 = (p) => {
    if (typeof p !== 'string' || !p) return;
    const 온경로 = resolve(root, p);
    const 상대 = relative(root, 온경로);
    const 밖인가 = !상대 || 상대.startsWith('..') || isAbsolute(상대);
    모음.add((밖인가 ? 온경로 : 상대).split(sep).join('/'));
  };
  return {
    사건(ev) {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'tool' && ev.result && !ev.result.error) {
        const r = ev.result;
        담기(r.changed);
        for (const f of r.여럿 ?? []) if (f?.ok) 담기(f.path);
        for (const f of r.바뀐것들 ?? []) 담기(f);
      }
      for (const f of Array.isArray(ev.files) ? ev.files : []) 담기(f?.path);
    },
    목록: () => [...모음].sort(),
  };
}

/*
 * ── 사건 흐름 (--events <파일>) ───────────────────────────────────────
 *
 * 끝날 때 한 덩이만 나오면 오래 도는 잡을 지켜볼 수가 없다. 사건을 한 줄에 하나씩 JSON 으로 흘린다 —
 * `tail -f` 로 보고, 끝나면 `jq` 로 훑는다. 마지막 줄은 `--json` 과 같은 결과 한 덩이다(type: 'result').
 *
 * 글자 조각(content · thinking)은 안 싣는다. 흘려받는 서버면 한 턴에 수천 줄이 되고, 답은 마지막 줄에
 * 이미 통째로 있다. 긴 글은 잘라 싣는다 — 큰 파일을 읽은 도구 결과 하나가 한 줄에 통째로 실리면
 * 사건 파일이 읽은 파일들의 사본이 된다.
 *
 * `type` 칸은 약속이다. 나머지 칸은 판마다 늘 수 있다 — 루프가 화면에 주는 것을 그대로 옮긴다.
 */
export const 사건글한도 = 4000;
const 안싣는것 = new Set(['content', 'thinking']);

export function 사건줄(ev, 흐른ms, { 통째 = false } = {}) {
  const 자르기 = (_k, v) => (typeof v === 'string' && v.length > 사건글한도
    ? `${v.slice(0, 사건글한도)}…(+${v.length - 사건글한도})`
    : v);
  try {
    return JSON.stringify({ ...ev, elapsed: 흐른ms }, 통째 ? undefined : 자르기);
  } catch {
    // 제자리를 도는 값 같은 것. 무엇이 있었는지는 남긴다 — 통째로 빼면 그 자리가 비어 보인다.
    return JSON.stringify({ type: String(ev?.type ?? '?'), elapsed: 흐른ms, 못적음: true });
  }
}

/**
 * 사건 파일을 연다. 못 열면 던진다 — 부르는 쪽이 일을 시작하기 **전에** 선다.
 *
 * 다 돌고 나서 「사건 파일을 못 열었습니다」 면 지켜보려던 사람은 아무것도 못 봤다. 도중에 못 쓰게
 * 되면(디스크 가득) 한 번 알리고 그만 적는다 — 기록을 남기려다 일을 죽이면 본말이 뒤집힌다.
 */
export function 사건적기열기(경로, { 시작 = Date.now(), 알림 = () => {} } = {}) {
  const fd = openSync(경로, 'w');
  let 막힘 = false;
  let 닫힘 = false;
  const 한줄 = (글) => {
    if (막힘 || 닫힘) return;
    try { writeSync(fd, `${글}\n`); }
    catch (err) { 막힘 = true; 알림(err?.code ?? err?.message ?? String(err)); }
  };
  return {
    적기(ev) {
      if (!ev || 안싣는것.has(ev.type)) return;
      한줄(사건줄(ev, Date.now() - 시작));
    },
    // 결과 줄은 자르지 않는다 — 답이 거기에 통째로 있다는 것이 위 약속이다(--json 과 같은 덩이).
    결과(r) { 한줄(사건줄({ type: 'result', ...r }, Date.now() - 시작, { 통째: true })); },
    닫기() {
      if (닫힘) return;
      닫힘 = true;
      try { closeSync(fd); } catch { /* 이미 닫혔으면 그만 */ }
    },
  };
}
