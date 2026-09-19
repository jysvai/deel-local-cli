/**
 * 만든 웹을 그 자리에서 띄워 본다.
 *
 * ── 왜 만드나 ───────────────────────────────────────────────────────────
 *
 * 웹을 하나 만들어 놓고 눈으로 보려면 여태 이랬다 —
 *   · 파일을 두 번 눌러 연다 → file:// 라 fetch·모듈·WebGL 텍스처가 막힌다
 *   · GitHub Pages 에 올린다 → 한 글자 고칠 때마다 커밋·푸시·기다림
 *   · 아무 정적 서버나 깐다 → 미승인 SW 반입 금지에 걸린다
 *
 * Node 에 http 가 들어 있으므로 셋 다 필요 없다. 의존성은 그대로 0개다.
 *
 * ── 무엇을 조심했나 ─────────────────────────────────────────────────────
 *
 * 서버를 띄운다는 것은 **내 디스크를 남에게 열어 주는 일**이다. 그래서
 *
 *   1. 127.0.0.1 에만 묶는다. 0.0.0.0 은 아예 못 쓰게 해 뒀다 —
 *      같은 사무실 망에서 아무나 내 소스를 읽게 된다.
 *   2. 포트는 0(커널이 빈 것을 준다). 고정 포트는 남이 쓰던 것을 뺏는다.
 *   3. 경로는 guard 의 scope 로 풀고, **띄운 폴더 밖인지는 여기서 한 번 더 본다.**
 *      scope 는 작업 범위(프로젝트 전체)까지 열어 주므로 그것만으로는 모자란다 —
 *      하위 폴더 하나만 띄웠을 때 `/../다른폴더/비밀.env` 가 그대로 나간다.
 *      두 벌이라 한쪽만 고쳐질 걱정은 남지만, 없으면 진짜로 샌다 — 그 자리
 *      인라인 주석(`밖인지는 길 조각으로 본다`)이 어떻게 재는지 적어 뒀다.
 *   4. 파일을 **주기만** 한다. PUT·POST·DELETE 는 받지 않는다.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, readdirSync, watch, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, extname, relative, sep, isAbsolute, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { 내부살림 } from '../tools/fsutil.js';
import { detect } from '../tools/encoding.js';

// 확장자 → 형식. 없는 것은 그냥 내려받게 둔다.
// glb·gltf·wasm 을 넣어 뒀다 — 형식이 틀리면 Three.js 가 조용히 아무것도 안 그린다.
const 형식 = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.pdf': 'application/pdf',
};

// 고친 것이 바로 보이게 하는 조각. HTML 에만 끼워 넣는다.
//
// 파일을 고치면 화면이 저절로 새로 뜬다. 이게 없으면 결국 브라우저를 손으로
// 새로 고치게 되고, 그러면 굳이 여기서 띄울 이유가 절반은 사라진다.
//
// 조각에는 **ASCII 만** 싣는다 (2.0.0 6회차 미리보기6). 브라우저는 끼운 조각도 그 페이지의
// 인코딩으로 읽는다 — EUC-KR·Shift_JIS 페이지에 한글 주석과 한글 통로 이름을 끼웠더니 통로
// 주소부터 깨졌다. 그래서 통로 이름은 퍼센트로 싣고, 알리는 말은 영어 낱말로 하고, 사람이 읽을
// 풀이는 조각 바깥(여기)에 둔다. 서버가 꺼지면 EventSource 는 계속 다시 붙으려 하는데 조용히
// 놔둔다 — deel 을 다시 띄우면 그대로 이어 붙어서 화면을 새로 고치지 않아도 된다.
const 되살림통로 = '__deel__/살아있나';
const 되살림 = `
<script>/* deel preview: reload on change */
(function(){try{
  var s=new EventSource('/${되살림통로.split('/').map(encodeURIComponent).join('/')}');
  s.onmessage=function(e){ if(e.data==='reload')location.reload(); };
}catch(err){}})();
</script>`;

const 안전한경로 = (u) => {
  // %00 이나 널바이트가 섞이면 아래 fs 가 경로를 잘라 읽는다. 통째로 거절한다.
  // `\` 도 거절한다 — 앞의 `/` 는 지우지만 `\evil.com` 처럼 역슬래시로 시작하면
  // 남아 있다가, 밑에서 `/${길}/` 로 리다이렉트 주소를 만들 때 일부 브라우저가
  // `\` 를 `/` 로 봐서 `//evil.com/` 처럼 다른 도메인으로 새는 통로가 된다.
  let p;
  try { p = decodeURIComponent(String(u).split('?')[0].split('#')[0]); } catch { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  return p.replace(/^\/+/, '');
};

