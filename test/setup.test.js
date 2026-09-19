// 첫 실행 마법사. 처음 켠 사람이 가장 먼저 만나는 자리다.
//
// 왜 여기까지 검사하나: 이 화면에서 막히면 그 사람은 이 프로그램을 다시 안 켠다.
// 그런데 손으로 눌러 보는 것 말고는 확인할 길이 없어서, 그동안 아무도 안 봤다.
// 그래서 표준입력을 가짜 TTY 로 갈아끼워 사람이 치는 것처럼 넣는다.
//
// 붙는 곳은 이 컴퓨터 안(127.0.0.1)의 임시 스텁뿐이다. 바깥으로는 안 나간다.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, confirm, pick } from '../src/ui/prompt.js';
import { runSetup, showStatus, runDiagnose } from '../src/setup.js';
import { verdict } from '../src/report.js';
import { load } from '../src/config.js';
import { resetNet, setOffline, isOffline, contacted } from '../src/safety/network.js';
import { 제공자들 } from '../src/providers/index.js';
import { 리전들 } from '../src/providers/bedrock.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 진입점 = fileURLToPath(new URL('../bin/deel.js', import.meta.url));
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

// 보이지 않는 글자는 코드값으로 만든다 — 이 파일에 날 글자를 적지 않는다.
const ESC = String.fromCharCode(27);

{
  /*
   * ── 한 덩어리에 답이 둘 실려 올 때 ────────────────────────────────────
   *
   * `printf '2\nhttp://…\n' | deel setup` 이나 빠른 붙여넣기에서 난다. 엔터 뒤 나머지를 되돌려
   * 놓는데, 되돌리는 순간 **아직 듣고 있는 첫 물음**에게 곧바로 다시 배달돼 「firstsecond」 가
   * 되고, 둘째 물음은 영영 답을 못 받았다.
   */
  for (const [이름, 덩이] of [['LF', 'first\nsecond\n'], ['CRLF', 'first\r\nsecond\r\n']]) {
    const 원래 = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    const 입력 = 가짜입력();
    let a; let b;
    try {
      const p = ask('하나');
      입력.write(덩이);
      a = await p;
      b = await Promise.race([ask('둘'), new Promise((r) => setTimeout(() => r('<안 옴>'), 1500))]);
    } finally { process.stdout.write = 원래; 되돌리기(); }
    check(`★★ 한 덩어리의 두 답을 두 물음이 나눠 받는다 (${이름})`, a === 'first' && b === 'second', JSON.stringify([a, b]));
  }
}

{
  /*
   * ── CRLF 가 덩이 사이에서 갈려 올 때 (Gemini 화면4) ─────────────────────
   *
   * 윈도에서 CRLF 로 적은 답 파일을 파이프로 흘리면 `ans1\r` | `\nans2\r\n` 로 갈려 올 수 있다.
   * 첫 물음은 \r 에서 끝나고, 둘째 물음이 맨 앞 \n 을 엔터로 읽어 **빈 답**으로 넘어갔다 —
   * 그 뒤 답이 한 칸씩 다음 물음으로 밀린다(주소 물음에 모델 이름이 들어간다).
   */
  const 원래 = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  const 입력 = 가짜입력();
  // 파이프다 — 터미널(raw)은 엔터를 \r 하나로만 보내 CRLF 가 갈릴 일이 없다.
  입력.isTTY = false;
  const 답들 = [];
  try {
    const p1 = ask('하나');
    입력.write('ans1\r');
    답들.push(await p1);
    const p2 = ask('둘');
    입력.write('\nans2\r\n');
    답들.push(await Promise.race([p2, new Promise((r) => setTimeout(() => r('<안 옴>'), 1500))]));
  } finally { process.stdout.write = 원래; 되돌리기(); }
  check('★ CRLF 가 덩이 사이에서 갈려도 빈 답이 안 끼어든다', 답들[0] === 'ans1' && 답들[1] === 'ans2', JSON.stringify(답들));
}

{
  /*
   * 터미널에서는 삼키지 않는다 (Gemini 화면5). raw 모드의 엔터는 늘 덩이 끝 \r 하나라, 그 뒤 첫 키로
   * Ctrl+J(\n)를 치면 그 엔터가 먹혀 물음이 안 끝났다. CRLF 가 갈려 오는 것은 파이프뿐이다.
   */
  const 원래 = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  const 입력 = 가짜입력();
  let 둘째;
  try {
    const p1 = ask('하나');
    입력.write('ans1\r');
    await p1;
    const p2 = ask('둘', { def: 'D' });
    입력.write('\n');
    둘째 = await Promise.race([p2, new Promise((r) => setTimeout(() => r('<안 옴>'), 1500))]);
  } finally { process.stdout.write = 원래; 되돌리기(); }
  check('★ 터미널에서 엔터 뒤 Ctrl+J 를 삼키지 않는다', 둘째 === 'D', JSON.stringify(둘째));
}

