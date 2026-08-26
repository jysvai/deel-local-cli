// 첫 실행 마법사. 처음 켠 사람이 가장 먼저 만나는 자리다.
//
// 왜 여기까지 검사하나: 이 화면에서 막히면 그 사람은 이 프로그램을 다시 안 켠다.
// 그런데 손으로 눌러 보는 것 말고는 확인할 길이 없어서, 그동안 아무도 안 봤다.
// 그래서 표준입력을 가짜 TTY 로 갈아끼워 사람이 치는 것처럼 넣는다.
//
// 붙는 곳은 이 컴퓨터 안(127.0.0.1)의 임시 스텁뿐이다. 바깥으로는 안 나간다.
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, confirm, pick } from '../src/ui/prompt.js';
import { runSetup, showStatus, runDiagnose } from '../src/setup.js';
import { load } from '../src/config.js';
import { resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const home = mkdtempSync(join(tmpdir(), 'deel-setup-home-'));
process.env.DEEL_HOME = home;

// ── 가짜 TTY 표준입력 ───────────────────────────────────────────────────
//
// prompt.js 는 process.stdin 을 직접 잡고 raw 모드로 한 글자씩 읽는다.
// 그래서 흉내 낼 것이 세 가지다: isTTY · setRawMode · 글자 흘려보내기.
const 진짜stdin = process.stdin;
function 가짜입력() {
  const s = new PassThrough();
  s.isTTY = true;
  s.setRawMode = () => s;
  Object.defineProperty(process, 'stdin', { value: s, configurable: true });
  return s;
}
function 되돌리기() {
  Object.defineProperty(process, 'stdin', { value: 진짜stdin, configurable: true });
}

// 화면은 삼키고, 물어보는 사이사이에 대답을 넣어 준다.
//
// 대답은 '시간을 재서' 가 아니라 '물음이 화면에 뜬 것을 보고' 넣는다.
// 시간으로 맞추면 느린 기계에서 두 대답이 한 덩어리로 붙어 들어가고,
// 빠른 기계에서는 물음보다 먼저 도착한다. 둘 다 됐다 안 됐다 하는 검사가 된다 —
// 실제로 CI 여섯 자리 중 넷이 그렇게 빨간불이 났다.
async function 대화(대답들, fn) {
  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
  const 입력 = 가짜입력();

  // prompt.js 의 ask 는 물어볼 때마다 '›' 를 찍는다. 그 개수가 곧 몇 번 물었나다.
  const 물은횟수 = () => (모인것.match(/›/g) ?? []).length;
  const 기다리기 = async (몇번째) => {
    for (let i = 0; i < 400 && 물은횟수() < 몇번째; i++) await new Promise((r) => setTimeout(r, 10));
  };

  try {
    const p = fn();
    for (let i = 0; i < 대답들.length; i++) {
      await 기다리기(i + 1);       // i+1 번째 물음이 뜰 때까지
      입력.write(대답들[i] + '\r');
    }
    const v = await p;
    return { v, out: 모인것 };
  } finally {
    process.stdout.write = 원래;
    되돌리기();
  }
}
const 색빼기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

trace('1-한줄받기');

// ── 한 줄 입력 ──────────────────────────────────────────────────────────
{
  const { v, out } = await 대화(['안녕하세요'], () => ask('이름'));
  check('친 글을 그대로 받는다', v === '안녕하세요', JSON.stringify(v));
  check('친 글이 화면에도 보인다', /안녕하세요/.test(out), JSON.stringify(색빼기(out).slice(0, 40)));

  const { v: v2 } = await 대화([''], () => ask('이름', { def: '기본이름' }));
  check('그냥 엔터면 기본값', v2 === '기본이름', JSON.stringify(v2));

  const { v: v3 } = await 대화(['적은것'], () => ask('이름', { def: '기본이름' }));
  check('적었으면 적은 것이 이긴다', v3 === '적은것', JSON.stringify(v3));
}

{
  // 가림 입력. 키를 칠 때 화면에 안 보여야 한다.
  const { v, out } = await 대화(['비밀키abc'], () => ask('API 키', { mask: true }));
  check('가림 입력도 값은 그대로 받는다', v === '비밀키abc', JSON.stringify(v));
  check('가림 입력은 화면에 안 찍힌다', !색빼기(out).includes('비밀키abc'), JSON.stringify(색빼기(out).slice(0, 50)));
  check('대신 가림표가 찍힌다', /●/.test(out), '');
}

{
  // 지우기(백스페이스). 오타를 못 고치면 긴 키를 못 넣는다.
  const { v } = await 대화(['abc\x7fd'], () => ask('키'));
  check('백스페이스로 지운다', v === 'abd', JSON.stringify(v));

  // 빈 상태에서 백스페이스를 눌러도 안 터진다
  const { v: v2 } = await 대화(['\x7f\x7fxy'], () => ask('키'));
  check('빈 상태 백스페이스에도 안 터진다', v2 === 'xy', JSON.stringify(v2));

  // 제어문자는 무시한다. 붙여넣기에 섞여 들어온다.
  const { v: v3 } = await 대화(['a\x01b\x1bc'], () => ask('키'));
  check('제어문자는 안 담는다', v3 === 'abc', JSON.stringify(v3));
}

trace('2-예아니오');

{
  for (const [친것, 기본, 될것, 이름] of [
    ['y', true, true, 'y 는 예'],
    ['n', true, false, 'n 은 아니오'],
    ['', true, true, '엔터는 기본값(예)'],
    ['', false, false, '엔터는 기본값(아니오)'],
    ['ㅇ', false, true, '한글 ㅇ 도 예'],
    ['예', false, true, '한글 예 도 예'],
    ['아무거나', true, false, '엉뚱한 답은 아니오'],
  ]) {
    const { v } = await 대화([친것], () => confirm('하시겠습니까', 기본));
    check(이름, v === 될것, `받은 것 ${v}`);
  }
}

trace('3-목록고르기');

{
  const 목록 = [{ label: '첫째', note: 'ㄱ' }, { label: '둘째' }, { label: '셋째' }];
  const { v, out } = await 대화(['2'], () => pick('고르세요', 목록));
  check('번호로 고른다', v === 1, String(v));
  check('목록이 화면에 보인다', /첫째/.test(out) && /셋째/.test(out), '');
}

trace('4-첫실행마법사');

// ── 마법사 전체를 한 바퀴 ───────────────────────────────────────────────
//
// 여기가 이 검사의 본론이다. 주소를 넣고 → 붙고 → 모델을 고르고 → 진단을 돌고
// → 설정이 저장되기까지가 한 번도 안 끊겨야 한다.
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    // 모델 이름이 한글이면 주소에 퍼센트 인코딩으로 실려 온다. 풀고 본다.
    const url = decodeURIComponent(req.url.split('?')[0]);
    const 보냄 = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/v1/models') return 보냄({ data: [{ id: '가모델', owned_by: '사내' }, { id: '나모델' }] });
    if (url === '/api/v0/models/가모델') return 보냄({ id: '가모델', max_context_length: 131072, loaded_context_length: 131072 });
    if (url === '/v1/chat/completions') {
      let j = null;
      try { j = JSON.parse(body); } catch {}
      // 도구를 물어보면 도구를 부르는 흉내를 낸다. 진단이 이걸로 판정을 낸다.
      const 도구요청 = Array.isArray(j?.tools) && j.tools.length;
      return 보냄({
        choices: [{
          finish_reason: 도구요청 ? 'tool_calls' : 'stop',
          message: 도구요청
            ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }
            : { role: 'assistant', content: '네' },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      });
    }
    보냄({}, 404);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

{
  const { v, out } = await 대화(
    ['검사연결', `127.0.0.1:${port}`, '', '1'],   // 이름 · 주소 · 키(없음) · 모델 1번
    () => runSetup(),
  );
  const 글 = 색빼기(out);
  check('마법사가 0 으로 끝난다', v === 0, String(v));
  check('연결됐다고 말해 준다', /연결됨/.test(글), 글.slice(0, 80));
  check('모델 목록을 보여 준다', /가모델/.test(글) && /나모델/.test(글), '');
  check('진단까지 돌린다', /판정|준비됨|제한적/.test(글), 글.slice(-160));
  check('설정 파일을 저장한다', existsSync(join(home, 'config.json')), home);

  const cfg = load();
  check('고른 모델이 저장된다', cfg.profiles?.[0]?.model === '가모델', String(cfg.profiles?.[0]?.model));
  check('붙은 주소가 저장된다', String(cfg.profiles?.[0]?.baseUrl).includes(String(port)), String(cfg.profiles?.[0]?.baseUrl));
  check('이 연결이 활성으로 잡힌다', cfg.active === cfg.profiles?.[0]?.id, `${cfg.active} vs ${cfg.profiles?.[0]?.id}`);
  check('진단에서 읽은 컨텍스트가 저장된다', cfg.profiles?.[0]?.ctx === 131072, String(cfg.profiles?.[0]?.ctx));
  check('키가 없으면 키 경고를 안 띄운다', !/키가 이 파일에 들어 있습니다/.test(글), '');
}

{
  // 주소를 비우면 더 진행하면 안 된다. 빈 주소로 저장되면 다음에 켤 때 막힌다.
  const { v, out } = await 대화(['이름만', ''], () => runSetup());
  check('주소가 비면 1 로 끝낸다', v === 1, String(v));
  check('주소가 비었다고 말해 준다', /주소가 비었습니다/.test(색빼기(out)), 색빼기(out).slice(-60));
}

{
  // 안 붙는 주소. 무엇을 확인해야 하는지 알려 줘야 한다 —
  // 사내망에서는 대개 프록시나 인증서 문제라서 그 두 개를 짚어 준다.
  const { v, out } = await 대화(['이름', '127.0.0.1:1', ''], () => runSetup());
  const 글 = 색빼기(out);
  check('안 붙으면 1 로 끝낸다', v === 1, String(v));
  check('연결 실패라고 말해 준다', /연결 실패/.test(글), 글.slice(0, 80));
  check('어디를 시도했는지 보여 준다', /\/models/.test(글), '');
  check('사내 인증서 이야기를 해 준다', /NODE_EXTRA_CA_CERTS/.test(글), '');
  check('프록시 이야기도 해 준다', /프록시/.test(글), '');
}

{
  // 키를 넣은 경우 — 키가 파일에 남는다는 것을 반드시 알려 줘야 한다.
  const { out } = await 대화(['키있는연결', `127.0.0.1:${port}`, 'key-1', '1'], () => runSetup());
  const 글 = 색빼기(out);
  check('키를 넣으면 파일에 남는다고 알려 준다', /키가 이 파일에 들어 있습니다/.test(글), 글.slice(-200));
  check('환경변수로 빼는 법도 알려 준다', /DEEL_API_KEY/.test(글), '');
}

trace('5-상태와진단');

{
  const 원래 = process.stdout.write.bind(process.stdout);
  let 글 = '';
  process.stdout.write = (chunk) => { 글 += chunk; return true; };
  let code;
  try { code = await showStatus(); } finally { process.stdout.write = 원래; }
  check('status 가 0 으로 끝난다', code === 0 || code === undefined, String(code));
  check('status 가 저장된 연결을 보여 준다', /가모델|검사연결|키있는연결/.test(색빼기(글)), 색빼기(글).slice(0, 100));
}

{
  // 인자로 준 주소로 바로 진단. 저장된 것과 무관하게 돌아야 한다.
  const 원래 = process.stdout.write.bind(process.stdout);
  let 글 = '';
  process.stdout.write = (chunk) => { 글 += chunk; return true; };
  let code;
  try {
    code = await runDiagnose({ url: `127.0.0.1:${port}`, key: '', model: '가모델' });
  } finally { process.stdout.write = 원래; }
  check('주소를 직접 줘도 진단이 돈다', code === 0, String(code));
  check('진단이 판정을 낸다', /판정|준비됨|제한적|막힘/.test(색빼기(글)), 색빼기(글).slice(-120));
}

trace('6-치움');
srv.close();
resetNet();
rmSync(home, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n첫 실행 마법사 검사  ${D}(처음 켠 사람이 여기서 막히면 다시 안 켠다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
