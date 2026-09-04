// 검사가 소스의 어디를 실제로 밟았는지 센다.
//
// 왜 직접 만들었나: 이 프로젝트는 의존성이 0개다(사내 미승인 SW 반입 금지).
// c8·nyc·jest 를 붙이면 그 규칙이 깨진다. 대신 Node 에 원래 들어 있는
// V8 커버리지를 쓴다 — NODE_V8_COVERAGE 에 폴더를 주면 프로세스가 끝날 때
// 그 폴더에 JSON 을 떨군다. 자식 프로세스도 환경변수를 물려받으니 검사
// 러너가 띄우는 파일들까지 전부 모인다.
//
// 쓰는 법:  node test/coverage.mjs            전부 돌리고 요약
//           node test/coverage.mjs --json     기계가 읽을 형태로
//           node test/coverage.mjs --file src/agent/route.js   한 파일 자세히
//           node test/coverage.mjs --min 90   문턱을 바꿔서
//
// 일부러 80% 아래로 두는 파일이 둘 있다. 숫자를 올리려고 억지 검사를 붙이면
// 검사가 거짓말을 하기 시작하므로, 왜 못 밟는지를 여기에 적어 둔다.
//
//   src/tools/excel.js    암호 걸린 엑셀을 여는 길. 이 컴퓨터에 엑셀이 깔려
//                         있어야 하고, 암호가 걸린 진짜 파일이 있어야 한다.
//                         가짜로 흉내 내면 '되는 것처럼 보이는' 검사가 된다.
//   src/plugins/manage.js GitHub 에서 플러그인을 내려받는 길(fetchInto).
//                         검사에서 바깥으로 나가지 않는다는 약속이 먼저다.
//                         폴더에서 설치하는 길은 commands-more.test.js 가 본다.
//
// 숫자를 어떻게 세는가:
//   V8 은 '줄' 이 아니라 '바이트 구간' 단위로 몇 번 지나갔는지를 준다.
//   구간은 겹쳐서 들어온다 — 함수 전체를 감싸는 큰 구간 안에 if 문 하나짜리
//   작은 구간이 들어 있는 식이다. 그래서 큰 것부터 칠하고 작은 것으로 덮는다.
//   그러면 각 바이트마다 '가장 안쪽 구간의 횟수' 가 남는다.
//   줄 단위로는, 그 줄의 글자 중 하나라도 횟수가 1 이상이면 밟은 줄로 센다.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const 인자 = process.argv.slice(2);
const JSON출력 = 인자.includes('--json');
const 한파일 = ((i) => (i >= 0 ? 인자[i + 1] : null))(인자.indexOf('--file'));
const 문턱 = Number(((i) => (i >= 0 ? 인자[i + 1] : null))(인자.indexOf('--min')) ?? 80);

const C = process.stdout.isTTY || process.env.FORCE_COLOR;
const g = (s) => (C ? `\x1b[32m${s}\x1b[0m` : s);
const r = (s) => (C ? `\x1b[31m${s}\x1b[0m` : s);
const y = (s) => (C ? `\x1b[33m${s}\x1b[0m` : s);
const d = (s) => (C ? `\x1b[90m${s}\x1b[0m` : s);
const w = (s) => (C ? `\x1b[37m${s}\x1b[0m` : s);
const b = (s) => (C ? `\x1b[1m${s}\x1b[0m` : s);

// ── 1. 커버리지를 켜고 검사를 돌린다 ────────────────────────────────────
const 자리 = mkdtempSync(join(tmpdir(), 'deel-cov-'));

async function 검사돌리기() {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [join(here, 'run.mjs')], {
      stdio: JSON출력 ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, NODE_V8_COVERAGE: 자리, FORCE_COLOR: C ? '1' : '' },
    });
    kid.on('close', (code) => done(code ?? 1));
  });
}

