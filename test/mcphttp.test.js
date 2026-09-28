/**
 * HTTP 로 붙는 MCP 서버 (2.1.3 · backend/mcp.js 의 MCP웹서버) — 그리고 자료 · 프롬프트.
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 사내 MCP 서버는 점점 주소 하나로 온다. `.deel/mcp.json` 에 `url` 을 적으면 「url 로 붙는 서버는
 * 아직 못 붙입니다」 였다. 붙이되 **나가는 문은 하나** — backend/http.js 의 원시요청 으로 나가서
 * 문지기(safety/network.js)를 지나야 한다. 오프라인 잠금이면 이 컴퓨터 밖으로는 못 붙어야 하고,
 * 다른 집으로 되돌려도 안 따라가야 하고, 요청이 끝나면 연 문은 다시 닫혀야 한다.
 *
 * 흉내 서버는 여기서 진짜 HTTP 로 띄운다(127.0.0.1). JSON 으로 답하는 길, SSE 로 답하며 도중에
 * 우리에게 ping 을 묻는 길, 세션을 버려 404 를 주는 길, 열쇠를 요구하는 길, 새 규격만 받는 길을 낸다.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

const 집 = mkdtempSync(join(tmpdir(), 'deel-mcphttp-home-'));
process.env.DEEL_HOME = 집;
const {
  설정읽기, 다붙이기, 모두닫기, MCP웹서버, SSE가르기, 도구정의, 읽기만하나, 자료도구이름, 적을주소, 메모읽기,
} = await import('../src/backend/mcp.js');
const { setOffline, resetNet, allowed } = await import('../src/safety/network.js');
const { runTool } = await import('../src/tools/index.js');
const { MCP프롬프트펴기 } = await import('../src/commands.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 흉내 서버 ─────────────────────────────────────────────────────────────
const 기록 = { 요청: [], 지움: [], 핑답: null, 세션번호: 0 };
const 살아있는세션 = new Set();
const 몸읽기 = (req) => new Promise((r) => { let s = ''; req.setEncoding('utf8'); req.on('data', (d) => { s += d; }); req.on('end', () => r(s)); });
let 다른집 = null;

const 서버 = createServer(async (req, res) => {
  const 길 = new URL(req.url, 'http://x').pathname.slice(1);
  if (req.method === 'DELETE') { 기록.지움.push(req.headers['mcp-session-id']); 살아있는세션.delete(req.headers['mcp-session-id']); res.writeHead(200).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  const 글 = await 몸읽기(req);
  let j;
  try { j = JSON.parse(글); } catch { res.writeHead(400).end(); return; }
  기록.요청.push({ 길, method: j.method, id: j.id, 머리: req.headers, j });
  const 답 = (result) => ({ jsonrpc: '2.0', id: j.id, result });
  const 제이슨 = (몸, 머리 = {}) => { res.writeHead(200, { 'Content-Type': 'application/json', ...머리 }); res.end(JSON.stringify(몸)); };

  if (길 === 'legacy404') { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found'); return; }
  if (길 === 'redirect') { res.writeHead(307, { Location: `${다른집}/json` }).end(); return; }
  if (길 === 'modern' && j.method === 'initialize') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'], requested: j.params?.protocolVersion } } }));
    return;
  }
  if (길 === 'auth' && req.headers.authorization !== 'Bearer test-key-value') { res.writeHead(401, { 'Content-Type': 'text/plain' }).end('unauthorized'); return; }
  // JSON-RPC 가 아닌 JSON 으로 거절하는 창구 — OAuth 꼴 {error, error_description} · {message}.
  if (길 === 'authjson') { res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid_token', error_description: 'token expired' })); return; }
  if (길 === 'msgjson') { res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'rate limit exceeded' })); return; }
  // 다시 하는 인사가 느린 서버 — 그 사이에 다른 물음의 404 가 닿는다.
  if (길 === 'race' && j.method === 'initialize' && 기록.세션번호 > 0) await 잠깐(150);

  // 우리가 보낸 답(ping 의 답)과 알림은 202 로 받는다.
  if (j.method === undefined) { 기록.핑답 = j; res.writeHead(202).end(); return; }
  if (j.id == null) { res.writeHead(202).end(); return; }

  if (j.method === 'initialize') {
    const 세션 = `sess-${++기록.세션번호}`;
    살아있는세션.add(세션);
    const 능력 = 길 === 'resonly' ? { resources: {} } : { tools: {}, resources: {}, prompts: {} };
    제이슨(답({ protocolVersion: '2025-06-18', capabilities: 능력, serverInfo: { name: '웹스텁', version: '1.0' } }), { 'Mcp-Session-Id': 세션 });
    return;
  }
  const 세션 = req.headers['mcp-session-id'];
  if (!세션) { res.writeHead(400).end('no session'); return; }
  if (j.method === 'tools/call' && j.params?.name === 'late' && !살아있는세션.has(세션)) {
    // 이 물음의 404 는 다른 물음이 새 세션을 받아 온 **뒤에** 닿는다 (늦게 온 404).
    for (let i = 0; i < 120 && ![...살아있는세션].some((x) => x !== 세션); i++) await 잠깐(25);
    await 잠깐(150);
    res.writeHead(404).end('session gone');
    return;
  }
  if (!살아있는세션.has(세션)) { res.writeHead(404).end('session gone'); return; }
  if (길 === 'nullid' && j.method === 'tools/call') { 제이슨({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: 인자가 틀렸습니다' } }); return; }

  if (j.method === 'tools/list') {
    if (길 === 'resonly') { 제이슨({ jsonrpc: '2.0', id: j.id, error: { code: -32601, message: 'Method not found' } }); return; }
    제이슨(답({ tools: [
      { name: 'search', description: '찾기', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
      { name: 'slow', description: '안 끝남', inputSchema: { type: 'object' } },
    ] }));
    return;
  }
  if (j.method === 'tools/call' && j.params?.name === 'slow') { req.on('close', () => {}); return; }   // 영영 답 안 함
  if (j.method === 'tools/call') {
    const 결과 = 답({ content: [{ type: 'text', text: `찾은 것: ${j.params?.arguments?.q}` }] });
    if (길 !== 'sse') { 제이슨(결과); return; }
    // SSE — 주석 줄, 우리에게 묻는 ping, 그리고 CRLF 로 끝나는 답. 답은 우리가 ping 에 답한 뒤에 보낸다.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': 살아 있음\n\n');
    res.write(`id: 1\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' })}\n\n`);
    for (let i = 0; i < 40 && !기록.핑답; i++) await 잠깐(25);
    const 통 = JSON.stringify(결과);
    res.write(`event: message\r\ndata: ${통.slice(0, 10)}`);
    await 잠깐(20);
    res.write(`${통.slice(10)}\r`);
    await 잠깐(20);
    res.end('\n\r\n');
    return;
  }
  if (j.method === 'resources/list') {
    제이슨(답(j.params?.cursor === 'p2'
      ? { resources: [{ uri: 'docs://b', name: '둘째 문서' }] }
      : { resources: [{ uri: 'docs://a', name: '첫 문서', mimeType: 'text/markdown', description: '맨 앞' }], nextCursor: 'p2' }));
    return;
  }
  if (j.method === 'resources/templates/list') { 제이슨(답({ resourceTemplates: [{ uriTemplate: 'docs://{id}', name: '문서 번호로' }] })); return; }
  if (j.method === 'resources/read') {
    const uri = j.params?.uri;
    제이슨(답({ contents: uri === 'img://1'
      ? [{ uri, mimeType: 'image/png', blob: Buffer.from('그림바이트들'.repeat(10)).toString('base64') }]
      : [{ uri, mimeType: 'text/markdown', text: `# ${uri} 의 본문` }] }));
    return;
  }
  if (j.method === 'prompts/list') {
    제이슨(답({ prompts: [
      { name: 'review', description: '파일 검토', arguments: [{ name: 'file', required: true }, { name: 'focus' }] },
      { name: '빈칸 든 이름', description: '슬래시로 못 부른다' },
    ] }));
    return;
  }
  if (j.method === 'prompts/get') {
    const a = j.params?.arguments ?? {};
    제이슨(답({ messages: [{ role: 'user', content: { type: 'text', text: `${a.file} 을 검토하세요 — 볼 것: ${a.focus ?? '전부'}` } }] }));
    return;
  }
  제이슨({ jsonrpc: '2.0', id: j.id, error: { code: -32601, message: `모름 ${j.method}` } });
});
const 다른서버 = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); });
await new Promise((r) => 서버.listen(0, '127.0.0.1', r));
await new Promise((r) => 다른서버.listen(0, '127.0.0.1', r));
const 여기 = `http://127.0.0.1:${서버.address().port}`;
다른집 = `http://127.0.0.1:${다른서버.address().port}`;

const root = mkdtempSync(join(tmpdir(), 'deel-mcphttp-'));
mkdirSync(join(root, '.deel'), { recursive: true });
const 설정쓰기 = (표) => writeFileSync(join(root, '.deel', 'mcp.json'), JSON.stringify(표), 'utf8');
const 믿는env = { ...process.env, DEEL_TRUST_ALL: '1', DEEL_MCP_LAZY: 'off', DEEL_TEST_MCP_TOKEN: 'test-key-value' };
const 한대 = (길, 머리 = {}) => new MCP웹서버({ 이름: `웹-${길}`, 방식: 'http', url: `${여기}/${길}`, headers: 머리 });
const 답글 = (약속) => 약속.then((r) => r.text, (e) => `던짐 ${e.message}`);

trace('1-설정읽기');
{
  설정쓰기({ mcpServers: {
    가: { type: 'http', url: `${여기}/json`, headers: { Authorization: 'Bearer ${DEEL_TEST_MCP_TOKEN}', 'X-Team': '${DEEL_NO_SUCH_VAR:-default-team}' } },
    나: { url: `${여기}/json` },
    다: { type: 'sse', url: `${여기}/sse` },
    라: { url: 'https://x.example/sse' },
    마: { type: 'http', url: 'ftp://x.example/mcp' },
    바: { type: 'http', url: `${여기}/json`, headers: { Authorization: 'Bearer ${DEEL_REALLY_MISSING_XYZ}' } },
    사: { type: 'streamable-http', url: `${여기}/json` },
    아: { type: 'http', url: `${여기}/json`, headers: { 'X-팀이름': 'dev' } },
    자: { type: 'http', url: `${여기}/json`, headers: { 'X-Team': '개발팀' } },
  } });
  const s = 설정읽기(root, { env: 믿는env });
  const 찾기 = (n) => s.서버들.find((x) => x.이름 === n);
  const 왜 = (n) => (s.못받은것 ?? []).find((x) => x.이름 === n)?.왜 ?? '';
  check('★★★ type http 를 HTTP 서버로 받는다', 찾기('가')?.방식 === 'http' && 찾기('가')?.url === `${여기}/json`, JSON.stringify(찾기('가')));
  check('★★ headers 의 ${변수} 를 환경변수로 편다 (열쇠를 저장소에 안 적게)', 찾기('가')?.headers?.Authorization === 'Bearer test-key-value', JSON.stringify(찾기('가')?.headers));
  check('★ ${변수:-기본} 은 없으면 기본을 쓴다', 찾기('가')?.headers?.['X-Team'] === 'default-team', JSON.stringify(찾기('가')?.headers));
  check('★★ type 없이 url 만 적은 것도 HTTP 로 받는다 (다른 도구 설정을 붙여 넣은 꼴)', 찾기('나')?.방식 === 'http', JSON.stringify(s.서버들.map((x) => x.이름)));
  check('  streamable-http 라고 적어도 받는다', 찾기('사')?.방식 === 'http');
  check('★★ 옛 sse 규격은 안 받고 까닭을 말한다', !찾기('다') && /sse/.test(왜('다')), 왜('다'));
  check('★ type 없이 /sse 로 끝나는 주소는 옛 규격으로 보고 까닭을 말한다', !찾기('라') && /\/sse/.test(왜('라')), 왜('라'));
  check('★ http(s) 가 아닌 주소는 안 받는다', !찾기('마') && /http/.test(왜('마')), 왜('마'));
  check('★★ 없는 환경변수는 빈 글로 펴서 보내지 않고 까닭을 말한다', !찾기('바') && /DEEL_REALLY_MISSING_XYZ/.test(왜('바')), 왜('바'));
  check('★★ 머리말에 못 싣는 글자(한글 이름 · 한글 값)는 붙여 보기 전에 까닭을 말한다', !찾기('아') && !찾기('자') && /X-팀이름/.test(왜('아')) && /X-Team/.test(왜('자')),
    `${왜('아')} | ${왜('자')}`);
  check('  stdio 설정은 그대로다 (방식 없음)', 설정읽기(root, { env: 믿는env }).서버들.every((x) => x.방식 === 'http'));
}

trace('2-JSON');
{
  // 소문자로 적어도 규격 머리말을 못 덮는다 — 대소문자만 다른 두 머리말은 fetch 가 한 줄로 합친다.
  const s = 한대('json', { accept: 'text/html', 'X-Team': 'blue' });
  const 붙음 = await s.붙기({ timeout: 4000 });
  check('★★★ HTTP 서버에 붙어 도구 목록을 받는다', 붙음 && s.도구.some((t) => t.name === 'search'), String(s.죽음));
  check('★★ 인사로 받은 세션 번호를 들고 있다', /^sess-\d+$/.test(s.세션 ?? ''), String(s.세션));
  const 말 = await 답글(s.부르기('search', { q: '위키' }, { timeout: 4000 }));
  check('★★★ 도구를 불러 답을 받는다', 말 === '찾은 것: 위키', 말);
  const 마지막 = 기록.요청.filter((x) => x.method === 'tools/call').at(-1);
  check('★★ 세션 번호와 고른 규격 판을 머리말에 싣는다', 마지막?.머리['mcp-session-id'] === s.세션 && 마지막?.머리['mcp-protocol-version'] === '2025-06-18',
    JSON.stringify({ 세션: 마지막?.머리['mcp-session-id'], 판: 마지막?.머리['mcp-protocol-version'] }));
  check('★ 적어 둔 머리말이 규격 머리말(Accept)을 덮지 못한다', /text\/event-stream/.test(마지막?.머리.accept ?? '') && !/text\/html/.test(마지막?.머리.accept ?? ''),
    마지막?.머리.accept);
  check('  적어 둔 다른 머리말은 싣는다', 마지막?.머리['x-team'] === 'blue', 마지막?.머리['x-team']);
  const 인사 = 기록.요청.find((x) => x.method === 'initialize' && x.길 === 'json');
  check('  인사는 2025-11-25 로 청한다', 인사?.j.params?.protocolVersion === '2025-11-25', 인사?.j.params?.protocolVersion);
  check('★★ 인사 뒤 initialized 알림을 보낸다', 기록.요청.some((x) => x.method === 'notifications/initialized'));
  check('★★★ 요청이 끝나면 잠깐 연 문을 닫는다 (허용 목록에 안 남는다)', !allowed().includes(여기), allowed().join(','));
  check('★ 자료를 낸다고 한 서버에는 read_resource 를 붙인다', s.도구.some((t) => t.name === 자료도구이름));
  check('★ 프롬프트 목록을 받는다 — 빈칸 든 이름은 슬래시로 못 부르니 뺀다', s.프롬프트.length === 1 && s.프롬프트[0].name === 'review' && s.프롬프트[0].arguments[0].required === true,
    JSON.stringify(s.프롬프트));

  // 세션을 서버가 버리면 새로 인사하고 한 번만 다시 보낸다.
  const 옛세션 = s.세션;
  살아있는세션.clear();
  const 둘 = await 답글(s.부르기('search', { q: '다시' }, { timeout: 4000 }));
  check('★★★ 서버가 세션을 버려 404 를 주면 새로 인사하고 다시 보낸다', 둘 === '찾은 것: 다시' && s.세션 && s.세션 !== 옛세션, `${둘} · ${옛세션} → ${s.세션}`);

  // 한 물음이 멎어도 서버를 죽음 으로 적지 않는다.
  const 시작 = Date.now();
  const 멎음 = await 답글(s.부르기('slow', {}, { timeout: 700 }));
  check('★★ 답을 안 주는 물음은 시한에 끝난다', /초 안에 답이 없습니다/.test(멎음) && Date.now() - 시작 < 3000, `${멎음} · ${Date.now() - 시작}ms`);
  check('★★ 물음 하나가 멎어도 서버는 살아 있다 — 다음 물음은 된다', s.살아있나() && (await 답글(s.부르기('search', { q: '또' }, { timeout: 4000 }))) === '찾은 것: 또');
  const 끊개 = new AbortController();
  setTimeout(() => 끊개.abort(), 100);
  const 끊시작 = Date.now();
  const 끊음 = await 답글(s.부르기('slow', {}, { timeout: 5000, signal: 끊개.signal }));
  check('★★ ESC 가 도는 HTTP 물음을 곧장 끊는다', /중단했습니다/.test(끊음) && Date.now() - 끊시작 < 1500, `${끊음} · ${Date.now() - 끊시작}ms`);

  // 자료
  const 목록 = await 답글(s.부르기(자료도구이름, {}, { timeout: 4000 }));
  check('★★★ read_resource 를 uri 없이 부르면 자료 목록을 쪽을 따라 끝까지 준다', /docs:\/\/a — 첫 문서 \(text\/markdown\): 맨 앞/.test(목록) && /docs:\/\/b/.test(목록), 목록);
  check('★ 틀(templates)도 같이 적는다', /docs:\/\/\{id\}/.test(목록), 목록);
  const 본문 = await 답글(s.부르기(자료도구이름, { uri: 'docs://a' }, { timeout: 4000 }));
  check('★★★ uri 를 주면 그 자료의 글을 준다', 본문 === '# docs://a 의 본문', 본문);
  const 그림 = await 답글(s.부르기(자료도구이름, { uri: 'img://1' }, { timeout: 4000 }));
  check('★ 바이너리 자료는 싣지 않고 있다고만 말한다', /image\/png .*바이트 — 글이 아니라 싣지 않습니다/.test(그림) && !/[A-Za-z0-9+/]{40,}/.test(그림), 그림);
  check('★★ read_resource 는 읽기만 한다고 적혀 confirm 이 안 묻는다', 읽기만하나([s], `mcp__${s.이름}__${자료도구이름}`));
  check('  모델에게 mcp__<서버>__read_resource 로 보인다', 도구정의([s]).some((d) => d.function.name === `mcp__${s.이름}__${자료도구이름}`));

  // 프롬프트
  const 편것 = await MCP프롬프트펴기([s], `mcp__${s.이름}__review`, 'src/app.js 오류 처리와 이름');
  check('★★★ /mcp__<서버>__<프롬프트> 로 받은 글을 편다 — 마지막 인자가 나머지를 다 받는다', 편것?.text === 'src/app.js 을 검토하세요 — 볼 것: 오류 처리와 이름', JSON.stringify(편것));
  const 모자람 = await MCP프롬프트펴기([s], `mcp__${s.이름}__review`, '');
  check('★★ 꼭 필요한 인자가 빠지면 부르지 않고 무엇이 빠졌는지 말한다', /인자가 모자랍니다.*file/.test(모자람?.탈 ?? ''), JSON.stringify(모자람));
  check('  없는 프롬프트는 null — 여느 슬래시 명령 찾기로 넘어간다', (await MCP프롬프트펴기([s], `mcp__${s.이름}__없음`, '')) === null);
  // 인자 가르기 (2차 눈) — 받은 인자를 그대로 글로 돌려주는 가짜 서버로 잰다.
  const 가짜 = {
    이름: '가짜', 쓸수있나: () => true, 프롬프트받기: async (_n, a) => JSON.stringify(a),
    프롬프트: [{ name: 'p', arguments: [{ name: 'file', required: true }, { name: 'focus' }] }, { name: 'q', arguments: [{ name: 'constructor', required: true }] }],
  };
  const 받은인자 = async (글) => { const r = await MCP프롬프트펴기([가짜], 'mcp__가짜__p', 글); try { return JSON.parse(r?.text); } catch { return r; } };
  const 묶음 = await 받은인자('"src/my app.js" 오류 처리');
  check('★★ 따옴표로 묶은 인자는 빈칸이 있어도 한 인자다', 묶음?.file === 'src/my app.js' && 묶음.focus === '오류 처리', JSON.stringify(묶음));
  const 여러줄 = await 받은인자('a.js 첫줄\n    둘째줄');
  check('★★ 마지막 인자는 남은 글을 그대로 받는다 — 줄바꿈 · 들여쓰기가 산다', 여러줄?.focus === '첫줄\n    둘째줄', JSON.stringify(여러줄));
  const 끝묶음 = await 받은인자("a.js '오류 처리'");
  check('  마지막 인자가 통째로 따옴표면 따옴표만 벗긴다', 끝묶음?.focus === '오류 처리', JSON.stringify(끝묶음));
  const 원형이름 = await MCP프롬프트펴기([가짜], 'mcp__가짜__q', '');
  check('★ 꼭 필요한 인자 이름이 constructor 여도 빠졌다고 말한다 (Object 원형에 속지 않는다)', /빠진 것: constructor/.test(원형이름?.탈 ?? ''), JSON.stringify(원형이름));

  // 도는 물음이 있는데 닫으면(끝날 때 · /mcp 끄기) 그 물음도 곧장 끝난다 — 시한까지 붙들지 않는다.
  const 닫을것 = 한대('json');
  await 닫을것.붙기({ timeout: 4000 });
  const 닫시작 = Date.now();
  setTimeout(() => 닫을것.닫기(), 100);
  const 닫힘 = await 답글(닫을것.부르기('slow', {}, { timeout: 5000 }));
  check('★★ 닫으면 도는 HTTP 물음도 곧장 끝난다', /닫았습니다/.test(닫힘) && Date.now() - 닫시작 < 1500, `${닫힘} · ${Date.now() - 닫시작}ms`);

  const 끝낼세션 = s.세션;
  s.닫기();
  for (let i = 0; i < 40 && !기록.지움.includes(끝낼세션); i++) await 잠깐(25);
  check('★★ 닫으면 세션을 끝낸다고 알린다 (DELETE)', !!끝낼세션 && 기록.지움.includes(끝낼세션), `${끝낼세션} · ${JSON.stringify(기록.지움)}`);
  check('  닫은 서버는 되살리지 않는다', !s.쓸수있나());
}

trace('3-SSE');
{
  const s = 한대('sse');
  await s.붙기({ timeout: 4000 });
  기록.핑답 = null;
  const 말 = await 답글(s.부르기('search', { q: '흐름' }, { timeout: 4000 }));
  check('★★★ SSE 로 오는 답을 받는다 (주석 줄 · 조각 · CRLF 를 넘어)', 말 === '찾은 것: 흐름', 말);
  check('★★ 흐름 도중 서버가 물은 ping 에 POST 로 답한다', 기록.핑답?.id === 'srv-1' && 기록.핑답?.result && typeof 기록.핑답.result === 'object', JSON.stringify(기록.핑답));
  s.닫기();

  const 가름 = SSE가르기('data: 가\r\n\r\ndata: 나\ndata: 다\n\n: 주석\n\nevent: x\ndata: 반');
  check('★ SSE 가르기 — 줄 끝 셋을 다 받고 여러 data 줄은 \\n 으로 잇는다', JSON.stringify(가름.사건들) === JSON.stringify(['가', '나\n다']) && 가름.남은것.endsWith('data: 반'), JSON.stringify(가름));
  const 끊긴 = SSE가르기('data: 가\r');
  check('★ 조각이 \\r 에서 끊기면 사건을 내지 않고 붙들어 둔다', 끊긴.사건들.length === 0 && 끊긴.남은것.endsWith('\r'), JSON.stringify(끊긴));
  const 씨알 = SSE가르기('data: 가\r\r');
  const 씨알둘 = SSE가르기('data: 나\r\n\r');
  check('★ 줄 끝 뒤에 \\r 이 오면 빈 줄이 선 것이다 — 뒤가 \\n 이든 아니든 사건을 낸다 (\\r 만 쓰는 서버)',
    JSON.stringify(씨알.사건들) === '["가"]' && JSON.stringify(씨알둘.사건들) === '["나"]', JSON.stringify([씨알, 씨알둘]));
}

trace('3b-재인사경합');
{
  const s = 한대('race');
  await s.붙기({ timeout: 4000 });
  const 인사수 = () => 기록.요청.filter((x) => x.길 === 'race' && x.method === 'initialize').length;
  const 앞 = 인사수();
  살아있는세션.clear();
  const [가, 나] = await Promise.all([답글(s.부르기('search', { q: '가' }, { timeout: 4000 })), 답글(s.부르기('search', { q: '나' }, { timeout: 4000 }))]);
  check('★★★ 세션이 끝난 줄 모르고 같이 나간 물음들이 모두 다시 인사한 세션으로 답을 받는다 — 인사 중에 닿은 404 도', 가 === '찾은 것: 가' && 나 === '찾은 것: 나', `${가} | ${나}`);
  check('★★ 그때 인사는 한 번이다', 인사수() - 앞 === 1, `${인사수() - 앞}번`);
  const 둘째앞 = 인사수();
  살아있는세션.clear();
  const [다, 라] = await Promise.all([답글(s.부르기('search', { q: '다' }, { timeout: 4000 })), 답글(s.부르기('late', { q: '라' }, { timeout: 8000 }))]);
  check('★★ 새 세션을 받은 뒤에 늦게 온 404 는 또 인사하지 않는다 — 받아 온 세션을 버리지 않는다',
    인사수() - 둘째앞 === 1 && 다 === '찾은 것: 다' && 라 === '찾은 것: 라', `${인사수() - 둘째앞}번 · ${다} | ${라}`);
  // 다시 인사하는 도중에 새로 나가는 물음 — 세션 없이 나가면 서버가 거절한다. 인사가 끝나기를 기다린다.
  살아있는세션.clear();
  const 먼저 = 답글(s.부르기('search', { q: '마' }, { timeout: 4000 }));
  for (let i = 0; i < 80 && !s.다시인사중; i++) await 잠깐(5);
  const 도중 = await 답글(s.부르기('search', { q: '바' }, { timeout: 4000 }));
  check('★★ 다시 인사하는 도중에 나간 물음도 새 세션으로 답을 받는다', 도중 === '찾은 것: 바' && (await 먼저) === '찾은 것: 마', `${도중}`);
  const 앞수 = 기록.요청.length;
  s.닫기();
  await s.알림('notifications/test', {});
  s.물음에답({ jsonrpc: '2.0', id: 'srv-9', method: 'ping' });
  await 잠깐(100);
  check('★ 닫은 뒤에는 알림 · 답도 안 보낸다 — 새 연결을 열지 않는다', 기록.요청.length === 앞수, `${기록.요청.length - 앞수}개 더 나감`);
}

trace('4-탈');
{
  const 없음 = 한대('legacy404');
  check('★★ 인사에 404 면 MCP 창구가 아니거나 옛 규격일 수 있다고 말한다', !(await 없음.붙기({ timeout: 3000 })) && /HTTP 404.*옛 HTTP\+SSE/.test(없음.죽음 ?? ''), 없음.죽음);
  없음.닫기();
  const 새것 = 한대('modern');
  check('★★ 새 규격만 받는 서버는 받는 규격을 그대로 보여 준다', !(await 새것.붙기({ timeout: 3000 })) && /2026-07-28/.test(새것.죽음 ?? ''), 새것.죽음);
  새것.닫기();
  const 열쇠없음 = 한대('auth');
  check('★★ 401 이면 열쇠(headers)를 보라고 말한다', !(await 열쇠없음.붙기({ timeout: 3000 })) && /HTTP 401.*headers/.test(열쇠없음.죽음 ?? ''), 열쇠없음.죽음);
  열쇠없음.닫기();
  const 제이슨거절 = 한대('authjson');
  check('★ JSON-RPC 가 아닌 JSON 거절(OAuth 꼴)도 까닭을 옮긴다', !(await 제이슨거절.붙기({ timeout: 3000 })) && /HTTP 401.*invalid_token.*token expired/.test(제이슨거절.죽음 ?? ''), 제이슨거절.죽음);
  제이슨거절.닫기();
  const 말거절 = 한대('msgjson');
  check('  {message} 로 거절해도 그 말을 옮긴다', !(await 말거절.붙기({ timeout: 3000 })) && /HTTP 429.*rate limit exceeded/.test(말거절.죽음 ?? ''), 말거절.죽음);
  말거절.닫기();
  const 번호없음 = 한대('nullid');
  await 번호없음.붙기({ timeout: 3000 });
  const 번호없는답 = await 답글(번호없음.부르기('search', { q: 'x' }, { timeout: 3000 }));
  check('★ 번호 없는(id: null) 오류 답은 서버가 한 말을 그대로 옮긴다 — 「번호가 없다」 로 덮지 않는다', /Invalid Request: 인자가 틀렸습니다/.test(번호없는답), 번호없는답);
  번호없음.닫기();
  const 열쇠 = 한대('auth', { Authorization: 'Bearer test-key-value' });
  check('  열쇠를 실으면 붙는다', await 열쇠.붙기({ timeout: 3000 }), String(열쇠.죽음));
  열쇠.닫기();
  const 되돌림 = 한대('redirect');
  const 전 = 기록.요청.length;
  check('★★★ 다른 집으로 되돌리면 따라가지 않는다 (열쇠 머리말이 실린 물음)', !(await 되돌림.붙기({ timeout: 3000 })) && /되돌립니다/.test(되돌림.죽음 ?? ''), 되돌림.죽음);
  check('  허용 목록에 딴 집이 안 남는다', !allowed().includes(다른집) && !allowed().includes(여기), `${allowed().join(',')} · 요청 ${기록.요청.length - 전}`);
  되돌림.닫기();
  const 자료만 = 한대('resonly');
  check('★ 도구 없이 자료만 내는 서버도 붙는다 (tools/list 를 몰라도)', await 자료만.붙기({ timeout: 3000 }) && 자료만.도구.length === 1 && 자료만.도구[0].name === 자료도구이름,
    `${자료만.죽음} · ${JSON.stringify(자료만.도구.map((t) => t.name))}`);
  자료만.닫기();
}

trace('5-자물쇠');
{
  설정쓰기({ mcpServers: {
    안쪽: { type: 'http', url: `${여기}/json` },
    바깥: { type: 'http', url: 'https://mcp.example.com/mcp' },
    띄울것: { command: process.execPath, args: ['-e', '0'] },
  } });
  setOffline(true);
  const r = await 다붙이기(root, { offline: true, env: 믿는env, timeout: 4000 });
  const 왜 = (n) => (r.못한것 ?? []).find((x) => x.이름 === n)?.왜 ?? '';
  check('★★★ 오프라인 잠금에도 이 컴퓨터 안의 HTTP 서버는 붙는다 (문지기가 막을 수 있는 길)', r.서버들.some((s) => s.이름 === '안쪽'), JSON.stringify(r.못한것));
  check('★★★ 오프라인 잠금이면 바깥 HTTP 서버에는 안 붙고 까닭을 말한다', !r.서버들.some((s) => s.이름 === '바깥') && /오프라인.*mcp\.example\.com/.test(왜('바깥')), 왜('바깥'));
  check('★★ 띄우는 서버(stdio)는 여전히 안 띄운다', !r.서버들.some((s) => s.이름 === '띄울것') && /오프라인/.test(왜('띄울것')), 왜('띄울것'));
  check('  잠김 이 선다', r.잠김 === true);
  모두닫기();
  // 붙이는 자리를 건너뛰고 곧장 붙어도 문지기가 막는다 — 막는 것은 목록이 아니라 나가는 문이다.
  const 곧장 = new MCP웹서버({ 이름: '곧장', 방식: 'http', url: 'https://mcp.example.com/mcp', headers: {} });
  check('★★★ 오프라인이면 바깥 주소로는 요청 자체가 안 나간다 (나가는 문의 문지기)', !(await 곧장.붙기({ timeout: 3000 })) && /오프라인/.test(곧장.죽음 ?? ''), 곧장.죽음);
  곧장.닫기();
  setOffline(false);
}

trace('6-지연로딩');
{
  설정쓰기({ mcpServers: { 위키: { type: 'http', url: `${여기}/json` } } });
  const 게으른env = { ...믿는env, DEEL_MCP_LAZY: '' };
  const 첫 = await 다붙이기(root, { env: 게으른env, timeout: 4000 });
  check('준비: 처음엔 붙어서 적어 둔다', 첫.서버들[0] instanceof MCP웹서버 && !첫.서버들[0].대기 && !!메모읽기(root).위키, JSON.stringify(첫.못한것));
  모두닫기();
  const 요청전 = 기록.요청.length;
  const 둘 = await 다붙이기(root, { env: 게으른env, timeout: 4000 });
  const s = 둘.서버들[0];
  check('★★ 다음 판에는 적어 둔 목록으로 서고 요청을 안 보낸다', s instanceof MCP웹서버 && s.대기 && 기록.요청.length === 요청전, `${s?.대기} · 요청 ${기록.요청.length - 요청전}`);
  check('★ 대기 중에도 프롬프트를 안다 (슬래시 명령이 선다)', s.프롬프트.some((p) => p.name === 'review'), JSON.stringify(s.프롬프트));
  const 말 = await 답글(s.부르기('search', { q: '깨움' }, { timeout: 4000 }));
  check('★★★ 대기 중이던 HTTP 서버를 부르는 순간 붙어 답한다', 말 === '찾은 것: 깨움' && s.살아있나(), 말);
  const 편것 = await MCP프롬프트펴기(둘.서버들, 'mcp__위키__review', 'README.md');
  check('  프롬프트도 부를 수 있다', /README\.md 을 검토하세요/.test(편것?.text ?? ''), JSON.stringify(편것));
  // 대화 화면에서 치는 그대로 — commands.js 의 handle 이 슬래시 이름을 받아 프롬프트 글을 모델 몫으로 넘긴다.
  const { handle } = await import('../src/commands.js');
  const 적힌것 = [];
  const 화면 = await handle('/mcp__위키__review docs/설계.md', { mcp: 둘.서버들, commands: [], root }, { audit: { write: (k, d) => 적힌것.push({ k, d }) } });
  check('★★★ 대화 화면에서 /mcp__<서버>__<프롬프트> 를 치면 받은 글이 모델에게 간다', 화면?.handled === false && /docs\/설계\.md 을 검토하세요/.test(화면?.text ?? ''),
    JSON.stringify(화면).slice(0, 160));
  check('  무엇을 불렀는지 감사기록에 남긴다', 적힌것.some((x) => x.k === 'mcp' && x.d?.프롬프트 === 'review'), JSON.stringify(적힌것));

  // 도구로 부르는 길(tools/index.js 의 runMcpTool) — 모델이 부르는 그대로.
  const ctx = { mcp: 둘.서버들, audit: { tool() {} }, 모델컨텍스트: 8192 };
  const 결과 = await runTool(`mcp__위키__${자료도구이름}`, { uri: 'docs://b' }, ctx);
  check('★★ 모델이 부른 read_resource 가 자료의 글을 받는다', /docs:\/\/b 의 본문/.test(String(결과.content ?? '')) && !결과.error, JSON.stringify(결과).slice(0, 200));
  모두닫기();
}

check('  감사·화면용 주소는 이름·비밀번호·물음표 뒤를 뗀다', 적을주소('https://나:비번@mcp.example.com/mcp?key=abc') === 'https://mcp.example.com/mcp', 적을주소('https://나:비번@mcp.example.com/mcp?key=abc'));

모두닫기();
resetNet();
서버.closeAllConnections?.();
다른서버.closeAllConnections?.();
await new Promise((r) => 서버.close(r));
await new Promise((r) => 다른서버.close(r));
try { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch { /* 그만 */ }
try { rmSync(집, { recursive: true, force: true, maxRetries: 3 }); } catch { /* 그만 */ }

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\nHTTP 로 붙는 MCP · 자료 · 프롬프트  ${D}(나가는 문 하나로)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
