/**
 * 훅 — 사람이 적어 둔 명령을 **정해진 자리**에서 돌린다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 사내마다 지켜야 하는 것이 다르다. 어떤 팀은 `git push` 를 절대 못 하게
 * 해야 하고, 어떤 팀은 파일을 고칠 때마다 사내 포맷터를 돌려야 하고, 어떤
 * 팀은 사람이 친 말에 주민번호가 섞였는지를 먼저 봐야 한다.
 *
 * 이걸 전부 이 프로그램 안에 넣을 수는 없다. 넣으면 팀마다 포크를 뜨게 되고,
 * 포크를 뜨면 그 순간부터 우리가 고치는 것이 그 팀에 안 간다. 그래서 **자리만
 * 내준다.** 무엇을 할지는 그 팀이 제 파일에 적는다.
 *
 * 규칙(safety/policy.js)과는 다른 축이다. 규칙은 「이 무늬면 막는다」 는 표라서
 * 우리가 아는 것만 잰다. 훅은 아무 프로그램이나 부를 수 있어서, 사내 DLP 나
 * 사내 승인 서버처럼 **우리가 영영 모르는 것**을 물어볼 수 있다.
 *
 * ── 이건 남의 프로그램을 돌리는 일이다 ─────────────────────────────────
 *
 * MCP 와 같은 무게로 다룬다. 다만 가르는 점이 하나 있다 — MCP 서버는 밖에서
 * 받아 온 남의 프로그램이고, 훅은 **이 사람이 제 파일에 제 손으로 적은 명령**
 * 이다. Bash 도구로 치는 것과 같은 무게다. 그래서 자물쇠(--offline)가 걸려도
 * 훅은 돈다 — Bash 를 안 막으면서 훅만 막으면 말이 안 맞는다.
 *
 *   1) **기본은 꺼져 있다.** hooks.json 에 사람이 직접 적어야만 돈다.
 *   2) **프로젝트 파일은 믿는 폴더에서만 읽는다.** 남의 저장소를 clone 하는
 *      것만으로 명령이 돌면 안 된다 (safety/trust.js).
 *   3) **감사기록에 남긴다.** 무엇이 언제 돌았고 무엇을 막았는지.
 *   4) **DEEL_HOOKS=off 로 끈다.** 훅이 망가지면 프로그램 전체가 멈추는데,
 *      그때 고칠 길이 훅 파일을 지우는 것뿐이면 안 된다.
 *
 * ── 고장 나면 막는다 ───────────────────────────────────────────────────
 *
 * 문지기가 쓰러져 있으면 문은 **잠긴 것이 아니다.** 그런데 흔한 규격은
 * 「2번으로 끝나면 막고, 나머지 실패는 지나간다」 다. 그러면 훅 파일에 오타
 * 하나(`pythno check.py`)가 나는 순간 그 문은 조용히 열린 채로 남는다 —
 * 화면에는 여전히 「훅 3개」 라고 떠 있는 채로.
 *
 * 그래서 **막는 자리의 훅**(도구전·말전)은 고장 나면 막는다. 못 잰 것을
 * 초록으로 세지 않는 것과 같은 판단이다. 지나가게 하려면 그 훅에
 * `"고장나면": "지나가기"` 라고 **적어야** 한다 — 적힌 것만 지나간다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { 돌려보기 } from '../tools/spawn.js';
import { 셸고르기 } from '../tools/shell.js';
import { 믿나 } from './trust.js';

/** 훅이 이 시간 안에 안 끝나면 죽인다. 사람이 훅마다 따로 정할 수 있다. */
export const 제한기본 = 15000;
/** 한 훅이 뱉을 수 있는 글의 최대. 넘으면 자르고 잘랐다고 말한다. */
export const 글최대 = 16 * 1024;
/** 한 자리에서 돌릴 수 있는 훅 수. 이보다 많으면 설정이 잘못된 것이다. */
export const 훅최대 = 32;

/**
 * 훅을 걸 수 있는 자리.
 *
 * 영문 이름도 같이 받는다 — Claude Code 의 hooks 설정을 그대로 복사해 붙일 수
 * 있어야 한다. MCP 설정에서 `mcpServers` 를 그대로 받는 것과 같은 이유다.
 * 이미 그 파일을 갖고 있는 사람에게 「우리 말로 다시 적어라」 고 하면, 그
 * 사람은 훅을 안 쓴다.
 */