// ── 2. 떨어진 JSON 을 모은다 ────────────────────────────────────────────
//
// 프로세스마다 파일이 하나씩 나온다. 여기서 조심할 것이 하나 있다 —
// **프로세스별로 따로 계산한 뒤 합쳐야 한다.**
//
// 처음에는 모든 프로세스의 구간을 한 통에 부어 놓고 한 번에 칠했다. 그랬더니
// route.js 가 48% 로 나왔다. route.test.js 가 route() 를 마흔 번 넘게 부르는데도.
// 이유는 이렇다: 다른 검사 파일은 modes.js 를 거쳐 route.js 를 import 만 하고
// 안 부른다. 그 프로세스의 기록에는 route() 전체가 count 0 인 구간으로 남는다.
// 두 기록을 섞으면 그 0 짜리 구간이 실제로 마흔 번 지나간 기록을 덮어 버린다.
//
// 한 프로세스 안에서는 안쪽 구간이 바깥을 덮는 게 맞다(그게 분기 커버리지다).
// 프로세스 사이에서는 반대다 — 한 군데서만 밟아도 밟은 것이다. 그래서
// 프로세스별로 줄 집합을 뽑고 마지막에 합집합을 낸다.
function 모으기() {
  const 모음 = new Map();   // 파일경로 → [프로세스별 구간 배열]
  for (const 이름 of readdirSync(자리)) {
    if (!이름.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(readFileSync(join(자리, 이름), 'utf8')); } catch { continue; }
    for (const s of j.result ?? []) {
      if (!String(s.url).startsWith('file:')) continue;
      let p;
      try { p = fileURLToPath(s.url); } catch { continue; }
      if (!볼파일인가(p)) continue;
      const 구간들 = [];
      for (const f of s.functions ?? []) {
        // ranges[0] 은 언제나 그 함수 전체다. 나머지는 그 안의 분기(블록)다.
        // '함수가 불렸나' 는 반드시 ranges[0] 으로 봐야 한다.
        //
        // 처음에는 isBlockCoverage 가 켜진 함수를 통째로 건너뛰었다. 그런데
        // 그 값은 '이 함수는 분기까지 정밀하게 쟀다' 는 뜻이라, 오히려 실제로
        // 불린 함수에만 켜진다. 그래서 128개 검사가 부르는 commands.handle 이
        // '한 번도 안 불린 함수' 로 나왔다 — 정반대로 읽고 있었다.
        (f.ranges ?? []).forEach((rg, i) => {
          구간들.push({ ...rg, fn: f.functionName || '(이름없음)', 함수전체: i === 0 });
        });
      }
      if (!구간들.length) continue;
      const 지금 = 모음.get(p) ?? [];
      지금.push(구간들);
      모음.set(p, 지금);
    }
  }
  return 모음;
}

// 우리 소스만 센다. 검사 파일 자신과 node 내부는 뺀다 —
// 검사가 검사를 얼마나 밟았는지는 아무 뜻이 없다.
function 볼파일인가(p) {
  const rel = relative(root, p);
  if (rel.startsWith('..')) return false;
  const 정규 = rel.split(sep).join('/');
  if (!정규.startsWith('src/') && !정규.startsWith('bin/')) return false;
  return 정규.endsWith('.js') || 정규.endsWith('.mjs');
}