/*
 * ── 우리 이름으로 부른 것만 받는다 (사냥5 H5-7) ─────────────────────────────
 *
 * 127.0.0.1 에 묶는 것으로는 **브라우저**를 못 막는다. 사람이 연 아무 웹 페이지가
 * 제 도메인을 잠깐 127.0.0.1 로 풀리게 바꾸면(DNS 리바인딩) 그 페이지 스크립트가
 * `http://evil.example:포트/…` 를 **같은 출처**로 읽는다. 연결은 127.0.0.1 로 오니
 * 묶은 주소로는 못 가르고, 가르는 자리는 Host 머리글 하나다. 실제로 재 보니 Host 를
 * evil.example 로 줘도 200 이었다. 브라우저가 우리를 부르는 이름은 셋뿐이고 포트까지
 * 붙는다(기본 포트가 아니므로). 그 밖이면 안 준다.
 */
function 우리이름인가(host, port) {
  const 이름 = String(host ?? '').trim().toLowerCase();
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(이름);
}

/*
 * ── 살림·비밀 파일은 안 준다 (사냥5 H5-7) ───────────────────────────────────
 *
 * 경로가 띄운 폴더 안이면 무엇이든 줬다. 프로젝트 폴더를 그대로 띄우는 일이 흔한데,
 * 거기에는 `.deel/config.json`(게이트웨이 열쇠)과 `.env` 가 같이 산다 — 위 리바인딩
 * 한 번이면 둘 다 나간다. 도구가 읽으면 안 되는 살림은 도구 울타리와 **같은 자**
 * (tools/fsutil.js 의 내부살림)로 가른다. 자를 여기 또 적으면 한쪽만 고쳐진다.
 * 그 자가 안 보는 비밀은 Vite 개발 서버가 기본으로 거부하는 목록을 따른다 —
 * `.env`·`.env.*`·`*.pem`·`*.crt`·`.git/` — 미리보기가 그걸 줘야 할 까닭이 없다.
 *
 * 거기에 **개인키**를 보탠다 (2.0.0 7회차). Vite 목록에는 증서(`.pem`·`.crt`)만 있는데,
 * deel 자신이 프로필 `"인증서"` 에 `client.pem`(증서) 곁에 `client.key`(개인키)와
 * `client.pfx`·`client.p12`(둘 한 덩이)를 두라고 적어 둔다(backend/clientcert.js 머리말).
 * 그래서 이 프로그램을 쓰는 사람의 폴더에는 그 파일들이 실제로 있다 — 그런데 증서는
 * 가리고 **새면 안 되는 쪽인 개인키는 그대로 줬다.** 재 보니 `/client.key` 가 200 으로
 * 내용까지 나갔다. 둘을 갈라 막을 까닭이 없다.
 *
 * `.cer` 도 같이 막는다 — 윈도우 「인증서 내보내기」 가 기본으로 내놓는 이름이고 알맹이는
 * `.crt` 와 같은 것이다. 미리보기가 못 보여 줘서 아쉬울 파일이 아니다. 잘못 막았을 때 드는
 * 값(파일 하나가 안 보인다)이 잘못 줬을 때 드는 값(개인키가 나간다)보다 훨씬 싸다.
 */