export const 자리표 = Object.freeze({
  PreToolUse: '도구전',
  PostToolUse: '도구후',
  UserPromptSubmit: '말전',
  Stop: '턴끝',
});
export const 자리들 = Object.freeze(['도구전', '도구후', '말전', '턴끝']);
/** 막을 수 있는 자리. 나머지는 무슨 소리를 해도 못 막는다. */
export const 막는자리 = Object.freeze(['도구전', '말전']);

export const 프로젝트자리 = (root) => join(root, '.deel', 'hooks.json');
/**
 * 이 PC 것이 놓이는 자리.
 *
 * `DEEL_HOME` 을 먼저 본다 — 설정도 믿는 목록도 다 그 폴더를 따라가는데
 * (config.js · safety/trust.js) 훅만 진짜 집 폴더를 보면, USB 로 들고 다니는
 * 설치에서 훅만 안 따라온다. 그리고 그건 아무 데도 안 찍힌다.
 */
export const 이PC자리 = (집 = homedir(), env = process.env) => (
  env.DEEL_HOME ? join(resolve(env.DEEL_HOME), 'hooks.json') : join(집, '.deel', 'hooks.json')
);

/** 사람이 `pre-tool-use` 처럼 적어도 알아듣는다. */
function 자리풀기(값) {
  const s = String(값 ?? '').trim();
  if (자리들.includes(s)) return s;
  const 납작 = s.replace(/[-_\s]/g, '').toLowerCase();
  for (const [영, 한] of Object.entries(자리표)) if (영.toLowerCase() === 납작) return 한;
  return null;
}

/**
 * 도구 이름 무늬를 짓는다 — **양끝을 묶는다.**
 *
 * 여기가 묶여 있지 않으면 `Read` 라고 적은 무늬가 `TodoWrite` 에도 걸린다.
 * 막는 쪽이면 안 막을 것을 막고, 고치는 쪽이면 엉뚱한 것을 고친다. 둘 다
 * 「왜 이러지」 로 며칠을 쓰게 되는 종류의 어긋남이다.
 *
 * 무늬가 잘못 적혀 있으면 **null 을 돌려준다.** 아무것도 안 걸리는 무늬로
 * 삼키면 그 훅은 있으나 마나가 되는데, 화면에는 여전히 세어져 있다.
 */
export function 무늬짓기(값) {
  const s = String(값 ?? '').trim();
  if (!s || s === '*') return { 다냐: true, re: null };
  try { return { 다냐: false, re: new RegExp(`^(?:${s})$`) }; } catch { return null; }
}

/** 이 훅이 이 도구에 걸리나. */
export function 걸리나(훅, 도구) {
  if (!훅.무늬 || 훅.무늬.다냐) return true;
  return 훅.무늬.re.test(String(도구 ?? ''));
}

/**
 * 훅 하나를 우리 모양으로 편다.
 *
 * @returns {object|null} 못 알아들으면 null (부르는 쪽이 왜인지 적는다)
 */
function 한훅(자리, 무늬글, 것, 출처) {
  const 명령 = String(것?.명령 ?? 것?.command ?? '').trim();
  if (!명령) return null;
  if (것?.type && 것.type !== 'command') return null;   // 다른 갈래는 아직 없다
  const 무늬 = 무늬짓기(무늬글);
  if (!무늬) return null;
  const 초 = Number(것?.제한초 ?? 것?.timeout ?? 0);
  const 고장나면 = String(것?.고장나면 ?? 것?.onError ?? '').trim();
  return {
    자리,
    무늬글: String(무늬글 ?? '*'),
    무늬,
    명령,
    제한: Number.isFinite(초) && 초 > 0 ? Math.min(초 * 1000, 120000) : 제한기본,
    // 적힌 것만 지나간다. 이 파일 머리말의 「고장 나면 막는다」 가 여기다.
    지나갈까: 고장나면 === '지나가기' || 고장나면 === 'pass',
    출처,
    이름: String(것?.이름 ?? 것?.name ?? '').trim() || null,
  };
}

/**
 * 한 파일에서 훅을 읽는다. 두 가지 모양을 다 받는다.
 *
 *   납작한 것   { "hooks": [ { "때": "도구전", "도구": "Bash", "명령": "…" } ] }
 *   Claude 것   { "hooks": { "PreToolUse": [ { "matcher": "Bash",
 *                            "hooks": [ { "type": "command", "command": "…" } ] } ] } }
 */
