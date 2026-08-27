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
 *   3. 경로는 guard 의 scope 로만 푼다. `../`·심볼릭 링크·정션을 이미
 *      거기서 막고 있으므로 여기서 또 짜지 않는다. 두 벌이 되면 한쪽만 고쳐진다.
 *   4. 파일을 **주기만** 한다. PUT·POST·DELETE 는 받지 않는다.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, readdirSync, watch, realpathSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';

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
const 되살림 = `
<script>/* deel 미리보기 — 파일이 바뀌면 새로 뜬다 */
(function(){try{
  var s=new EventSource('/__deel__/살아있나');
  s.onmessage=function(e){ if(e.data==='다시')location.reload(); };
  // 서버가 꺼지면 EventSource 가 계속 다시 붙으려 한다. 조용히 놔둔다 —
  // deel 을 다시 띄우면 그대로 이어 붙어서 화면을 새로 고치지 않아도 된다.
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
  let 바뀐수 = 0;
  let 감시 = null;
  let 늦추기 = null;

  const 알리기 = () => {
    바뀐수 += 1;
    for (const res of 듣는이들) {
      try { res.write('data: 다시\n\n'); } catch { 듣는이들.delete(res); }
    }
  };

  const srv = createServer((req, res) => {
    // 주기만 한다. 받는 길은 아예 열지 않는다.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return res.end('GET 만 받습니다');
    }

    const 길 = 안전한경로(req.url);
    if (길 === null) { res.writeHead(400); return res.end('주소가 이상합니다'); }

    // 되살림 통로. 열어 두고 파일이 바뀔 때마다 한 줄씩 흘린다.
    if (길 === '__deel__/살아있나') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
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
      const 안쪽 = relative(뿌리, abs);
      if (안쪽.startsWith('..') || (안쪽 !== '' && 안쪽.split(sep)[0] === '..')) {
        res.writeHead(403); return res.end('띄운 폴더 밖입니다');
      }
    } catch {
      res.writeHead(403);
      return res.end('작업 범위 밖입니다');
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
        res.writeHead(301, { location: `${encodeURI(`/${길}/`)}${물음표 ?? ''}` });
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

function 파일주기(abs, req, res, 되살리기) {
  const ext = extname(abs).toLowerCase();
  const mime = 형식[ext] ?? 'application/octet-stream';
  let st;
  try { st = statSync(abs); } catch { res.writeHead(404); return res.end(); }

  // HTML 에는 되살림 조각을 끼워 넣는다. 길이가 달라지므로 흘려보내지 않고 통째로 읽는다.
  if (되살리기 && (ext === '.html' || ext === '.htm')) {
    let 글 = '';
    const s = createReadStream(abs, 'utf8');
    s.on('data', (d) => { 글 += d; });
    s.on('error', () => { res.writeHead(500); res.end(); });
    s.on('end', () => {
      // </body> 앞에 넣는 게 정석이지만 없는 문서도 많다. 없으면 그냥 뒤에 붙인다.
      const 몸 = 글.includes('</body>') ? 글.replace('</body>', `${되살림}\n</body>`) : 글 + 되살림;
      const buf = Buffer.from(몸, 'utf8');
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
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (m && st.size > 0) {
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
    return createReadStream(abs, { start: 처음, end: 끝 }).pipe(res);
  }

  res.writeHead(200, {
    'content-type': mime,
    'content-length': st.size,
    'accept-ranges': 'bytes',
    // 고친 것이 바로 보여야 한다. 미리보기에서 캐시는 도움이 안 된다.
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  return createReadStream(abs).pipe(res);
}

// index.html 이 없는 폴더. 무엇이 있는지라도 보여 준다 — 흰 화면보다 낫다.
function 목록주기(abs, 뿌리, res) {
  let 것들 = [];
  try { 것들 = readdirSync(abs, { withFileTypes: true }); } catch { /* 못 읽으면 빈 채로 */ }
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
