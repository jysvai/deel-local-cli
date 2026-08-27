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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  check('고치면 새로 뜨게 하는 조각을 끼운다', 첫장.글.includes('__deel__/살아있나'));
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
    if (r.code === 200 && r.글.includes('진짜키')) 샌것.push(`${왜} (${길})`);
  }
  check('띄운 폴더 밖이 안 열린다', 샌것.length === 0, 샌것.join(' · '));

  // 절대 경로를 통째로 주는 길. 윈도우에서 C:\ 로 시작하는 것이 특히 위험하다.
  const 절대 = await 받기('/' + encodeURIComponent(join(모래밭, '비밀.env')));
  check('절대 경로로도 안 열린다', !(절대.code === 200 && 절대.글.includes('진짜키')),
    `${절대.code}`);

  // 널바이트. fs 가 여기서 경로를 잘라 읽는 일이 실제로 있다.
  const 널 = await 받기('/index.html%00.png');
  check('널바이트를 거절한다', 널.code === 400 || 널.code === 404, String(널.code));
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

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n미리보기 검사  ${D}(띄운 폴더 밖이 새지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
