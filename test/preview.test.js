// 만든 웹을 그 자리에서 띄우기.
//
// ── 여기서 지키는 것 ────────────────────────────────────────────────────
//
// 서버를 띄운다는 것은 **내 디스크를 남에게 열어 주는 일**이다. 편한 기능이
// 하나 늘어나는 게 아니라 새는 자리가 하나 생기는 것이므로, 되는 것보다
// **안 되어야 하는 것**을 더 촘촘히 본다.
//
//   · 띄운 폴더 밖이 열리는가 (../ · %2e%2e · 절대경로 · 널바이트)
//   · 밖으로 나가 있는가 (127.0.0.1 말고 다른 데 묶였는가)
//   · 받는 길이 열려 있는가 (PUT·POST 로 파일이 써지는가)
//   · 끄면 진짜로 꺼지는가 (안 꺼지면 포트를 문 채로 남는다)
//
// 서버는 **포트 0** 으로 띄운다. 고정 포트는 남이 쓰던 것을 뺏는다.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { 띄우기 } from '../src/preview/serve.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-차림');

const 모래밭 = mkdtempSync(join(tmpdir(), 'deel-preview-'));
const 사이트 = join(모래밭, '사이트');
mkdirSync(join(사이트, '안쪽'), { recursive: true });
writeFileSync(join(사이트, 'index.html'), '<!doctype html><html><body><h1>안녕</h1></body></html>', 'utf8');
writeFileSync(join(사이트, '안쪽', 'a.css'), 'body{color:red}', 'utf8');
writeFileSync(join(사이트, '모델.glb'), Buffer.from([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]));
mkdirSync(join(사이트, '빈방'), { recursive: true });
// 띄운 폴더 **밖**. 이게 열리면 안 된다.
writeFileSync(join(모래밭, '비밀.env'), 'API_KEY=진짜키', 'utf8');

/*
 * 안엣 JS 를 재는 데 쓸 것들. **서버를 띄우기 전에** 만든다.
 *
 * 전에는 그 절 안에서 만들었다. 그런데 되살리기 감시는 watch(뿌리,
 * {recursive:true}) 이고, 윈도우에서 그건 ReadDirectoryChangesW 다 —
 * 감시가 도는 중에 하위 폴더를 통째로 새로 만들면 libuv 가 그 자리에서
 * abort 한다(0xC0000409). 검사 하나가 지는 게 아니라 **프로세스가 사라져서**
 * 화면에 한 줄도 안 남는다. 윈도우 Node 24 에서만, 그것도 늘은 아니고 가끔.
 *
 * 감시가 파일 바뀌는 것을 제대로 보는지는 아래 되살리기 절이 따로 잰다.
 * 여기서 굳이 감시가 도는 중에 만들 이유가 없다.
 */