{
  /*
   * ── ESC 를 누르고 O 를 치고 엔터 ────────────────────────────────────────
   *
   * `ESC O` 뒤 한 글자를 무엇이든 SS3 순서의 끝으로 먹었다. 엔터가 그 자리에 오면 엔터가 사라져
   * 물음이 안 끝난다. SS3 의 끝 글자는 0x40–0x7E 뿐이다 — 아니면 홑 ESC(Alt+O)다.
   */
  const 원래 = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  const 입력 = 가짜입력();
  let v;
  try {
    const p = ask('키');
    입력.write(`ab${String.fromCharCode(27)}O\r`);
    v = await Promise.race([p, new Promise((r) => setTimeout(() => r('<안 옴>'), 1500))]);
  } finally { process.stdout.write = 원래; 되돌리기(); }
  check('★ ESC O 뒤의 엔터를 순서 끝으로 안 먹는다', v === 'abO', JSON.stringify(v));
}

{
  /*
   * ── 화살표·Delete·붙여넣기 표시가 글자로 박혔다 ─────────────────────────
   *
   * ESC 만 떼고 뒤따르는 `[D` `[3~` `[200~` 는 글자로 담았다. 가림 입력이면 화면에는 ● 만 보여
   * 사람은 모른다 — 열쇠가 조용히 틀어져 저장되고, 붙을 때 401 이 난다.
   */
  const 경우 = [
    ['왼쪽 화살표', `http://localhst${ESC}[D${ESC}[Do`, 'http://localhsto', {}],
    ['Delete', `abc${ESC}[3~`, 'abc', {}],
    ['Home', `bc${ESC}[Ha`, 'bca', {}],
    ['SS3 화살표', `ab${ESC}OAc`, 'abc', {}],
    ['가림 입력에서 화살표', `sk-abc${ESC}[D`, 'sk-abc', { mask: true }],
    ['붙여넣기 표시', `${ESC}[200~http://x:1${ESC}[201~`, 'http://x:1', {}],
  ];
  for (const [이름, 친것, 될것, o] of 경우) {
    const { v } = await 대화([친것], () => ask('키', o));
    check(`★ ${이름} 순서를 글자로 안 담는다`, v === 될것, JSON.stringify(v));
  }

  // 순서가 두 토막에 갈려 와도 (느린 원격 터미널)
  const 원래 = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  const 입력 = 가짜입력();
  let v;
  try {
    const p = ask('키');
    입력.write(`ab${ESC}[`);
    await new Promise((r) => setTimeout(r, 20));
    입력.write('3~c\r');
    v = await p;
  } finally { process.stdout.write = 원래; 되돌리기(); }
  check('★ 순서가 두 토막에 갈려 와도 글자로 안 담는다', v === 'abc', JSON.stringify(v));

  // 그림글자는 UTF-16 두 토막이다. 한 토막만 지우면 반쪽 글자가 열쇠·이름에 남는다.
  const { v: 그림 } = await 대화([`a${String.fromCodePoint(0x1f600)}\x7f`], () => ask('키'));
  check('★ 그림글자 뒤 백스페이스가 반쪽 글자를 안 남긴다', 그림 === 'a', JSON.stringify(그림));
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
  // 2번 = 주소를 직접 넣기. 그 다음 주소 · 키(없음) · 이름 · 모델 1번.
  const { v, out } = await 대화(
    ['2', `127.0.0.1:${port}`, '', '검사연결', '1'],
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
  const { v, out } = await 대화(['2', ''], () => runSetup());
  check('주소가 비면 1 로 끝낸다', v === 1, String(v));
  check('주소가 비었다고 말해 준다', /주소가 비었습니다/.test(색빼기(out)), 색빼기(out).slice(-60));
}

{
  /*
   * ── 틀린 주소를 열쇠·이름까지 다 받은 뒤에야 알렸다 ──────────────────
   *
   * `http://` · `https://` · `::1` · 빈칸 든 주소를 넣으면 열쇠를 묻고 이름을 묻고, 그 다음에야
   * 「Invalid URL」 이라는 날것의 말로 실패했다. 열쇠를 찾아 붙여넣은 수고가 버려진다.
   *
   * 여기서는 물음이 뜰 때만 답을 넣고, 마법사가 끝나면 더 안 넣는다 — 위 대화() 는 답을 다 쓸
   * 때까지 물음을 기다려서, 일찍 끝나는 쪽을 재면 한 경우에 몇 초씩 걸린다.
   */
  const 끝까지 = async (대답들, fn) => {
    const 원래 = process.stdout.write.bind(process.stdout);
    let 모인것 = '';
    process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
    const 입력 = 가짜입력();
    let 끝남 = false;
    try {
      const p = Promise.resolve().then(fn).catch((e) => `던짐: ${e?.message}`).finally(() => { 끝남 = true; });
      for (let i = 0; i < 대답들.length && !끝남; i++) {
        for (let j = 0; j < 300 && !끝남 && (모인것.match(/›/g) ?? []).length < i + 1; j++) await new Promise((r) => setTimeout(r, 10));
        if (!끝남) 입력.write(`${대답들[i]}\r`);
      }
      const v = await Promise.race([p, new Promise((r) => setTimeout(() => r('<안 끝남>'), 15000))]);
      return { v, out: 모인것 };
    } finally { process.stdout.write = 원래; 되돌리기(); }
  };
  /*
   * `http:///v1` · `/v1` 은 슬래시가 셋이라 URL 파서가 **경로를 호스트로 끌어올린다**
   * (`http://v1/`). 「호스트 이름이 없습니다」 줄이 `!u.hostname` 을 보고 있어서 한 번도
   * 안 걸렸고 — http/https 는 호스트가 비면 `new URL` 이 먼저 던진다 — 마법사는 열쇠와
   * 이름까지 다 받은 뒤 `v1` 이라는 엉뚱한 이름을 진짜로 두드렸다. (doctor.js 와 쌍둥이)
   */
  for (const 주소 of ['http://', 'https://', '::1', 'http://local host:1/v1', 'http:///v1', '/v1']) {
    const { v, out } = await 끝까지(['2', 주소, '', ''], () => runSetup());
    const 글 = 색빼기(out);
    check(`★ 틀린 주소(${주소})는 받은 자리에서 1 로 끝낸다`, v === 1, String(v));
    check(`★ 틀린 주소(${주소})면 열쇠를 안 묻는다`, !/API 키/.test(글), 글.slice(-160));
    check(`틀린 주소(${주소})라고 사람 말로 적는다`, /주소가 올바르지 않습니다/.test(글) && !/Invalid URL/.test(글), 글.slice(-160));
  }
}

{
  // 안 붙는 주소. 무엇을 확인해야 하는지 알려 줘야 한다 —
  // 사내망에서는 대개 프록시나 인증서 문제라서 그 두 개를 짚어 준다.
  const { v, out } = await 대화(['2', '127.0.0.1:1', '', '이름'], () => runSetup());
  const 글 = 색빼기(out);
  check('안 붙으면 1 로 끝낸다', v === 1, String(v));
  check('연결 실패라고 말해 준다', /연결 실패/.test(글), 글.slice(0, 80));
  check('어디를 시도했는지 보여 준다', /\/models/.test(글), '');
  check('사내 인증서 이야기를 해 준다', /NODE_EXTRA_CA_CERTS/.test(글), '');
  check('프록시 이야기도 해 준다', /프록시/.test(글), '');
}

{
  // 키를 넣은 경우 — 그 키가 **어떤 꼴로** 파일에 들어갔는지 반드시 알려 줘야 한다.
  // 잠긴 것과 평문을 구분해 주지 않으면, 안 잠긴 파일을 잠긴 줄 알고 아무 데나 둔다.
  const { out } = await 대화(['2', `127.0.0.1:${port}`, 'key-1', '키있는연결', '1'], () => runSetup());
  const 글 = 색빼기(out);
  check('키를 넣으면 어디에 어떻게 두는지 알려 준다', /열쇠 보관 — (DPAPI|맥 키체인|파일에 평문)/.test(글), 글.slice(-260));
  check('환경변수로 빼는 법도 알려 준다', /DEEL_API_KEY/.test(글), '');
}

trace('4-2-붙일곳-고르기');

/*
 * ── 이 절은 바깥에 못 나간다 ────────────────────────────────────────────
 *
 * 여기서 밟는 길에는 진짜 벤더 주소(api.openai.com · generativelanguage…)가
 * 들어 있다. 번호를 하나 잘못 세면 검사가 진짜로 구글에 붙는다 — 실제로 한 번
 * 그랬다. 「조심해서 번호를 잘 세자」 는 대책이 아니다.
 *
 * 그래서 봉인을 걸어 둔다. 127.0.0.1 은 그대로 되고(위 절의 스텁), 바깥은
 * 자물쇠가 막는다. 번호를 잘못 세도 나갈 수가 없다.
 */
setOffline(true);
check('★ 이 절은 봉인되어 있다 — 번호를 잘못 세도 바깥에 못 나간다', isOffline());

// 메뉴 번호를 손으로 세지 않는다. 제공자를 하나 더하면 번호가 통째로 밀리는데,
// 그때 검사는 조용히 엉뚱한 항목을 고르게 된다 — 위에서 겪은 그대로다.
const 메뉴번호 = (id) => {
  if (id === '열쇠먼저') return '1';
  if (id === 'custom') return '2';
  const 벤더 = 제공자들.filter((p) => p.id !== 'custom').map((p) => p.id);
  return String(3 + 벤더.indexOf(id));
};

/*
 * ── 「열쇠만 있습니다」 길 ───────────────────────────────────────────────
 *
 * 여기서 제일 조심할 것은 편의가 아니라 **열쇠가 어디로 가느냐**다.
 * 「어디 것인지 찾아 주기」 를 벤더마다 찔러 보는 식으로 만들면, Anthropic
 * 열쇠가 OpenAI 서버로, 다시 Google 서버로 간다. 401 이 오고 끝이지만 열쇠는
 * 이미 갔다. 그래서 앞머리로 짐작해 **한 곳만** 묻고, 모르면 물어본다.
 *
 * 아래 검사들은 전부 **바깥에 안 나간다.** 리전이 이상해서 붙기 전에 멈추거나,
 * 봉인이 막아서 「연결 실패」 로 끝나는 자리만 밟는다.
 */
{
  // 1번 = 열쇠만 있습니다. sk-ant- 는 Anthropic 이다 — sk- 가 먼저 집으면 안 된다.
  const { v, out } = await 대화(
    [메뉴번호('열쇠먼저'), 'sk-ant-api03-abcdefghijklmnop', ''], () => runSetup(),
  );
  const 글 = 색빼기(out);
  check('★ 앞머리로 어디 열쇠인지 알아본다', /Anthropic/.test(글), 글.slice(-300).split('\n').filter(Boolean).slice(0, 2).join(' / '));
  check('★ 다른 데는 안 묻는다고 말한다', /여기저기 던지지 않습니다/.test(글), '');
  check('열쇠 받는 곳도 알려 준다', String(글).includes('console.anthropic.com'), '');
  /*
   * ★ 봉인이 실제로 막는다.
   *
   * 이 자리가 이 절의 안전 그물이다. 번호를 잘못 세도, 규격이 하나 더
   * 붙어도, 봉인이 켜져 있는 한 검사는 진짜 벤더 서버에 못 닿는다.
   * 그리고 막혔을 때 **죽지 않고** 「연결 실패」 로 끝나야 한다 —
   * 예전에는 자물쇠 예외가 설정 전체를 죽였다.
   */
  check('★ 봉인이 막아서 못 붙는다', v === 1, String(v));
  check('★ 죽지 않고 연결 실패로 끝난다', /연결 실패/.test(글), 글.slice(-200).trim().split('\n').at(-1) ?? '');
  check('막은 것이 봉인이라고 말한다', /오프라인 모드|밖으로는 나가지 않습니다/.test(글), '');
}

{
  /*
   * 모르는 열쇠. 여기서 짐작으로 아무 데나 보내면 그게 바로 유출이다.
   * 「모르겠으니 골라 주세요」 가 정답이다.
   *
   * 고른 뒤에는 위와 같다 — 봉인이 막아서 붙기 전에 끝난다.
   */
  const { v, out } = await 대화(
    [메뉴번호('열쇠먼저'), 'ABSK-사내에서-발급한-열쇠-1234',
      String(제공자들.findIndex((x) => x.id === 'anthropic') + 1), ''],
    () => runSetup(),
  );
  const 글 = 색빼기(out);
  check('★ 모르는 열쇠는 모른다고 한다', /어디 열쇠인지 모르겠습니다/.test(글), '');
  check('★ 짐작으로 안 보낸다고 말한다', /짐작으로 여기저기 보내지 않습니다/.test(글), '');
  check('대신 사람에게 고르게 한다', /어디 열쇠인가요/.test(글), '');
  check('고른 뒤 흐름이 이어진다', v === 1, String(v));
  check('여기서도 봉인이 막는다', /연결 실패/.test(글), '');
}

{
  // Bedrock 은 리전이 주소에 들어간다. 이상한 리전으로 주소를 지어내면
  // 있지도 않은 호스트를 두드리고, 화면에는 「연결 실패」 만 남는다 —
  // 리전을 잘못 적었다는 것을 알려 줄 기회를 놓친다.
  // 5번 = AWS Bedrock · 6번 = 리전 직접 입력.
  const { v, out } = await 대화([메뉴번호('bedrock'), String(리전들.length + 1), '서울'], () => runSetup());
  const 글 = 색빼기(out);
  check('★ 이상한 리전이면 주소를 안 만들고 멈춘다', v === 1, String(v));
  check('리전이 이상하다고 콕 집어 말한다', /리전 이름이 이상합니다/.test(글), 글.slice(-160).trim().split('\n').at(-1) ?? '');
  check('올바른 꼴을 예로 보여 준다', /ap-northeast-2/.test(글), '');
}

{
  // 목록이 지원 명단처럼 보이면 거기 없는 회사는 안 되는 줄 알고 돌아선다.
  // 「직접 넣기」 가 목록 위쪽에 있어야 한다.
  const { out } = await 대화([메뉴번호('custom'), ''], () => runSetup());
  const 글 = 색빼기(out);
  const 직접자리 = 글.indexOf('주소를 직접 넣기');
  const 벤더자리 = 글.indexOf('AWS Bedrock');
  check('★ 「직접 넣기」 가 벤더 목록보다 위에 있다',
    직접자리 >= 0 && 벤더자리 >= 0 && 직접자리 < 벤더자리, `직접@${직접자리} 벤더@${벤더자리}`);
  check('빈칸이 몇 개인지 미리 알려 준다', /빈칸 \d개/.test(글), (글.match(/빈칸 \d개[^\n]*/) ?? [''])[0]);
  check('빈칸 0개짜리 길(deel scan)을 먼저 알려 준다', /deel scan --save/.test(글), '');
}

// 봉인을 푼다. 아래는 다시 이 컴퓨터 안의 스텁에 붙는다.
setOffline(false);

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

trace('5-0-못-붙었을-때-무엇이-막았는지');

{
  /*
   * ── 알아낸 쪽이 적어 둔 말이 일반 문구에 덮인다 (막판-바깥) ────────────
   *
   * setup.js 의 「연결 실패」 자리는 `막힌까닭()` 을 **먼저** 쓰고, 그게 없을
   * 때만 `found.why` 로 떨어진다. 그런데 `공통까닭()` 은 401·403·404·429·402
   * 에 전부 답을 갖고 있다. 그래서 detect.js 의 `애저막힌말()` 이 지어 둔 세
   * 줄(401·403·404)이 한 번도 화면에 못 간다.
   *
   * 404 가 제일 아깝다. 일반 문구는 「주소를 다시 보세요」 로 끝나는데,
   * Azure 에서 그 404 는 **주소에 배포 이름이 빠진 것**이라 고칠 자리가 딱
   * 정해져 있다 — 알아낸 쪽은 그 자리를 이미 적어 뒀다.
   *
   * 여기서는 404 를 내는 이 컴퓨터 안 스텁을 Azure 배포 주소 꼴로 두드려,
   * 그 한 줄이 화면까지 오는지만 본다.
   */
  const 스텁404 = createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":{"code":"DeploymentNotFound"}}');
  });
  await new Promise((r) => 스텁404.listen(0, '127.0.0.1', r));
  const p404 = 스텁404.address().port;

  const 원래 = process.stdout.write.bind(process.stdout);
  let 글 = '';
  process.stdout.write = (chunk) => { 글 += chunk; return true; };
  try {
    await runDiagnose({ url: `http://127.0.0.1:${p404}/openai/deployments`, key: '가짜열쇠', model: '가모델' });
  } finally { process.stdout.write = 원래; 스텁404.close(); }
  const 맨글 = 색빼기(글);

  check('★★ 알아낸 쪽이 적어 둔 까닭이 화면까지 온다 (Azure 404 의 배포 이름 힌트)',
    맨글.includes('/openai/deployments/<배포이름>'),
    맨글.split('\n').filter((l) => l.includes('⚠')).join(' / ') || '⚠ 줄 없음');
  check('★ 일반 문구도 같이 남는다 (아는 것을 빼서 맞추지 않는다)',
    /이 규격이 없습니다/.test(맨글),
    맨글.split('\n').filter((l) => l.includes('⚠')).join(' / ') || '⚠ 줄 없음');
}