export function 훅펴기(raw, 출처) {
  const 훅들 = [];
  const 버린것 = [];
  const 것 = raw?.hooks ?? raw?.훅 ?? raw;

  if (Array.isArray(것)) {
    for (const x of 것) {
      const 자리 = 자리풀기(x?.때 ?? x?.자리 ?? x?.event);
      if (!자리) { 버린것.push(`모르는 자리: ${x?.때 ?? x?.event ?? '(없음)'}`); continue; }
      const h = 한훅(자리, x?.도구 ?? x?.matcher ?? '*', x, 출처);
      if (h) 훅들.push(h); else 버린것.push(`${자리}: 명령이나 무늬가 잘못 적혀 있습니다`);
    }
    return { 훅들, 버린것 };
  }

  if (것 && typeof 것 === 'object') {
    for (const [열쇠, 값] of Object.entries(것)) {
      const 자리 = 자리풀기(열쇠);
      if (!자리) { 버린것.push(`모르는 자리: ${열쇠}`); continue; }
      for (const 묶음 of Array.isArray(값) ? 값 : [값]) {
        const 무늬글 = 묶음?.matcher ?? 묶음?.도구 ?? '*';
        const 안것 = Array.isArray(묶음?.hooks) ? 묶음.hooks : [묶음];
        for (const x of 안것) {
          const h = 한훅(자리, 무늬글, x, 출처);
          if (h) 훅들.push(h); else 버린것.push(`${자리}: 명령이나 무늬가 잘못 적혀 있습니다`);
        }
      }
    }
  }
  return { 훅들, 버린것 };
}

function 파일하나(경로, 출처) {
  if (!existsSync(경로)) return { 훅들: [], 버린것: [], 있음: false, 자리: 경로 };
  let j;
  try { j = JSON.parse(readFileSync(경로, 'utf8')); } catch (e) {
    return { 훅들: [], 버린것: [], 있음: true, 자리: 경로, 오류: `못 읽었습니다: ${e.message}` };
  }
  return { ...훅펴기(j, 출처), 있음: true, 자리: 경로 };
}

/**
 * 이 자리에서 쓸 훅을 다 모은다.
 *
 * 이 PC 것이 먼저 돌고 프로젝트 것이 나중에 돈다. 순서가 값을 갖는 자리는
 * 하나뿐이다 — 막는 훅은 **먼저 막는 것이 이긴다.** 이 PC 에 적은 것이
 * 프로젝트 파일에 덮이면 안 되기 때문이다.
 *
 * @returns {{훅들, 켜짐, 왜꺼짐, 이PC, 프로젝트, 안믿음}}
 */
export function 훅읽기(root, { env = process.env, 집 = homedir(), 켜짐 = null } = {}) {
  const 끔 = String(env.DEEL_HOOKS ?? '').trim().toLowerCase();
  const 꺼짐 = 켜짐 === false || 끔 === 'off' || 끔 === '0' || 끔 === 'false';

  const 이PC = 파일하나(이PC자리(집, env), '이 PC');
  /*
   * 프로젝트 파일은 **믿는 폴더에서만** 읽는다.
   *
   * 이게 이 파일에서 제일 중요한 한 줄이다. 없으면 `git clone` 한 번이 곧
   * 남이 적어 둔 명령을 내 PC 에서 도는 것이 된다 — 사람이 아무것도 안 쳐도
   * 첫 도구 호출에서 돈다. 프로젝트 설정을 믿는 폴더에서만 읽는 것과 같은
   * 규칙이고(safety/trust.js), 여기가 그 규칙이 제일 필요한 자리다.
   */
  const 믿는가 = 믿나(root, { env });
  const 프로젝트 = 믿는가
    ? 파일하나(프로젝트자리(root), '프로젝트')
    : { 훅들: [], 버린것: [], 있음: existsSync(프로젝트자리(root)), 자리: 프로젝트자리(root) };

  const 다 = [...이PC.훅들, ...프로젝트.훅들].slice(0, 훅최대);
  return {
    훅들: 꺼짐 ? [] : 다,
    켜짐: !꺼짐,
    왜꺼짐: 꺼짐 ? (켜짐 === false ? '--no-hooks' : 'DEEL_HOOKS=off') : null,
    이PC,
    프로젝트,
    // 파일은 있는데 폴더를 안 믿어서 안 읽은 경우. 화면이 이걸 말해야 한다 —
    // 안 그러면 사람은 제가 적은 훅이 왜 안 도는지 영영 모른다.
    안믿음: !믿는가 && 프로젝트.있음,
    넘침: [...이PC.훅들, ...프로젝트.훅들].length > 훅최대,
  };
}

/** 이 자리에 걸린 훅만 고른다. */
export function 고를것(훅들, 자리, 도구 = null) {
  return (훅들 ?? []).filter((h) => h.자리 === 자리 && (자리 !== '도구전' && 자리 !== '도구후' ? true : 걸리나(h, 도구)));
}

