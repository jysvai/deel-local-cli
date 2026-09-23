// `deel eval` — 과제 모음(골든셋)을 실제 모델로 돌려 **얼마나 해내나**를 잰다 (2.1.0).
//
// ── 왜 만드나 ───────────────────────────────────────────────────────────
//
// 사내 검토에서 들은 말이다 — 「검증 조건에서 작업마다 골든셋이 필요하다. 지금처럼
// 정적 검사에 기대면 한계가 있다.」 맞는 말이었다. 검사 1만 4천여 개는 가짜 게이트웨이로
// 「도구가 약속대로 도나」 를 잰다. 「이 회사의 모델과 deel 이 실제 일을 몇 개 해내나」 는
// 한 번도 안 쟀다. 모델을 바꾸거나 deel 을 올릴 때 나아졌는지 나빠졌는지 말할 숫자가 없었다.
//
// ── 어떻게 재나 ─────────────────────────────────────────────────────────
//
// 과제 하나는 폴더 하나다.
//
//   과제이름/
//     task.json    { "prompt": 시킬 말, "check": 정답 검사 명령, … }
//     start/       시작 파일 — 임시 작업 폴더로 복사된다
//     golden/      정답 검사 파일 — deel 이 **다 끝낸 뒤에** 작업 폴더에 들어간다
//
// 1. 임시 폴더에 start/ 를 깐다
// 2. 그 폴더에서 `deel run --json --yes "<prompt>"` 를 돌린다 — 사람이 쓰는 그 길 그대로
// 3. golden/ 을 덮어 넣고 check 를 돌린다. 종료코드 0 이면 통과
//
// 정답은 **모델이 못 본다.** 일하는 동안 폴더에 없다가 끝난 뒤에 들어온다. 그래서 「검사를
// 통과하게 검사를 고치는」 길이 없다. 모델이 같은 이름의 파일을 만들어 둬도 덮인다.
//
// 결과는 `<과제 모음>/.results/<시각>.json` 에 남고, 지난 결과와 견줘 **나빠진 과제**를
// 짚는다. 판을 올리거나 모델을 바꾼 뒤 한 번 돌려 보는 것이 쓰임새다.
//
// ── 안 하는 것 ──────────────────────────────────────────────────────────
//
// 동시에 안 돌린다. 과제마다 모델을 오래 부르고 검사가 CPU 를 먹는다 — 사내 게이트웨이의
// 분당 한도와 이 PC 의 메모리를 같이 지킨다. 느려도 숫자가 맞는 쪽을 고른다.
//
// check 는 **사람이 적은 명령**이라 관문 없이 돈다(npm test 를 손으로 치는 것과 같다).
// 다만 그 명령이 모델이 쓴 코드를 돌리므로 열쇠처럼 생긴 환경변수는 빼고 넘긴다
// (safety/shellenv.js). 남이 준 과제 모음은 task.json 을 먼저 읽어 보고 돌리라.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { 돌려보기 } from '../tools/spawn.js';
import { 셸명령 } from '../tools/shell.js';
import { 셸환경 } from '../safety/shellenv.js';
import { 승인바닥 } from '../safety/policy.js';
import { c, say, mark } from '../ui/ansi.js';
import { 언어 } from '../i18n/index.js';
import { 예제과제 } from './starter.js';

const 진입점 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'deel.js');

/** 과제 하나를 deel 이 끝낼 때까지 기다리는 시간(초)과, 정답 검사 한 번의 시간(초). */
export const 기본시간초 = 600;
export const 검사시간초 = 120;
/** 한 과제를 몇 번까지 되풀이해 재나. 모델은 같은 말에도 다르게 답한다. */
export const 최대되풀이 = 20;
export const 결과폴더 = '.results';

const 글 = (ko, en) => (언어() === 'ko' ? ko : en);

/**
 * 과제 모음 폴더를 읽는다. task.json 이 있는 하위 폴더 하나가 과제 하나다.
 * 모양이 틀린 과제는 **빼지 않고** 탈을 달아 돌려준다 — 조용히 빼면 스무 개 중 열아홉만
 * 돌고 「다 통과」 가 된다.
 *
 * @returns {Array<{이름:string, 자리:string, 설정:object|null, 탈:string|null}>}
 */
