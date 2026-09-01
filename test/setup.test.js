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
import { resetNet, setOffline, isOffline } from '../src/safety/network.js';
import { 제공자들 } from '../src/providers/index.js';
import { 리전들 } from '../src/providers/bedrock.js';
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
 * 아래 검사들은 전부 **바깥에 안 나간다.** 고른 뒤 규격이 아직 없어서
 * (Anthropic) 또는 리전이 이상해서, 붙기 전에 멈추는 자리만 밟는다.
 */
{
  // 1번 = 열쇠만 있습니다. sk-ant- 는 Anthropic 이다 — sk- 가 먼저 집으면 안 된다.
  const { v, out } = await 대화([메뉴번호('열쇠먼저'), 'sk-ant-api03-abcdefghijklmnop'], () => runSetup());
  const 글 = 색빼기(out);
  check('★ 앞머리로 어디 열쇠인지 알아본다', /Anthropic/.test(글), 글.slice(-300).split('\n').filter(Boolean).slice(0, 2).join(' / '));
  check('★ 다른 데는 안 묻는다고 말한다', /여기저기 던지지 않습니다/.test(글), '');
  check('아직 못 하는 규격이면 붙기 전에 멈춘다', v === 1, String(v));
  check('왜 멈췄는지 말한다', /규격을 아직 다 못 붙였습니다/.test(글), '');
  check('그럼 뭘 쓰면 되는지도 말한다', /Gemini|Bedrock/.test(글), '');
}

{
  /*
   * 모르는 열쇠. 여기서 짐작으로 아무 데나 보내면 그게 바로 유출이다.
   * 「모르겠으니 골라 주세요」 가 정답이다.
   */
  const { v, out } = await 대화([메뉴번호('열쇠먼저'), 'ABSK-사내에서-발급한-열쇠-1234', String(제공자들.findIndex((x) => x.id === 'anthropic') + 1)], () => runSetup());
  const 글 = 색빼기(out);
  check('★ 모르는 열쇠는 모른다고 한다', /어디 열쇠인지 모르겠습니다/.test(글), '');
  check('★ 짐작으로 안 보낸다고 말한다', /짐작으로 여기저기 보내지 않습니다/.test(글), '');
  check('대신 사람에게 고르게 한다', /어디 열쇠인가요/.test(글), '');
  // 2번 = Anthropic → 규격이 없어서 멈춘다. 바깥에 안 나간다.
  check('고른 뒤 흐름이 이어진다', v === 1, String(v));
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