mkdirSync(join(사이트, '앱'), { recursive: true });
writeFileSync(join(사이트, '앱', 'main.js'), "import x from './쪽.js'; export default x;", 'utf8');
writeFileSync(join(사이트, '앱', '쪽.mjs'), 'export default 1;', 'utf8');
writeFileSync(join(사이트, '앱', '자료.json'), '{"값":1}', 'utf8');
writeFileSync(join(사이트, '앱', '판.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
writeFileSync(join(사이트, '앱', 'index.html'), '<!doctype html><body><script type="module" src="./main.js"></script></body>', 'utf8');

/*
 * 이음줄 둘 — 하나는 밖으로, 하나는 안으로. **서버를 띄우기 전에** 건다.
 *
 * 위 머리말과 같은 까닭이다. 감시가 도는 중에 하위 폴더(이음줄도 폴더다)를
 * 만들면 윈도우에서 libuv 가 그 자리에서 abort 한다. 윈도우에서 파일 이음줄은
 * 권한이 필요하지만 폴더 junction 은 그냥 걸린다.
 */
let 이음줄됨 = false;
try {
  symlinkSync(모래밭, join(사이트, '밖으로'), process.platform === 'win32' ? 'junction' : 'dir');
  symlinkSync(join(사이트, '안쪽'), join(사이트, '지름길'), process.platform === 'win32' ? 'junction' : 'dir');
  이음줄됨 = true;
} catch { /* 권한이 없으면 그 판은 건너뛴다 */ }

const scope = makeScope(모래밭);          // 작업 범위는 모래밭 전체
const 서버 = await 띄우기({ 뿌리: 사이트, scope });  // 띄운 것은 사이트만

/*
 * 받아 오기 — `fetch` 말고 node:http 로 직접 두드린다.
 *
 * fetch(undici)는 연결을 살려 두고 다시 쓴다(keep-alive). 그 자체는 좋은데,
 * 윈도우 Node 24 에서 이 검사가 그 연결 풀을 밟으면 0xC0000409 로 **프로세스가
 * 통째로 죽었다.** 검사 하나가 지는 게 아니라 사라지는 것이라, 무엇이
 * 틀렸는지 화면에 한 줄도 안 남는다. 고칠 때마다 죽는 자리가 한 걸음씩
 * 뒤로 밀린 것이 실마리였다 — 특정 호출이 아니라 쌓이는 것이 원인이라는 뜻이다.
 *
 * 그래서 여기서는 `agent: false` 로 요청마다 새 연결을 열고 바로 닫는다.
 * 이 검사가 재려는 것은 서버이지 클라이언트가 아니므로, 클라이언트는 제일
 * 단순한 것이 맞다. 재는 값(상태·헤더·몸)은 그대로다.
 */
const 받기 = (길, o = {}) => new Promise((done, 탈) => {
  const u = new URL(서버.url.replace(/\/$/, '') + 길);
  const q = http.request({
    hostname: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
    method: o.method ?? 'GET',
    headers: o.headers ?? {},
    agent: false,          // 연결을 재쓰지 않는다
  }, (a) => {
    let 몸 = '';
    a.setEncoding('utf8');
    a.on('data', (b) => { 몸 += b; });
    a.on('end', () => {
      const 형식 = a.headers['content-type'] ?? '';
      done({
        code: a.statusCode,
        글: 형식.startsWith('text') || !형식 ? 몸 : '',
        /*
         * ── 「글」 만 보면 새는 것을 못 본다 ──────────────────────────
         *
         * `글` 은 형식이 text 일 때만 채운다. 그건 화면에 그릴 것을 볼
         * 때는 맞는데, **밖으로 새나**를 잴 때는 정반대로 작동했다.
         *
         * 아래 3절의 탈출 검사가 `r.글.includes('진짜키')` 로 판정한다.
         * 그런데 `.env` 는 serve.js 의 형식표에 없어 octet-stream 으로
         * 나가고, 그러면 `글` 은 **언제나 빈 글자**다. 서버가 열쇠를
         * 통째로 내줘도 이 검사는 초록이다 — 여덟 가지 탈출을 재는 척하며
         * 아무것도 안 쟀다.
         *
         * 그래서 형식과 상관없는 날 몸을 따로 둔다. 새는지 보는 자리는
         * 이걸 본다.
         */
        몸,
        형식,
        // fetch 의 Response 처럼 헤더를 물어볼 수 있게 맞춰 둔다.
        r: { headers: { get: (이름) => a.headers[String(이름).toLowerCase()] ?? null } },
      });
    });
  });
  q.on('error', 탈);
  if (o.body) q.write(o.body);
  q.end();
});

trace('2-주기');
// ── 제 일은 하는가 ──────────────────────────────────────────────────────
{
  check('127.0.0.1 로만 묶인다', /^http:\/\/127\.0\.0\.1:\d+\/$/.test(서버.url), 서버.url);
  check('포트를 커널이 준다 (고정 아님)', 서버.port > 0 && 서버.port !== 8080 && 서버.port !== 3000,
    String(서버.port));

  const 첫장 = await 받기('/');
  check('index.html 을 준다', 첫장.code === 200 && 첫장.글.includes('안녕'), String(첫장.code));
  check('HTML 로 알려 준다', /text\/html/.test(첫장.형식), 첫장.형식);
  check('고치면 새로 뜨게 하는 조각을 끼운다', 첫장.글.includes(`__deel__/${encodeURIComponent('살아있나')}`));
  check('조각을 </body> 앞에 넣는다', 첫장.글.indexOf('EventSource') < 첫장.글.indexOf('</body>'));

  const css = await 받기('/안쪽/a.css');
  check('한글 폴더 안쪽도 준다', css.code === 200 && css.글.includes('color:red'), String(css.code));
  check('CSS 형식을 맞게 준다', /text\/css/.test(css.형식), css.형식);

  // 형식이 틀리면 Three.js 가 조용히 아무것도 안 그린다. 오류도 안 난다.
  const glb = await 받기('/모델.glb');
  check('glb 를 model/gltf-binary 로 준다', /model\/gltf-binary/.test(glb.형식), glb.형식);

  const 없는것 = await 받기('/없는파일.html');
  check('없는 것은 404', 없는것.code === 404, String(없는것.code));

  const 빈방 = await 받기('/빈방/');
  check('index 없는 폴더는 목록을 보여 준다', 빈방.code === 200 && /index\.html 이 없어서/.test(빈방.글),
    String(빈방.code));
}

trace('2.5-JS가다도나');
/*
 * ── 안엣 JS 가 누락 없이 도는가 ─────────────────────────────────────────
 *
 * 여기가 이 기능의 존재 이유다. 파일을 두 번 눌러 여는 것(file://)과 이것의
 * 차이가 바로 이 절이다. file:// 에서는 아래가 **전부** 막힌다 —
 * 모듈 import, fetch, 워커, WASM, 텍스처. 오류는 콘솔에만 나오고 화면은 그냥
 * 희어서, 만든 사람은 제 코드를 의심하며 몇 시간을 쓴다.
 *
 * 브라우저를 여기서 띄울 수는 없으므로, **브라우저가 그걸 돌리는 데 필요한
 * 조건**을 잰다. 형식(MIME)이 틀리면 브라우저가 아예 실행을 거부하기 때문에,
 * 실제로 여기서 거의 다 갈린다.
 */
{
  // 쓸 것들은 맨 위 차림에서 이미 만들어 뒀다 — 감시가 도는 중에 폴더를
  // 새로 만들면 윈도우에서 프로세스가 통째로 죽는다. 거기 적어 뒀다.

  // 형식이 틀리면 브라우저가 실행 자체를 거부한다. type="module" 은 특히 엄격하다.
  const 표 = [
    ['/앱/main.js', /text\/javascript/, '모듈 스크립트'],
    ['/앱/쪽.mjs', /text\/javascript/, '.mjs 도 자바스크립트로'],
    ['/앱/자료.json', /application\/json/, 'fetch 로 읽는 JSON'],
    ['/앱/판.wasm', /application\/wasm/, 'WebAssembly'],
  ];
  trace('2.5a-형식표');
  for (const [길, 맞나, 왜] of 표) {
    const r = await 받기(길);
    check(`${왜} 형식이 맞다`, r.code === 200 && 맞나.test(r.형식), `${r.code} · ${r.형식}`);
  }

  /*
   * 폴더를 슬래시 없이 부르면 반드시 붙여서 다시 보내야 한다.
   *
   * 안 그러면 index.html 은 나오는데 그 안의 `./main.js` 가 `/main.js` 로
   * 풀린다. 화면은 희고 오류는 콘솔에만 있다 — 정확히 '안에 있는 js 가
   * 누락되는' 모습이다.
   */
  trace('2.5b-슬래시없이');
  // node:http 는 되보내기를 따라가지 않는다 — fetch 의 redirect:'manual' 이 필요 없다.
  const 슬래시없이 = await 받기('/앱');
  const 간자리 = 슬래시없이.r.headers.get('location') ?? '';
  check('폴더는 슬래시를 붙여 다시 보낸다',
    슬래시없이.code === 301 && decodeURIComponent(간자리) === '/앱/',
    `${슬래시없이.code} → ${간자리}`);
  // 헤더에 한글을 그대로 실으면 Node 가 ERR_INVALID_CHAR 로 서버를 죽인다.
  // 미리보기 한 번 켰다가 deel 이 통째로 끝나는 셈이라, 인코딩됐는지를 따로 못 박는다.
  check('되보내는 자리를 ASCII 로 싣는다', /^[\x20-\x7e]*$/.test(간자리), 간자리);

  trace('2.5c-따라가기');
  const 따라간것 = await 받기('/앱/');
  check('그 다음 상대 경로가 제대로 풀린다',
    따라간것.글.includes('./main.js') && (await 받기('/앱/main.js')).code === 200);

  // 주소로 화면을 나누는 앱: 안쪽 주소에서 새로고침해도 첫 장이 나와야 한다.
  trace('2.5d-라우터주소');
  const 안쪽주소 = await 받기('/설정/상세', { headers: { accept: 'text/html' } });
  check('라우터 주소에서 새로고침해도 첫 장이 나온다',
    안쪽주소.code === 200 && 안쪽주소.글.includes('안녕'), String(안쪽주소.code));

  // 그런데 없는 스크립트에까지 HTML 을 주면 안 된다. 브라우저가
  // "Unexpected token '<'" 로 죽는데, 그게 진짜 원인(오타)을 완전히 가린다.
  trace('2.5e-없는스크립트');
  const 없는스크립트 = await 받기('/앱/오타난이름.js', { headers: { accept: '*/*' } });
  check('없는 스크립트는 그냥 404 다 (HTML 로 속이지 않는다)',
    없는스크립트.code === 404, `${없는스크립트.code} · ${없는스크립트.형식}`);
}

trace('3-새는곳');
// ── 밖이 열리는가 ───────────────────────────────────────────────────────
//
// 여기가 이 파일의 핵심이다. 하나라도 200 이 뜨면 소스·키가 통째로 열린 것이다.
{
  const 새는길 = [
    ['/../비밀.env', '한 칸 위'],
    ['/../../비밀.env', '두 칸 위'],
    ['/안쪽/../../비밀.env', '들어갔다 나오기'],
    ['/%2e%2e/비밀.env', '퍼센트 인코딩'],
    ['/%2E%2E%2F비밀.env', '슬래시까지 인코딩'],
    ['/..%2f비밀.env', '섞어 쓰기'],
    ['/....//비밀.env', '점 네 개'],
    ['/%252e%252e/비밀.env', '두 번 인코딩'],
  ];
  const 샌것 = [];
  for (const [길, 왜] of 새는길) {
    let r;
    try { r = await 받기(길); } catch { continue; }   // 요청 자체가 거절되면 그것도 막힌 것
    if (r.code === 200 && r.몸.includes('진짜키')) 샌것.push(`${왜} (${길})`);
  }
  check('띄운 폴더 밖이 안 열린다', 샌것.length === 0, 샌것.join(' · '));

  // 절대 경로를 통째로 주는 길. 윈도우에서 C:\ 로 시작하는 것이 특히 위험하다.
  const 절대 = await 받기('/' + encodeURIComponent(join(모래밭, '비밀.env')));
  check('절대 경로로도 안 열린다', !(절대.code === 200 && 절대.몸.includes('진짜키')),
    `${절대.code}`);

  // 널바이트. fs 가 여기서 경로를 잘라 읽는 일이 실제로 있다.
  const 널 = await 받기('/index.html%00.png');
  check('널바이트를 거절한다', 널.code === 400 || 널.code === 404, String(널.code));

  /*
   * ★★★ **이음줄로 나가는 길** (막판 훑기).
   *
   * 위 여덟 가지는 전부 주소에 `..` 이 든 것이다. 그런데 파일 이름에 `..` 이
   * 하나도 없어도 밖으로 나갈 수 있다 — 띄운 폴더 안에 걸린 이음줄이다.
   * `node_modules/.bin`·pnpm 저장고처럼 도구가 저절로 거는 것이 흔하고,
   * 글자로 짠 길만 보는 검사는 그 길이 떳떳이 안쪽이라 그냥 통과시킨다.
   */
  if (이음줄됨) {
    const 이음 = await 받기('/밖으로/비밀.env');
    check('★★★ 폴더 밖으로 나가는 이음줄을 안 따라간다',
      !(이음.code === 200 && 이음.몸.includes('진짜키')), `${이음.code}`);
    // (짝) 안쪽으로만 가는 이음줄은 막지 않는다 — 거짓 경고도 결함이다.
    const 안이음 = await 받기('/지름길/a.css');
    check('  (짝) 안쪽으로만 가는 이음줄은 그대로 준다',
      안이음.code === 200 && 안이음.몸.includes('color:red'), `${안이음.code}`);
  }
}

trace('4-받는길');
// ── 쓰는 길은 아예 없는가 ───────────────────────────────────────────────
{
  for (const 방법 of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await 받기('/index.html', { method: 방법, body: '덮어쓰기' });
    check(`${방법} 는 안 받는다`, r.code === 405, String(r.code));
  }
  const h = await 받기('/index.html', { method: 'HEAD' });
  check('HEAD 는 받는다 (브라우저가 먼저 물어본다)', h.code === 200, String(h.code));
}

trace('5-되살림');
// ── 파일을 고치면 알려 주는가 ───────────────────────────────────────────
//
// 이게 없으면 결국 브라우저를 손으로 새로 고치게 되고, 그러면 여기서 띄울
// 이유가 절반은 사라진다.
if (서버.되살아나나) {
  const 전 = 서버.바뀐수();
  // SSE 는 끝나지 않는 응답이라 받기() 로는 못 잰다(end 를 안 기다린다).
  // 머리만 보고 바로 끊는다.
  const { 응답: 통로, 끊기 } = await new Promise((done, 탈) => {
    const u = new URL(서버.url + '__deel__/살아있나');
    const q = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, agent: false }, (a) => {
      a.resume();   // 흘려보낸다. 안 읽으면 서버 쪽이 막힌다.
      done({ 응답: a, 끊기: () => q.destroy() });
    });
    q.on('error', 탈);
    q.end();
  });
  check('되살림 통로가 열린다',
    통로.statusCode === 200 && /event-stream/.test(통로.headers['content-type'] ?? ''),
    통로.headers['content-type'] ?? '');

  writeFileSync(join(사이트, 'index.html'), '<!doctype html><html><body><h1>바뀜</h1></body></html>', 'utf8');
  // 저장 한 번에 이벤트가 여러 개 오므로 몰아서 한 번만 알린다 — 그 시간만큼 기다린다.
  await new Promise((r) => setTimeout(r, 700));
  check('파일이 바뀌면 알린다', 서버.바뀐수() > 전, `${전} → ${서버.바뀐수()}`);
  끊기();
  await new Promise((r) => setTimeout(r, 150));

  const 새로 = await 받기('/');
  check('바뀐 내용이 바로 나온다', 새로.글.includes('바뀜'));
  check('캐시를 안 남긴다', /no-store/.test(새로.r.headers.get('cache-control') ?? ''),
    새로.r.headers.get('cache-control') ?? '');
} else {
  check('되살림', false, '이 자리에서는 파일 변화를 못 본다 (recursive watch 없음)');
}