{
  /*
   * ── 봉인은 `--url` 로 직접 준 주소에도 걸려야 한다 ────────────────────
   *
   * 469줄 머리말이 「오히려 그쪽이 더 위험하다 — 설정에 없는 주소를 그 자리에서
   * 두드리는 길이기 때문이다」 라고 적어 두었다. 그런데 봉인 판정은 runProbe 에
   * 넘어가고, 그 앞의 connect() 가 먼저 주소를 두드린다. 봉인을 켜 놓은 사람이
   * 「안 나갔겠지」 하는 동안 실제로는 나간 셈이다.
   *
   * 나갔는지는 말이 아니라 자물쇠 기록(contacted)으로 잰다 — 화면 글은 두드린
   * 뒤에도 「연결 실패」 로 똑같이 찍히기 때문이다.
   */
  const 전 = contacted().length;
  const 원래 = process.stdout.write.bind(process.stdout);
  let 글 = '';
  process.stdout.write = (chunk) => { 글 += chunk; return true; };
  let code;
  try {
    code = await runDiagnose({ url: 'https://바깥게이트웨이.invalid', key: 'x', model: '가모델', offline: true });
  } finally { process.stdout.write = 원래; }
  check('★ 봉인이면 --url 로 준 바깥 주소를 안 두드린다', contacted().length === 전,
    `${전} → ${contacted().length}`);
  check('★ --url 갈래에서도 봉인이라고 말한다', /안 두드립니다|오프라인 모드/.test(색빼기(글)),
    색빼기(글).trim().split('\n').filter(Boolean).slice(-2).join(' / '));
  check('봉인에 막히면 1 로 끝난다', code === 1, String(code));
  check('봉인은 이 안 주소는 안 막는다',
    await runDiagnose({ url: `127.0.0.1:${port}`, key: '', model: '가모델', offline: true }) === 0);
}