// ── 3. 구간을 줄로 바꾼다 ───────────────────────────────────────────────
function 재기(경로, 프로세스별) {
  const 원문 = readFileSync(경로, 'utf8');
  // V8 이 주는 오프셋은 **바이트가 아니라 문자(UTF-16 단위)** 다.
  //
  // 처음에 바이트로 잡았다가 route.js 가 48% 로 나왔다. 이 프로젝트는 한글
  // 주석이 많아서 route.js 만 해도 6,746바이트인데 문자로는 4,313이다.
  // 그 차이만큼 뒤로 밀린 자리를 칠하니, 실제로 마흔 번 지나간 함수가
  // 안 밟은 것으로 나왔다. 한글이 적은 파일일수록 덜 틀려서 더 안 보인다.
  const len = 원문.length;

  // 문자 자리 → 줄 번호.
  const 줄번호 = new Int32Array(len);
  {
    let 줄 = 0;
    for (let i = 0; i < len; i++) {
      줄번호[i] = 줄;
      if (원문.charCodeAt(i) === 10) 줄++;
    }
  }

  const 줄들 = 원문.split('\n');
  const 셀수있는줄 = [];
  for (let ln = 0; ln < 줄들.length; ln++) if (셀줄인가(줄들[ln])) 셀수있는줄.push(ln);

  const 밟은줄 = new Set();
  // 함수 이름 → 이 함수를 실제로 부른 프로세스가 하나라도 있었나
  const 함수불림 = new Map();

  for (const 구간들 of 프로세스별) {
    // 한 프로세스 안: 큰 구간부터 칠하고 작은 구간으로 덮는다. 안쪽이 이긴다.
    const 횟수 = new Int32Array(len).fill(-1);
    const 정렬 = [...구간들].sort((a, x) => (x.endOffset - x.startOffset) - (a.endOffset - a.startOffset));
    for (const rg of 정렬) {
      const s = Math.max(0, rg.startOffset);
      const e = Math.min(len, rg.endOffset);
      for (let i = s; i < e; i++) 횟수[i] = rg.count;
    }

    const 최대 = new Int32Array(줄들.length).fill(-1);
    for (let i = 0; i < len; i++) {
      const ch = 원문.charCodeAt(i);
      // 공백은 빼고 본다. 들여쓰기만 있는 자리는 뜻이 없다.
      if (ch === 32 || ch === 9 || ch === 13 || ch === 10) continue;
      const ln = 줄번호[i];
      if (횟수[i] > 최대[ln]) 최대[ln] = 횟수[i];
    }
    // 합집합 — 어느 한 프로세스에서라도 밟았으면 밟은 것이다.
    for (const ln of 셀수있는줄) if (최대[ln] > 0) 밟은줄.add(ln);

    for (const rg of 구간들) {
      if (!rg.함수전체) continue;   // 함수 전체 구간만 본다. 나머지는 분기다.
      const 키 = `${rg.fn}@${rg.startOffset}`;
      함수불림.set(키, (함수불림.get(키) ?? false) || rg.count > 0);
    }
  }

  /*
   * ── 한 번도 안 지나간 함수 ──────────────────────────────────────────
   *
   * 이 칸이 **자기 자신과 어긋난 답**을 내고 있었다. 같은 파일에서
   * 「줄 커버리지 100%(안 밟은 구간 0개)」 라고 적으면서 동시에
   * 「이 함수는 한 번도 안 불렸다」 를 두 개씩 적었다. 줄 번호도 실제와
   * 스무 줄 넘게 어긋났다. 이 저장소에서 「검사가 한 번도 안 부르는 자리」 를
   * 찾는 연장은 이것 하나뿐인데, 거짓 양성이 섞이면 진짜 구멍이 그 속에 묻힌다.
   *
   * 그래서 **두 가지를 고친다.**
   *
   *   1. 줄을 오프셋만 믿지 않는다. 오프셋으로 얻은 줄에 그 이름이 없으면
   *      소스에서 그 이름을 선언한 줄을 찾아 쓴다. 못 찾으면 그렇다고 적는다.
   *   2. 그 줄이 **밟힌 줄**이면 안 불린 것이 아니다. 줄 커버리지는 실제와
   *      맞는 것이 확인됐으므로, 둘이 어긋나면 이쪽(함수 판정)을 접는다.
   *      모르면서 아는 척하는 것보다 못 세는 편이 낫다.
   */
  const 안밟은함수 = [];
  {
    const 이름줄찾기 = (이름) => {
      if (!이름) return -1;
      const 꼴 = [
        new RegExp(`(^|[^a-zA-Z0-9_])function[ ]*[*]?[ ]+${이름}[ ]*[(]`),
        new RegExp(`(^|[^a-zA-Z0-9_])(const|let|var)[ ]+${이름}[ ]*=`),
        new RegExp(`(^|[^a-zA-Z0-9_])${이름}[ ]*[(][^)]*[)][ ]*[{]`),
        new RegExp(`(^|[^a-zA-Z0-9_])${이름}[ ]*:`),
      ];
      for (let i = 0; i < 줄들.length; i++) {
        if (꼴.some((re) => re.test(줄들[i]))) return i;
      }
      return -1;
    };
    for (const [키, 불림] of 함수불림) {
      if (불림) continue;
      const 이름 = 키.slice(0, 키.lastIndexOf('@'));
      const off = Number(키.slice(키.lastIndexOf('@') + 1));
      const 오프셋줄 = 줄번호[Math.min(len - 1, Math.max(0, off))];
      // 오프셋이 가리킨 줄에 그 이름이 정말 있나. 없으면 소스에서 찾는다.
      const 맞나 = 이름 && String(줄들[오프셋줄] ?? '').includes(이름);
      const 줄 = 맞나 ? 오프셋줄 : 이름줄찾기(이름);
      // 그 줄이 밟혔으면 안 불린 것이 아니다. 어긋나면 적지 않는다.
      if (줄 >= 0 && 밟은줄.has(줄)) continue;
      if (줄 < 0 && 이름) continue;         // 어디 있는지도 모르면 말하지 않는다
      안밟은함수.push({ 이름: 이름 || '(이름없음)', 줄: 줄 + 1 });
    }
  }
  // 같은 이름이 여러 오프셋으로 들어오면 한 줄로 모은다.
  {
    const 본것 = new Set();
    const 추린것 = [];
    for (const x of 안밟은함수) {
      const 키 = `${x.이름}@${x.줄}`;
      if (본것.has(키)) continue;
      본것.add(키);
      추린것.push(x);
    }
    안밟은함수.length = 0;
    안밟은함수.push(...추린것);
  }
  안밟은함수.sort((a, x) => a.줄 - x.줄);

  // 안 밟은 구간을 줄 묶음으로. "여기가 안 돌았다" 를 사람이 보기 좋게.
  const 안밟은묶음 = [];
  {
    const 정렬2 = [...셀수있는줄].filter((ln) => !밟은줄.has(ln)).sort((a, x) => a - x);
    let 시작 = null; let 앞 = null;
    for (const ln of 정렬2) {
      if (시작 === null) { 시작 = ln; 앞 = ln; continue; }
      if (ln === 앞 + 1) { 앞 = ln; continue; }
      안밟은묶음.push([시작 + 1, 앞 + 1]);
      시작 = ln; 앞 = ln;
    }
    if (시작 !== null) 안밟은묶음.push([시작 + 1, 앞 + 1]);
  }

  const 전체 = 셀수있는줄.length;
  const 밟음 = 밟은줄.size;
  return {
    경로,
    이름: relative(root, 경로).split(sep).join('/'),
    전체,
    밟음,
    비율: 전체 ? (밟음 / 전체) * 100 : 100,
    안밟은함수,
    안밟은묶음,
    줄들,
  };
}