trace('6-끄기');
// ── 끄면 진짜 꺼지는가 ──────────────────────────────────────────────────
//
// 안 꺼지면 포트를 문 채로 남는다. 다음에 띄운 것과 두 개가 떠서 어느 쪽을
// 보고 있는지 알 수 없게 된다 — 그리고 프로그램이 안 끝난다.
{
  await 서버.닫기();
  let 아직도나 = false;
  try {
    const r = await 받기('/');
    아직도나 = r.code === 200;
  } catch { 아직도나 = false; }
  check('끄면 더는 안 붙는다', !아직도나);
}

rmSync(모래밭, { recursive: true, force: true });

trace('7-사냥5-이름과-살림');
/*
 * ── ★★ (사냥5 H5-7) 남의 이름으로 불러도, 살림·비밀을 달라고 해도 줬다 ─────
 *
 * 127.0.0.1 에만 묶어 두면 밖에서는 못 붙는다. 그런데 **브라우저는 안에 있다.**
 * 사람이 연 아무 웹 페이지가 제 도메인 이름을 잠깐 127.0.0.1 로 풀리게 바꾸면
 * (DNS 리바인딩) 그 페이지의 스크립트가 `http://evil.example:포트/.deel/config.json`
 * 을 같은 출처로 읽는다. 서버는 Host 를 안 봤고, 살림도 안 가렸다 — 게이트웨이
 * 열쇠와 .env 가 200 으로 나갔다.
 */
{
  const 곳 = mkdtempSync(join(tmpdir(), 'deel-preview-h57-'));
  mkdirSync(join(곳, '.deel'), { recursive: true });
  writeFileSync(join(곳, '.deel', 'config.json'), '{"apiKey":"열쇠-미리보기로-새면-안됨"}', 'utf8');
  writeFileSync(join(곳, '.env'), 'SECRET=미리보기-비밀\n', 'utf8');
  writeFileSync(join(곳, '.env.local'), 'SECRET=미리보기-비밀둘\n', 'utf8');
  mkdirSync(join(곳, '목록'), { recursive: true });
  writeFileSync(join(곳, '목록', '.env'), 'X=목록속-비밀\n', 'utf8');
  writeFileSync(join(곳, '목록', '보임.txt'), 'ok', 'utf8');
  writeFileSync(join(곳, '목록', '숨을.key'), '목록속-개인키\n', 'utf8');
  /*
   * ★★ 7회차 — 인증서 곁의 **개인키**. deel 자신이 프로필 "인증서" 에
   * `client.pem`(증서) · `client.key`(개인키) · `client.pfx`(둘 한 덩이)를 나란히 두라고
   * 적어 둔다(backend/clientcert.js 머리말). 그런데 미리보기는 증서(.pem·.crt)만 가리고
   * **개인키는 그대로 줬다** — 둘 중 새면 안 되는 쪽은 개인키다.
   */
  writeFileSync(join(곳, 'client.pem'), '증서-비밀', 'utf8');
  writeFileSync(join(곳, 'corp.crt'), '루트-비밀', 'utf8');
  writeFileSync(join(곳, 'client.key'), '개인키-비밀', 'utf8');
  writeFileSync(join(곳, 'client.pfx'), '피에프엑스-비밀', 'utf8');
  writeFileSync(join(곳, 'client.p12'), '피12-비밀', 'utf8');
  writeFileSync(join(곳, 'index.html'), '<html><body>h57-첫장</body></html>', 'utf8');
  const s = await 띄우기({ 뿌리: 곳, scope: makeScope(곳), 되살리기: false });
  const 두드리기 = (길, host) => new Promise((done) => {
    const q = http.request({
      hostname: '127.0.0.1', port: s.port, path: encodeURI(길), method: 'GET', agent: false,
      headers: host ? { host } : {},
    }, (r) => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (b += c));
      r.on('end', () => done({ code: r.statusCode, 글: b }));
    });
    q.on('error', (err) => done({ code: 0, 글: String(err?.message ?? err) }));
    q.end();
  });
  try {
    const 남의이름 = await 두드리기('/', `evil.example:${s.port}`);
    check('★★ (사냥5 H5-7) 127.0.0.1·localhost 가 아닌 이름으로 부르면 안 준다',
      남의이름.code === 403 && !남의이름.글.includes('h57-첫장'), `${남의이름.code} ${남의이름.글.slice(0, 40)}`);
    const 딴포트 = s.port === 65535 ? 1 : s.port + 1;
    const 포트틀림 = await 두드리기('/', `127.0.0.1:${딴포트}`);
    check('★ (사냥5 H5-7) 포트가 다른 이름으로 불러도 안 준다', 포트틀림.code === 403, String(포트틀림.code));
    for (const 이름 of [`127.0.0.1:${s.port}`, `localhost:${s.port}`, `LOCALHOST:${s.port}`, `[::1]:${s.port}`]) {
      const r = await 두드리기('/', 이름);
      check(`(사냥5 H5-7) ${이름.replace(/:\d+$/, '')} 로 부르면 준다`, r.code === 200 && r.글.includes('h57-첫장'), String(r.code));
    }
    const 설정 = await 두드리기('/.deel/config.json');
    check('★★ (사냥5 H5-7) 살림 설정 파일(열쇠)을 안 준다',
      설정.code === 403 && !설정.글.includes('열쇠-미리보기로'), `${설정.code} ${설정.글.slice(0, 40)}`);
    const 살림목록 = await 두드리기('/.deel/');
    check('★★ (사냥5 H5-7) 살림 폴더 목록을 안 보여 준다', 살림목록.code === 403, `${살림목록.code} ${살림목록.글.slice(0, 40)}`);
    const 비밀 = await 두드리기('/.env');
    check('★★ (사냥5 H5-7) .env 를 안 준다', 비밀.code === 403 && !비밀.글.includes('미리보기-비밀'), `${비밀.code}`);
    const 비밀둘 = await 두드리기('/.env.local');
    check('★ (사냥5 H5-7) .env.local 도 안 준다', 비밀둘.code === 403 && !비밀둘.글.includes('미리보기-비밀둘'), `${비밀둘.code}`);
    for (const [이름, 비밀글] of [['client.pem', '증서-비밀'], ['corp.crt', '루트-비밀'],
      ['client.key', '개인키-비밀'], ['client.pfx', '피에프엑스-비밀'], ['client.p12', '피12-비밀']]) {
      const r = await 두드리기(`/${이름}`);
      check(`★★ (7회차) 인증서·개인키를 안 준다 — ${이름}`,
        r.code === 403 && !r.글.includes(비밀글), `${r.code} ${r.글.slice(0, 40)}`);
    }
    // 목록에서도 빼는가. `/` 는 index.html 이 있어 목록이 아니므로 `/목록/` 으로 잰다.
    const 열쇠목록 = await 두드리기('/목록/');
    check('★ (7회차) 폴더 목록에 개인키 이름을 안 올린다',
      열쇠목록.code === 200 && 열쇠목록.글.includes('보임.txt') && !열쇠목록.글.includes('숨을.key'),
      `${열쇠목록.code} ${열쇠목록.글.slice(-160)}`);

    if (process.platform === 'win32') {
      /*
       * 6회차 — 윈도 NTFS 는 `이름::$DATA` · `폴더::$INDEX_ALLOCATION` 이 그 파일·폴더 자체다. 이름 견주기가
       * 글자 그대로라 `/.env::$DATA` 가 200 으로 .env 를 줬다(재현-미리보기6.mjs). `.deel` 쪽은 내부살림이 벗겨 봐서 막혔다.
       */
      mkdirSync(join(곳, '.git'), { recursive: true });
      writeFileSync(join(곳, '.git', 'config'), '[core] 깃-비밀\n', 'utf8');
      writeFileSync(join(곳, '인증.pem'), '피이엠-비밀', 'utf8');
      for (const [길, 비밀글] of [['/.env::$DATA', '미리보기-비밀'], ['/.env.local::$DATA', '미리보기-비밀둘'],
        ['/.git::$INDEX_ALLOCATION/config', '깃-비밀'], ['/인증.pem::$DATA', '피이엠-비밀'], ['/.env:$DATA', '미리보기-비밀']]) {
        const r = await 두드리기(길);
        check(`★★ (6회차) NTFS 스트림 꼴로도 안 준다 — ${길}`, r.code !== 200 && !r.글.includes(비밀글), `${r.code} ${r.글.slice(0, 40)}`);
      }
    }
    const 목록 = await 두드리기('/목록/');
    check('★ (사냥5 H5-7) 폴더 목록에 .env 를 안 올린다',
      목록.code === 200 && 목록.글.includes('보임.txt') && !목록.글.includes('.env'), `${목록.code} ${목록.글.slice(-160)}`);
  } finally {
    await s.닫기();
    rmSync(곳, { recursive: true, force: true });
  }
}