export function 과제읽기(폴더) {
  const 과제들 = [];
  for (const 이름 of readdirSync(폴더).sort()) {
    if (이름.startsWith('.')) continue;
    const 자리 = join(폴더, 이름);
    let 폴더인가 = false;
    try { 폴더인가 = statSync(자리).isDirectory(); } catch { /* 사이에 지워졌다 */ }
    if (!폴더인가) continue;
    /*
     * task.json 이 없어도 start/·golden/ 이 있으면 과제로 만든 폴더다 — 이름을 틀렸거나
     * (`Task.json` · `task.jsn`) 빠뜨린 것이다. 이것도 탈로 센다. 둘 다 없는 폴더(과제들이
     * 같이 쓰는 도우미 따위)만 과제가 아니다 (2차 눈 판정).
     */
    if (!existsSync(join(자리, 'task.json'))) {
      if (existsSync(join(자리, 'start')) || existsSync(join(자리, 'golden'))) {
        과제들.push({ 이름, 자리, 설정: null, 탈: 'task.json 이 없습니다 — start/·golden/ 은 있는데 시킬 말과 정답 검사가 없습니다' });
      }
      continue;
    }
    let 설정 = null;
    let 탈 = null;
    try {
      const v = JSON.parse(readFileSync(join(자리, 'task.json'), 'utf8').replace(/^\uFEFF/, ''));
      탈 = 설정탈(v);
      if (!탈) 설정 = v;
    } catch (e) {
      탈 = `task.json 을 못 읽었습니다 — ${String(e?.message ?? e).split('\n')[0]}`;
    }
    과제들.push({ 이름, 자리, 설정, 탈 });
  }
  return 과제들;
}

/** task.json 이 쓸 수 있는 모양인가. 쓸 수 있으면 null, 아니면 까닭. */
export function 설정탈(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'task.json 이 객체가 아닙니다';
  if (typeof v.prompt !== 'string' || !v.prompt.trim()) return 'prompt(시킬 말)가 없습니다';
  if (typeof v.check !== 'string' || !v.check.trim()) return 'check(정답 검사 명령)가 없습니다';
  for (const 칸 of ['timeout', 'checkTimeout']) {
    if (v[칸] !== undefined && !(Number.isFinite(Number(v[칸])) && Number(v[칸]) > 0)) return `${칸} 은 0 보다 큰 초여야 합니다`;
  }
  for (const 칸 of ['doneCheck', 'work']) {
    if (v[칸] !== undefined && typeof v[칸] !== 'string') return `${칸} 은 글이어야 합니다`;
  }
  return null;
}

/**
 * 폴더를 통째로 복사한다. 원본이 없으면 아무것도 안 한다(start/ 가 없는 과제는 빈 폴더에서 시작).
 *
 * `덮기` 는 정답을 넣을 때 쓴다. 모델이 같은 이름을 **다른 꼴**로 만들어 두었으면(정답은
 * `sub/` 폴더인데 모델은 `sub` 파일) 그것을 걷어내고 정답을 넣는다. 안 걷으면 복사가 터져
 * 평가 전체가 죽는다 — 과제 하나의 일로 스무 개가 다 멈춘다 (2차 눈 판정).
 */
export function 폴더복사(원본, 대상, { 덮기 = false } = {}) {
  if (!existsSync(원본)) return 0;
  let n = 0;
  for (const 이름 of readdirSync(원본)) {
    const 가 = join(원본, 이름);
    const 나 = join(대상, 이름);
    const 폴더다 = statSync(가).isDirectory();
    if (덮기) {
      let 있는것 = null;
      try { 있는것 = statSync(나); } catch { /* 없다 */ }
      if (있는것 && 있는것.isDirectory() !== 폴더다) rmSync(나, { recursive: true, force: true, maxRetries: 3 });
    }
    if (폴더다) { mkdirSync(나, { recursive: true }); n += 폴더복사(가, 나, { 덮기 }); }
    else { mkdirSync(dirname(나), { recursive: true }); copyFileSync(가, 나); n++; }
  }
  return n;
}

/**
 * 예제 과제를 만든다. 이미 있는 과제 폴더는 **안 덮는다** — 사람이 고쳐 둔 과제를 지우면 안 된다.
 * @returns {{만든:string[], 건너뜀:string[]}}
 */