trace('5-1-진단-끝값');

{
  /*
   * ── 진단이 실패해도 0 으로 끝났다 ──────────────────────────────────────
   *
   * `deel diagnose` 는 사내에 도구를 넣기 전에 스크립트가 제일 먼저 돌리는 명령이다.
   * 그 스크립트가 보는 것은 화면 글이 아니라 **끝값**이다. 판정이 「연결실패」 인데도
   * 0 으로 끝나면 스크립트는 붙은 줄 알고 다음 줄로 간다 — 진단을 돌린 뜻이 사라진다.
   * 봉인에 막혀 한 줄도 못 재 본 판도 마찬가지였다.
   *
   * 끝값은 **CLI 로** 잰다. 함수가 주는 값과 프로세스가 내는 값이 갈리는 자리가
   * 바로 새는 자리다.
   */
  const 진단집 = mkdtempSync(join(tmpdir(), 'deel-diag-끝값-'));
  /*
   * 스텁 서버가 **이 프로세스** 안에 떠 있다. spawnSync 로 부르면 이 쪽 이벤트 루프가
   * 멈춰서 스텁이 영영 답을 못 하고, 아이는 60초 시간 초과로 「연결실패」 를 본다 —
   * 재려던 것과 다른 것을 재게 된다. 그래서 비동기 spawn 으로 띄운다.
   */
  const 돌리기 = (프로필, 덧 = {}) => new Promise((끝) => {
    writeFileSync(join(진단집, 'config.json'),
      JSON.stringify({ version: 1, active: 'd', profiles: [프로필], ...덧 }), 'utf8');
    const 아이 = spawn(process.execPath, [진입점, 'diagnose'], {
      cwd: 진단집, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DEEL_HOME: 진단집, NO_COLOR: '1', FORCE_COLOR: '', DEEL_NO_MOTION: '1' },
    });
    let 글 = '';
    아이.stdout.on('data', (b2) => (글 += b2));
    아이.stderr.on('data', (b2) => (글 += b2));
    const 시계 = setTimeout(() => 아이.kill('SIGKILL'), 120000);
    아이.stdin.end();
    아이.on('close', (code) => { clearTimeout(시계); 끝({ code, 글: 색빼기(글) }); });
  });
  const 바탕 = { id: 'd', name: '검사', kind: 'openai', auth: 'none', model: '가모델' };

  const 됨 = await 돌리기({ ...바탕, baseUrl: `http://127.0.0.1:${port}/v1` });
  check('진단이 되면 0 으로 끝난다', 됨.code === 0,
    `code=${됨.code} · ${됨.글.trim().split('\n').filter(Boolean).slice(-1)[0] ?? ''}`);

  const 안됨 = await 돌리기({ ...바탕, baseUrl: 'http://127.0.0.1:1/v1' });
  check('★★ 연결이 안 되면 0 이 아닌 값으로 끝낸다', 안됨.code !== 0, `code=${안됨.code}`);
  check('  화면에도 연결실패라고 적는다', /연결실패|연결 자체가 되지 않았습니다/.test(안됨.글),
    안됨.글.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '');

  // 봉인 판. `.invalid` 는 어떤 DNS 도 답하지 않기로 정해진 이름이라 진짜 바깥에 안 닿는다.
  const 봉인 = await 돌리기({ ...바탕, baseUrl: 'https://no-such-host-deel-diag.invalid/v1', online: true },
    { offline: true });
  check('★★ 봉인에 막혀 한 줄도 못 재 봤으면 0 으로 끝내지 않는다', 봉인.code !== 0, `code=${봉인.code}`);
  check('  봉인이라고 적는다', /안 두드립니다/.test(봉인.글),
    봉인.글.trim().split('\n').filter(Boolean).slice(-2).join(' / '));
  rmSync(진단집, { recursive: true, force: true });
}