/**
 * 이 줄을 셈에 넣는가.
 *
 * 주석과 빈 줄은 뺀다. 이 프로젝트는 주석이 아주 많아서(왜 그렇게 했는지를
 * 적어 두는 규칙) 안 빼면 비율이 주석 양에 좌우된다 — 검사를 늘려도 숫자가
 * 안 오르고, 주석을 지우면 숫자가 오른다. 그런 지표는 사람을 잘못 이끈다.
 *
 * 여는 괄호·닫는 괄호만 있는 줄도 뺀다. V8 은 이런 줄을 함수 밖으로 치는
 * 일이 있어서, 밟히지도 못하는 줄이 분모에만 쌓인다.
 */
function 셀줄인가(줄) {
  const s = String(줄).trim();
  if (!s) return false;
  if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return false;
  if (/^[)\]}]*[;,]?$/.test(s)) return false;
  if (/^(import|export)\s/.test(s) && !/=>|\bfunction\b/.test(s)) return false;
  return true;
}

// ── 4. 화면 ─────────────────────────────────────────────────────────────
function 막대(비율, 폭 = 12) {
  const n = Math.round((비율 / 100) * 폭);
  const 색 = 비율 >= 문턱 ? g : 비율 >= 50 ? y : r;
  return 색('▰'.repeat(n)) + d('▱'.repeat(폭 - n));
}

const code = await 검사돌리기();
const 모음 = 모으기();

// 한 번도 안 실린 파일도 0% 로 잡아야 한다.
// 안 그러면 '아무도 안 쓰는 파일' 이 표에서 통째로 사라져 100% 처럼 보인다.
const 모든소스 = [];
(function 훑기(디렉) {
  for (const e of readdirSync(디렉, { withFileTypes: true })) {
    const p = join(디렉, e.name);
    if (e.isDirectory()) 훑기(p);
    else if (볼파일인가(p)) 모든소스.push(p);
  }
})(join(root, 'src'));
for (const p of readdirSync(join(root, 'bin')).map((x) => join(root, 'bin', x))) {
  if (볼파일인가(p)) 모든소스.push(p);
}