export function 예제만들기(폴더) {
  const 만든 = [];
  const 건너뜀 = [];
  for (const [이름, 과제] of Object.entries(예제과제)) {
    const 자리 = join(폴더, 이름);
    if (existsSync(자리)) { 건너뜀.push(이름); continue; }
    mkdirSync(자리, { recursive: true });
    writeFileSync(join(자리, 'task.json'), JSON.stringify(과제.task, null, 2) + '\n');
    for (const [갈래, 파일들] of [['start', 과제.start], ['golden', 과제.golden]]) {
      for (const [길, 내용] of Object.entries(파일들 ?? {})) {
        const 어디 = join(자리, 갈래, 길);
        mkdirSync(dirname(어디), { recursive: true });
        writeFileSync(어디, 내용);
      }
    }
    만든.push(이름);
  }
  return { 만든, 건너뜀 };
}

/** `deel run --json` 의 표준출력에서 마지막 JSON 한 덩이를 읽는다. 못 읽으면 null. */
export function 결과덩이(stdout) {
  const 줄들 = String(stdout ?? '').trim().split('\n').reverse();
  for (const 줄 of 줄들) {
    const s = 줄.trim();
    if (!s.startsWith('{')) continue;
    try { return JSON.parse(s); } catch { /* 다음 줄 */ }
  }
  return null;
}

const 꼬리 = (s, n = 800) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `…${t.slice(t.length - n)}` : t;
};

/**
 * 과제 하나를 한 번 돌린다.
 *
 * 통과·실패는 **정답 검사 하나로만** 가른다. deel 이 걸음 상한이나 오류로 끝났어도 폴더가
 * 맞게 고쳐져 있으면 통과다 — 재는 것은 「해냈나」 지 「깔끔하게 끝냈나」 가 아니다.
 * deel 이 어떻게 끝났는지는 옆에 적는다.
 */
export async function 한번돌리기(과제, { 판 = 1, 깃발들 = [], 남김 = false, 시간초 = null } = {}) {
  const 설정 = 과제.설정;
  const t0 = Date.now();
  const 작업 = mkdtempSync(join(tmpdir(), 'deel-eval-'));
  try {
    폴더복사(join(과제.자리, 'start'), 작업);
    const 제한초 = Number(설정.timeout ?? 시간초 ?? 기본시간초);
    const 인자 = [
      진입점, 'run', '--json', '--yes', '--root', 작업,
      ...(설정.work ? ['--work', 설정.work] : []),
      ...(설정.doneCheck ? ['--check', 설정.doneCheck] : []),
      ...깃발들,
      // `--` 뒤는 낱말이다 — 시킬 말이 대시로 시작해도 깃발로 안 읽힌다.
      '--', 설정.prompt,
    ];
    const 돌림 = await 돌려보기(process.execPath, 인자, {
      timeout: 제한초 * 1000, maxBuffer: 64 * 1024 * 1024,
      덤: { cwd: 작업, env: { ...process.env, NO_COLOR: '1' } },
    });
    const 덩이 = 결과덩이(돌림.stdout);
    const deel = {
      code: 돌림.status,
      reason: 덩이?.reason ?? (돌림.error ? (/안 끝났습니다/.test(돌림.error.message) ? 'timeout' : 'spawn') : 'no-json'),
      steps: 덩이?.steps ?? 0,
      tools: 덩이?.tools ?? 0,
      usage: { in: 덩이?.usage?.prompt ?? 덩이?.usage?.in ?? 0, out: 덩이?.usage?.out ?? 0 },
      model: 덩이?.model ?? null,
      ...(덩이?.check ? { check: 덩이.check } : {}),
      ...(덩이 ? {} : { stderr: 꼬리(돌림.stderr) }),
    };

    // 정답을 넣는다 — 일이 다 끝난 **뒤에**. 모델이 같은 이름으로 만든 것은 꼴이 달라도 덮인다.
    폴더복사(join(과제.자리, 'golden'), 작업, { 덮기: true });
    const 셸 = 셸명령(설정.check);
    const 검사 = await 돌려보기(셸.file, 셸.args, {
      timeout: Number(설정.checkTimeout ?? 검사시간초) * 1000,
      덤: { cwd: 작업, env: 셸환경(process.env).env, windowsVerbatimArguments: 셸.verbatim },
    });
    const 통과 = !검사.error && 검사.status === 0;
    return {
      과제: 과제.이름, 판, 통과,
      초: Math.round((Date.now() - t0) / 100) / 10,
      deel,
      검사: { code: 검사.status, ...(통과 ? {} : { 꼬리: 꼬리(`${검사.stdout ?? ''}\n${검사.stderr ?? ''}\n${검사.error?.message ?? ''}`) }) },
      ...(남김 ? { 작업폴더: 작업 } : {}),
    };
  } finally {
    if (!남김) {
      try { rmSync(작업, { recursive: true, force: true, maxRetries: 3 }); } catch { /* 임시 폴더다 — 못 지워도 OS 가 거둔다 */ }
    }
  }
}

