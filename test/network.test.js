// 소스 코드가 정해진 자리 밖으로 새어 나가지 않는지 검증한다.
//
// 이게 이 프로그램에서 제일 중요한 검사다.
// 코딩 에이전트는 파일 내용을 통째로 모델에 보낸다. 그 주소가 하나로 묶여 있지 않으면
// "로컬에서만 돕니다" 는 그냥 말이다. 그래서 말이 아니라 여기서 확인한다.
import { createServer } from 'node:http';
import { req } from '../src/backend/http.js';
import {
  allowEndpoint, allowTemporarily, setOffline, checkUrl, resetNet,
  contacted, allowed, isLocalHost, NetBlocked, 사설로풀리나, 안쪽주소인가, 프록시경유 } from '../src/safety/network.js';
import { 프록시정하기, 프록시고르기, 프록시지우기 } from '../src/backend/proxy.js';
import { importSpecs } from '../src/pack/selfpack.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 막히나 = (url) => {
  try { checkUrl(url); return false; } catch (e) { return e instanceof NetBlocked; }
};

// ── 1. 기본은 전부 거절 ─────────────────────────────────────────────────
resetNet();
check('아무것도 정하지 않으면 전부 거절', 막히나('https://api.openai.com/v1/chat/completions'));
check('로컬조차도 거절', 막히나('http://127.0.0.1:11434/api/chat'));

// ── 2. 정한 자리 하나만 통과 ────────────────────────────────────────────
allowEndpoint('http://127.0.0.1:11434/v1');
check('정한 자리는 통과', !막히나('http://127.0.0.1:11434/v1/chat/completions'));
check('같은 호스트 다른 포트는 거절', 막히나('http://127.0.0.1:1234/v1/chat/completions'));
check('바깥 주소는 거절', 막히나('https://api.openai.com/v1/chat/completions'));
check('비슷하게 생긴 주소도 거절', 막히나('http://127.0.0.1.evil.com/v1/chat/completions'));
check('허용 목록은 하나뿐', allowed().length === 1, allowed().join(', '));

// 새 연결로 바꾸면 앞의 것은 닫힌다 — 모델을 갈아탄 뒤에도 옛 주소가 열려 있으면 안 된다.
allowEndpoint('http://127.0.0.1:1234/v1');
check('연결을 바꾸면 이전 자리는 닫힘', 막히나('http://127.0.0.1:11434/v1/chat/completions'));
check('바꾼 자리는 열림', !막히나('http://127.0.0.1:1234/v1/models'));

// ── 3. 잠깐 열기는 반드시 다시 닫힌다 ───────────────────────────────────
const close = allowTemporarily('https://codeload.github.com/a/b');
check('잠깐 여는 동안은 통과', !막히나('https://codeload.github.com/a/b/tar.gz'));
close();
check('닫으면 다시 거절', 막히나('https://codeload.github.com/a/b/tar.gz'));

// ── 4. 오프라인 잠금 ────────────────────────────────────────────────────
setOffline(true);
const c2 = allowTemporarily('https://codeload.github.com/a/b');
check('오프라인이면 허용 목록에 있어도 바깥은 거절', 막히나('https://codeload.github.com/a/b/tar.gz'));
c2();
check('오프라인이어도 이 컴퓨터 안은 통과', !막히나('http://127.0.0.1:1234/v1/models'));
setOffline(false);

