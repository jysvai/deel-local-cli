// 나머지 화면들 — 대화 목록, 훑기 결과, 엑셀 표를 글로 바꾸는 자리.
//
// 다 '보여 주기만' 하는 코드라 틀려도 안 죽는다. 그래서 오히려 오래 방치된다.
// 여기서 틀리면 사람이 잘못된 것을 보고 잘못된 결정을 한다 —
// 없는 대화를 이어하려 하거나, 도구 호출도 못 하는 모델을 골라 쓰거나.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessions } from '../src/agent/sessionui.js';
import { Store, list as listSessions } from '../src/agent/store.js';
import { toText, summarize, isExcelPath } from '../src/tools/excel.js';
import { spin } from '../src/ui/spinner.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

async function 받아적기(fn) {
  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
  try { const v = await fn(); return { v, out: 모인것 }; } finally { process.stdout.write = 원래; }
}
const 색빼기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

trace('1-대화목록');

// ── deel sessions ───────────────────────────────────────────────────────
{
  const 빈폴더 = mkdtempSync(join(tmpdir(), 'deel-ui2-empty-'));
  const { v, out } = await 받아적기(() => runSessions({ root: 빈폴더 }));
  check('대화가 없으면 0 으로 끝난다', v === 0, String(v));
  check('없다고 말해 준다', /남아 있는 대화가 없습니다/.test(색빼기(out)), 색빼기(out).trim().slice(0, 60));
  check('어떻게 쌓이는지 알려 준다', /한 번 쓰면/.test(색빼기(out)), '');
  rmSync(빈폴더, { recursive: true, force: true });
}

{
  const 폴더 = mkdtempSync(join(tmpdir(), 'deel-ui2-sess-'));
  // 대화 두 개를 남긴다.
  // Store 의 둘째 인자는 '대화 이름'이다. 모델 같은 머리글은 begin() 으로 넣는다 —
  // 여기에 객체를 넘기면 이름이 [object Object] 가 된다.
  const s1 = new Store(폴더).begin({ model: '가모델', root: 폴더 });
  s1.append({ role: 'user', content: '첫 번째 대화의 첫 질문입니다' });
  s1.append({ role: 'assistant', content: '답' });
  const s2 = new Store(폴더).begin({ model: '나모델', root: 폴더 });
  s2.append({ role: 'user', content: '두 번째 대화입니다' });
  s2.append({ role: 'assistant', content: '답' });

  const { v, out } = await 받아적기(() => runSessions({ root: 폴더 }));
  const 글 = 색빼기(out);
  check('대화가 있으면 0 으로 끝난다', v === 0, String(v));
  check('둘 다 보여 준다', /첫 번째 대화의 첫 질문/.test(글) && /두 번째 대화입니다/.test(글), 글.slice(0, 200));
  check('모델 이름을 같이 보여 준다', /가모델|나모델/.test(글), '');
  check('언제였는지 보여 준다', /방금|분 전|시간 전|어제|일 전|\d{4}-\d{2}/.test(글), 글.slice(0, 200));

  // 지우기
  const 있는것 = listSessions(폴더, { limit: 10 });
  const { v: v2, out: out2 } = await 받아적기(() => runSessions({ root: 폴더, rm: 있는것[0].id }));
  check('id 로 대화를 지운다', v2 === 0, String(v2));
  check('지웠다고 말해 준다', /지웠습니다/.test(색빼기(out2)), 색빼기(out2).trim().slice(0, 60));
  check('실제로 하나 줄었다', listSessions(폴더, { limit: 10 }).length === 있는것.length - 1,
    `${있는것.length} → ${listSessions(폴더, { limit: 10 }).length}`);

  // 없는 id 를 지우려 하면 1 로 끝나야 한다. 0 으로 끝내면 스크립트가 성공으로 안다.
  const { v: v3, out: out3 } = await 받아적기(() => runSessions({ root: 폴더, rm: '그런거없음' }));
  check('없는 id 를 지우면 1 로 끝난다', v3 === 1, String(v3));
  check('없다고 말해 준다', 색빼기(out3).trim().length > 0, 색빼기(out3).trim().slice(0, 60));

  rmSync(폴더, { recursive: true, force: true });
}

trace('2-엑셀글로바꾸기');

// ── 엑셀 표 → 모델에게 줄 글 ────────────────────────────────────────────
{
  check('.xlsx 를 엑셀로 본다', isExcelPath('가계부.xlsx'), '');
  check('.xls 도 엑셀로 본다', isExcelPath('옛날.xls'), '');
  check('.xlsm 도 엑셀로 본다', isExcelPath('매크로.xlsm'), '');
  check('대문자 확장자도 본다', isExcelPath('A.XLSX'), '');
  check('.csv 는 엑셀이 아니다', !isExcelPath('a.csv'), '이미 글이라 그냥 읽으면 된다');
  check('.txt 는 엑셀이 아니다', !isExcelPath('a.txt'), '');
  check('없는 값에도 안 터진다', !isExcelPath(null) && !isExcelPath(undefined), '');
}