/** 과제별로 묶는다 — 몇 판 중 몇 판 통과했나. */
export function 과제별(결과들) {
  const 표 = new Map();
  for (const r of 결과들) {
    const 것 = 표.get(r.과제) ?? { 과제: r.과제, 판: 0, 통과: 0 };
    것.판++;
    if (r.통과) 것.통과++;
    표.set(r.과제, 것);
  }
  return [...표.values()];
}

/**
 * 지난 결과와 견준다. 다 통과하던 과제가 하나라도 떨어졌으면 나빠짐, 못 하던 과제를 다 해내면 나아짐.
 * 되풀이 수가 다르면 비율로 본다.
 */
export function 견주기(지난것, 지금것) {
  const 비율 = (x) => (x.판 ? x.통과 / x.판 : 0);
  const 지난표 = new Map((지난것 ?? []).map((x) => [x.과제, x]));
  const 나빠짐 = [];
  const 나아짐 = [];
  for (const x of 지금것) {
    const 전 = 지난표.get(x.과제);
    if (!전) continue;
    if (비율(x) < 비율(전)) 나빠짐.push(x.과제);
    else if (비율(x) > 비율(전)) 나아짐.push(x.과제);
  }
  return { 나빠짐, 나아짐 };
}

/** 제일 새 결과 파일. 깨졌거나 과제별이 없는 것(손으로 적은 `{}` 따위)은 건너뛴다 — 견줄 것이 없다. */
export function 지난결과(폴더) {
  const 자리 = join(폴더, 결과폴더);
  if (!existsSync(자리)) return null;
  const 파일들 = readdirSync(자리).filter((f) => /^\d{8}-\d{6}.*\.json$/.test(f)).sort();
  for (const f of 파일들.reverse()) {
    try {
      const 값 = JSON.parse(readFileSync(join(자리, f), 'utf8'));
      if (Array.isArray(값?.과제별)) return { 파일: f, 값 };
    } catch { /* 깨진 것은 건너뛴다 */ }
  }
  return null;
}

/**
 * 결과 파일 이름. **UTC** 로 적고 `Z` 를 붙인다 — 지역 시각이면 시차가 다른 PC 의 결과가 한
 * 폴더에 섞일 때(저장소에 올려 같이 쓰는 과제 모음) 이름 순서가 시각 순서와 어긋나고,
 * 「지난번」 을 엉뚱한 파일로 고른다 (2차 눈 판정).
 */
export const 시각이름 = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

/**
 * `deel eval [폴더]` 의 몸통. 종료코드를 돌려준다 — 0 다 통과 · 1 하나라도 실패 · 64 부른 모양이 틀림.
 */