const 결과 = 모든소스.map((p) => (모음.has(p) ? 재기(p, 모음.get(p)) : 실린적없음(p)));

function 실린적없음(경로) {
  const 줄들 = readFileSync(경로, 'utf8').split('\n');
  const 셀 = 줄들.filter(셀줄인가).length;
  return {
    경로, 이름: relative(root, 경로).split(sep).join('/'),
    전체: 셀, 밟음: 0, 비율: 0,
    안밟은함수: [], 안밟은묶음: 셀 ? [[1, 줄들.length]] : [], 줄들,
    안실림: true,
  };
}

결과.sort((a, x) => a.비율 - x.비율);
const 총전체 = 결과.reduce((s, x) => s + x.전체, 0);
const 총밟음 = 결과.reduce((s, x) => s + x.밟음, 0);
const 총비율 = 총전체 ? (총밟음 / 총전체) * 100 : 0;

if (JSON출력) {
  console.log(JSON.stringify({
    overall: Number(총비율.toFixed(2)),
    lines: { total: 총전체, covered: 총밟음 },
    threshold: 문턱,
    testExit: code,
    files: 결과.map((x) => ({
      file: x.이름, pct: Number(x.비율.toFixed(2)), total: x.전체, covered: x.밟음,
      uncoveredRanges: x.안밟은묶음, uncalledFunctions: x.안밟은함수, neverLoaded: !!x.안실림,
    })),
  }, null, 2));
} else if (한파일) {
  const 찾음 = 결과.find((x) => x.이름 === 한파일.split(sep).join('/') || x.이름.endsWith('/' + 한파일));
  if (!찾음) { console.log(r(`  그런 파일이 없습니다: ${한파일}`)); process.exit(1); }
  console.log(`\n${b(찾음.이름)}  ${막대(찾음.비율)} ${w(찾음.비율.toFixed(0) + '%')} ${d(`${찾음.밟음}/${찾음.전체}줄`)}\n`);
  if (찾음.안밟은함수.length) {
    console.log(d('  한 번도 안 불린 함수'));
    for (const f of 찾음.안밟은함수) console.log(`    ${r('·')} ${w(f.이름)} ${d(':' + f.줄)}`);
    console.log('');
  }
  console.log(d('  안 밟은 줄'));
  for (const [s, e] of 찾음.안밟은묶음) {
    console.log(`    ${r(s === e ? String(s) : `${s}–${e}`)}  ${d((찾음.줄들[s - 1] ?? '').trim().slice(0, 62))}`);
  }
  console.log('');
} else {
  console.log(`\n${b('커버리지')}  ${d('(검사가 소스의 어디를 실제로 밟았는가)')}\n`);
  const 폭 = Math.max(...결과.map((x) => x.이름.length), 10);
  const 낮은것 = 결과.filter((x) => x.비율 < 문턱);
  for (const x of 결과) {
    const 색 = x.비율 >= 문턱 ? g : x.비율 >= 50 ? y : r;
    console.log(`  ${x.비율 >= 문턱 ? g('✓') : r('✗')} ${x.이름.padEnd(폭)}  ${막대(x.비율)} ${색(String(Math.round(x.비율)).padStart(3) + '%')} ${d(`${x.밟음}/${x.전체}`)}${x.안실림 ? d('  한 번도 안 실림') : ''}`);
  }
  console.log(`\n  ${d('─'.repeat(폭 + 34))}`);
  console.log(`  ${b('전체')}${' '.repeat(폭 - 2)}  ${막대(총비율)} ${(총비율 >= 문턱 ? g : r)(String(Math.round(총비율)).padStart(3) + '%')} ${d(`${총밟음}/${총전체}줄`)}`);
  console.log(`\n  ${문턱}% 미만 ${낮은것.length ? r(낮은것.length + '개') : g('없음')}${낮은것.length ? d('  — 자세히 보려면 node test/coverage.mjs --file <경로>') : ''}`);
  console.log(`  ${d('검사 종료코드')} ${code === 0 ? g('0') : r(String(code))}\n`);
}

rmSync(자리, { recursive: true, force: true });
process.exitCode = code === 0 ? 0 : 1;