{
  const 시트들 = [
    { name: '1월', hidden: false, rows: [['날짜', '금액'], ['1일', '1000'], ['2일', '2000']] },
    { name: '숨긴것', hidden: true, rows: [['비고'], ['ㅇ']] },
  ];
  const { text, 잘림 } = toText(시트들);
  check('시트마다 머리를 붙인다', /### 시트: 1월/.test(text), text.slice(0, 60));
  check('숨긴 시트는 숨김이라고 적는다', /숨긴것 \(숨김\)/.test(text), '');
  check('줄·칸 수를 적는다', /3줄 × 2칸/.test(text), text.split('\n')[0]);
  check('CSV 로 만든다', /날짜,금액/.test(text), text.split('\n')[1]);
  check('안 잘렸으면 잘림이 비어 있다', 잘림.length === 0, JSON.stringify(잘림));
}

{
  // 큰 표. 통째로 밀어 넣으면 컨텍스트가 터진다 — 자르되 잘랐다고 말해야 한다.
  const 큰것 = [{ name: '큰표', rows: Array.from({ length: 900 }, (_, i) => [String(i), '값']) }];
  const { text, 잘림 } = toText(큰것, { maxRows: 100 });
  check('줄이 많으면 자른다', text.split('\n').length < 200, `${text.split('\n').length}줄`);
  check('잘랐다고 알려 준다', 잘림.some((x) => /900줄 중 100줄/.test(x)), JSON.stringify(잘림));
  check('원래 줄 수는 그대로 적는다', /900줄/.test(text), text.split('\n')[0]);

  const { text: t2, 잘림: j2 } = toText(큰것, { maxRows: 900, maxChars: 500 });
  check('글자 수로도 자른다', t2.length <= 560, `${t2.length}자`);
  check('글자로 잘랐다고도 알려 준다', j2.some((x) => /길이/.test(x)), JSON.stringify(j2));
  check('자른 자리를 글에도 남긴다', /여기서 자릅니다/.test(t2), t2.slice(-40));
}

{
  // 빈 시트. 실제로 있다 — 서식만 있고 값이 없는 시트.
  const { text, 잘림 } = toText([{ name: '빈것', rows: [] }]);
  check('빈 시트에도 안 터진다', /빈것/.test(text), text.slice(0, 60));
  check('빈 시트는 0줄 × 0칸', /0줄 × 0칸/.test(text), text.split('\n')[0]);
  check('시트가 아예 없어도 안 터진다', toText([]).text === '', JSON.stringify(toText([]).text));
}

{
  const 한줄 = summarize([{ name: 'a', rows: [[1], [2]] }, { name: 'b', rows: [[3]] }], '암호를 풀어 읽음');
  check('요약이 시트 수를 센다', /시트 2개/.test(한줄), 한줄);
  check('요약이 줄 수를 센다', /3줄/.test(한줄), 한줄);
  check('어떻게 읽었는지 남긴다', /암호를 풀어 읽음/.test(한줄), 한줄);
}

trace('3-진행표시-TTY');

// ── 진행 표시의 TTY 갈래 ────────────────────────────────────────────────
//
// 사람이 보는 화면에서는 돌아야 한다. 검사는 TTY 가 아니라서 그동안 이쪽이
// 한 번도 안 돌았다 — 여기서 터지면 사람만 겪는 고장이 된다.
{
  const 원래TTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

  let 터짐 = null;
  const { out } = await 받아적기(async () => {
    try {
      const s = spin('돌고 있습니다');
      // 한 칸 넘어가게 두면 tick 이 두 번 이상 돈다.
      await new Promise((r) => setTimeout(r, 200));
      s.stop('  다 됐습니다');
    } catch (err) { 터짐 = err?.message ?? String(err); }
  });
  check('TTY 에서 스피너가 안 터진다', 터짐 === null, String(터짐));
  check('TTY 에서는 스피너 글자가 나온다', /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(out), JSON.stringify(out.slice(0, 40)));
  check('멈추면 끝맺음 글을 남긴다', /다 됐습니다/.test(out), '');
  check('멈춘 뒤에는 더 안 그린다', (() => {
    const 뒤 = out.split('다 됐습니다')[1] ?? '';
    return !/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(뒤);
  })(), '멈춘 뒤에도 돌면 화면이 계속 흔들린다');

  if (원래TTY) Object.defineProperty(process.stdout, 'isTTY', 원래TTY);
  else delete process.stdout.isTTY;
}

trace('4-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n나머지 화면 검사  ${D}(틀려도 안 죽어서 오래 방치되는 자리)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