trace('7b-살림은-안쪽-길로-본다');
/*
 * ── ★★★ 살림인지는 **띄운 폴더 안쪽 길**로 본다 (막판 훑기) ──────────────
 *
 * 위 절이 붙은 뒤로 `안줄것인가` 가 **절대경로**를 살림 판정자에게 넘겼다.
 * 그래서 띄운 폴더가 하필 `.claude/` 나 `.cursor/` **아래**에 있으면 — 거기에
 * 만든 것을 두는 사람이 실제로 있다 — 그 폴더의 **모든 파일**이 403 이었다.
 * 재 보니 `index.html` 도 `a.css` 도 「살림이나 비밀 파일이라 안 줍니다」 였다.
 * 제가 만든 제 사이트인데. 거짓 경고도 결함이다.
 *
 * 그렇다고 안쪽 길만 보면 `.deel` 을 **통째로** 띄운 사람이 `config.json` 을
 * 그대로 내준다. 그래서 두 방향을 같이 잰다 — 살림 **아래**는 주고, 살림
 * **자체**는 안 준다.
 */
{
  const 밭 = mkdtempSync(join(tmpdir(), 'deel-preview-살림-'));
  // ① `.claude` 아래의 내 사이트
  const 사이트 = join(밭, '.claude', '내사이트');
  mkdirSync(사이트, { recursive: true });
  writeFileSync(join(사이트, 'index.html'), '<h1>내 사이트</h1>', 'utf8');
  // ② `.claude` 자체
  writeFileSync(join(밭, '.claude', 'history.jsonl'), '{"몰래":1}\n', 'utf8');
  // ③ `.deel` 자체
  mkdirSync(join(밭, '.deel'), { recursive: true });
  writeFileSync(join(밭, '.deel', 'config.json'), '{"apiKey":"살림째-띄워도-새면-안됨"}', 'utf8');

  const 한번 = async (뿌리, 길) => {
    const srv = await 띄우기({ 뿌리, scope: makeScope(밭), 되살리기: false });
    try {
      return await new Promise((풀기) => {
        http.get({ host: '127.0.0.1', port: srv.port, path: 길, agent: false }, (a) => {
          const 조각 = [];
          a.on('data', (d) => 조각.push(d));
          a.on('end', () => 풀기({ code: a.statusCode, 몸: Buffer.concat(조각).toString('utf8') }));
        }).on('error', () => 풀기({ code: -1, 몸: '' }));
      });
    } finally { await srv.닫기(); }
  };

  try {
    const 내것 = await 한번(사이트, '/index.html');
    check('★★★ `.claude` 아래에 둔 내 사이트를 살림이라며 막지 않는다',
      내것.code === 200 && 내것.몸.includes('내 사이트'), `${내것.code} ${내것.몸.slice(0, 60)}`);

    const 남의것 = await 한번(join(밭, '.claude'), '/history.jsonl');
    check('★★★ 그래도 `.claude` 를 통째로 띄우면 안 준다',
      남의것.code !== 200 && !남의것.몸.includes('몰래'), `${남의것.code}`);

    const 살림째 = await 한번(join(밭, '.deel'), '/config.json');
    check('★★★ `.deel` 을 통째로 띄워도 열쇠는 안 나간다',
      살림째.code !== 200 && !살림째.몸.includes('살림째-띄워도-새면-안됨'), `${살림째.code}`);
  } finally {
    rmSync(밭, { recursive: true, force: true });
  }
}