trace('5-2-마법사도-봉인');

{
  /*
   * ── `deel setup` 이 봉인을 뚫고 나갔다 ─────────────────────────────────
   *
   * runProbe 머리말이 「봉인은 진단에도 걸린다 … 자물쇠가 명령 하나로 열리면
   * 자물쇠가 아니다」 라고 적어 두었는데, 정작 마법사는 그 말을 한 번도 안 넘겼다.
   * 관리 정책이나 설정에 offline 을 켜 둔 PC 에서도 후보 주소를 그대로 두드렸다 —
   * 사람이 방금 적어 넣은 열쇠까지 실려서. `diagnose` 는 같은 판에서 막는다.
   *
   * 나갔는지는 말이 아니라 자물쇠 기록(contacted)으로 잰다 — 화면 글은 두드린 뒤에도
   * 「연결 실패」 로 똑같이 찍히기 때문이다. 주소는 `.invalid` 를 쓴다. 어떤 DNS 도
   * 답하지 않기로 정해진 이름이라 진짜 바깥에 닿을 일이 없다.
   */
  const 봉인집 = mkdtempSync(join(tmpdir(), 'deel-setup-봉인-'));
  writeFileSync(join(봉인집, 'config.json'),
    JSON.stringify({ version: 1, offline: true, active: null, profiles: [] }), 'utf8');
  const 옛집 = process.env.DEEL_HOME;
  process.env.DEEL_HOME = 봉인집;
  const 전 = contacted().length;
  let v; let out;
  try {
    ({ v, out } = await 대화(
      ['2', 'https://no-such-host-deel-setup.invalid/v1', '', '봉인검사'], () => runSetup(),
    ));
  } finally { process.env.DEEL_HOME = 옛집; }
  const 글 = 색빼기(out);
  check('★★ 봉인이면 deel setup 도 바깥 주소를 안 두드린다', contacted().length === 전,
    `${전} → ${contacted().length}`);
  check('★ 마법사도 봉인이라고 말한다', /안 두드립니다/.test(글),
    글.trim().split('\n').filter(Boolean).slice(-2).join(' / '));
  check('★ 봉인에 막히면 1 로 끝낸다', v === 1, String(v));
  check('★ 못 재 본 연결을 저장하지 않는다',
    !(load().profiles ?? []).some((p) => String(p.baseUrl).includes('no-such-host-deel-setup')),
    JSON.stringify((load().profiles ?? []).map((p) => p.baseUrl)));
  rmSync(봉인집, { recursive: true, force: true });
}