function 안줄것인가(abs, 뿌리) {
  /*
   * 살림인지는 **띄운 폴더 이름 + 그 안쪽 길**로 본다 (막판 훑기).
   *
   * 여태 절대경로를 그대로 넘겼다. 그러면 띄운 폴더가 하필 `.claude/` 나
   * `.cursor/` **아래**에 있을 때 — 거기에 만든 것을 두는 사람이 실제로 있다 —
   * 그 폴더의 **모든 파일**이 403 이 된다. 재 보니 `index.html` 도 `a.css` 도
   * 전부 「살림이나 비밀 파일이라 안 줍니다」 였다. 제가 만든 제 사이트인데.
   * 거짓 경고도 결함이다.
   *
   * 그렇다고 안쪽 길만 보면 `.deel` 을 **통째로** 띄운 사람이 `config.json` 을
   * 그대로 내주게 된다 — 그때는 안쪽 길이 그냥 `config.json` 이라 아무 데도 안
   * 걸린다. 그래서 뿌리의 **제 이름 한 칸**을 앞에 붙여서 본다.
   *
   *   띄운 곳 `…/.claude/내사이트` · `index.html` → `내사이트/index.html`   준다
   *   띄운 곳 `…/.claude`          · `history.jsonl` → `.claude/history.jsonl` 안 준다
   *   띄운 곳 `…/.deel`            · `config.json`   → `.deel/config.json`     안 준다
   *   띄운 곳 프로젝트             · `.deel/config.json` → `myproj/.deel/…`    안 준다
   *
   * 띄운 폴더 **밖**은 위 담장(안쪽 검사 · 이음줄 검사)이 이미 막으므로,
   * 여기서 위쪽 조각을 안 봐도 새지 않는다.
   */
  const 안쪽길 = relative(뿌리, abs);
  const 볼길 = [basename(뿌리), ...(안쪽길 ? [안쪽길] : [])].join(sep);
  if (내부살림(볼길)) return true;
  const 조각 = 안쪽길.split(sep).map((x) => x.toLowerCase());
  /*
   * 윈도 NTFS 는 조각 끝의 `:스트림`(`.env::$DATA` · `.git::$INDEX_ALLOCATION`)과 끝 점·빈칸이 **같은
   * 파일·폴더**를 연다. 아래 이름 견주기는 글자 그대로라, 재 보니 `/.env::$DATA` · `/x.pem::$DATA` ·
   * `/.git::$INDEX_ALLOCATION/config` 가 200 으로 나갔다 (2.0.0 6회차 · `재현-미리보기6.mjs`). `.deel` 은
   * 내부살림 이 꼬리를 벗겨 봐서 막혔다. 윈도 파일 이름에는 `:` 가 못 들어가므로 그런 조각은 통째로 안 준다.
   */
  if (process.platform === 'win32' && 조각.some((x) => x.includes(':') || /[. ]$/.test(x))) return true;
  if (조각.some((x) => x === '.git' || x === '.env' || x.startsWith('.env.'))) return true;
  return /\.(pem|crt|cer|key|pfx|p12)$/.test(조각[조각.length - 1] ?? '');
}

/** 이용자 파일 이름을 HTML 안에 그대로 꽂기 전에 씌운다 — 파일 이름에
 * `<script>` 가 들어 있어도 태그로 안 읽히게. */
const html씌우기 = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/**
 * 폴더 하나를 띄운다.
 *
 * @param {object} o
 * @param {string} o.뿌리   띄울 폴더 (이미 scope 로 푼 절대 경로여야 한다)
 * @param {object} o.scope  guard 의 makeScope 결과. 경로는 전부 이걸로 푼다.
 * @param {boolean} [o.되살리기=true] 파일이 바뀌면 새로 뜨게 할지
 * @returns {Promise<{url:string, port:number, 닫기:Function, 바뀐수:Function}>}
 */