trace('미리보기6');
/*
 * 2.0.0 6회차 · Gemini 미리보기6 — 날 소켓으로 재 본 셋.
 *
 *   `c#` 폴더로 넘길 때 `location: /c#/` — 브라우저는 `#` 뒤를 조각으로 읽어 엉뚱한 곳으로 간다.
 *   되살리기가 켜진 채 EUC-KR HTML 을 utf8 로 읽어 **글이 � 로 깨져서** 나갔다.
 *   다른 프로그램이 잠근 파일(윈도 EBUSY)을 부르면 읽기 흐름의 오류를 아무도 안 받아 **프로세스가 죽었다.**
 */
{
  const { encode } = await import('../src/tools/encoding.js');
  const 곳 = mkdtempSync(join(tmpdir(), 'deel-preview6-'));
  mkdirSync(join(곳, 'c#'));
  writeFileSync(join(곳, 'c#', 'index.html'), '<p>c</p>');
  const 옛본문 = encode('한글 문서', 'euc-kr').buf;
  writeFileSync(join(곳, 'euc.html'), Buffer.concat([Buffer.from('<meta charset="euc-kr"><body><p>'), 옛본문, Buffer.from('</p></body>')]));
  writeFileSync(join(곳, 'big.bin'), Buffer.alloc(64 * 1024, 1));
  const s6 = await 띄우기({ 뿌리: 곳, scope: makeScope(곳) });
  const 날받기 = (경로) => new Promise((풀기) => {
    const q = http.get({ host: '127.0.0.1', port: s6.port, path: 경로, agent: false }, (a) => {
      const 조각 = [];
      a.on('data', (d) => 조각.push(d));
      a.on('end', () => 풀기({ code: a.statusCode, 머리: a.headers, 몸: Buffer.concat(조각) }));
      a.on('error', () => 풀기({ code: -1, 머리: {}, 몸: Buffer.concat(조각) }));
      // 서버가 답을 끝내지 못한 채 끊기면 end 도 error 도 안 오고 close 만 온다 — 여기서 멎으면 안 된다.
      a.on('close', () => 풀기({ code: a.complete ? a.statusCode : -1, 머리: a.headers, 몸: Buffer.concat(조각) }));
    });
    q.on('error', () => 풀기({ code: -1, 머리: {}, 몸: Buffer.alloc(0) }));
    q.setTimeout(5000, () => q.destroy());
  });
  try {
    trace('미리보기6-넘김');
    const 넘김 = await 날받기('/c%23');
    check('★ # 든 폴더로 넘길 때 # 를 %23 으로 싣는다', 넘김.code === 301 && 넘김.머리.location === '/c%23/',
      `${넘김.code} ${넘김.머리.location}`);

    const 옛 = await 날받기('/euc.html');
    check('★ EUC-KR HTML 에 조각을 끼워도 원래 바이트 그대로 준다',
      옛.code === 200 && 옛.몸.includes(옛본문) && 옛.몸.includes(Buffer.from('EventSource')), `${옛.code} 원래바이트=${옛.몸.includes(옛본문)}`);
    const 조각자리 = 옛.몸.indexOf(Buffer.from('<script>'));
    check('★ 끼운 조각은 ASCII 뿐이다 — 어떤 인코딩 페이지에서도 안 깨진다',
      조각자리 >= 0 && ![...옛.몸.subarray(조각자리)].some((b) => b > 0x7f), String(조각자리));
    /*
     * ★★★ 바이트를 그대로 준 것을 **머리글 한 줄이 도로 무르고 있었다** (막판 훑기).
     *
     * HTTP 의 charset 은 문서 안의 `<meta charset>` 을 이긴다. 바이트를 안 건드려
     * 놓고 머리에 utf-8 이라 적으면 브라우저는 그 EUC-KR 바이트를 utf-8 로 읽어
     * 화면에는 결국 � 가 뜬다 — 위 두 검사는 통과하면서 사람 눈에는 여전히 깨진다.
     */
    check('★★★ EUC-KR 파일에 utf-8 이라고 적어 보내지 않는다',
      /charset=euc-kr/i.test(String(옛.머리['content-type'] ?? '')), String(옛.머리['content-type']));
    // (짝) 멀쩡한 utf-8 파일까지 딴 이름으로 바꾸면 그게 더 큰 고장이다.
    writeFileSync(join(곳, 'utf.html'), '<body><p>한글 문서</p></body>', 'utf8');
    const 새 = await 날받기('/utf.html');
    check('  (짝) utf-8 파일은 여태처럼 utf-8 이다',
      /charset=utf-8/i.test(String(새.머리['content-type'] ?? '')), String(새.머리['content-type']));
    // (짝) charset 이 없는 갈래는 손대지 않는다.
    writeFileSync(join(곳, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const 그림 = await 날받기('/a.png');
    check('  (짝) 그림에는 charset 을 안 붙인다',
      String(그림.머리['content-type']) === 'image/png', String(그림.머리['content-type']));

    if (process.platform === 'win32') {
      const { spawn } = await import('node:child_process');
      const { openSync, closeSync } = await import('node:fs');
      const 죽음 = [];
      const 손 = (e) => 죽음.push(String(e?.code ?? e));
      process.on('uncaughtException', 손);
      const 큰것 = join(곳, 'big.bin');
      const 잠금 = spawn('powershell', ['-NoProfile', '-Command',
        `$f=[IO.File]::Open('${큰것}','Open','Read','None'); Start-Sleep 5; $f.Close()`], { stdio: 'ignore', windowsHide: true });
      // 끝나는 것을 **띄우자마자** 기다려 둔다 — 아래가 5초를 넘기면 exit 가 먼저 지나가 영영 안 온다.
      const 잠금끝 = new Promise((r) => 잠금.on('exit', r));
      let 잠김 = false;
      for (let i = 0; i < 60 && !잠김; i++) {
        try { closeSync(openSync(큰것, 'r')); await new Promise((r) => setTimeout(r, 100)); } catch { 잠김 = true; }
      }
      const 잠긴 = await 날받기('/big.bin');
      await new Promise((r) => setTimeout(r, 300));
      process.removeListener('uncaughtException', 손);
      check('먼저: 파일이 실제로 잠겼다', 잠김);
      check('★ (윈도우) 다른 프로그램이 잠근 파일을 불러도 프로세스가 안 죽는다', 죽음.length === 0, 죽음.join(' '));
      check('그 요청은 성한 파일인 척 끝나지 않는다', 잠긴.code !== 200 || 잠긴.몸.length < 64 * 1024, `${잠긴.code} ${잠긴.몸.length}`);
      await 잠금끝;
    }
  } finally {
    await s6.닫기();
    rmSync(곳, { recursive: true, force: true });
  }
}

/*
 * ── 9회차 (2차 눈 · 미리보기b) ────────────────────────────────────────
 *
 * 세 가지를 한꺼번에 잰다. 셋 다 「막아야 할 것을 막는가」 가 아니라
 * **「막으면 안 되는 것을 막는가 · 지켜야 할 규격을 지키는가」** 쪽이다.
 * 거짓 경고도 결함이다.
 */
{
  const 곳 = mkdtempSync(join(tmpdir(), 'deel-미리9-'));
  const s9 = await 띄우기({ 뿌리: 곳, scope: makeScope(곳) });
  const 받9 = (길, o = {}) => new Promise((done, 탈) => {
    const u = new URL(s9.url.replace(/\/$/, '') + 길);
    const q = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: o.method ?? 'GET',
      headers: o.headers ?? {},
      agent: false,
    }, (a) => {
      let 몸 = '';
      a.setEncoding('utf8');
      a.on('data', (b) => { 몸 += b; });
      a.on('end', () => done({ code: a.statusCode, 몸, 머리: a.headers }));
    });
    q.on('error', 탈);
    // 안 끝나는 것도 **답**이다. 여기서 던지면 검사가 통째로 죽어서
    // 무엇이 안 끝났는지가 화면에 한 줄도 안 남는다.
    q.setTimeout(2500, () => { q.destroy(); done({ code: 0, 몸: '(안 끝남)', 머리: {} }); });
    q.end();
  });
  try {
    /*
     * ── 1. 이름이 「..」 로 시작하는 **진짜 파일** 을 밖으로 치지 않는가
     *
     * `..config.json` 은 윈도·리눅스 둘 다에서 만들 수 있는 이름이다.
     * 글자로 `startsWith('..')` 를 보면 그 파일이 「띄운 폴더 밖」 이 된다.
     * 그리고 뒤따르는 `split(sep)[0] === '..'` 는 앞 조건에 통째로 먹혀
     * **어떤 입력에도 혼자 걸리지 않는다** — 안 걸리는 규칙이다.
     */
    writeFileSync(join(곳, '..config.json'), '{"진짜":"파일"}', 'utf8');
    const 점둘 = await 받9('/..config.json');
    check('★★★ 이름이 「..」 로 시작하는 진짜 파일을 「폴더 밖」 이라고 막지 않는다',
      점둘.code === 200 && 점둘.몸.includes('진짜'), `${점둘.code} ${점둘.몸.slice(0, 40)}`);

    const 진짜밖 = await 받9('/../밖.txt');
    check('  진짜 윗폴더는 여전히 못 나간다', 진짜밖.code !== 200, String(진짜밖.code));

    /*
     * ── 2. 되살림 통로에 HEAD 로 두드리면 몸을 흘리지 않는가
     *
     * HEAD 는 몸이 없어야 한다(RFC 9110). 지금은 `: 붙었습니다` 를 쓰고
     * 연결을 **안 닫은 채** 듣는이 목록에 넣는다 — 그 뒤 파일이 바뀔 때마다
     * 몸을 계속 흘린다. 브라우저가 아니라 프록시·검사기가 두드리면 그 연결이
     * 영영 안 닫혀 서버 닫기가 늦어진다.
     */
    const 머리만 = await 받9('/__deel__/살아있나', { method: 'HEAD' });
    check('★★★ 되살림 통로에 HEAD 로 부르면 몸이 없고 연결이 끝난다',
      머리만.몸 === '', JSON.stringify(머리만.몸.slice(0, 40)));

    /*
     * ── 3. 문법이 틀린 Range 는 무시하고 200 을 준다
     *
     * `bytes=-` 는 시작도 끝도 없는 **문법 오류**다. RFC 9110 은 「못 알아들을
     * Range 헤더는 없는 것처럼 보라」 고 한다. 지금은 정규식에 걸려 처음=0 ·
     * 끝=마지막 으로 채워져 **파일 전체를 206 으로** 준다 — 받는 쪽은 자기가
     * 요청한 조각을 받았다고 믿는다.
     */
    writeFileSync(join(곳, '영상.mp4'), Buffer.alloc(2048, 7));
    const 빈범위 = await 받9('/영상.mp4', { headers: { range: 'bytes=-' } });
    check('★★★ 문법이 틀린 Range(bytes=-) 는 없는 것처럼 보고 200 을 준다',
      빈범위.code === 200, `${빈범위.code} ${빈범위.머리['content-range'] ?? ''}`);
    const 성한범위 = await 받9('/영상.mp4', { headers: { range: 'bytes=0-9' } });
    check('  성한 Range 는 그대로 206', 성한범위.code === 206, String(성한범위.code));
    const 뒤범위 = await 받9('/영상.mp4', { headers: { range: 'bytes=-100' } });
    check('  뒤에서 100바이트도 그대로 206', 뒤범위.code === 206, String(뒤범위.code));
  } finally {
    await s9.닫기();
    rmSync(곳, { recursive: true, force: true });
  }
}

const G ='\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n미리보기 검사  ${D}(띄운 폴더 밖이 새지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