{
  /*
   * ── 같은 자물쇠를 **깃발로** 잠갔을 때 (막판-바깥) ────────────────────
   *
   * `--help` 는 `--offline` 을 「⛊ 봉인 — 기억해 둔 허가까지 무시하고 막습니다」
   * 라고 적는다. 그런데 bin/deel.js 는 `runSetup()` 을 **인자 없이** 부르고,
   * 설정받기() 의 봉인 판정은 `봉인됐나({ cfg })` 라 깃발 칸이 늘 비어 있었다.
   * 위 블록이 막는 것은 설정·정책에 적힌 봉인뿐이고, 사람이 그 자리에서
   * `deel setup --offline` 이라고 친 것은 조용히 버려졌다.
   *
   * 깃발을 믿고 사내 게이트웨이 주소를 넣은 사람은 방금 적어 넣은 열쇠까지
   * 실어 보낸 셈이 된다. 설정은 **비워 두고** 깃발만 준다 — 그래야 이 자리가
   * 실제로 재진다.
   */
  const 깃발집 = mkdtempSync(join(tmpdir(), 'deel-setup-깃발봉인-'));
  writeFileSync(join(깃발집, 'config.json'),
    JSON.stringify({ version: 1, active: null, profiles: [] }), 'utf8');
  const 옛집 = process.env.DEEL_HOME;
  process.env.DEEL_HOME = 깃발집;
  const 전 = contacted().length;
  let v; let out;
  try {
    ({ v, out } = await 대화(
      ['2', 'https://no-such-host-deel-flag.invalid/v1', '', '깃발봉인검사'],
      () => runSetup({ offline: true }),
    ));
  } finally { process.env.DEEL_HOME = 옛집; }
  const 글 = 색빼기(out);
  check('★★ --offline 깃발만 줘도 deel setup 이 바깥 주소를 안 두드린다',
    contacted().length === 전, `${전} → ${contacted().length}`);
  check('★ 깃발 갈래에서도 봉인이라고 말한다', /안 두드립니다/.test(글),
    글.trim().split('\n').filter(Boolean).slice(-2).join(' / '));
  check('★ 깃발 봉인에 막히면 1 로 끝낸다', v === 1, String(v));
  rmSync(깃발집, { recursive: true, force: true });
}