export function 띄우기({ 뿌리, scope, 되살리기 = true }) {
  const 듣는이들 = new Set();   // 살아 있는 EventSource 응답들
  /*
   * 뿌리의 **진짜** 자리. 이음줄을 따라간 뒤 견주려면 양쪽이 다 진짜여야 한다.
   *
   * 맥의 `/tmp` 는 `/private/tmp` 로 가는 이음줄이고, 윈도의 `C:\Users\나\문서` 도
   * 원드라이브를 켜면 이음줄이 된다. 한쪽만 따라가면 제자리에 있는 파일이 전부
   * 「폴더 밖」 이 되어 403 을 받는다 — 거짓 경고도 결함이다.
   */
  let 뿌리진짜 = 뿌리;
  try { 뿌리진짜 = realpathSync.native(뿌리); } catch { /* 못 바꾸면 준 대로 */ }
  let 바뀐수 = 0;
  let 감시 = null;
  let 늦추기 = null;

  const 알리기 = () => {
    바뀐수 += 1;
    for (const res of 듣는이들) {
      try { res.write('data: reload\n\n'); } catch { 듣는이들.delete(res); }
    }
  };

  const srv = createServer((req, res) => {
    // 우리 이름으로 부른 것만 받는다 — 되살림 통로도 이 뒤다 (위 우리이름인가 머리말).
    if (!우리이름인가(req.headers.host, srv.address()?.port)) {
      res.writeHead(403);
      return res.end('이 이름으로는 안 받습니다 — 127.0.0.1 이나 localhost 로 여세요');
    }
    // 주기만 한다. 받는 길은 아예 열지 않는다.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return res.end('GET 만 받습니다');
    }

    const 길 = 안전한경로(req.url);
    if (길 === null) { res.writeHead(400); return res.end('주소가 이상합니다'); }

    // 되살림 통로. 열어 두고 파일이 바뀔 때마다 한 줄씩 흘린다.
    if (길 === 되살림통로) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      /*
       * HEAD 는 머리만 주고 끝낸다 (9회차 · 2차 눈).
       *
       * 여태 HEAD 도 이 아래로 흘러 몸을 쓰고 **연결을 안 닫은 채** 듣는이
       * 목록에 들어갔다. HEAD 에 몸을 주는 것은 규격 위반이고(RFC 9110),
       * 그 연결은 브라우저가 아니라 프록시·검사기가 두드린 것이라 영영 안
       * 닫힌다 — 재 보니 **응답이 끝나지 않았다.** 그 뒤 파일이 바뀔 때마다
       * 아무도 안 보는 곳으로 `data: reload` 를 계속 흘린다.
       */
      if (req.method === 'HEAD') return res.end();
      res.write(': 붙었습니다\n\n');
      듣는이들.add(res);
      req.on('close', () => 듣는이들.delete(res));
      return undefined;
    }

    let abs;
    try {
      abs = scope.resolve(길 ? join(뿌리, 길) : 뿌리);
      // scope 는 작업 범위까지만 본다. 띄운 폴더 밖도 막아야 한다 —
      // 아니면 /../다른폴더/비밀.env 로 프로젝트 전체가 열린다.
      /*
       * 밖인지는 **길 조각**으로 본다. 글자로 보면 안 된다 (9회차 · 2차 눈).
       *
       * `..config.json` 은 윈도·리눅스 둘 다에서 만들 수 있는 이름이다.
       * `startsWith('..')` 로 보면 그 진짜 파일이 「띄운 폴더 밖」 이 되어
       * 403 을 받는다 — 거짓 경고도 결함이다. 그리고 뒤에 있던
       * `split(sep)[0] === '..'` 는 앞 조건에 통째로 먹혀 **어떤 입력에도
       * 혼자 걸리지 않았다.** 안 걸리는 규칙은 없느니만 못하다.
       *
       * `isAbsolute` 도 같이 본다. 윈도에서 relative 는 드라이브가 다르면
       * `..` 이 아니라 `D:\…` 를 그대로 돌려준다 — 그것은 `..` 검사에 안 걸린다.
       */
      const 안쪽 = relative(뿌리, abs);
      if (isAbsolute(안쪽) || 안쪽.split(sep)[0] === '..') {
        res.writeHead(403); return res.end('띄운 폴더 밖입니다');
      }
      /*
       * 이음줄은 **따라간 뒤에** 한 번 더 본다 (막판 훑기).
       *
       * 위 검사는 글자로 짠 길만 본다. `공개/키 → C:\Users\나\.ssh` 같은 이음줄은
       * 글자로는 `공개/키` 라 떳떳이 안쪽이고, 그대로 열어 준다. 만든 사람이
       * 일부러 건 것도 있지만 `node_modules/.bin`·pnpm 저장고처럼 도구가 저절로
       * 거는 것이 훨씬 많다 — 폴더 하나 띄웠다고 홈 전체가 열리면 안 된다.
       *
       * 없는 파일은 여기서 안 막는다. realpath 가 던지면 아래 existsSync 가
       * 404 로 맡는다 — 있는 것에 403, 없는 것에 404 를 주면 있는지가 샌다.
       */
      try {
        const 진짜 = realpathSync.native(abs);
        if (진짜 !== abs) {
          const 진짜안쪽 = relative(뿌리진짜, 진짜);
          if (isAbsolute(진짜안쪽) || 진짜안쪽.split(sep)[0] === '..') {
            res.writeHead(403); return res.end('띄운 폴더 밖으로 가는 이음줄입니다');
          }
        }
      } catch { /* 없는 것은 아래에서 404 */ }
    } catch {
      res.writeHead(403);
      return res.end('작업 범위 밖입니다');
    }
    // 있는지 보기 **전에** 가른다 — 없는 .env 에 404, 있는 .env 에 403 이면 있는지가 샌다.
    if (안줄것인가(abs, 뿌리)) {
      res.writeHead(403);
      return res.end('살림이나 비밀 파일이라 안 줍니다');
    }

    if (!existsSync(abs)) {
      /*
       * 주소로 화면을 나누는 앱(React Router·Vue Router 같은 것)을 위한 길.
       *
       * `/설정` 같은 주소는 디스크에 파일이 없다. 첫 화면에서 눌러 들어가면
       * 되는데 **거기서 새로고침을 하면 404** 가 뜬다. 만든 사람은 "내 앱이
       * 깨졌나" 싶지만 앱은 멀쩡하고 서버가 모르는 것뿐이다.
       *
       * 그래서 확장자가 없고 HTML 을 달라는 요청이면 첫 장을 준다.
       * 확장자가 있는 것(app.js·a.css)에는 절대 안 한다 — 없는 스크립트에
       * HTML 을 돌려주면 브라우저가 "Unexpected token '<'" 로 죽는데,
       * 그게 진짜 원인(파일 이름 오타)을 완전히 가린다.
       */
      const 첫장 = join(뿌리, 'index.html');
      const 확장자없나 = !extname(길);
      const html달라나 = String(req.headers.accept ?? '').includes('text/html');
      if (확장자없나 && html달라나 && existsSync(첫장)) return 파일주기(첫장, req, res, 되살리기);
      res.writeHead(404);
      return res.end('없는 파일입니다');
    }

    let st;
    try { st = statSync(abs); } catch { res.writeHead(404); return res.end('못 읽습니다'); }

    if (st.isDirectory()) {
      /*
       * 끝에 슬래시가 없으면 **반드시** 붙여서 다시 보낸다.
       *
       * 이걸 안 하면 안엣것이 통째로 깨진다. `/docs` 로 들어오면 index.html 은
       * 나오는데, 그 안의 `./app.js` 를 브라우저가 `/app.js` 로 푼다 —
       * 실제로는 `/docs/app.js` 인데 404 가 난다.
       * 화면은 흰데 오류는 콘솔에만 있어서 "왜 안 되지" 로 한참 헤매게 된다.
       */
      if (길 !== '' && !req.url.split('?')[0].endsWith('/')) {
        const [, 물음표] = req.url.split(/(\?.*)$/);
        // 헤더는 ASCII 만 실린다. 한글 폴더 이름을 그대로 넣으면 ERR_INVALID_CHAR 로
        // **서버가 죽는다.** 미리보기 하나 켰다가 deel 이 통째로 끝나는 셈이다.
        // 길은 이미 디코드된 값이므로 다시 인코드해서 싣는다.
        //
        // 조각마다 encodeURIComponent 로 싣는다 (2.0.0 6회차 미리보기6). encodeURI 는 `#`·`?` 를
        // 주소의 뼈대로 보고 그대로 둬서, `c#` 폴더로 넘길 때 `location: /c#/` 가 나갔다 — 브라우저는
        // `#` 뒤를 조각으로 떼고 `/c` 를 다시 불러 같은 넘김을 되풀이했다.
        res.writeHead(301, { location: `/${길.split('/').map(encodeURIComponent).join('/')}/${물음표 ?? ''}` });
        return res.end();
      }
      const 첫장 = join(abs, 'index.html');
      if (existsSync(첫장)) return 파일주기(첫장, req, res, 되살리기);
      return 목록주기(abs, 뿌리, res);
    }
    return 파일주기(abs, req, res, 되살리기);
  });

  return new Promise((done, fail) => {
    srv.on('error', fail);
    // 127.0.0.1 만. 여기를 0.0.0.0 으로 바꾸면 같은 망의 아무나 내 소스를 읽는다.
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;

      if (되살리기) {
        try {
          /*
           * 감시할 자리는 **긴 이름으로 바꿔서** 준다.
           *
           * 윈도우가 알려 주는 파일 이름은 긴 이름인데, 우리가 준 자리가 짧은
           * 이름(`RUNNER~1` 같은 8.3 이름)이거나 정션 너머면 둘이 안 맞는다.
           * 그때 libuv 는 잡을 수 있는 오류를 내지 않고 **그냥 죽는다** —
           *
           *   Assertion failed: !_wcsnicmp(filename, dir, dirlen),
           *   file src\win\fs-event.c, line 72
           *
           * try 로 감싸도 소용없다. assert 는 프로세스를 통째로 끝낸다.
           * 미리보기 한 번 켰다가 deel 이 사라지는 셈이고, 화면에는 아무
           * 이유도 안 남는다. GitHub 의 윈도우 러너 임시 폴더가 정확히 그
           * 모양이라 검사가 거기서만 죽었고, 그 덕에 찾았다.
           */
          let 감시자리 = 뿌리;
          try { 감시자리 = realpathSync.native(뿌리); } catch { /* 못 바꾸면 준 대로 */ }
          감시 = watch(감시자리, { recursive: true }, () => {
            // 저장 한 번에 이벤트가 여러 개 온다. 몰아서 한 번만 알린다.
            clearTimeout(늦추기);
            늦추기 = setTimeout(알리기, 120);
            // 이 시계가 프로그램을 붙잡고 있으면 안 된다.
            늦추기.unref?.();
          });
          /*
           * 도는 중에 오는 감시 오류(지켜보던 폴더가 지워짐·권한이 바뀜)는 위 try 가 못 잡는다.
           * 'error' 를 받는 이가 없으면 EventEmitter 가 던져 **프로세스가 죽는다** (2.0.0 6회차
           * 미리보기6 V7). 되살림만 멈추고 파일은 계속 준다.
           */
          감시.on('error', () => { try { 감시?.close(); } catch { /* 이미 닫혔다 */ } });
        } catch {
          // 리눅스 옛 커널 등에서 recursive 가 안 될 수 있다. 그때는 되살림만 없다.
          감시 = null;
        }
        감시?.unref?.();
      }

      done({
        url: `http://127.0.0.1:${port}/`,
        port,
        되살아나나: !!감시,
        바뀐수: () => 바뀐수,
        듣는수: () => 듣는이들.size,
        닫기() {
          clearTimeout(늦추기);
          try { 감시?.close(); } catch { /* 이미 닫혔다 */ }
          // 열어 둔 통로를 안 끊으면 서버가 안 닫힌다 — 프로그램이 안 끝난다.
          for (const r of 듣는이들) { try { r.end(); } catch { /* 그만 */ } }
          듣는이들.clear();
          return new Promise((r) => srv.close(r));
        },
      });
    });
  });
}