export async function runEval({ 폴더 = null, init = false, repeat = 1, keep = false, json = false, only = null, 깃발들 = [], 시간초 = null } = {}) {
  const 뿌리 = process.cwd();
  const 고른폴더 = resolve(뿌리, 폴더 ?? (existsSync(join(뿌리, 'golden')) || init ? 'golden' : join('.deel', 'golden')));
  const 보일 = relative(뿌리, 고른폴더) || '.';
  const 말하기 = (s = '') => { if (!json) say(s); };
  /*
   * 부른 모양이 틀렸거나 돌릴 것이 없을 때. `--json` 이면 받는 쪽은 표준출력을 통째로
   * JSON.parse 한다 — 색 입힌 글을 내면 그 자리에서 깨진다. 그래서 JSON 한 줄로 낸다.
   */
  const 못돌림 = (코드, 오류, 덧 = null) => {
    if (json) process.stdout.write(JSON.stringify({ ok: false, code: 코드, error: 오류 }) + '\n');
    else {
      say(`  ${c.red('✗')} ${오류}`);
      if (덧) say(`     ${덧}`);
    }
    return 코드;
  };

  if (init) {
    const { 만든, 건너뜀 } = 예제만들기(고른폴더);
    말하기('');
    말하기(`  ${mark.ok} ${글(`예제 과제 ${만든.length}개를 만들었습니다 — ${보일}`, `Created ${만든.length} example tasks — ${보일}`)}`);
    for (const 이름 of 만든) 말하기(`     ${c.gray(이름)}`);
    if (건너뜀.length) 말하기(`  ${c.gray(글(`이미 있어 안 덮은 것: ${건너뜀.join(' · ')}`, `Already there, left alone: ${건너뜀.join(' · ')}`))}`);
    말하기('');
    말하기(`  ${c.gray(글('돌리기:', 'Run them:'))} ${c.cyan(`deel eval ${보일}`)}`);
    말하기(`  ${c.gray(글('과제 하나 = task.json(시킬 말·정답 검사) + start/(시작 파일) + golden/(끝난 뒤 넣는 정답 검사)',
      'One task = task.json (prompt, check) + start/ (starting files) + golden/ (checks added after the run)'))}`);
    말하기('');
    if (json) process.stdout.write(JSON.stringify({ ok: true, folder: 고른폴더, created: 만든, skipped: 건너뜀 }) + '\n');
    return 0;
  }

  const 되풀이 = Number(repeat);
  if (!Number.isInteger(되풀이) || 되풀이 < 1 || 되풀이 > 최대되풀이) {
    return 못돌림(64, 글(`--repeat 는 1 ~ ${최대되풀이} 사이의 정수여야 합니다: ${repeat}`, `--repeat must be a whole number from 1 to ${최대되풀이}: ${repeat}`));
  }
  if (!existsSync(고른폴더)) {
    return 못돌림(1, 글(`과제 모음이 없습니다 — ${보일}`, `No task folder — ${보일}`),
      `${c.gray(글('예제부터 만들려면:', 'To start from examples:'))} ${c.cyan('deel eval --init')}`);
  }

  let 과제들 = 과제읽기(고른폴더);
  if (only) {
    const 고를것 = String(only).split(',').map((s) => s.trim()).filter(Boolean);
    과제들 = 과제들.filter((x) => 고를것.some((k) => x.이름.includes(k)));
  }
  if (!과제들.length) {
    return 못돌림(1, 글(`돌릴 과제가 없습니다 — ${보일} 밑에 task.json 이 든 폴더가 없습니다`, `Nothing to run — no folder with a task.json under ${보일}`));
  }

  말하기('');
  말하기(`  ${c.bold(글('골든셋', 'Golden set'))} ${c.gray(`— ${보일} · ${글(`과제 ${과제들.length}개 · 과제마다 ${되풀이}번`, `${과제들.length} tasks · ${되풀이} run(s) each`)}`)}`);
  말하기('');

  /*
   * 관리 정책이 승인 바닥을 걸었으면 과제마다 띄우는 `deel run --yes` 의 --yes 가 안 먹는다(oneshot.js).
   * 그러면 파일을 바꾸는 과제는 전부 거절되어 실패로 세어진다 — 모델 탓처럼 보이는 0% 가 나온다. 먼저 말한다.
   */
  const 바닥 = 승인바닥();
  if (바닥.바닥 !== 'auto') {
    말하기(`  ${c.yellow('⚠')} ${글(`관리 정책이 승인을 ${바닥.바닥} 로 걸어 두어 과제 안에서 파일을 못 바꿉니다 — 바꾸는 과제는 실패로 세어집니다 (${바닥.곳})`,
      `A managed policy holds approval at ${바닥.바닥}, so tasks cannot change files — those will count as failed (${바닥.곳})`)}`);
    말하기('');
  }
  const t0 = Date.now();
  const 결과들 = [];
  for (const 과제 of 과제들) {
    for (let 판 = 1; 판 <= 되풀이; 판++) {
      const 이름표 = 되풀이 > 1 ? `${과제.이름} #${판}` : 과제.이름;
      /*
       * 모양이 틀린 과제도 **되풀이 수만큼** 실패를 센다. 한 판만 세면 `--repeat 5` 에서 분모가
       * 넷 줄어 통과율이 부푼다 — 멀쩡한 과제 5/5 와 깨진 과제 하나가 50% 가 아니라 83% 가 된다
       * (2차 눈 판정). 화면에는 한 번만 적는다.
       */
      if (과제.탈) {
        결과들.push({ 과제: 과제.이름, 판, 통과: false, 초: 0, 과제탈: 과제.탈 });
        if (판 === 1) 말하기(`  ${c.yellow('⊘')} ${과제.이름}  ${c.gray(과제.탈)}`);
        continue;
      }
      const r = await 한번돌리기(과제, { 판, 깃발들, 남김: keep, 시간초 });
      결과들.push(r);
      const 옆 = [`${r.초}${글('초', 's')}`];
      if (r.deel.tools) 옆.push(글(`도구 ${r.deel.tools}회`, `${r.deel.tools} tool calls`));
      if (r.deel.reason && r.deel.reason !== 'done') 옆.push(`deel: ${r.deel.reason}`);
      말하기(`  ${r.통과 ? mark.ok : c.red('✗')} ${이름표}  ${c.gray(옆.join(' · '))}`);
      if (!r.통과) {
        for (const 줄 of String(r.검사.꼬리 ?? '').split('\n').filter((l) => l.trim()).slice(-4)) 말하기(`      ${c.gray(줄.slice(0, 160))}`);
        if (r.deel.stderr) for (const 줄 of r.deel.stderr.split('\n').filter((l) => l.trim()).slice(-3)) 말하기(`      ${c.gray(줄.slice(0, 160))}`);
      }
      if (r.작업폴더) 말하기(`      ${c.gray(글(`작업 폴더를 남겼습니다: ${r.작업폴더}`, `Kept the work folder: ${r.작업폴더}`))}`);
    }
  }

  const 묶음 = 과제별(결과들);
  const 판수 = 결과들.length;
  const 통과수 = 결과들.filter((r) => r.통과).length;
  const 모델 = 결과들.find((r) => r.deel?.model)?.deel.model ?? null;
  const 지난 = 지난결과(고른폴더);
  const 견줌 = 견주기(지난?.값?.과제별, 묶음);
  const 초 = Math.round((Date.now() - t0) / 1000);
  const 토큰 = 결과들.reduce((a, r) => ({ in: a.in + (r.deel?.usage?.in ?? 0), out: a.out + (r.deel?.usage?.out ?? 0) }), { in: 0, out: 0 });

  const 기록 = {
    when: new Date().toISOString(),
    model: 모델,
    folder: 고른폴더,
    repeat: 되풀이,
    passed: 통과수,
    runs: 판수,
    rate: 판수 ? Math.round((통과수 / 판수) * 1000) / 10 : 0,
    seconds: 초,
    tokens: 토큰,
    과제별: 묶음,
    결과: 결과들,
    ...(지난 ? { 견줌: { 지난파일: 지난.파일, ...견줌 } } : {}),
  };
  let 남긴곳 = null;
  try {
    mkdirSync(join(고른폴더, 결과폴더), { recursive: true });
    남긴곳 = join(고른폴더, 결과폴더, `${시각이름()}.json`);
    writeFileSync(남긴곳, JSON.stringify(기록, null, 2) + '\n');
  } catch { 남긴곳 = null; }

  if (json) process.stdout.write(JSON.stringify(기록) + '\n');
  말하기('');
  말하기(`  ${c.gray('──')} ${통과수 === 판수 ? c.green(글(`통과 ${통과수}/${판수}`, `passed ${통과수}/${판수}`)) : c.yellow(글(`통과 ${통과수}/${판수}`, `passed ${통과수}/${판수}`))}`
    + ` ${c.gray(`(${기록.rate}%) · ${초}${글('초', 's')} · ↑${토큰.in.toLocaleString()} ↓${토큰.out.toLocaleString()}${모델 ? ` · ${모델}` : ''}`)}`);
  if (지난) {
    if (견줌.나빠짐.length) 말하기(`  ${c.red('▼')} ${글('지난번보다 나빠짐:', 'Worse than last time:')} ${견줌.나빠짐.join(' · ')}`);
    if (견줌.나아짐.length) 말하기(`  ${c.green('▲')} ${글('지난번보다 나아짐:', 'Better than last time:')} ${견줌.나아짐.join(' · ')}`);
    if (!견줌.나빠짐.length && !견줌.나아짐.length) 말하기(`  ${c.gray(글(`지난번(${지난.파일})과 같습니다`, `Same as last time (${지난.파일})`))}`);
  }
  if (남긴곳) 말하기(`  ${c.gray(글(`결과: ${relative(뿌리, 남긴곳)}`, `Results: ${relative(뿌리, 남긴곳)}`))}`);
  말하기('');
  return 통과수 === 판수 ? 0 : 1;
}