/*
 * ── 셸을 거친다. 여기서는 그게 맞다 ────────────────────────────────────
 *
 * 문서 변환(tools/convert.js)은 셸을 안 거친다. 거기 들어가는 파일 이름은
 * 모델이 정하기 때문이다 — 따옴표 한 개가 명령이 된다.
 *
 * 여기는 반대다. 명령은 **사람이 제 파일에 적은 글**이고, 모델이 만든 것은
 * 한 글자도 안 섞인다(아래 넣을것 은 전부 stdin 으로 간다). 그리고 사람이
 * 훅에 적고 싶은 것은 대개 `npx prettier --write "$@" && git diff --exit-code`
 * 같은 것이다. 셸을 안 거치면 그 줄을 적을 길이 없어서, 아무도 훅을 안 쓴다.
 *
 * 그래서 Bash 도구와 **같은 셸**을 쓴다(tools/shell.js). 같은 자리에서 같은
 * 말이 통해야 사람이 훅을 짤 수 있다.
 */
function 셸로(명령) {
  const 셸 = 셸고르기();
  return { file: 셸.file, args: 셸.명령(명령), verbatim: !!셸.verbatim };
}

/**
 * 훅 하나를 돌린다.
 *
 * 넘길 것은 **전부 stdin 으로 간다.** 명령줄에 끼우지 않는다 — 모델이 만든
 * 글(파일 경로·명령·사람 말)이 명령줄에 들어가면 그 자리가 곧 주입 구멍이다.
 *
 * @returns {Promise<{훅, 코드, 말, 막나, 왜, ms, 잘림}>}
 */
export async function 훅돌리기(훅, 넣을것, { signal = null, 돌리개 = 돌려보기 } = {}) {
  const t0 = Date.now();
  const { file, args, verbatim } = 셸로(훅.명령);
  const r = await 돌리개(file, args, {
    timeout: 훅.제한,
    maxBuffer: 글최대,
    signal,
    /*
     * 자리는 **여기서** 붙인다.
     *
     * 부르는 쪽에 맡기면 길이 둘이라(자리돌리기·직접 부르기) 한쪽만 붙이는
     * 날이 온다. 그러면 자리마다 갈래를 두는 훅 하나가 조용히 엉뚱한 갈래로
     * 떨어지는데, 그건 훅을 짠 사람도 우리도 못 알아차린다.
     */
    넣을것: `${JSON.stringify({ 자리: 훅.자리, ...(넣을것 ?? {}) })}\n`,
    덤: { windowsVerbatimArguments: verbatim, windowsHide: true },
  });
  const ms = Date.now() - t0;

  const 날것 = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const 잘림 = 날것.length > 글최대;
  const 말 = 잘림 ? `${날것.slice(0, 글최대)}\n…(훅이 뱉은 글이 길어서 여기까지만 옮겼습니다)` : 날것;

  // 못 돌렸다 · 시한을 넘겼다 · 중단됐다. 셋 다 「잰 적이 없다」 는 뜻이다.
  if (r.error) {
    return {
      훅, 코드: null, 말, ms, 잘림,
      막나: 막는자리.includes(훅.자리) && !훅.지나갈까,
      왜: `훅을 못 돌렸습니다 — ${r.error.message}`,
    };
  }
  if (r.status === 0) return { 훅, 코드: 0, 말, ms, 잘림, 막나: false, 왜: null };
  /*
   * 2 는 「막으라」 는 뜻이다 (흔한 규격 그대로).
   *
   * 나머지 0 아닌 값은 「훅이 고장났다」 로 본다. 막는 자리에서는 그것도
   * 막는다 — 이 파일 머리말의 이유다. `"고장나면": "지나가기"` 를 적어 두면
   * 그때만 지나간다.
   */
  if (r.status === 2) return { 훅, 코드: 2, 말, ms, 잘림, 막나: 막는자리.includes(훅.자리), 왜: null };
  return {
    훅, 코드: r.status, 말, ms, 잘림,
    막나: 막는자리.includes(훅.자리) && !훅.지나갈까,
    왜: `훅이 ${r.status} 로 끝났습니다`,
  };
}