/*
 * ── 4½. 봉인인데 **프록시**로 나가는 자리 (8회차) ──────────────────────
 *
 * 목적지만 로컬 검사를 받았다. isLocalHost 는 사내망(10.x · 192.168.x · 172.16–31.x)까지
 * 「이 안」 으로 치는데 프록시비켜가나(backend/proxy.js)는 **루프백만** 비켜 간다. 그래서
 * `--offline` + LAN Ollama(192.168.0.50) + `HTTP_PROXY=http://proxy.corp.com:8080` 조합에서
 * 패킷이 실제로 닿는 첫 기계는 **사내 프록시**인데 아무 검사도 안 받았다 — 게이트웨이 열쇠가
 * 실린 요청이 봉인 중에 그대로 컴퓨터 밖으로 나갔다.
 *
 * 봉인이 막는 것은 「이 컴퓨터 밖」 이지 프록시라는 말이 아니다. 루프백 프록시
 * (127.0.0.1:3128)를 거쳐 로컬 창구에 붙는 길은 계속 열려 있어야 한다.
 */
{
  resetNet();
  const 창구 = 'http://192.168.0.50:11434/v1';
  allowEndpoint(창구);
  const 나가나 = (거쳐) => {
    try { checkUrl(`${창구}/chat/completions`, 거쳐); return true; } catch (e) { return !(e instanceof NetBlocked); }
  };
  setOffline(true);
  check('★★★ (8회차) 봉인 중에는 사내 프록시로 안 나간다', 나가나('http://proxy.corp.com:8080') === false);
  check('★★★ 봉인 중에는 바깥 프록시(숫자 주소)로도 안 나간다', 나가나('http://8.8.8.8:3128') === false);
  check('★★ 봉인 중 프록시 주소를 못 읽으면 안 나간다', 나가나('말도 안 되는 주소') === false);
  check('★★★ 봉인 중에도 루프백 프록시를 거친 로컬 창구는 열려 있다', 나가나('http://127.0.0.1:3128') === true);
  check('★★ 봉인 중에도 localhost 프록시는 열려 있다', 나가나('http://localhost:3128') === true);
  check('봉인 중 직접 연결(프록시 없음)은 그대로 열려 있다', 나가나(null) === true);
  setOffline(false);
  check('봉인이 아니면 사내 프록시로 나간다', 나가나('http://proxy.corp.com:8080') === true);

  // 이 조합이 진짜로 생기나 — 설정·환경변수를 그대로 태워 본다(http.js:149 와 같은 부름).
  프록시지우기();
  프록시정하기({ env: { HTTP_PROXY: 'http://proxy.corp.com:8080' }, config: null });
  const 고른것 = 프록시고르기(`${창구}/chat/completions`);
  check('★★ LAN 창구는 실제로 사내 프록시를 거치도록 골라진다', 고른것?.url === 'http://proxy.corp.com:8080', JSON.stringify(고른것?.url));
  setOffline(true);
  check('★★★ 그 조합이 봉인에서 막힌다', 나가나(고른것?.url ?? null) === false);
  setOffline(false);
  프록시지우기();
  resetNet();
}

/*
 * ── 4¾. 거쳐 간 프록시는 **지금** 거친 것만 (8회차) ─────────────────────
 * 직접 연결한 뒤에도 옛 프록시 값이 남아 심사서·화면이 「이 프록시를 거친다」 고 적었다.
 */
{
  resetNet();
  allowEndpoint('http://127.0.0.1:11434/v1');
  checkUrl('http://127.0.0.1:11434/v1/a', 'http://proxy.corp.com:8080');
  const 거친뒤 = 프록시경유();
  checkUrl('http://127.0.0.1:11434/v1/b', null);
  check('★★ (8회차) 프록시를 안 거친 요청 뒤에는 「거친 프록시」 가 안 남는다', 프록시경유() === null, JSON.stringify(프록시경유()));
  check('짝: 거쳤을 때는 그 프록시가 남는다', 거친뒤?.url === 'http://proxy.corp.com:8080', JSON.stringify(거친뒤));
  resetNet();
}

/*
 * ── 4⅞. 연결을 바꿔도 **잠깐 연 것**은 안 닫힌다 (8회차) ────────────────
 * allowEndpoint 가 목록을 통째로 비워서, 플러그인을 받는 동안 /model 로 갈아타면
 * 받던 곳이 「허용되지 않은 주소」 로 막혔다. 닫는 것은 잠깐 연 자가 준 함수뿐이다.
 */
{
  resetNet();
  allowEndpoint('http://127.0.0.1:11434/v1');
  const 닫기 = allowTemporarily('https://codeload.github.com/a/b');
  allowEndpoint('http://127.0.0.1:1234/v1');
  check('★★ (8회차) 연결을 바꿔도 잠깐 연 곳은 열려 있다', !막히나('https://codeload.github.com/a/b/tar.gz'));
  check('짝: 바꾼 연결도 열려 있다', !막히나('http://127.0.0.1:1234/v1/models'));
  닫기();
  check('짝: 잠깐 연 것을 닫으면 그때 닫힌다', 막히나('https://codeload.github.com/a/b/tar.gz'));
  check('짝: 바꾼 연결은 그대로 남는다', !막히나('http://127.0.0.1:1234/v1/models'));
  resetNet();
}