{
  // 반대쪽. 봉인을 켜 둬도 이 안(127.0.0.1) 주소는 그대로 붙어야 한다 —
  // 자물쇠가 너무 세면 사람들은 자물쇠를 끄는 법부터 배운다.
  const 안집 = mkdtempSync(join(tmpdir(), 'deel-setup-봉인안-'));
  writeFileSync(join(안집, 'config.json'),
    JSON.stringify({ version: 1, offline: true, active: null, profiles: [] }), 'utf8');
  const 옛집 = process.env.DEEL_HOME;
  process.env.DEEL_HOME = 안집;
  let v; let out;
  try {
    ({ v, out } = await 대화(['2', `127.0.0.1:${port}`, '', '봉인안검사', '1'], () => runSetup()));
  } finally { process.env.DEEL_HOME = 옛집; }
  check('★ 봉인은 이 안 주소는 안 막는다 — 마법사가 그대로 끝난다', v === 0,
    `${v} · ${색빼기(out).trim().split('\n').filter(Boolean).slice(-1)[0] ?? ''}`);
  rmSync(안집, { recursive: true, force: true });
}

trace('5-3-판정말');

// ── 진단 판정이 빠뜨리는 칸 ────────────────────────────────────────────
//
// 판정(src/report.js 의 verdict)은 사람이 이 화면에서 가져가는 전부다.
// 한 칸이 「안됨」 인데 판정 글이 그 칸을 한 마디도 안 하면, 사람은 그 줄을
// 못 보고 지나간다 — 표는 길고 판정 글은 짧아서 다들 판정 글만 읽는다.
{
  const 판 = (system) => verdict({ ctx: 131072 }, [
    ['chat', 'ok'], ['system', system], ['stream', 'ok'],
    ['tools', 'ok'], ['toolresult', 'ok'], ['json', 'ok'], ['think', 'ok'],
  ].map(([id, status]) => ({ id, status })));

  const 시스템말 = (v) => v.notes.filter((n) => /시스템/.test(n));
  check('시스템 지시를 약하게 따르면 그 말을 한다', 시스템말(판('warn')).length === 1,
    JSON.stringify(시스템말(판('warn'))));
  /*
   * ★ `=== 'warn'` 만 보고 있었다.
   *
   * 옆줄의 json·stream 은 `!== 'ok'` 로 재는데 이 줄만 warn 하나만 봤다.
   * 그래서 **제일 나쁜 판**(system 을 붙이면 요청 자체가 실패하는 게이트웨이)에서
   * 판정 글이 아무 말도 안 했다. 규칙도 스킬도 하나도 안 걸리는 연결인데
   * 화면은 「준비됨」 이었다.
   */
  check('★★ 시스템 지시가 아예 안 통하는 판에도 말을 한다', 시스템말(판('no')).length === 1,
    JSON.stringify(판('no').notes));
  check('★ 그때는 「약하게」 가 아니라 아예 안 된다고 적는다',
    /실패|안 통|안 걸/.test(시스템말(판('no'))[0] ?? '') && !/약하게/.test(시스템말(판('no'))[0] ?? ''),
    시스템말(판('no'))[0] ?? '(없음)');
  check('멀쩡하면 시스템 이야기를 안 한다', 시스템말(판('ok')).length === 0,
    JSON.stringify(시스템말(판('ok'))));
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