/**
 * 한 자리의 훅을 차례로 돌린다.
 *
 * **차례로** 도는 것이 핵심이다. 같이 돌리면 두 훅이 같은 파일을 고칠 때
 * 결과가 매번 달라진다 — 포맷터를 훅으로 거는 것이 제일 흔한 쓰임인데
 * 하필 그게 그 모양이다.
 *
 * 막는 자리에서는 **첫 막힘에서 멈춘다.** 이미 막힌 것에 남은 훅을 더
 * 돌리는 것은 시간만 쓰는 일이고, 사람에게 보여 줄 까닭도 첫 것이 맞다.
 *
 * @returns {Promise<{막힘: object|null, 결과들: object[], 말들: string[]}>}
 */
export async function 자리돌리기(훅들, 자리, {
  도구 = null, 넣을것 = {}, signal = null, audit = null, 돌리개 = 돌려보기,
} = {}) {
  const 것들 = 고를것(훅들, 자리, 도구);
  const 결과들 = [];
  let 막힘 = null;
  for (const h of 것들) {
    if (signal?.aborted) break;
    const r = await 훅돌리기(h, { 도구, ...넣을것 }, { signal, 돌리개 });
    결과들.push(r);
    /*
     * 감사기록에 남긴다 — **돈 것 전부.**
     *
     * 막은 것만 남기면 「훅이 안 돌았다」 와 「훅이 돌았는데 통과시켰다」 를
     * 나중에 구별할 수 없다. 사내 심사에서 물어보는 것이 정확히 그 둘의
     * 차이다.
     */
    audit?.write?.('hook', {
      자리, 도구, 명령: h.명령, 출처: h.출처, 코드: r.코드, ms: r.ms, 막음: !!r.막나,
    });
    if (r.막나) { 막힘 = r; break; }
  }
  return { 막힘, 결과들, 말들: 결과들.map((r) => r.말).filter(Boolean) };
}

/**
 * 막혔을 때 모델에게 할 말.
 *
 * 훅이 뱉은 글을 **그대로** 싣는다. 우리가 요약하면 사내 규칙의 문구가
 * 뭉개지는데, 사람이 그 문구를 보고 담당자를 찾아가야 한다. 대신 우리가
 * 무엇을 했는지는 우리가 적는다.
 */
export function 막힘말(r, { 보인출처 = (h) => h.출처 } = {}) {
  const 줄 = [`${r.훅.자리} 훅이 막았습니다 (${보인출처(r.훅)}: ${r.훅.이름 ?? r.훅.명령}).`];
  if (r.왜) 줄.push(`  ${r.왜} — 문지기가 쓰러져 있으면 통과시키지 않습니다.`);
  if (r.말) { 줄.push(''); 줄.push(r.말); }
  줄.push('');
  줄.push('같은 것을 다시 부르지 마세요. 다른 길을 찾거나, 왜 필요한지 사용자에게 말하세요.');
  return 줄.join('\n');
}

/** 화면 한 장 (doctor · /status). 명령은 적되 값은 안 만든다. */
export function 훅줄들(r) {
  const 줄 = [];
  if (!r.켜짐) { 줄.push({ 상태: 'warn', 이름: '훅', 값: `꺼져 있습니다 (${r.왜꺼짐})` }); return 줄; }
  if (r.이PC.오류) 줄.push({ 상태: 'no', 이름: '훅 · 이 PC', 값: r.이PC.자리, 덧말: r.이PC.오류 });
  if (r.프로젝트.오류) 줄.push({ 상태: 'no', 이름: '훅 · 프로젝트', 값: r.프로젝트.자리, 덧말: r.프로젝트.오류 });
  if (r.안믿음) {
    줄.push({
      상태: 'warn', 이름: '훅 · 프로젝트', 값: r.프로젝트.자리,
      덧말: '믿는 폴더가 아니라서 안 읽습니다 — 읽게 하려면 deel trust',
    });
  }
  for (const 것 of [r.이PC, r.프로젝트]) {
    for (const 왜 of 것.버린것 ?? []) 줄.push({ 상태: 'warn', 이름: '훅 · 못 알아들음', 값: 왜 });
  }
  if (r.넘침) 줄.push({ 상태: 'warn', 이름: '훅', 값: `${훅최대}개까지만 씁니다 — 나머지는 안 돕니다` });
  if (!r.훅들.length) { 줄.push({ 상태: 'ok', 이름: '훅', 값: '없습니다' }); return 줄; }
  const 셈 = {};
  for (const h of r.훅들) 셈[h.자리] = (셈[h.자리] ?? 0) + 1;
  줄.push({
    상태: 'ok', 이름: '훅', 값: `${r.훅들.length}개`,
    덧말: 자리들.filter((z) => 셈[z]).map((z) => `${z} ${셈[z]}`).join(' · '),
  });
  return 줄;
}