// ── 5. 사설망 판정 ──────────────────────────────────────────────────────
for (const h of ['127.0.0.1', 'localhost', '192.168.0.5', '10.1.2.3', '172.16.0.9', '::1']) {
  check(`이 컴퓨터·사내망으로 봄: ${h}`, isLocalHost(h));
}
for (const h of ['8.8.8.8', 'api.openai.com', '172.32.0.1', 'evil.com']) {
  check(`바깥으로 봄: ${h}`, !isLocalHost(h));
}

// ── 6. 실제 요청도 막히나 (진짜 서버를 하나 띄워서 확인) ────────────────
const hits = [];
const server = createServer((req_, res) => {
  hits.push(req_.url);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

resetNet();
allowEndpoint(`http://127.0.0.1:${port}`);
const ok = await req(`http://127.0.0.1:${port}/v1/models`);
check('허용된 곳에는 실제로 닿음', ok.ok && hits.length === 1, `요청 ${hits.length}건`);

// 허용되지 않은 곳으로 보내려 하면 요청 자체가 안 나간다
const other = createServer((req_, res) => { hits.push('SHOULD-NOT:' + req_.url); res.end('{}'); });
await new Promise((r) => other.listen(0, '127.0.0.1', r));
const otherPort = other.address().port;
let threw = null;
try {
  await req(`http://127.0.0.1:${otherPort}/v1/chat/completions`, {
    method: 'POST', body: { messages: [{ role: 'user', content: '내 소스 코드 전부' }] },
  });
} catch (e) { threw = e; }
check('허용 안 된 곳은 던져서 막음', threw instanceof NetBlocked, threw?.name ?? '안 막힘');
check('그 서버에는 한 건도 안 닿음', !hits.some((h) => String(h).startsWith('SHOULD-NOT')),
  hits.filter((h) => String(h).startsWith('SHOULD-NOT')).join(', '));

check('닿은 곳 기록이 남음', contacted().length === 1 && contacted()[0].local,
  JSON.stringify(contacted()));

server.closeAllConnections?.();
other.closeAllConnections?.();
server.close();
other.close();
await new Promise((r) => setImmediate(r));

// ── 6¼. 이 컴퓨터·사내망 철자 — 글자를 바꿔 빠져나가지 못한다 ────────────
// `localhost.` 와 `[::ffff:127.0.0.1]` 은 둘 다 127.0.0.1 에 붙는데 '바깥' 으로 읽혔다.
{
  for (const h of ['localhost', 'localhost.', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '[::1]', '::1', '[::ffff:127.0.0.1]', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '[::ffff:c0a8:101]', '0.0.0.0', '10.1.2.3', '192.168.0.9', '172.16.5.5', '172.31.255.1', '169.254.169.254', 'fe80::1', 'fd00::1', '[fc00::1]']) {
    check(`${h} 는 이 컴퓨터·사내망이다`, isLocalHost(h) === true);
  }
  for (const h of ['example.com', 'localhost.example.com', '8.8.8.8', '172.32.0.1', '172.15.0.1', '11.0.0.1', '192.169.0.1', '2001:db8::1', '::ffff:8.8.8.8', 'my-localhost']) {
    check(`${h} 는 바깥이다`, isLocalHost(h) === false);
  }
}

// ── 6⅓. 웹이 닿으면 안 되는 안쪽 — 봉인이 열어 주는 안쪽과는 다른 표다 (사냥4 W9) ──
/*
 * isLocalHost 는 **두 일**을 한다. WebFetch 가 안 읽을 곳이기도 하고, 봉인(offline)이
 * 그래도 열어 주는 곳이기도 하다. 그래서 거기에 100.64/10 을 더하면 막는 쪽은 조여지지만
 * 봉인 쪽은 **풀린다** — 통신사 CGNAT 너머가 「이 안」 이 된다.
 *
 * 그래서 막는 쪽만 넓힌 표를 따로 둔다. 알리바바 클라우드 메타데이터(100.100.100.200)가
 * 100.64/10 에 산다. fec0::/10(옛 사이트로컬)과 IPv4 를 싼 IPv6 꼴도 여기서 본다.
 */
{
  for (const h of ['100.100.100.200', '100.64.0.1', '100.127.255.254', 'fec0::1', '[fec0::1]', '[64:ff9b::a9fe:a9fe]', '[::7f00:1]',
    '198.18.0.1', '224.0.0.1', '255.255.255.255', 'ff02::1', '127.0.0.1', '10.0.0.1', 'localhost']) {
    check(`★ ${h} 는 웹이 닿으면 안 되는 안쪽이다`, 안쪽주소인가(h) === true);
  }
  for (const h of ['8.8.8.8', '100.63.255.255', '100.128.0.1', 'example.com', '100.example.com', '[64:ff9b::808:808]', '2001:db8::1', '[2606:4700::1111]']) {
    check(`★ ${h} 는 안쪽이 아니다`, 안쪽주소인가(h) === false);
  }
  // 봉인은 안 풀린다 — isLocalHost 는 그대로다.
  check('★★ 100.100.100.200 을 봉인이 열어 주는 「이 안」 으로 넓히지 않는다', isLocalHost('100.100.100.200') === false && isLocalHost('fec0::1') === false);
}

// ── 6½. 잠깐 열기는 겹쳐 열 수 있어야 한다 ───────────────────────────────
// WebFetch 다섯이 한 집에 줄을 서면, 첫 것이 닫을 때 나머지 넷이 막히면 안 된다.
resetNet();
{
  const 집 = 'http://127.0.0.1:1';
  const 첫 = allowTemporarily(집);
  const 둘 = allowTemporarily(집);
  첫();
  let 아직 = true;
  try { checkUrl(`${집}/x`); } catch { 아직 = false; }
  check('겹쳐 연 집은 하나가 닫아도 아직 열려 있다', 아직);
  둘(); 둘();
  let 닫힘 = false;
  try { checkUrl(`${집}/x`); } catch { 닫힘 = true; }
  check('마지막이 닫으면 정말 닫힌다 (두 번 닫아도 남의 몫은 안 닫는다)', 닫힘);
  allowEndpoint(집);
  const 셋 = allowTemporarily(집);
  셋();
  let 남음 = true;
  try { checkUrl(`${집}/x`); } catch { 남음 = false; }
  check('원래 열려 있던 집은 잠깐 열었다 닫아도 그대로 열려 있다', 남음);
  resetNet();
}

// ── 7. 문이 정말 하나뿐인가 ─────────────────────────────────────────────
// http.js 말고 다른 데서 fetch 를 직접 부르면 자물쇠를 지나지 않는다.
// src 전체를 본다 — 목록에 없는 파일에서 새면 못 잡던 것을(WebFetch 가 그랬다) 이제는 잡는다.
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
function 소스전부(dir, 모음 = []) {
  for (const 이름 of readdirSync(dir)) {
    const p = join(dir, 이름);
    if (statSync(p).isDirectory()) 소스전부(p, 모음);
    else if (/\.(js|mjs)$/.test(이름)) 모음.push(relative(repo, p).replace(/\\/g, '/'));
  }
  return 모음;
}
const SRC = 소스전부(join(repo, 'src'));
check('훑을 소스가 있다 (60개 넘게)', SRC.length > 60, String(SRC.length));
const 직접fetch = [];
for (const f of SRC) {
  const lines = readFileSync(join(repo, f), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    // fetch( 만이 아니다 — globalThis.fetch( · window.fetch( · new WebSocket( 도 문이다.
    // (preview/serve.js 가 브라우저에 주는 글 속의 EventSource 는 이 프로그램이 여는 문이 아니라 안 본다.)
    if (!/(?<![.\w])fetch\s*\(|(?:globalThis|window|self)\s*\.\s*fetch\s*\(|\bnew\s+WebSocket\s*\(/.test(line)) return;
    if (f !== 'src/backend/http.js') 직접fetch.push(`${f}:${i + 1}`);   // 자물쇠를 지나는 문은 하나뿐이다
  });
}
check('자물쇠를 건너뛰는 fetch 없음 (src 전체)', 직접fetch.length === 0, 직접fetch.join(', '));

// 연결을 바꾸는 자리는 자물쇠도 같이 옮겨야 한다.
// 한 번 빠뜨렸다 — /model 로 갈아탄 뒤 옛 주소가 열린 채 새 주소가 막혔다.
// /model 은 가르는 자리(commands.js)와 갈아끼우는 자리(commands/model.js)가 나눠 맡는다 — 한 덩이로 본다.
const 갈아타는곳 = [['src/commands.js', 'src/commands/model.js'], 'src/repl.js', 'src/setup.js'];
const 안옮김 = [];
for (const f of 갈아타는곳) {
  const text = [f].flat().map((p) => readFileSync(join(repo, p), 'utf8')).join('\n');
  const 바꾼다 = /session\.conn,|conn\.base\s*=|Object\.assign\(session\.conn/.test(text);
  if (바꾼다 && !/allowEndpoint\s*\(/.test(text)) 안옮김.push([f].flat().join(' + '));
}
check('연결을 바꾸면 자물쇠도 옮김', 안옮김.length === 0, 안옮김.join(', '));

// ── 8. 몰래 보내는 코드가 없나 ──────────────────────────────────────────
// 소켓을 직접 만지는 곳은 둘뿐이다 — http.js(프록시 터널: http · https · tls)와
// preview/serve.js(이 컴퓨터 안에서 여는 미리보기 서버: http). 그 밖에서 나오면 새는 것이다.
const 소켓허용 = {
  'src/backend/http.js': ['node:http', 'node:https', 'node:tls'],
  'src/preview/serve.js': ['node:http'],
};
const 의심 = [];
for (const f of SRC) {
  const text = readFileSync(join(repo, f), 'utf8');
  for (const spec of importSpecs(text)) {
    if (['node:http', 'node:https', 'node:net', 'node:dgram', 'node:tls'].includes(spec) && !(소켓허용[f] ?? []).includes(spec)) {
      의심.push(`${f} → ${spec}`);
    }
  }
  // 소스에 박힌 바깥 주소 (github 는 플러그인 받기용, 보기 주소(example · .corp)는 설명용이라 예외)
  //
  // src/providers/ 는 예외다. **거기 있는 것이 주소 그 자체**이기 때문이다 —
  // bedrock-runtime.ap-northeast-2.amazonaws.com 을 외워서 치라고 하면 아무도
  // 안 쓴다. 다만 예외를 그냥 뚫어 두지는 않는다. 아래 9절에서 그 폴더가
  // **주소만 적힌 데이터**이고 문이 아니라는 것을 따로 잰다.
  if (/^src[\\/]providers[\\/]/.test(f)) continue;
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase();
    if (/github\.com$/.test(host)) continue;
    if (/(?:(?:^|\.)example\.)|(?:\.(?:corp|local|test|invalid|example)$)/.test(host)) continue;
    // xmlns 값은 주소처럼 생겼을 뿐 주소가 아니다 — 이름표다.
    // hwpx(OWPML) 를 쓰려면 hancom.co.kr 네임스페이스를 글자 그대로 적어야 하고,
    // 그 글자는 아무도 열어보지 않는다. 그래서 **xmlns= 뒤에 붙은 것만** 봐준다.
    // 호스트 이름으로 봐주면 그 호스트로 진짜 나가는 코드까지 같이 통과한다.
    if (/xmlns(:[A-Za-z0-9_-]+)?=["']$/.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
    의심.push(`${f} 안에 박힌 주소: ${host}`);
  }
}
check('소스에 박힌 바깥 주소·저수준 소켓 없음 (src 전체)', 의심.length === 0, 의심.slice(0, 4).join(' · '));

/*
 * ── 9. 주소 메모가 문이 되지 않았나 ────────────────────────────────────
 *
 * 위에서 src/providers/ 만 예외로 뒀다. 그 예외가 안전하려면 그 폴더가
 * **아무 데도 안 나가야** 한다 — 주소가 적혀 있는 것과 그 주소로 나가는 것은
 * 전혀 다른 일이다.
 *
 * 그래서 여기서 잰다: 그 폴더는 아무것도 안 들여오고(import 0개), fetch 도
 * 소켓도 없다. 순수한 데이터 한 장이다. 나가는 문은 여전히 backend/http.js
 * 하나뿐이고, 그 문은 checkUrl 을 지난다.
 */
{
  const 메모들 = SRC.filter((f) => /^src[\\/]providers[\\/]/.test(f));
  check('주소 메모가 실제로 있다', 메모들.length >= 5, String(메모들.length));
  const 새는것 = [];
  for (const f of 메모들) {
    const text = readFileSync(join(repo, f), 'utf8');
    // 제 폴더 안끼리 잇는 것(index.js → openai.js)만 봐준다.
    for (const spec of importSpecs(text)) {
      if (!/^\.\/[a-z]+\.js$/.test(spec)) 새는것.push(`${f} → ${spec}`);
    }
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (/(?<![.\w])fetch\s*\(|\bnew\s+WebSocket\s*\(|\breq\s*\(/.test(line)) 새는것.push(`${f}:${i + 1}`);
    }
  }
  check('★ 주소 메모는 문이 아니다 — 아무것도 안 들여오고 아무 데도 안 나간다',
    새는것.length === 0, 새는것.join(' · '));
}


/*
 * ── 이름이 아니라 **닿는 곳** ───────────────────────────────────────────
 *
 * isLocalHost 는 글자를 본다. 그 검사를 통과하는 평범한 공개 도메인이
 * A 레코드 하나로 `127.0.0.1` 이나 `169.254.169.254`(클라우드 메타데이터)
 * 를 가리키면 그대로 닿는다. 그래서 실제로 풀어 보고 돌아온 주소를 본다.
 */
{
  const 로컬 = await 사설로풀리나('localhost');
  check('★★ 사내로 풀리는 이름을 잡는다', !!로컬 && 로컬.걸린것.length > 0,
    JSON.stringify(로컬));
  check('★ 숫자로 적은 주소는 여기서 안 푼다 (isLocalHost 가 이미 본다)',
    (await 사설로풀리나('127.0.0.1')) === null);
  check('★ 못 푸는 이름에서 안 죽는다',
    (await 사설로풀리나('없는이름.invalid')) === null);
  check('★ 빈 값도 안 죽는다',
    (await 사설로풀리나('')) === null && (await 사설로풀리나(null)) === null);
}

// ── 9. 반쪽 글자는 모델에게 안 간다 ────────────────────────────────────
//
// 6회차 직접 사냥. Read · Grep · Bash 가 결과를 상한에서 자를 때 이모지 앞쪽 반이
// 남는다(홀짝에 따라). JSON.stringify 는 그것을 `\ud83c` 낱개 이스케이프로 싣고,
// 그런 글자를 거절하는 서버면 그 결과가 대화에 남는 동안 모든 턴이 400 이다.
// 자르는 자리는 여럿이지만 나가는 문은 req() 하나다 — 거기서 본다.
{
  let 받은몸 = '';
  const 받기 = createServer((q, s) => {
    let b = '';
    q.setEncoding('utf8');
    q.on('data', (d) => (b += d));
    q.on('end', () => { 받은몸 = b; s.writeHead(200, { 'Content-Type': 'application/json' }); s.end('{}'); });
  });
  await new Promise((r) => 받기.listen(0, '127.0.0.1', r));
  const 받기포트 = 받기.address().port;
  resetNet();
  allowEndpoint(`http://127.0.0.1:${받기포트}`);
  const 온 = String.fromCodePoint(0x1f34e);
  const 반쪽 = 온.slice(0, 1);
  await req(`http://127.0.0.1:${받기포트}/v1/chat/completions`, {
    method: 'POST',
    body: { messages: [{ role: 'tool', content: `잘린 결과 ${반쪽}` }, { role: 'user', content: `${온} 한글 "따옴표"` }] },
  });
  let 풀린 = null;
  try { 풀린 = JSON.parse(받은몸); } catch { /* 아래 check 가 받는다 */ }
  const 역빗금 = String.fromCharCode(92);
  check('★ (6회차 반쪽글자) 모델로 가는 몸통에 짝 없는 서로게이트가 안 실린다',
    풀린?.messages?.[0]?.content?.isWellFormed?.() === true && !받은몸.toLowerCase().includes(`${역빗금}ud83c`), 받은몸.slice(0, 80));
  check('짝: 온전한 이모지·한글·따옴표는 한 글자도 안 바뀐다', 풀린?.messages?.[1]?.content === `${온} 한글 "따옴표"`, 받은몸.slice(0, 80));
  받기.closeAllConnections?.();
  받기.close();
}

// ── 결과 ────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n바깥으로 새는지 검사  ' + D + '(소스가 정해진 자리 밖으로 나가지 않는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
// 서버를 띄운 검사는 process.exit() 를 쓰지 않는다 — loop.test.js 의 설명 참고.
process.exitCode = fail.length ? 1 : 0;
