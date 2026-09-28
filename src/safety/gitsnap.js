/**
 * 셸이 바꾼 파일을 git 으로 알아내 되돌리기에 올린다 (2.1.3).
 *
 * ── 왜 이게 필요한가 ───────────────────────────────────────────────────
 *
 * Bash 의 되돌리기는 **명령줄에 적힌 이름**을 보고 떴다(tools/index.js 의 바꾸기전스냅샷). 셸이 푸는
 * 와일드카드(`rm *.tmp`)와 스크립트 안에서 고치는 것(`npm run format` · `node 고치기.js` ·
 * `npx prettier --write .`)은 이름이 명령줄에 없어 떠 둔 것이 없었고, /undo 뒤에도 그대로였다.
 * 모델이 파일을 제일 많이 바꾸는 길이 바로 그 둘이다.
 *
 * ── 어떻게 ────────────────────────────────────────────────────────────
 *
 * 명령 **앞**에 `git status` 로 지금 고치던 것 · 안 올린 것을 보고, 그 파일들만 사본을 떠 둔다(보통 몇 개다).
 * 명령 **뒤**에 한 번 더 보고 견준다.
 *
 *   앞에 깨끗했던 파일이 바뀌거나 사라졌다  → 앞 모습은 명령 전 HEAD 에 있다 (git 이 들고 있다). git 이 작업 폴더에
 *                                          꺼내 줄 모습으로 받는다 — `git restore` 와 같다(줄 끝 변환까지 · 헤드꺼내기)
 *   앞에 고치던 · 안 올린 파일이 바뀌었다   → 앞 모습은 떠 둔 사본
 *   앞에 없던 파일이 생겼다                → 「원래 없던 자리」 — 되돌리면 지운다
 *
 * 그렇게 안 것을 되돌리기 이력(safety/undo.js)에 **여느 기록과 같은 모양으로** 적는다. 그러면 /undo 가
 * 밖을 가리키는 기록 · 링크 너머 · 바이너리를 다루는 규칙을 그대로 탄다 — 되돌리는 길을 새로 만들지 않는다.
 *
 * ── 안 하는 것 ────────────────────────────────────────────────────────
 *
 *   · .git 에 아무것도 안 쓴다. `git add` 로 나무를 뜨는 길도 있었지만, 그러면 명령마다 남의 저장소에
 *     객체를 쌓는다(큰 파일이면 크게). 읽기만 하는 status · cat-file 만 부르고, status 도
 *     `--no-optional-locks` 로 색인을 안 고친다.
 *   · 무시되는 파일(.gitignore)은 못 본다 — git 이 안 보는 자리다. 못 본 것을 되돌린다고 말하지 않는다.
 *   · git 의 색인(스테이징)과 커밋은 안 되돌린다. 되돌리는 것은 작업 폴더의 파일이다.
 *   · 저장소가 아니면 아무것도 안 한다(null). 없는 안전망을 있다고 하지 않는다.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { 경로에서찾기 } from './which.js';

// 명령 전에 사본을 떠 둘 파일의 상한. 넘친 것은 「못 떴다」 로 말한다.
const 사본수상한 = 400;
const 사본한개상한 = 4 * 1024 * 1024;
const 사본합상한 = 32 * 1024 * 1024;
// git 이 이보다 오래 걸리는 저장소면 이 판에서는 그만둔다 — 명령마다 사람이 기다린다.
const 느림문턱 = 3000;
// 앞 모습을 꺼내는 데는 더 기다린다 — 명령은 이미 돌았고, 여기서 끊기면 그 파일들을 되돌릴 수 없다.
const 꺼내기문턱 = 10000;
// 수정 시각이 이만큼 안쪽이면 시각을 못 믿는다 — FAT 은 2초 단위라, 한 틈에 두 번 쓰면 크기 · 시각이 같다.
const 흐릿한틈 = 3000;

/** 이 뿌리에서는 그만뒀다 (느리다). 프로세스가 사는 동안 기억한다. */
const 그만둔곳 = new Set();
let 깃자리 = undefined;

function 깃찾기() {
  // 작업 폴더 안의 git.exe 를 집지 않게 우리가 PATH 에서 찾는다 (which.js) — 절대 경로 칸만 본다.
  if (깃자리 === undefined) 깃자리 = 경로에서찾기(['git']);
  return 깃자리;
}