/*
 * 표에 적힌 `charset=utf-8` 을 **파일에 맞춰 고친다** (막판 훑기).
 *
 * HTTP 머리에 적은 charset 은 문서 안의 `<meta charset>` 을 **이긴다**(WHATWG).
 * 그래서 EUC-KR 로 적힌 옛 페이지는 제 입으로 euc-kr 이라 적어 둬도 여기서
 * utf-8 이라고 우기는 순간 통째로 깨져 보인다. 되살림 조각을 바이트째로 끼운
 * 것도(위 머리말) 이 한 줄이 도로 무르고 있었다 — 반쪽 고침이었다.
 *
 * 건드리는 것은 글 갈래뿐이다. 그림·소리·wasm 에는 charset 이 없다.
 */
function 글자맞추기(mime, 머리) {
  if (!머리 || !mime.includes('charset=utf-8')) return mime;
  // 잘림:true — 앞부분만 봤으니 끝에서 잘린 글자를 깨진 것으로 세지 말라는 뜻이다.
  const r = detect(머리, { 잘림: true });
  return r.id === 'utf-8' ? mime : mime.replace('charset=utf-8', `charset=${r.id}`);
}

/** 인코딩을 가리려고 앞부분만 읽는다. 다 읽으면 큰 파일에서 흘려보내는 뜻이 없어진다. */
function 머리읽기(abs, 몇 = 64 * 1024) {
  let fd = null;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(몇);
    const 센것 = readSync(fd, buf, 0, 몇, 0);
    return buf.subarray(0, 센것);
  } catch { return null; } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* 이미 닫혔다 */ } }
  }
}

function 파일주기(abs, req, res, 되살리기) {
  const ext = extname(abs).toLowerCase();
  const 적힌형식 = 형식[ext] ?? 'application/octet-stream';
  const mime = 적힌형식.includes('charset=utf-8') ? 글자맞추기(적힌형식, 머리읽기(abs)) : 적힌형식;
  let st;
  try { st = statSync(abs); } catch { res.writeHead(404); return res.end(); }

  // HTML 에는 되살림 조각을 끼워 넣는다. 길이가 달라지므로 흘려보내지 않고 통째로 읽는다.
  if (되살리기 && (ext === '.html' || ext === '.htm')) {
    const 조각들 = [];
    const s = createReadStream(abs);
    s.on('data', (d) => { 조각들.push(d); });
    s.on('error', () => { res.writeHead(500); res.end(); });
    s.on('end', () => {
      /*
       * **바이트째로** 끼운다 (2.0.0 6회차 미리보기6). utf8 글로 읽었다가 utf8 로 다시 적었더니
       * EUC-KR 페이지의 한글이 전부 U+FFFD 로 바뀌어 나갔다 — 되살리기는 기본으로 켜져 있어서
       * 옛 한글 페이지는 미리보기에서 늘 깨져 보였다. `</body>` 는 그런 인코딩에서도 같은 ASCII
       * 바이트이고, 끼우는 조각도 ASCII 뿐이라(위 되살림 머리말) 원래 바이트를 한 개도 안 건드린다.
       * `</body>` 앞에 넣는 게 정석이지만 없는 문서도 많다. 없으면 그냥 뒤에 붙인다.
       */
      const 원 = Buffer.concat(조각들);
      const 자리 = 원.indexOf('</body>');
      const buf = 자리 >= 0
        ? Buffer.concat([원.subarray(0, 자리), Buffer.from(`${되살림}\n`), 원.subarray(자리)])
        : Buffer.concat([원, Buffer.from(되살림)]);
      res.writeHead(200, { 'content-type': mime, 'content-length': buf.length, 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return undefined;
  }

  /*
   * 동영상·소리는 브라우저가 조각으로 달라고 한다(Range).
   * 이걸 안 받아 주면 <video> 가 아예 안 돈다 — 파일은 멀쩡한데 화면만 검다.
   */
  const range = req.headers.range;
  /*
   * `bytes=-` 는 **문법 오류**다 — 시작도 끝도 없다. 규격은 「못 알아들을
   * Range 는 없는 것처럼 보라」 고 한다(RFC 9110 §14.2). 여태는 정규식에
   * 걸려 처음=0 · 끝=마지막 으로 채워져 **파일 전체를 206 으로** 줬다.
   * 받는 쪽은 자기가 청한 조각을 받았다고 믿는다 (9회차 · 2차 눈).
   */
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (m && st.size > 0 && (m[1] !== '' || m[2] !== '')) {
    let 처음 = m[1] === '' ? null : Number(m[1]);
    let 끝 = m[2] === '' ? null : Number(m[2]);
    if (처음 === null && 끝 !== null) { 처음 = Math.max(0, st.size - 끝); 끝 = st.size - 1; }
    else { 처음 = 처음 ?? 0; 끝 = 끝 === null ? st.size - 1 : Math.min(끝, st.size - 1); }
    if (!Number.isFinite(처음) || !Number.isFinite(끝) || 처음 > 끝 || 처음 >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'content-type': mime,
      'content-range': `bytes ${처음}-${끝}/${st.size}`,
      'accept-ranges': 'bytes',
      'content-length': 끝 - 처음 + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return 흘리기(createReadStream(abs, { start: 처음, end: 끝 }), res);
  }

  res.writeHead(200, {
    'content-type': mime,
    'content-length': st.size,
    'accept-ranges': 'bytes',
    // 고친 것이 바로 보여야 한다. 미리보기에서 캐시는 도움이 안 된다.
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  return 흘리기(createReadStream(abs), res);
}

/*
 * 읽기 흐름을 답에 잇는다 — **흐름의 오류를 받는 자리까지.**
 *
 * `pipe` 는 오류를 넘겨 주지 않는다. 다른 프로그램이 파일을 잠가 두면(윈도 EBUSY — 편집기·백신·
 * 빌드 도구가 흔히 그런다) statSync 는 되고 여는 자리에서 오류가 나는데, 그걸 아무도 안 받아
 * **deel 프로세스가 통째로 죽었다** (2.0.0 6회차 미리보기6). 머리말(200 · 길이)은 이미 나갔으니
 * 답을 고칠 수는 없고, 연결을 끊어 받는 쪽이 「덜 받은 답」 으로 알게 한다 — 빈 파일을 성한
 * 답인 척 끝내지 않는다.
 */
function 흘리기(흐름, res) {
  흐름.on('error', () => res.destroy());
  return 흐름.pipe(res);
}

// index.html 이 없는 폴더. 무엇이 있는지라도 보여 준다 — 흰 화면보다 낫다.
function 목록주기(abs, 뿌리, res) {
  let 것들 = [];
  try { 것들 = readdirSync(abs, { withFileTypes: true }); } catch { /* 못 읽으면 빈 채로 */ }
  // 눌러도 안 주는 것은 목록에도 안 올린다 — 이름만으로도 무엇이 있는지 샌다 (사냥5 H5-7).
  것들 = 것들.filter((e) => !안줄것인가(join(abs, e.name), 뿌리));
  const 여기 = relative(뿌리, abs).split(sep).join('/');
  // 파일 이름은 디스크에서 온 것이라 `<script>` 같은 것이 그대로 들어 있을 수
  // 있다 — 씌우지 않고 꽂으면 그 파일이 있는 폴더를 미리보기로 여는 사람 화면에서
  // 그대로 실행된다(Stored XSS). href 는 이미 encodeURIComponent 로 씌웠지만
  // 화면에 보이는 글자는 안 씌웠던 것이 문제였다.
  const 줄 = (e) => {
    const 이름 = html씌우기(e.name) + (e.isDirectory() ? '/' : '');
    return `<li><a href="${encodeURIComponent(e.name)}${e.isDirectory() ? '/' : ''}">${이름}</a></li>`;
  };
  const 여기씌움 = html씌우기(여기);
  const 몸 = `<!doctype html><meta charset="utf-8"><title>${여기씌움 || '/'}</title>`
    + '<style>body{font:14px/1.7 ui-monospace,monospace;max-width:44rem;margin:3rem auto;padding:0 1rem}'
    + 'h1{font-size:1rem;color:#888;font-weight:400}a{color:#0a7}li{list-style:none}'
    + 'p{color:#999}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}a{color:#4d9}}</style>'
    + `<h1>/${여기씌움}</h1>`
    + (여기 ? '<li><a href="../">../</a></li>' : '')
    + 것들.map(줄).join('')
    + '<p>index.html 이 없어서 목록을 보여 줍니다.</p>';
  const buf = Buffer.from(몸, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length });
  res.end(buf);
}

/**
 * 기본 브라우저로 연다.
 *
 * 실패해도 조용히 넘어간다 — 주소는 이미 화면에 찍혀 있으므로 손으로 열면 된다.
 * 여기서 오류를 띄우면 '띄우기는 됐는데 실패한 것처럼' 보인다.
 */
export function 브라우저로(url) {
  /*
   * 열면 안 되는 자리가 있다.
   *
   * 검사가 돌 때마다 진짜 브라우저 창이 뜨면 사람 화면이 난장판이 된다.
   * 파이프로 넘길 때(로그·캡처)도 열 이유가 없다 — 볼 사람이 없다.
   * 상자 검사는 isTTY 를 거짓말하게 만들어 자식을 띄우므로, TTY 만 봐서는
   * 못 막는다. 그래서 env 로도 막을 수 있게 뒀고 검사 돌리개가 그걸 켠다.
   */
  if (process.env.DEEL_NO_OPEN) return false;
  if (!process.stdout.isTTY) return false;
  try {
    const [cmd, args] = process.platform === 'win32'
      // start 는 cmd 안엣말이다. 첫 따옴표 한 쌍은 창 제목 자리라 비워 둬야 한다.
      ? ['cmd', ['/d', '/s', '/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const kid = spawn(cmd, args, { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
    kid.on('error', () => { /* 없으면 그만 */ });
    kid.unref();
    return true;
  } catch {
    return false;
  }
}