function 깃(뿌리, 인자, { 바이트 = false, 입력 = undefined, 제한 = 느림문턱 } = {}) {
  const 파일 = 깃찾기();
  if (!파일) return null;
  const r = spawnSync(파일, ['--no-optional-locks', '-c', 'core.quotepath=false', ...인자], {
    cwd: 뿌리, windowsHide: true, timeout: 제한, maxBuffer: 256 * 1024 * 1024,
    // 입력은 Buffer 로 — 글로 주면 encoding 을 입력의 인코딩으로도 써서 'buffer' 에서 던진다.
    encoding: 바이트 ? 'buffer' : 'utf8', input: 입력 === undefined ? undefined : Buffer.from(입력, 'utf8'),
    // 사람이 켜 둔 페이저 · 비밀번호 묻기가 끼지 않게.
    env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (r.error || r.status !== 0) return { ok: false, 느림: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM' };
  return { ok: true, out: r.stdout };
}

/**
 * `git status --porcelain=v1 -z` 를 읽는다. 열쇠는 저장소 꼭대기 기준 경로(슬래시), 값은 두 글자 상태.
 * 이름 바꾸기(R · C)는 옛 이름도 같이 올린다 — 옛 자리는 사라진 파일이다.
 */
function 상태읽기(뿌리) {
  const r = 깃(뿌리, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all', '--', '.']);
  if (!r?.ok) return r?.느림 ? { 느림: true } : null;
  const 표 = new Map();
  const 칸 = String(r.out).split('\0');
  for (let i = 0; i < 칸.length; i++) {
    const 줄 = 칸[i];
    if (줄.length < 4) continue;
    const 상태 = 줄.slice(0, 2);
    표.set(줄.slice(3), 상태);
    if (상태[0] === 'R' || 상태[0] === 'C') {
      const 옛 = 칸[++i];
      if (옛 && 상태[0] === 'R') 표.set(옛, ' D');
    }
  }
  return { 표 };
}

/*
 * 저장소 꼭대기 기준 경로를 **작업 폴더 기준**으로. 밖이거나 deel 제 살림(.deel)이면 null.
 *
 * 절대 경로끼리 견주지 않는다 — 윈도우에서 git 이 주는 꼭대기(긴 이름 · 슬래시)와 우리 뿌리(짧은 이름 · 대소문자)가
 * 글자로 달라, 안의 파일이 전부 밖으로 읽힐 수 있다. git 이 준 앞머리(`--show-prefix`)를 떼고 뿌리에 붙인다.
 */
const 살림꼴 = /(^|\/)\.deel(\/|$)/i;
function 맡을경로(앞머리, 경로) {
  if (!경로.startsWith(앞머리)) return null;
  const rel = 경로.slice(앞머리.length);
  if (!rel || 살림꼴.test(rel)) return null;
  return rel;
}

function 모양(abs) {
  try { const s = statSync(abs); return s.isFile() ? { 크기: s.size, 시각: s.mtimeMs } : { 폴더: true }; } catch { return null; }
}

/*
 * 명령 전 HEAD 에 있던 모습을 **한꺼번에** 꺼낸다. 돌려주는 표: 경로 → Buffer(있던 모습) · null(HEAD 에 없던 것).
 * 표에 없는 경로는 못 꺼낸 것이다 — 「없던 것」 과 다르다. 없던 것으로 적으면 /undo 가 멀쩡한 파일을 지운다.
 * HEAD 부터 못 읽었으면 null.
 *
 * 파일마다 `git cat-file` 을 띄우면 포매터가 200 파일을 고친 뒤 윈도우에서 8초를 기다렸다. 두 번만 띄운다 —
 * `--batch-check` 로 있나 없나를, `--batch --filters` 로 내용을. `--filters` 는 작업 폴더에 꺼낼 때의 변환
 * (core.autocrlf 의 CRLF · .gitattributes)을 태운다. 안 태우면 윈도우용 git 기본값(autocrlf=true)에서
 * /undo 가 CRLF 파일을 LF 로 되돌렸다.
 *
 * `--filters` 의 머리줄 크기는 변환 **전** 크기라 믿을 수 없다. 그래서 물음마다 뒤에 없는 개체 하나(아무도 못
 * 맞출 제비 번호)를 물어, 그 「missing」 줄을 경계로 쓴다.
 */
function 헤드꺼내기(뿌리, 머리, 경로들) {
  // 줄바꿈이 든 이름은 한 줄 물음에 못 싣는다 — 그 자리는 표에 없다(못 꺼냄).
  const 실을것 = 경로들.filter((p) => !/[\r\n]/.test(p));
  const 확인 = 깃(뿌리, ['cat-file', '--batch-check'], { 입력: `${[머리, ...실을것.map((p) => `${머리}:${p}`)].join('\n')}\n`, 제한: 꺼내기문턱 });
  if (!확인?.ok) return null;
  const 줄들 = String(확인.out).split('\n');
  if (!/^[0-9a-f]+ commit \d+$/.test(줄들[0] ?? '')) return null;
  const 표 = new Map();
  const 꺼낼것 = [];
  실을것.forEach((p, i) => {
    const 줄 = 줄들[i + 1] ?? '';
    if (줄.endsWith(' missing')) 표.set(p, null);                          // HEAD 에 없다 — 명령이 새로 만든 것
    else { const m = /^([0-9a-f]+) blob \d+$/.exec(줄); if (m) 꺼낼것.push([p, m[1]]); }
  });
  if (!꺼낼것.length) return 표;
  const 제비 = randomBytes(20).toString('hex');
  const 내용 = 깃(뿌리, ['cat-file', '--batch', '--filters'], {
    바이트: true, 제한: 꺼내기문턱, 입력: 꺼낼것.map(([p, oid]) => `${oid} ${p}\n${제비} x\n`).join(''),
  });
  if (!내용?.ok) return 표;
  const 몸 = 내용.out;
  const 경계 = Buffer.from(`\n${제비} missing\n`);
  let i = 0;
  for (const [p, oid] of 꺼낼것) {
    const 머리끝 = 몸.indexOf(0x0a, i);
    if (머리끝 < 0 || !몸.subarray(i, 머리끝).toString('latin1').startsWith(`${oid} blob `)) break;
    const 끝 = 몸.indexOf(경계, 머리끝 + 1);
    if (끝 < 0) break;
    표.set(p, Buffer.from(몸.subarray(머리끝 + 1, 끝)));
    i = 끝 + 경계.length;
  }
  return 표;
}

/**
 * 명령 **앞** 모습을 뜬다.
 *
 * @returns {null | {뿌리, 앞머리, 머리, 표: Map, 사본: Map}}
 *   null — 저장소가 아니거나, git 이 없거나, 이 저장소에서는 그만뒀다(느려서)
 */
export function 깃앞보기(뿌리) {
  try {
    뿌리 = resolve(String(뿌리));
    if (그만둔곳.has(뿌리) || !깃찾기()) return null;
    const 시작 = Date.now();
    const 뜬때 = 시작;
    // 앞머리와 HEAD 를 한 번에 묻는다 — 명령마다 도는 자리라 git 을 한 번 덜 띄운다. 커밋이 아직 없으면 HEAD 가
    // 없어 실패하니, 그때만 앞머리를 따로 묻는다.
    let 앞머리;
    let 머리 = null;
    const 둘 = 깃(뿌리, ['rev-parse', '--show-prefix', 'HEAD']);
    if (둘?.ok) {
      const 줄들 = String(둘.out).split('\n');
      앞머리 = 줄들[0].trim();
      머리 = (줄들[1] ?? '').trim() || null;
    } else {
      const 꼭 = 깃(뿌리, ['rev-parse', '--show-prefix']);
      if (!꼭?.ok) return null;
      앞머리 = String(꼭.out).trim();
    }
    const 상태 = 상태읽기(뿌리);
    if (!상태 || 상태.느림 || Date.now() - 시작 > 느림문턱) {
      if (상태?.느림 || Date.now() - 시작 > 느림문턱) 그만둔곳.add(뿌리);
      return null;
    }

    // 고치던 것 · 안 올린 것의 사본. 이 파일들의 앞 모습은 git 에 없다.
    const 사본 = new Map();
    let 합 = 0;
    for (const [경로] of 상태.표) {
      const rel = 맡을경로(앞머리, 경로);
      if (rel === null) continue;
      const 꼴 = 모양(join(뿌리, rel));
      if (!꼴) { 사본.set(경로, { 없음: true }); continue; }
      if (꼴.폴더) continue;
      if (사본.size >= 사본수상한 || 꼴.크기 > 사본한개상한 || 합 + 꼴.크기 > 사본합상한) {
        사본.set(경로, { ...꼴, 못뜸: '사본 상한' });
        continue;
      }
      try {
        const buf = readFileSync(join(뿌리, rel));
        합 += buf.length;
        사본.set(경로, { ...꼴, buf });
      } catch (err) { 사본.set(경로, { ...꼴, 못뜸: err?.code ?? '못 읽음' }); }
    }
    return { 뿌리, 앞머리, 머리, 표: 상태.표, 사본, 뜬때 };
  } catch {
    return null;   // 뜨다 터져서 명령이 못 도는 일은 없어야 한다
  }
}

/**
 * 명령 **뒤**에 견주고, 바뀐 것을 되돌리기 이력에 적는다.
 *
 * 이번 턴에 이미 뜬 파일은 안 적는다(History.떴나) — 그 기록이 턴 처음 모습이다. 낱말 보고 뜬 것과 겹쳐도 한 번이다.
 *
 * @returns {{뜬것: string[], 못뜬것: {abs: string, 왜: string}[]}}  뜬것 은 절대 경로
 */
export function 깃뒤적기(앞, { history } = {}) {
  const 뜬것 = [];
  const 못뜬것 = [];
  if (!앞 || typeof history?.뒤늦은기록 !== 'function') return { 뜬것, 못뜬것 };
  try {
    const 뒤 = 상태읽기(앞.뿌리);
    if (!뒤 || 뒤.느림) return { 뜬것, 못뜬것 };
    const 할것 = [];   // [경로, abs, 지금, 앞모습] — 앞모습 이 '헤드' 면 아래에서 한꺼번에 꺼낸다
    for (const 경로 of new Set([...앞.표.keys(), ...뒤.표.keys()])) {
      const rel = 맡을경로(앞.앞머리, 경로);
      if (rel === null) continue;
      const abs = join(앞.뿌리, rel);
      // 이번 턴에 이미 뜬 자리는 History.뒤늦은기록 이 거른다 — 그 기록이 턴 처음 모습이다.
      const 지금 = 모양(abs);
      if (지금?.폴더) continue;
      const 떠둔것 = 앞.사본.get(경로);

      let 앞모습;   // Buffer · null(없던 자리) · undefined(안 바뀜) · false(바뀌었는데 앞 모습이 없다)
      if (앞.표.has(경로)) {
        // 명령 전부터 고치던 · 안 올린 · 지워 둔 파일. 떠 둔 것과 지금이 같으면 안 바뀐 것이다.
        if (!떠둔것) continue;                                   // 폴더였거나 안 맡는 자리
        // 크기 · 시각이 같아도 그 시각이 뜬 때와 가까우면 믿지 않는다(흐릿한틈) — 한 틈에 두 번 쓴 것일 수 있다.
        const 시각믿음 = 떠둔것.시각 < (앞.뜬때 ?? 0) - 흐릿한틈;
        if (떠둔것.없음) 앞모습 = 지금 ? null : undefined;
        else if (!지금) 앞모습 = 떠둔것.buf ?? false;
        else if (지금.크기 === 떠둔것.크기 && 지금.시각 === 떠둔것.시각 && (시각믿음 || !떠둔것.buf)) 앞모습 = undefined;
        else if (떠둔것.buf) {
          let 지금것 = null;
          try { 지금것 = readFileSync(abs); } catch { /* 못 읽으면 바뀐 것으로 본다 */ }
          앞모습 = 지금것 && 지금것.equals(떠둔것.buf) ? undefined : 떠둔것.buf;
        } else 앞모습 = false;
        if (앞모습 === false) { 못뜬것.push({ abs, 왜: 떠둔것.못뜸 ?? '사본 없음' }); continue; }
      } else {
        // 명령 전에 깨끗했던 자리 — 앞 모습은 명령 전 HEAD 에 있다. 상태 글자(??)로 「새 파일」 을 가르지 않는다 —
        // `git rm --cached` 로 추적만 뗀 파일도 ?? 로 나온다. HEAD 에 물어 가른다. 커밋이 아직 없으면 없던 자리다.
        앞모습 = 앞.머리 ? '헤드' : null;
      }
      if (앞모습 === undefined) continue;
      할것.push([경로, abs, 지금, 앞모습]);
    }
    const 헤드볼것 = 할것.filter((x) => x[3] === '헤드').map((x) => x[0]);
    // 꺼내다 터져도 떠 둔 사본으로 적을 것은 적는다 — 꺼내지 못한 것만 「못 떴다」 로.
    let 헤드 = null;
    try { if (헤드볼것.length) 헤드 = 헤드꺼내기(앞.뿌리, 앞.머리, 헤드볼것); } catch { 헤드 = null; }
    for (const [경로, abs, 지금, 앞것] of 할것) {
      let 앞모습 = 앞것;
      if (앞모습 === '헤드') {
        앞모습 = 헤드?.get(경로);
        if (앞모습 === undefined) { 못뜬것.push({ abs, 왜: 'git 에서 앞 모습을 못 꺼냈습니다' }); continue; }
      }
      if (앞모습 === null && !지금) continue;                    // 생겼다 사라졌다 — 되돌릴 것이 없다
      const rec = history.뒤늦은기록(abs, 앞모습, 'Bash');
      if (!rec) continue;
      if (rec.skipped) 못뜬것.push({ abs, 왜: rec.skipped });
      else 뜬것.push(abs);
    }
  } catch { /* 적다 터져도 명령은 이미 돌았다 — 적은 데까지만 말한다 */ }
  return { 뜬것, 못뜬것 };
}

/** 검사가 원래대로 돌려놓을 때. */
export function 깃뜨기잊기() { 그만둔곳.clear(); 깃자리 = undefined; }
