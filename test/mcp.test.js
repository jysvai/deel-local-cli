// 밖에서 붙인 도구(MCP) 검사.
//
// 흉내로는 규격 실수를 못 잡는다. 진짜 자식 프로세스를 띄워서, 진짜
// 줄 단위 JSON-RPC 를 주고받는다. 스텁 서버도 여기서 같이 만든다.
//
// 무엇을 확인하나:
//   1) 규격대로 붙고 도구를 받아오는가
//   2) 서버가 죽거나·답이 없거나·헛소리를 해도 **우리가 안 죽는가**
//      — 남의 프로그램이라 언제든 그럴 수 있다
//   3) 자물쇠(--offline)일 때 아예 안 띄우는가
//      — 자식 프로세스가 어디로 나가는지 우리는 못 막는다
//   4) 우리 환경변수(게이트웨이 열쇠)를 안 넘기는가
//   5) 도구가 우리 것과 안 섞이는가
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  설정읽기, 다붙이기, 이름풀기, 도구정의, 도구최대, 살아있는수, 모두닫기, 깨끗한환경,
  메모자리, 메모읽기, 메모쓰기, 메모유효, 지문, 쓸만한메모, MCP서버, 띄울모양, 되살리기최대 } from '../src/backend/mcp.js';
import { 거둘것에있나 } from '../src/reap.js';
import { VERSION } from '../src/version.js';
import { toolSchemas, runTool } from '../src/tools/index.js';
import { Audit } from '../src/safety/audit.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-mcp-'));
const 여기 = dirname(fileURLToPath(import.meta.url));
/*
 * 이 검사 폴더는 **믿는 폴더로 친다.**
 *
 * 다붙이기() 는 이제 믿는 폴더에서만 서버를 띄운다 — 남의 저장소에 딸려 온
 * mcp.json 으로 남의 프로그램이 돌면 안 되기 때문이다(backend/mcp.js).
 * 임시 폴더는 당연히 안 믿는 폴더라, 여기서는 그 문을 명시적으로 연다.
 *
 * 사용자의 진짜 trusted.json 은 안 건드린다 — 파일에 적는 대신 이 환경변수
 * 하나로만 연다. 안 믿을 때 어떻게 되는지는 따로 아래에서 잰다.
 */
const 믿는env = { ...process.env, DEEL_TRUST_ALL: '1' };
mkdirSync(join(root, '.deel'), { recursive: true });

trace('1-스텁서버만들기');

/*
 * 스텁 MCP 서버.
 *
 * 규격은 줄 하나에 JSON-RPC 통 하나가 전부다. 그래서 이만큼이면 진짜다.
 * 모드를 인자로 받아 못된 서버 흉내도 낸다.
 */
const 서버본문 = `
import { writeFileSync as 적기 } from 'node:fs';
const 모드 = process.argv[2] ?? 'normal';
const 인사자리 = process.argv[3] ?? null;
// 아무 답도 안 하고 살아만 있는 서버. 여기서 return 해야 진짜로 벙어리가 된다 —
// 아래 stdin 처리까지 흘러가면 멀쩡히 답해 버린다.
if (모드 === 'silent') { setInterval(() => {}, 1000); }
else if (모드 === 'crash') { process.exit(3); }                 // 뜨자마자 죽음
else if (모드 === 'sticky') { setInterval(() => {}, 1000); }     // 입력이 닫혀도 안 죽음 (2.0.2 · M3)
else if (모드 === 'garbage') { process.stdout.write('이건 JSON 이 아닙니다\\n'); }
if (모드 !== 'silent') 듣기();
let 핑번호 = null;
let 인사끝 = false;
function 듣기() {
let 찌꺼기 = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  찌꺼기 += d;
  let i;
  while ((i = 찌꺼기.indexOf('\\n')) >= 0) {
    const 줄 = 찌꺼기.slice(0, i); 찌꺼기 = 찌꺼기.slice(i + 1);
    if (!줄.trim()) continue;
    let j; try { j = JSON.parse(줄); } catch { continue; }
    if (j.method === 'initialize') {
      // 우리가 무엇이라고 인사했는지 적어 둔다. 검사가 그걸 읽는다.
      if (인사자리) { try { 적기(인사자리, JSON.stringify(j.params)); } catch {} }
      const 인사답 = () => {
        답(j.id, {
          protocolVersion: '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: '스텁MCP', version: '9.9.9' },
        });
        인사끝 = true;
      };
      // 인사에 늦게 답하는 서버 (6회차 MB1). 그사이 온 tools/call 은 규격 위반이라 그렇다고 답한다.
      if (모드 === 'slowinit') setTimeout(인사답, 700); else 인사답();
    }
    // 우리가 서버의 물음(ping)에 준 답. 기다리던 것이면 그제야 진짜 답을 준다 (collide).
    else if (!j.method && j.id != null) {
      if (모드 === 'collide' && j.id === 핑번호 && j.result) 답(핑번호, { content: [{ type: 'text', text: '진짜 답 · 핑답받음' }] });
    }
    else if (j.method === 'tools/list' && 모드 === 'paged') {
      // 두 쪽으로 나눠 준다. 뒷쪽을 안 따라가면 둘쪽도구 가 조용히 빠진다.
      if (!j.params?.cursor) 답(j.id, { tools: [{ name: '첫쪽도구', inputSchema: { type: 'object' } }], nextCursor: '둘째쪽' });
      else 답(j.id, { tools: [{ name: '둘쪽도구', inputSchema: { type: 'object' } }] });
    }
    else if (j.method === 'tools/list' && 모드 === 'pagedstall') {
      // 첫 쪽은 주고 **뒷쪽은 영영 안 준다.** 쪽을 넘기다 시한이 지나는 서버다.
      if (!j.params?.cursor) 답(j.id, { tools: [{ name: '첫쪽도구', inputSchema: { type: 'object' } }], nextCursor: '둘째쪽' });
    }
    else if (j.method === 'tools/call' && 모드 === 'flood') {
      // 줄바꿈 없이 끝없이 쏟는다.
      const 덩이 = 'x'.repeat(1 << 20);
      const 쏟기 = () => { while (process.stdout.write(덩이)); process.stdout.once('drain', 쏟기); };
      쏟기();
    }
    else if (j.method === 'tools/call' && 모드 === 'collide') {
      // 서버 쪽 번호는 서버가 따로 센다 — 우리 물음과 **같은 번호로** ping 을 묻는다.
      핑번호 = j.id;
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: j.id, method: 'ping' }) + '\\n');
    }
    else if (j.method === 'tools/list') {
      const 몇개 = 모드 === 'many' ? 40 : 2;
      const tools = [];
      for (let n = 0; n < 몇개; n++) tools.push({
        name: 몇개 === 2 ? ['위키검색', '이슈보기'][n] : 'tool' + n,
        description: '스텁 도구 ' + n,
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      });
      답(j.id, { tools });
    }
    else if (j.method === 'tools/call') {
      if (모드 === 'slowinit' && !인사끝) 답(j.id, { content: [{ type: 'text', text: '인사 전에 부름' }] });
      else if (j.params.name === '이슈보기') 답(j.id, { content: [{ type: 'text', text: '그런 이슈 없음' }], isError: true });
      else if (j.params.name === '자원보기') 답(j.id, { content: [{ type: 'resource', resource: { uri: 'file:///x.txt', mimeType: 'text/plain', text: '박힌 자원 본문' } }] });
      else if (j.params.name === '구조만') 답(j.id, { content: [], structuredContent: { answer: 42 } });
      else if (j.params.name === '환경보기') 답(j.id, { content: [{ type: 'text', text: JSON.stringify(process.env) }] });
      else 답(j.id, { content: [{ type: 'text', text: '찾은 것: ' + (j.params.arguments?.q ?? '') + '\\n두 번째 줄' }] });
    }
    else if (j.id != null) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { code: -32601, message: '모르는 메서드' } }) + '\\n');
  }
});
}
function 답(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
`;
const 서버파일 = join(root, 'stub-mcp.mjs');
writeFileSync(서버파일, 서버본문, 'utf8');

const 설정쓰기 = (표) => writeFileSync(join(root, '.deel', 'mcp.json'), JSON.stringify(표, null, 2), 'utf8');
const 인사파일 = join(root, '인사.json');
const 서버설정 = (모드 = 'normal') => ({ command: process.execPath, args: [서버파일, 모드, 인사파일] });

trace('2-설정읽기');

{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const s = 설정읽기(root);
  check('설정을 읽는다', s.서버들.length === 1 && s.서버들[0].이름 === '사내위키', JSON.stringify(s.서버들.map((x) => x.이름)));

  // Claude Code 설정을 그대로 복사해 붙일 수 있어야 한다.
  설정쓰기({ mcpServers: { a: 서버설정(), b: { ...서버설정(), disabled: true }, c: { type: 'sse', url: 'https://x' } } });
  const s2 = 설정읽기(root);
  check('disabled 는 안 띄운다', !s2.서버들.some((x) => x.이름 === 'b'), s2.서버들.map((x) => x.이름).join(','));
  // http/sse 는 바깥으로 나가는 것이라 자물쇠와 부딪힌다. stdio 만 받는다.
  check('stdio 아닌 규격은 안 받는다', !s2.서버들.some((x) => x.이름 === 'c'), s2.서버들.map((x) => x.이름).join(','));

  /*
   * ── 안 받은 것을 **말해 주나** ─────────────────────────────────────────
   *
   * 여기서 그냥 버리고 있었다. 그러면 적어 둔 서버가 화면 어디에도 안 나온다 —
   * 켤 때 뜨는 줄도 `/mcp` 목록도 붙은 것만 세우니, 사람 쪽에서는 **목록이
   * 완전해 보인다.** 이 파일이 제일 흔하게 받는 것이 다른 도구 설정을 그대로
   * 붙여넣은 것이고 거기에는 sse·url 항목이 섞여 있다 (34차 리뷰).
   */
  const 못받은 = s2.못받은것 ?? [];
  check('★★ stdio 가 아니면 안 받았다고 말해 준다', 못받은.some((x) => x.이름 === 'c'),
    JSON.stringify(못받은));
  check('★ 왜 안 받았는지도 적는다', /sse|stdio/.test(못받은.find((x) => x.이름 === 'c')?.왜 ?? ''),
    못받은.find((x) => x.이름 === 'c')?.왜 ?? '');
  // 사람이 스스로 끈 것은 알려 줄 것이 없다 — 군말이 되면 진짜 경고가 묻힌다.
  check('★★ disabled 는 안 받았다고 안 한다', !못받은.some((x) => x.이름 === 'b'),
    JSON.stringify(못받은));

  설정쓰기({ mcpServers: { u: { url: 'https://x/sse' }, v: { args: ['x'] } } });
  const s3 = 설정읽기(root);
  check('★ url 만 적은 것도 말해 준다', /url/.test((s3.못받은것 ?? []).find((x) => x.이름 === 'u')?.왜 ?? ''),
    JSON.stringify(s3.못받은것));
  check('★ command 가 없으면 그렇게 말한다', /command/.test((s3.못받은것 ?? []).find((x) => x.이름 === 'v')?.왜 ?? ''),
    JSON.stringify(s3.못받은것));

  /*
   * 붙이는 자리까지 그대로 실려 오나 — 여기서 끊기면 화면에는 여전히 안 뜬다.
   *
   * **믿는 폴더로** 돌려야 한다. 안 믿는 폴더는 그 자리에서 따로 돌아가고,
   * 그 길도 안 받은 것을 같이 싣기 때문에 **정작 재려던 줄을 안 지난다** —
   * 어긋내기가 그것을 잡아 줬다(줄을 지워도 초록이었다).
   */
  설정쓰기({ mcpServers: { 사내위키: 서버설정(), 원격: { type: 'sse', url: 'https://x' } } });
  const 붙임 = await 다붙이기(root, {
    timeout: 2500,
    // 지연 로딩은 끈다 — 여기서 메모를 적어 두면 뒤에 오는 검사들이 대기
    // 중인 서버를 받게 되고, 그건 이 검사가 재려던 것과 아무 상관이 없다.
    env: { ...process.env, DEEL_TRUST_ALL: '1', DEEL_MCP_LAZY: 'off' },
  });
  check('★★ 못 받은 것이 다붙이기 의 못한것 으로 온다',
    붙임.못한것.some((x) => x.이름 === '원격'), JSON.stringify(붙임.못한것));
  check('★ 멀쩡한 서버는 그대로 붙는다', 붙임.서버들.some((s) => s.이름 === '사내위키'),
    붙임.서버들.map((s) => s.이름).join(','));
  모두닫기();

  /*
   * ★★ 앞에 BOM 이 붙은 설정도 읽는다.
   *
   * 윈도우 파워셸 5.1 의 `Set-Content -Encoding UTF8` 은 파일 앞에 U+FEFF 를 붙인다.
   * JSON.parse 는 그 한 글자에서 넘어지고, 그러면 적어 둔 서버가 **통째로** 안 뜬다 —
   * 화면에는 「mcp.json 을 못 읽었습니다」 한 줄뿐이라 사람은 멀쩡한 JSON 을 뒤진다.
   * 설정·훅·정책은 이미 떼고 있었고(safety/trust.js 의 BOM떼기) 여기만 빠져 있었다.
   */
  const BOM = String.fromCharCode(0xfeff);
  writeFileSync(join(root, '.deel', 'mcp.json'), BOM + JSON.stringify({ mcpServers: { 사내위키: 서버설정() } }), 'utf8');
  const BOM설정 = 설정읽기(root);
  check('★★ BOM 이 붙은 mcp.json 도 읽는다', !BOM설정.오류 && BOM설정.서버들[0]?.이름 === '사내위키',
    BOM설정.오류 ?? JSON.stringify(BOM설정.서버들.map((x) => x.이름)));

  writeFileSync(join(root, '.deel', 'mcp.json'), '{ 깨진 JSON', 'utf8');
  check('깨진 설정은 이유를 말한다', !!설정읽기(root).오류, 설정읽기(root).오류 ?? '');
  check('깨진 설정이어도 안 터진다', 설정읽기(root).서버들.length === 0);

  /*
   * ── ★★ (6회차 Gemini 엠씨피 M5) JSON 으로는 멀쩡한데 표가 아닌 설정 ──────────────
   *
   * `null` 은 JSON.parse 를 지나 `null.mcpServers` 에서 TypeError 로 던졌다 — 설정읽기 를 부르는
   * 자리가 통째로 넘어진다. `"mcpServers": [ … ]` 는 배열 번호 `0` 이 서버 이름이 됐다.
   * 둘 다 「못 읽었습니다」 로 까닭을 말한다. 빈 표 `{}` 는 여태처럼 「서버 없음」 이다.
   */
  for (const [이름, 글] of [['null', 'null'], ['맨 배열', '[1]'], ['mcpServers 배열', '{"mcpServers":[{"command":"x"}]}'], ['mcpServers 글자', '{"mcpServers":"abc"}']]) {
    writeFileSync(join(root, '.deel', 'mcp.json'), 글, 'utf8');
    let 읽음 = null; let 던짐 = null;
    try { 읽음 = 설정읽기(root); } catch (e) { 던짐 = e; }
    check(`★★ (6회차 M5) mcp.json 이 ${이름} 이어도 안 터지고 까닭을 말한다`,
      !던짐 && !!읽음?.오류 && 읽음.서버들.length === 0,
      String(던짐?.message ?? 읽음?.오류 ?? JSON.stringify(읽음?.서버들?.map((x) => x.이름))));
  }
  writeFileSync(join(root, '.deel', 'mcp.json'), '{}', 'utf8');
  check('★ (6회차 M5) 빈 표 {} 는 오류 없이 서버 0개다', !설정읽기(root).오류 && 설정읽기(root).서버들.length === 0, 설정읽기(root).오류 ?? '');

  rmSync(join(root, '.deel', 'mcp.json'));
  check('설정이 없으면 없다고 한다', 설정읽기(root).있음 === false);
}

trace('3-붙기');

{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const r = await 다붙이기(root, { audit: new Audit(root), env: 믿는env });
  check('서버가 붙는다', r.서버들.length === 1, JSON.stringify(r.못한것));
  const s = r.서버들[0];
  check('서버 정보를 받아온다', s.정보?.name === '스텁MCP', JSON.stringify(s.정보));
  check('도구 목록을 받아온다', s.도구.length === 2, String(s.도구.length));
  check('살아 있다고 안다', s.살아있나() === true);

  // 이름이 우리 도구와 안 섞여야 한다.
  const 정의 = 도구정의(r.서버들);
  check('이름 앞에 서버를 붙인다', 정의[0].function.name === 'mcp__사내위키__위키검색', 정의[0].function.name);
  check('붙인 이름을 도로 풀 수 있다',
    이름풀기('mcp__사내위키__위키검색')?.도구 === '위키검색', JSON.stringify(이름풀기('mcp__사내위키__위키검색')));
  check('우리 도구 이름은 안 풀린다', 이름풀기('Read') === null);
  check('설명에 어느 서버인지 적는다', /^\[사내위키\]/.test(정의[0].function.description), 정의[0].function.description);
  check('인자 스키마를 그대로 넘긴다', 정의[0].function.parameters?.properties?.q?.type === 'string');

  // 실제로 불러 본다.
  const ctx = { scope: makeScope(root), audit: new Audit(root), mcp: r.서버들, seen: new Set() };
  const 결과 = await runTool('mcp__사내위키__위키검색', { q: '인코딩' }, ctx);
  check('도구를 부르면 답이 온다', /찾은 것: 인코딩/.test(결과.content ?? ''), JSON.stringify(결과));
  check('몇 줄인지 요약해 준다', /2줄/.test(결과.summary ?? ''), 결과.summary);

  // 도구가 오류를 내도 우리가 안 죽어야 한다 — 오류를 결과로 돌려준다.
  const 오류 = await runTool('mcp__사내위키__이슈보기', { q: 'x' }, ctx);
  check('도구 오류는 결과로 돌려준다', /그런 이슈 없음/.test(오류.error ?? ''), JSON.stringify(오류));

  check('없는 서버를 부르면 말해 준다',
    /붙어 있지 않습니다/.test((await runTool('mcp__없는서버__x', {}, ctx)).error ?? ''), '');

  // 감사기록에 남아야 한다. 남의 프로그램이 무엇을 했는지가 반입 심사의 핵심이다.
  const { readFileSync, existsSync } = await import('node:fs');
  const 기록 = join(root, '.deel', 'audit.jsonl');
  check('MCP 호출이 감사기록에 남는다',
    existsSync(기록) && /mcp__사내위키__위키검색/.test(readFileSync(기록, 'utf8')), '');

  for (const x of r.서버들) x.닫기();
  check('닫으면 죽었다고 안다', s.살아있나() === false);
}

trace('4-못된서버');

// ── 남의 프로그램은 언제든 이상하게 군다 ────────────────────────────────
//
// 여기가 이 파일에서 제일 중요한 자리다. 서버 하나가 이상하다고 deel 이
// 멈추거나 죽으면, 붙일 수가 없는 기능이 된다.
{
  설정쓰기({ mcpServers: { 죽는놈: 서버설정('crash'), 멀쩡이: 서버설정() } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  check('죽는 서버가 있어도 나머지는 붙는다', r.서버들.length === 1 && r.서버들[0].이름 === '멀쩡이',
    JSON.stringify(r.서버들.map((s) => s.이름)));
  check('못 붙은 것을 조용히 넘기지 않는다', r.못한것.length === 1 && r.못한것[0].이름 === '죽는놈',
    JSON.stringify(r.못한것));
  check('왜 못 붙었는지 말한다', typeof r.못한것[0].왜 === 'string' && r.못한것[0].왜.length > 0, r.못한것[0]?.왜);
  for (const s of r.서버들) s.닫기();
}

{
  // 아무 답도 안 하는 서버. 시간 제한이 없으면 여기서 영영 멈춘다.
  설정쓰기({ mcpServers: { 벙어리: 서버설정('silent') } });
  const t0 = Date.now();
  const r = await 다붙이기(root, { timeout: 1200, env: 믿는env });
  const 걸린시간 = Date.now() - t0;
  check('답 없는 서버에서 안 멈춘다', 걸린시간 < 6000, `${(걸린시간 / 1000).toFixed(1)}초`);
  check('답 없는 서버는 못 붙었다고 한다', r.서버들.length === 0 && r.못한것.length === 1, JSON.stringify(r.못한것));
  check('시간 초과라고 말해 준다', /초 안에 답이 없습니다/.test(r.못한것[0]?.왜 ?? ''), r.못한것[0]?.왜);
}

{
  // stdout 에 JSON 아닌 것을 쏟는 서버. 로그를 그냥 찍는 서버가 실제로 흔하다.
  설정쓰기({ mcpServers: { 수다쟁이: 서버설정('garbage') } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  check('규격 밖의 잡소리는 버리고 계속 간다', r.서버들.length === 1, JSON.stringify(r.못한것));
  for (const s of r.서버들) s.닫기();
}

{
  // 도구를 40개 주는 서버. 스키마가 통째로 매 요청에 실리므로 무한정 받으면
  // 컨텍스트가 조용히 줄어든다. 자르되 **잘랐다고 말한다.**
  설정쓰기({ mcpServers: { 욕심쟁이: 서버설정('many') } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  const s = r.서버들[0];
  check('도구가 너무 많으면 자른다', s.도구.length === 도구최대, String(s.도구.length));
  check('자른 것을 조용히 안 넘긴다', s.잘림 === 40 - 도구최대, String(s.잘림));
  for (const x of r.서버들) x.닫기();
}

trace('5-자물쇠와열쇠');

// ── 자물쇠가 걸려 있으면 아예 안 띄운다 ─────────────────────────────────
//
// 자식 프로세스가 어디로 나가는지 우리는 못 막는다.
// **막을 수 없는 것을 막았다고 말하지 않는다.**
{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const r = await 다붙이기(root, { offline: true, env: 믿는env });
  check('오프라인이면 안 띄운다', r.서버들.length === 0 && r.잠김 === true);
  check('왜 안 띄웠는지 말한다', /오프라인/.test(r.못한것[0]?.왜 ?? ''), r.못한것[0]?.왜);
}

trace('5b-안믿는폴더');

/*
 * ── 안 믿는 폴더에서는 아예 안 띄운다 ───────────────────────────────────
 *
 * `mcp.json` 은 프로젝트 폴더에 있고, 그러니 **저장소에 같이 딸려 온다.**
 * 남의 저장소를 clone 하고 그 안에서 deel 을 켜면 거기 적힌 `command` 가
 * 이 계정 권한으로 자식 프로세스가 됐다 — 도구 승인 화면도 안 거치고,
 * 사람이 아무것도 안 쳤는데 돈다.
 *
 * 훅(safety/hooks.js)은 정확히 이 위협에 `믿나(root)` 를 강제하면서 제
 * 머리말에 「MCP 와 같은 무게로 다룬다」 고 적어 두었는데, 정작 무게를
 * 견주던 쪽에는 그 문이 없었다.
 *
 * 안 믿으면 **조용히 넘어가지 않는다.** 못 붙였다고 말하고 어떻게 하면
 * 되는지(deel trust)까지 같이 말한다 — 제가 적은 서버가 왜 안 뜨는지
 * 모르는 것이 두 번째로 나쁜 일이다.
 */
{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const 안믿는env = { ...process.env, DEEL_TRUST_ALL: '0' };
  const r = await 다붙이기(root, { timeout: 2500, env: 안믿는env });
  check('★★★ 안 믿는 폴더에서는 남의 프로그램을 안 띄운다',
    r.서버들.length === 0 && r.안믿음 === true, JSON.stringify({ n: r.서버들.length, 안믿음: r.안믿음 }));
  check('★★★ 안 띄운 서버를 이름과 함께 말한다',
    r.못한것.length === 1 && r.못한것[0].이름 === '사내위키', JSON.stringify(r.못한것));
  check('★★ 어떻게 하면 되는지 같이 말한다',
    /deel trust/.test(r.못한것[0]?.왜 ?? ''), r.못한것[0]?.왜);
  check('★★ 프로세스를 하나도 안 띄웠다', 살아있는수() === 0, String(살아있는수()));
}

// ── 우리 환경변수를 남의 프로세스에 넘기지 않는다 ───────────────────────
//
// DEEL_* 에는 게이트웨이 열쇠가 들어 있을 수 있다. 그 값이 넘어가면
// 어디로 가는지 우리가 알 수 없다.
{
  process.env.DEEL_SECRET_TEST = '열쇠-절대-새면-안-됨';
  설정쓰기({ mcpServers: { 환경보는놈: { ...서버설정(), env: { 내가준값: '이건괜찮다' } } } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  const ctx = { scope: makeScope(root), audit: new Audit(root), mcp: r.서버들, seen: new Set() };
  const 결과 = await runTool('mcp__환경보는놈__환경보기', {}, ctx);
  const 환경 = 결과.content ?? '';
  check('게이트웨이 열쇠를 안 넘긴다', !/열쇠-절대-새면-안-됨/.test(환경), 환경.slice(0, 100));
  check('DEEL_ 로 시작하는 것을 안 넘긴다', !/DEEL_SECRET_TEST/.test(환경));
  check('설정에 적은 env 는 넘긴다', /이건괜찮다/.test(환경), 환경.slice(0, 120));
  check('PATH 는 넘긴다 (없으면 아무것도 못 띄운다)', /"(PATH|Path)"/.test(환경));
  delete process.env.DEEL_SECRET_TEST;
  for (const s of r.서버들) s.닫기();
}

trace('6-도구목록에섞기');

// ── 우리 도구 목록에 어떻게 섞이는가 ────────────────────────────────────
{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });

  const 없이 = toolSchemas(null, { web: true }).length;
  const 함께 = toolSchemas(null, { web: true, mcp: r.서버들 }).length;
  check('붙은 도구가 목록에 더해진다', 함께 === 없이 + 2, `${없이} → ${함께}`);
  check('안 붙었으면 하나도 안 는다', toolSchemas(null, { web: true, mcp: [] }).length === 없이);

  // 우리 도구가 먼저다. 모델은 앞쪽을 더 잘 고른다 —
  // 파일을 읽어야 할 때 남의 검색 도구를 부르면 안 된다.
  const 목록 = toolSchemas(null, { web: true, mcp: r.서버들 }).map((t) => t.function.name);
  check('우리 도구가 앞에 온다', 목록.indexOf('Read') < 목록.indexOf('mcp__사내위키__위키검색'), 목록.join(','));

  /*
   * 읽기만 하는 모드에서는 안 준다.
   *
   * MCP 서버가 무엇을 하는지 우리는 모른다 — 이름이 '검색' 이어도 파일을 쓸 수
   * 있다. 파일을 안 바꾸기로 한 모드에서 '모르는 것' 을 쥐여 주면 그 약속이
   * 약속이 아니게 된다.
   */
  const 계획중 = toolSchemas(null, { web: true, mcp: r.서버들, work: 'plan' }).map((t) => t.function.name);
  check('계획 모드에는 밖 도구를 안 준다', !계획중.some((n) => n.startsWith('mcp__')), 계획중.join(','));
  const 코드중 = toolSchemas(null, { web: true, mcp: r.서버들, work: 'code' }).map((t) => t.function.name);
  check('코드 모드에는 준다', 코드중.some((n) => n.startsWith('mcp__')), 코드중.join(','));

  for (const s of r.서버들) s.닫기();
}

// 서버가 죽은 뒤에 부르면 오류로 돌려준다 (매달리지 않는다).
{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  const ctx = { scope: makeScope(root), audit: new Audit(root), mcp: r.서버들, seen: new Set() };
  for (const s of r.서버들) s.닫기();
  const 결과 = await runTool('mcp__사내위키__위키검색', { q: 'x' }, ctx);
  check('죽은 서버를 부르면 바로 오류', /죽었습니다/.test(결과.error ?? ''), JSON.stringify(결과));
}

// ── Error 가 아닌 것이 올라와도 **실패는 실패로** 적는다 ────────────────
//
// `e.message` 만 쓰면 문자열·숫자가 던져질 때 undefined 가 된다. 그러면
// `{ error: undefined }` 라, 부르는 쪽의 `if (result.error)` 가 거짓이 되어
// **실패가 성공으로 세어진다.** 남의 프로세스에서 올라오는 것이라 Error 라는
// 보장이 없다 — JSON-RPC 로 받은 값을 그대로 던지는 서버가 흔하다.
{
  const 던지는서버 = (던질것) => ({
    이름: '막된놈',
    쓸수있나: () => true,
    부르기: async () => { throw 던질것; },
  });

  for (const 던질것 of ['그냥 문자열 탈', 42, { code: -32000, message: null }]) {
    const ctx = { scope: makeScope(root), audit: new Audit(root), mcp: [던지는서버(던질것)], seen: new Set() };
    const r = await runTool('mcp__막된놈__아무거나', {}, ctx);
    check(`★ Error 아닌 것(${typeof 던질것})을 던져도 오류로 남는다`,
      typeof r.error === 'string' && r.error.length > 0 && r.error !== 'undefined',
      JSON.stringify(r));
  }

  // 성한 Error 는 여태처럼 그 말을 그대로 쓴다.
  const ctx = { scope: makeScope(root), audit: new Audit(root), mcp: [던지는서버(new Error('진짜 탈'))], seen: new Set() };
  const r = await runTool('mcp__막된놈__아무거나', {}, ctx);
  check('Error 면 그 말을 그대로 쓴다', r.error === '진짜 탈', JSON.stringify(r));
}

trace('7-판번호');

// ── 남의 서버에 우리 판 번호를 제대로 대는가 ────────────────────────────
//
// 이걸 검사로 못 박는 이유는 규격 때문이 아니라 **어긋나기 때문**이다.
// 전에는 mcp.js 가 '0.9.0' 을 직접 적어 들고 있었다. package.json 을 올려도
// 그건 안 올라가고, 아무 데서도 안 터지고, 남의 서버 기록에만 옛 번호가 남는다.
// 판 번호는 한 곳에서만 읽는다(src/version.js) — 그 약속을 여기서 지킨다.
{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });

  const 인사 = JSON.parse(readFileSync(인사파일, 'utf8'));
  const 진짜판 = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

  check('우리 이름을 댄다', 인사.clientInfo?.name === 'deel', JSON.stringify(인사.clientInfo));
  check('판 번호가 package.json 과 같다', 인사.clientInfo?.version === 진짜판,
    `${인사.clientInfo?.version} vs ${진짜판}`);
  check('판 번호를 못 읽어 0.0.0 으로 떨어지지 않았다', VERSION !== '0.0.0', VERSION);
  check('규격 판은 우리가 아는 것으로 댄다', 인사.protocolVersion === '2024-11-05', 인사.protocolVersion);

  // 서버가 대는 판은 서버 것이다 — 우리 것과 섞이면 안 된다.
  check('서버가 댄 판은 서버 것으로 둔다', r.서버들[0]?.정보?.version === '9.9.9',
    JSON.stringify(r.서버들[0]?.정보));

  for (const s of r.서버들) s.닫기();
}

trace('7.5-끝날때-남기지않는가');

/*
 * ── 프로그램이 끝나면 남의 서버도 데려가는가 ────────────────────────────
 *
 * 여기서 재는 탈은 화면에 안 나온다. MCP 서버는 우리가 띄운 **남의 프로그램**
 * 이라, 우리가 안 닫으면 그냥 남는다. 사람은 deel 을 껐다고 생각하는데
 * 작업 관리자에는 노드가 셋씩 떠 있다 — 며칠 쓰면 눈에 띄게 느려진다.
 *
 * 그래서 두 가지를 못 박는다.
 *   1. 띄운 것을 우리가 세고 있는가 (명부에 드는가·나가는가)
 *   2. 끝나는 길에 거두는 그물이 **실제로 걸려 있는가**
 *
 * 2번을 자식 프로세스로 재지 않는 까닭: 윈도우는 부모가 죽으면 프로세스
 * 나무를 통째로 거둔다. 그물을 다 걷어내도 아이는 어차피 죽어서 검사가
 * 초록으로 남는다 — 아무것도 안 지키는 검사가 된다. 그래서 그물이 걸려
 * 있다는 것 자체를 본다.
 */
{
  설정쓰기({ mcpServers: { 하나: 서버설정(), 둘: 서버설정() } });
  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  check('두 대가 붙었다', r.서버들.length === 2, String(r.서버들.length));
  check('★ 띄운 것을 세고 있다', 살아있는수() === 2, `명부 ${살아있는수()}`);

  const 아이들 = r.서버들.map((s) => s.kid);
  const 살아있는아이 = () => 아이들.filter((k) => k && k.exitCode === null && !k.killed).length;
  check('아이 둘이 진짜 떠 있다', 살아있는아이() === 2, String(살아있는아이()));

  // 하나만 손으로 닫으면 그 하나만 명부에서 빠져야 한다.
  r.서버들[0].닫기();
  check('★ 닫은 것은 명부에서 빠진다', 살아있는수() === 1, `명부 ${살아있는수()}`);

  const 거둔수 = 모두닫기();
  check('★ 남은 것을 모두닫기 가 거둔다', 거둔수 === 1, `${거둔수}개`);
  check('★ 다 거두면 명부가 빈다', 살아있는수() === 0, `명부 ${살아있는수()}`);

  // 죽는 데 시간이 조금 걸린다. 기다렸다가 본다.
  const 끝 = Date.now() + 5000;
  while (살아있는아이() > 0 && Date.now() < 끝) await new Promise((r2) => setTimeout(r2, 50));
  check('★ 닫으면 남의 프로세스가 진짜 없어진다', 살아있는아이() === 0,
    `아직 ${살아있는아이()}개`);

  check('★ 끝나는 길에 거두는 그물이 걸려 있다',
    process.listeners('exit').includes(모두닫기));

  // 두 번 불러도 안 터진다 — 끝날 때는 붙인 쪽이 이미 닫았을 수도 있다.
  let 두번째탈 = null;
  try { 모두닫기(); } catch (e) { 두번째탈 = e.message; }
  check('두 번 거둬도 안 터진다', 두번째탈 === null, 두번째탈 ?? '');
}

trace('8-끝');

/*
 * ── 남의 프로그램에 주는 환경 ───────────────────────────────────────────
 *
 * MCP 서버는 **남이 만든 프로그램**이고, 우리가 띄운다. 그쪽으로 넘어간 값은
 * 어디로 가는지 우리가 모른다. 그래서 필요한 것만 남기고 통째로 씻는다.
 *
 * 그런데 그 씻는 자를 재는 검사가 하나도 없었다. Bash·Jobs 쪽(열쇠뺀환경)은
 * shell.test.js 가 재는데, **더 위험한 쪽**인 여기는 아무도 안 봤다.
 */
{
  const 옛것 = {
    DEEL_API_KEY: process.env.DEEL_API_KEY,
    DEEL_KEY_사내: process.env.DEEL_KEY_사내,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.DEEL_API_KEY = 'sk-검사용-1111';
  process.env.DEEL_KEY_사내 = 'sk-검사용-2222';
  process.env.OPENAI_API_KEY = 'sk-남의열쇠-3333';
  try {
    const 준것 = 깨끗한환경();
    const 값들 = Object.values(준것).join(' | ');
    check('★★ MCP 자식에게 우리 열쇠를 안 준다',
      !/sk-검사용-1111|sk-검사용-2222/.test(값들),
      Object.keys(준것).filter((k) => /KEY/i.test(k)).join(', ') || '(열쇠꼴 이름 없음)');
    check('★★ DEEL_* 은 이름조차 안 넘어간다',
      !Object.keys(준것).some((k) => k.toUpperCase().startsWith('DEEL_')),
      Object.keys(준것).filter((k) => k.toUpperCase().startsWith('DEEL_')).join(', '));
    check('★ 남의 열쇠도 안 넘긴다 — 우리가 흘릴 값이 아니다',
      !/sk-남의열쇠-3333/.test(값들), '');
    check('★ 돌아가는 데 꼭 필요한 것은 남긴다', !!(준것.PATH ?? 준것.Path),
      Object.keys(준것).join(', ').slice(0, 100));
  } finally {
    for (const [k, v] of Object.entries(옛것)) {
      if (v == null) delete process.env[k]; else process.env[k] = v;
    }
  }
}


// ══ 지연 로딩 — 적어 둔 목록으로 서 있다가 부를 때 뜬다 ═══════════════
trace('9-지연로딩');
{
  /*
   * 이 기능은 **안 뜬 것**을 재야 한다. 그런데 「안 떴다」 는 눈에 안 보인다 —
   * 도구 목록은 그대로 있고 화면도 같다. 그래서 살아있는수() 로 잰다. 그게
   * 지금 이 프로세스가 실제로 붙들고 있는 자식 수다.
   */
  모두닫기();
  try { rmSync(메모자리(root)); } catch { /* 없으면 됐다 */ }
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });

  // 첫 판은 적어 둔 것이 없으니 그냥 띄운다. 그리고 적어 둔다.
  await 다붙이기(root, { timeout: 2500, env: 믿는env });
  check('처음에는 띄운다', 살아있는수() === 1, String(살아있는수()));
  check('★★ 그리고 도구 목록을 적어 둔다', existsSync(메모자리(root)), 메모자리(root));
  const 적힌것 = 메모읽기(root);
  check('  적은 것에 도구가 들어 있다', 적힌것['사내위키']?.도구?.length === 2,
    String(적힌것['사내위키']?.도구?.length));
  모두닫기();

  // 두 번째 판. 여기가 이 기능의 전부다 — **안 띄운다.**
  const 둘째 = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  check('★★ 두 번째부터는 안 띄운다', 살아있는수() === 0, String(살아있는수()));
  const s = 둘째.서버들[0];
  check('★★ 그래도 도구 목록은 있다', s.도구.length === 2, String(s.도구.length));
  check('★ 대기 중이라고 안다', s.대기 === true && s.살아있나() === false, '');
  /*
   * 「떠 있나」 와 「쓸 수 있나」 는 다른 말이다. 하나로 뭉개면 화면이 대기
   * 중인 서버를 「죽었다」 고 적고, 사람은 없는 탈을 고치러 간다.
   */
  check('★★ 그래도 쓸 수 있다고 안다', s.쓸수있나() === true, '');
  check('★ 도구 정의도 그대로 나온다',
    도구정의(둘째.서버들)[0]?.function?.name === 'mcp__사내위키__위키검색', '');

  // 부르는 순간 뜬다. 결과는 처음 판과 똑같아야 한다 — 사람 눈에 달라지면 안 된다.
  const out = await s.부르기('위키검색', { q: '휴가' });
  check('★★ 도구를 부르면 그때 뜬다', 살아있는수() === 1, String(살아있는수()));
  check('★★ 결과는 여느 때와 같다', out.text.startsWith('찾은 것: 휴가'), out.text);
  check('  이제는 대기가 아니다', s.대기 === false && s.살아있나() === true, '');
  모두닫기();

  /*
   * ★★ BOM 이 붙은 메모도 읽는다.
   *
   * 메모를 못 읽으면 빈 것으로 본다 — 그러면 **매번 서버를 다시 띄운다.** 오류도
   * 안 나고 도구도 멀쩡해서, 지연 로딩이 조용히 꺼진 것을 아무도 모른다.
   * 사람이 메모를 편집기·스크립트로 한 번 만지면 BOM 이 붙는 일은 흔하다.
   */
  const 메모원문 = readFileSync(메모자리(root), 'utf8');
  writeFileSync(메모자리(root), String.fromCharCode(0xfeff) + 메모원문, 'utf8');
  check('★★ BOM 이 붙은 메모도 읽는다', 메모읽기(root)['사내위키']?.도구?.length === 2,
    JSON.stringify(Object.keys(메모읽기(root))));
  writeFileSync(메모자리(root), 메모원문, 'utf8');
}

trace('10-메모가-어긋날때');
{
  /*
   * 적어 둔 것이 진짜와 어긋나는 자리를 세 겹으로 막는다. 그 세 겹을 잰다.
   */
  const 설정 = { 이름: 'x', command: 'node', args: ['a.mjs'], cwd: '/w', env: null };

  // 1) 지문 — 명령이 한 글자라도 바뀌면 다른 서버다.
  const 메모 = { 지문: 지문(설정), 적은때: Date.now(), 도구: [{ name: 'a' }] };
  check('★★ 지문이 같으면 쓴다', !!쓸만한메모(메모, 설정), '');
  check('★★ 인자가 바뀌면 안 쓴다', !쓸만한메모(메모, { ...설정, args: ['b.mjs'] }), '');
  check('★ 폴더가 바뀌어도 안 쓴다', !쓸만한메모(메모, { ...설정, cwd: '/other' }), '');
  check('★ 환경이 바뀌어도 안 쓴다', !쓸만한메모(메모, { ...설정, env: { A: '1' } }), '');

  /*
   * 2) 나이 — 도구가 늘어나는 서버도 있고, 영영 안 띄우면 그걸 영영 모른다.
   *    늘어나지 않는 것을 전제로 깔면 안 된다.
   */
  check('★★ 일주일이 지나면 안 쓴다',
    !쓸만한메모({ ...메모, 적은때: Date.now() - 메모유효 - 1 }, 설정), '');
  check('  그 안이면 쓴다', !!쓸만한메모({ ...메모, 적은때: Date.now() - 1000 }, 설정), '');

  check('빈 목록은 안 쓴다', !쓸만한메모({ ...메모, 도구: [] }, 설정), '');
  check('메모가 아예 없으면 안 쓴다', !쓸만한메모(null, 설정), '');
}

trace('11-메모가-옛것일때');
{
  /*
   * 3) 정말 띄운 뒤에 **맞춰 본다.**
   *
   * 적어 둔 목록에 있던 도구가 없어졌는데 그냥 tools/call 을 보내면, 서버가
   * 뭐라 답할지는 서버 마음이고 대개 「unknown tool」 한 줄이다. 그 줄로는
   * 우리가 옛 목록을 들고 있었다는 사실을 아무도 못 읽는다.
   */
  모두닫기();
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  // 있지도 않은 도구를 적어 둔 것처럼 꾸민다.
  writeFileSync(메모자리(root), JSON.stringify({
    version: 1,
    servers: {
      사내위키: {
        지문: 지문({ ...서버설정(), 이름: '사내위키', cwd: root }),
        적은때: Date.now(),
        도구: [{ name: '없어진도구', description: '옛것' }],
      },
    },
  }), 'utf8');

  const r = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  const s = r.서버들[0];
  check('옛 목록으로 서 있다', s.대기 === true && s.도구[0]?.name === '없어진도구', '');
  let 탈 = null;
  try { await s.부르기('없어진도구', {}); } catch (e) { 탈 = e; }
  check('★★ 없어진 도구는 없어졌다고 말한다', /더는 없습니다/.test(탈?.message ?? ''), 탈?.message ?? '(안 던짐)');
  check('★ 지금 있는 것을 알려 준다', /위키검색/.test(탈?.message ?? ''), 탈?.message ?? '');
  check('★★ 그리고 목록을 고쳐 든다', s.도구.some((t) => t.name === '위키검색'), s.도구.map((t) => t.name).join(' '));
  check('★ 무엇이 달라졌는지 들고 있다',
    s.달라짐?.없어진것?.includes('없어진도구'), JSON.stringify(s.달라짐));
  /*
   * ── 「고쳐 적고」 가 없었다 ─────────────────────────────────────────────
   *
   * 이 파일 머리말이 「정말 띄운 뒤에 맞춰 본다. 다르면 **그 자리에서 고쳐
   * 적고**」 라고 약속했는데, 고쳐 드는 것(위 줄)까지만 하고 디스크에 다시
   * 적지 않았다. 그래서 옛 목록이 **매 실행마다 다시** 모델에게 나갔다 —
   * 지문이 같고 이레가 안 지났으니 다음 판도 같은 옛것을 쓰고, 같은 실패를
   * 되풀이한다 (34차 리뷰).
   */
  const 고쳐적힌것 = 메모읽기(root)['사내위키'];
  check('★★ 맞춰 본 목록을 디스크에도 고쳐 적는다',
    (고쳐적힌것?.도구 ?? []).some((t) => t.name === '위키검색'),
    (고쳐적힌것?.도구 ?? []).map((t) => t.name).join(' '));
  check('★★ 없어진 도구는 적힌 것에서도 빠진다',
    !(고쳐적힌것?.도구 ?? []).some((t) => t.name === '없어진도구'),
    (고쳐적힌것?.도구 ?? []).map((t) => t.name).join(' '));
  모두닫기();

  /*
   * 이름은 그대로인데 **속이 달라진** 도구. 제일 조용한 어긋남이다 —
   * 필수 인자가 하나 늘었는데 옛 스키마를 모델에게 주면, 모델은 그 인자 없이
   * 부르고 서버가 기본값으로 넘어가는 구현이면 **그럴듯한 엉뚱한 결과**가
   * 돌아온다. 이름만 견주면 이걸 영영 못 본다.
   */
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  writeFileSync(메모자리(root), JSON.stringify({
    version: 1,
    servers: {
      사내위키: {
        지문: 지문({ ...서버설정(), 이름: '사내위키', cwd: root }),
        적은때: Date.now(),
        // 이름은 진짜 있는 것과 같고, 스키마만 옛것이다.
        도구: [{ name: '위키검색', description: '옛것', inputSchema: { type: 'object', properties: {} } }],
      },
    },
  }), 'utf8');
  const r2 = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  const s2 = r2.서버들[0];
  check('옛 스키마로 서 있다', s2.대기 === true, String(s2.대기));
  await s2.깨우기({ timeout: 2500 });
  check('★★ 이름이 같고 속이 달라진 것도 알아본다',
    s2.달라짐?.바뀐것?.includes('위키검색'), JSON.stringify(s2.달라짐));
  모두닫기();
}

trace('11-2-메모겹쳐쓰기');

/*
 * ── 한 대를 새로 띄우면 나머지 메모가 지워졌다 ──────────────────────────
 *
 * 메모쓰기 가 파일을 통째로 새로 썼고, 부르는 쪽은 **이번에 정말 띄운 것만**
 * 넘긴다(대기 중인 것에 적은때를 새로 찍으면 「일주일이면 다시 본다」 가 영영
 * 안 오므로 일부러 뺀다). 둘이 합쳐지면 대기 중이던 서버의 메모가 날아간다.
 *
 * A·B 를 쓰다 B 만 고치면 그 판에서 A 가 날아가고, 다음 판에는 B 가 날아간다 —
 * 그 뒤로 **매번 한 대가 반드시 즉시 뜬다.** 지연 로딩이 없애려던 기동 지연이
 * 영구히 돌아오는데, 화면으로는 알 길이 없다 (34차 리뷰).
 */
{
  모두닫기();
  try { rmSync(메모자리(root)); } catch { /* 없으면 됐다 */ }
  설정쓰기({ mcpServers: { 가: 서버설정(), 나: 서버설정() } });

  // 첫 판 — 둘 다 띄우고 둘 다 적는다.
  await 다붙이기(root, { timeout: 2500, env: 믿는env });
  모두닫기();
  check('둘 다 적혔다', Object.keys(메모읽기(root)).length === 2,
    Object.keys(메모읽기(root)).join(','));

  // 나 의 설정만 고친다 — 지문이 달라져 나 만 새로 뜨고 가 는 대기다.
  설정쓰기({ mcpServers: { 가: 서버설정(), 나: { ...서버설정(), args: [...서버설정().args, '--x'] } } });
  const 판 = await 다붙이기(root, { timeout: 2500, env: 믿는env });
  모두닫기();
  check('한 대만 새로 떴다', 판.서버들.filter((s) => !s.대기).length === 1,
    판.서버들.map((s) => `${s.이름}:${s.대기 ? '대기' : '띄움'}`).join(' '));
  const 적힌것2 = 메모읽기(root);
  check('★★ 대기 중이던 서버의 메모가 살아 있다', !!적힌것2['가'], Object.keys(적힌것2).join(','));
  check('★★ 새로 띄운 서버 메모도 있다', !!적힌것2['나'], Object.keys(적힌것2).join(','));
  /*
   * 대기 중이던 쪽의 적은때는 **안 바뀐다.** 바뀌면 일주일 시계가 매번
   * 되감겨서, 세 겹 그물 중 하나를 우리 손으로 걷는 것이 된다.
   */
  check('★ 대기 중인 것의 적은때는 그대로', 적힌것2['가'].적은때 <= 적힌것2['나'].적은때,
    `${적힌것2['가'].적은때} vs ${적힌것2['나'].적은때}`);

  // 설정에서 빠진 서버의 메모는 걷는다 — 안 걷으면 파일에 영영 쌓인다.
  설정쓰기({ mcpServers: { 나: { ...서버설정(), args: [...서버설정().args, '--y'] } } });
  await 다붙이기(root, { timeout: 2500, env: 믿는env });
  모두닫기();
  check('★ 설정에서 뺀 서버의 메모는 걷는다', !메모읽기(root)['가'],
    Object.keys(메모읽기(root)).join(','));

  /*
   * ── 남는 것이 **하나도 없으면** 아예 안 적었다 (8회차 · 뒷단) ────────────
   *
   * 「남는 서버가 없으면 쓸 것도 없다」 로 곧장 돌아섰다. 그런데 이 함수가 하는 일은
   * 두 가지다 — 새로 뜬 것을 적는 것, 그리고 **설정에서 빠진 것을 걷는 것.** 걷고 나서
   * 아무것도 안 남는 판(설정의 서버를 다 빼거나, 남은 한 대가 도구 0개로 떴을 때)에서는
   * 걷기가 통째로 취소돼서, 지운 서버의 메모가 파일에 영영 남는다.
   *
   * 남은 메모는 그냥 쓰레기가 아니다 — 지연 로딩이 이름으로 찾아 「이미 아는 서버」 로
   * 세우는 자리라, 설정에서 지운 남의 프로그램의 도구 목록이 계속 살아 있게 된다.
   */
  {
    const 파일 = 메모자리(root);
    writeFileSync(파일, JSON.stringify({ version: 1, servers: {
      지운것: { 지문: 'x', 적은때: Date.now(), 도구: [{ name: '옛도구', inputSchema: { type: 'object' } }] },
    } }, null, 2) + '\n', 'utf8');
    메모쓰기(root, [], { 남길이름: [] });
    check('★★ 남는 것이 하나도 없어도 지운 서버의 메모는 걷는다', !메모읽기(root)['지운것'],
      Object.keys(메모읽기(root)).join(',') || '(빈 것)');
  }
}

trace('12-끄기');
{
  /*
   * 끄는 길이 있어야 한다. 사내에서 「켤 때 다 뜨는지」 를 확인해야 하는
   * 자리가 있고, 그때 끌 방법이 없으면 이 기능이 곧 걸림돌이 된다.
   */
  모두닫기();
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const r = await 다붙이기(root, { timeout: 2500, env: { ...믿는env, DEEL_MCP_LAZY: 'off' } });
  check('★★ DEEL_MCP_LAZY=off 면 여느 때처럼 띄운다', 살아있는수() === 1, String(살아있는수()));
  check('  대기가 아니다', r.서버들[0]?.대기 === false, '');
  모두닫기();
}

trace('13-사냥4');
{
  모두닫기();
  const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 한대 = (모드, 더 = {}) => new MCP서버({ 이름: `검사-${모드}`, command: process.execPath, args: [서버파일, 모드], env: null, cwd: root, ...더 });
  const 끝났나 = async (kid, ms = 4000) => {
    const 끝 = Date.now() + ms;
    while (kid && kid.exitCode === null && kid.signalCode === null && Date.now() < 끝) await 잠깐(50);
    return !kid || kid.exitCode !== null || kid.signalCode !== null;
  };

  /*
   * W1 — 줄바꿈 없이 끝없이 쏟는 서버.
   *
   * 한도(4MB)를 넘으면 끝냄() 을 불렀지만 **귀는 그대로** 열어 두고 받은 것을 계속
   * 이어 붙였다. 끝냄() 은 두 번째부터 아무것도 안 하니, 버퍼가 끝없이 자라다
   * RangeError 로 deel 이 통째로 죽었다. 남의 프로그램 하나 때문에.
   */
  {
    const s = 한대('flood');
    await s.붙기({ timeout: 2500 });
    let 탈 = null;
    try { await s.부르기('아무거나', {}, { timeout: 5000 }); } catch (e) { 탈 = e; }
    check('★ 줄바꿈 없이 쏟으면 끊고 너무 크다고 말한다', /너무 큽니다/.test(탈?.message ?? ''), 탈?.message ?? '(안 던짐)');
    await 잠깐(150);
    const 크기1 = s.찌꺼기.length;
    await 잠깐(150);
    const 크기2 = s.찌꺼기.length;
    check('★★★ 끊은 뒤로는 더 쌓지 않는다', 크기2 <= 크기1 && 크기2 <= 5 * 1024 * 1024,
      `${Math.round(크기1 / 1048576)}MB → ${Math.round(크기2 / 1048576)}MB`);
    const kid = s.kid;
    s.찌꺼기 = '';   // 고치기 전에는 여기서라도 비워 둔다 — 빨간 판이 메모리로 죽지 않게
    check('★★ 쏟는 서버 프로세스를 거둔다 (닫기 전에)', await 끝났나(kid, 800), `pid ${kid?.pid}`);
    s.닫기();
  }

  /*
   * W5 — 서버가 **우리 물음과 같은 번호로** 묻는 판(ping).
   *
   * JSON-RPC 번호는 양쪽이 따로 센다. 번호만 보고 가르면 서버의 ping 이 우리
   * tools/call 의 답으로 먹혀 빈 결과가 되고, ping 에는 아무도 답을 안 한다.
   * 언어 서버 쪽(lsp/client.js)은 이미 method 로 가르고 있다.
   */
  {
    const s = 한대('collide');
    await s.붙기({ timeout: 2500 });
    let 답 = null;
    try { 답 = await s.부르기('아무거나', {}, { timeout: 3000 }); } catch (e) { 답 = { text: `(던짐) ${e.message}` }; }
    check('★★ 서버의 물음(같은 번호)이 우리 답으로 안 먹힌다 · ping 에 답한다', 답?.text === '진짜 답 · 핑답받음', JSON.stringify(답));
    s.닫기();
  }

  /*
   * W10 — tools/list 의 nextCursor. 뒷쪽을 안 따라가면 도구가 **조용히** 빠진다.
   */
  {
    const s = 한대('paged');
    const ok = await s.붙기({ timeout: 2500 });
    const 이름들 = s.도구.map((t) => t.name);
    check('★ 여러 쪽으로 나눈 도구 목록을 끝까지 받는다', ok && 이름들.includes('첫쪽도구') && 이름들.includes('둘쪽도구'), 이름들.join(','));
    s.닫기();
  }

  /*
   * ── 쪽을 넘기다 시한이 지나면 **받아 둔 것까지 버렸다** (8회차 · 뒷단) ─────
   *
   * 위 W10 이 붙인 쪽 넘기기가 통째로 하나의 try 안에 있었다. 첫 쪽을 다 받아 놓고도
   * 둘째 쪽에서 시한이 지나면 그 예외가 바깥 catch 로 가서 `끝냄('도구 목록을 못
   * 받았습니다')` · `return false` 로 끝난다 — 서버 하나가 통째로 안 붙는다.
   *
   * 쪽을 나눠 주는 서버는 대개 도구가 많은 큰 서버다. 뒷쪽 하나가 늦다고 그 서버의
   * 도구를 **한 개도** 안 쓰는 것은, 이 파일이 내내 지켜 온 「하나가 안 떠도 나머지는
   * 쓴다」 와 반대다. 받은 데까지 쓰고 뒤에 더 있다고 적으면 된다(잘림).
   */
  {
    const s = 한대('pagedstall');
    const ok = await s.붙기({ timeout: 1500 });
    check('★★★ 쪽을 넘기다 시한이 지나도 받아 둔 도구는 안 버린다',
      ok && s.도구.map((t) => t.name).join(',') === '첫쪽도구', `${ok} · ${s.도구.map((t) => t.name).join(',')} · ${s.죽음 ?? ''}`);
    check('★★ 그러고 뒤에 더 있다고 적는다 — 「다 받았다」 로 안 보이게', s.잘림 >= 1, String(s.잘림));
    s.닫기();
  }

  /*
   * W11 — 글이 박힌 resource 와 structuredContent 만 있는 답.
   * 앞엣것은 「[resource]」 한 낱말, 뒤엣것은 빈 글로 모델에게 갔다.
   */
  {
    const s = 한대('normal');
    await s.붙기({ timeout: 2500 });
    const 자원 = await s.부르기('자원보기', {});
    check('★ 박힌 resource 의 글을 싣는다', /박힌 자원 본문/.test(자원.text), JSON.stringify(자원));
    const 구조 = await s.부르기('구조만', {});
    check('★ structuredContent 만 있으면 그 JSON 을 싣는다', /"answer"\s*:\s*42/.test(구조.text), JSON.stringify(구조));
    s.닫기();
  }

  /*
   * W12 — 대기 중이던 서버가 initialize 에 끝내 답을 안 하면 깨우기가 실패하는데,
   * 그 프로세스는 **살려 둔 채** 명부에 남았다. 아무도 안 거둔다.
   */
  {
    const s = 한대('silent');
    s.메모로세우기({ 도구: [{ name: '위키검색', inputSchema: { type: 'object' } }] }, null);
    const 앞수 = 살아있는수();
    const ok = await s.깨우기({ timeout: 600 });
    check('  답 없는 서버는 못 깨운다', ok === false, String(s.죽음));
    check('★★ 못 깨운 서버는 명부에 안 남는다', 살아있는수() === 앞수, `${앞수} → ${살아있는수()}`);
    check('★★ 못 깨운 서버 프로세스를 거둔다', await 끝났나(s.kid, 3000), `pid ${s.kid?.pid}`);
    s.닫기();
  }

  /*
   * ── ★★ (6회차 Gemini 엠씨피 MB1) 깨우는 중에 들어온 두 번째 부름 ─────────────
   *
   * 깨우기 는 `살아있나()` 를 `깨우는중` 보다 먼저 봤다. 붙기 첫 줄에서 아이는 이미 떠 있으므로,
   * 인사(initialize)에 답이 오기 전에 들어온 두 번째 부름이 「살아 있다」 로 곧장 지나가
   * tools/call 을 **인사보다 먼저** 보냈다 — 규격 위반이라 서버는 거절하거나 엉뚱하게 답한다.
   * 모델이 도구를 한꺼번에 둘 부르는 것은 흔한 일이다.
   */
  {
    const s = 한대('slowinit');
    s.메모로세우기({ 도구: [{ name: '위키검색', inputSchema: { type: 'object' } }] }, null);
    const [가, 나] = await Promise.all([
      s.부르기('위키검색', { q: '하나' }, { timeout: 5000 }).catch((e) => ({ text: `던짐 ${e.message}` })),
      s.부르기('위키검색', { q: '둘' }, { timeout: 5000 }).catch((e) => ({ text: `던짐 ${e.message}` })),
    ]);
    check('★★ (6회차 MB1) 깨우는 중에 함께 들어온 부름도 인사가 끝난 뒤에 보낸다',
      /찾은 것: 하나/.test(가.text) && /찾은 것: 둘/.test(나.text), `${가.text} | ${나.text}`);
    s.닫기();
  }

  /*
   * ── ★ (6회차 Gemini 엠씨피 MB2) 시그널로 죽은 서버에 보내기 ──────────────────────
   *
   * 보내고기다리기 는 `exitCode` 만 봤다. 시그널로 죽은 아이는 exitCode 가 null 이라 그대로 지나가
   * 죽은 관에 써 놓고 시한(기본 60초)까지 기다렸다. 끝냄 이 `죽음` 을 이미 적어 뒀는데도.
   */
  {
    const s = 한대('normal');
    await s.붙기({ timeout: 2500 });
    s.kid.kill();
    await 끝났나(s.kid, 3000);
    await 잠깐(100);
    const 시작 = Date.now();
    let 까닭 = '';
    try { await s.보내고기다리기('tools/list', {}, 4000); } catch (e) { 까닭 = e.message; }
    const 걸린 = Date.now() - 시작;
    check('★ (6회차 MB2) 시그널로 죽은 서버에 보내면 기다리지 않고 곧장 실패한다',
      걸린 < 1500 && !!까닭, `${걸린}ms · ${까닭} · exitCode=${s.kid?.exitCode} signal=${s.kid?.signalCode}`);
    s.닫기();
  }

  /*
   * W13 — 서버 이름에 `__` 가 있거나 `_` 로 시작·끝나면 붙인 이름을 도로 못 푼다.
   * 목록에는 서고, 모델이 부르면 「my 서버가 붙어 있지 않습니다」 가 돌아왔다.
   */
  {
    설정쓰기({ mcpServers: { my__srv: 서버설정(), srv_: 서버설정(), _srv: 서버설정(), a_b: 서버설정() } });
    const 설정 = 설정읽기(root);
    check('★ 못 푸는 이름의 서버는 안 받는다', 설정.서버들.map((x) => x.이름).join(',') === 'a_b', 설정.서버들.map((x) => x.이름).join(','));
    const 못받은 = 설정.못받은것 ?? [];
    check('★ 안 받은 까닭을 이름마다 말한다', ['my__srv', 'srv_', '_srv'].every((n) => /_/.test(못받은.find((x) => x.이름 === n)?.왜 ?? '')),
      JSON.stringify(못받은));
    check('  받은 이름은 도로 풀린다', 이름풀기(도구정의([{ 이름: 'a_b', 도구: [{ name: 'c__d' }] }])[0].function.name)?.서버 === 'a_b');
  }

  /*
   * W7 — 윈도우의 `.cmd` 명령. 노드는 셸 없이 `.cmd` 를 못 띄운다(EINVAL), 그리고
   * `npx` 처럼 확장자 없이 적으면 PATHEXT 를 안 봐서 못 찾는다(ENOENT). 복사해 붙이는
   * mcp.json 의 절반이 `"command": "npx"` 다.
   */
  if (process.platform === 'win32') {
    const 폴더 = join(root, '명령 폴더');
    mkdirSync(폴더, { recursive: true });
    const cmd파일 = join(폴더, 'stubmcp.cmd');
    writeFileSync(cmd파일, `@"${process.execPath}" "${서버파일}" %*\r\n`, 'utf8');
    const 인사자리2 = join(root, '인사 & (둘) 100%.json');
    const s1 = new MCP서버({ 이름: 'cmd', command: cmd파일, args: ['normal', 인사자리2], env: null, cwd: root });
    const ok1 = await s1.붙기({ timeout: 6000 });
    check('★★ (윈도우) .cmd 경로로 적은 서버도 뜬다', ok1, String(s1.죽음));
    check('★ (윈도우) 빈칸·&·괄호·% 가 든 인자도 그대로 넘어간다', existsSync(인사자리2), 인사자리2);
    s1.닫기();
    const s2 = new MCP서버({ 이름: 'pathcmd', command: 'stubmcp', args: ['normal'], env: { PATH: `${폴더};${process.env.PATH ?? ''}` }, cwd: root });
    const ok2 = await s2.붙기({ timeout: 6000 });
    check('★★ (윈도우) 이름만 적은 .cmd 도 PATH 에서 찾아 띄운다 (npx 꼴)', ok2 && s2.도구.length === 2, String(s2.죽음));
    s2.닫기();

    /*
     * Gemini 웹4 — `%*` 로 넘기는 배치(전역 npx.cmd · npm 전역 쉼)는 받은 줄을 한 번 더 읽는다.
     * ^ 를 한 겹만 달면 따옴표 든 인자 하나가 cmd 의 따옴표 상태를 뒤집어 **다음 인자의 & 가
     * 명령으로 돌았다**. 줄바꿈 든 인자는 그 뒤 인자를 통째로 잃었다(cmd 가 거기서 줄을 끊는다).
     */
    {
      const { spawnSync } = await import('node:child_process');
      const 메아리 = join(폴더, 'echo.js');
      writeFileSync(메아리, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))', 'utf8');
      // 배치 글 안에 한글 경로를 적으면 cmd 가 코드 페이지로 읽어 깨진다 — %~dp0 으로 가리킨다.
      const 별 = join(폴더, 'star.cmd');
      writeFileSync(별, `@"${process.execPath}" "%~dp0echo.js" %*\r\n`, 'utf8');
      const 표지 = join(폴더, 'MARK.txt');
      // 표지 인자를 맨 뒤에 둔다 — 뒤에 인자가 더 오면 cmd 가 그 따옴표까지 파일 이름으로 먹어 표지가 안 생긴다.
      const 묶음 = ['x^y', '100%', 'a"b', 'p & echo made>MARK.txt'];
      const 모양 = 띄울모양(별, 묶음, process.env, 폴더);
      const r = spawnSync(모양.파일, 모양.인자, { ...모양.옵션, cwd: 폴더, encoding: 'utf8', timeout: 10000, windowsHide: true });
      let 받음 = null;
      try { 받음 = JSON.parse(r.stdout); } catch { /* 깨졌다 — 아래 검사가 잡는다 */ }
      check('★★ (윈도우) 따옴표 든 인자 뒤의 & 가 명령으로 안 돈다', !existsSync(표지), 표지);
      check('★★ (윈도우) %* 로 넘기는 .cmd 에도 인자가 글자 그대로 간다', JSON.stringify(받음) === JSON.stringify(묶음), `${JSON.stringify(받음)} · ${r.stderr}`);
      let 던짐 = null;
      try { 띄울모양(별, [`a${String.fromCharCode(10)}b`, 'after'], process.env, 폴더); } catch (e) { 던짐 = e; }
      check('★ (윈도우) 줄바꿈 든 인자는 잘린 채 띄우지 않고 까닭을 말한다', !!던짐 && /줄바꿈/.test(던짐.message), String(던짐?.message));
      // %~1 로 받는 배치는 두 겹이면 ^ 가 글자로 남는다 — %* 가 없는 배치는 한 겹 그대로다.
      const 물결 = join(폴더, 'tilde.bat');
      writeFileSync(물결, `@"${process.execPath}" "%~dp0echo.js" "%~1" "%~2"\r\n`, 'utf8');
      const 모양2 = 띄울모양(물결, ['two words', 'a^b'], process.env, 폴더);
      const r2 = spawnSync(모양2.파일, 모양2.인자, { ...모양2.옵션, cwd: 폴더, encoding: 'utf8', timeout: 10000, windowsHide: true });
      let 받음2 = null;
      try { 받음2 = JSON.parse(r2.stdout); } catch { /* 깨졌다 */ }
      check('(윈도우) %~1 로 받는 배치에는 한 겹 그대로 간다', JSON.stringify(받음2) === JSON.stringify(['two words', 'a^b']), `${JSON.stringify(받음2)} · ${r2.stderr}`);
      // Gemini 화면5 — 쓰는 법을 적은 REM 줄의 %* 에 속아 %~1 배치에 두 겹을 달았다.
      const 주석 = join(폴더, 'remtilde.cmd');
      writeFileSync(주석, `@REM usage: remtilde.cmd %*\r\n:: also %* here\r\n@"${process.execPath}" "%~dp0echo.js" "%~1" "%~2"\r\n`, 'utf8');
      const 모양3 = 띄울모양(주석, ['two words', 'a^b'], process.env, 폴더);
      const r3 = spawnSync(모양3.파일, 모양3.인자, { ...모양3.옵션, cwd: 폴더, encoding: 'utf8', timeout: 10000, windowsHide: true });
      let 받음3 = null;
      try { 받음3 = JSON.parse(r3.stdout); } catch { /* 깨졌다 */ }
      check('★ (윈도우) REM·:: 줄의 %* 는 넘기는 줄로 안 친다', JSON.stringify(받음3) === JSON.stringify(['two words', 'a^b']), `${JSON.stringify(받음3)} · ${r3.stderr}`);
    }

    /*
     * ── 빈 PATHEXT 는 **안 적은 것과 같이** 본다 (8회차 · 뒷단) ───────────────
     *
     * `??` 는 빈 글을 안 막는다. `PATHEXT=` 로 비워 둔 판(또는 `;;` 만 든 판)에서는
     * 확장자 목록이 통째로 비고, 그러면 붙여 보는 되풀이가 **한 번도 안 돌아** 무엇을
     * 물어도 null 이었다 — `npx` 는 ENOENT 로 안 뜨고, `stubmcp.cmd` 처럼 확장자까지
     * 적은 완전한 이름조차 못 찾아 **전체 경로 대신 이름만** cmd.exe 로 넘어간다.
     * 그러면 이 파일 머리말이 막으려던 자리로 되돌아간다 — cmd.exe 는 PATH 보다
     * 지금 폴더(남의 저장소일 수 있다)를 먼저 뒤진다.
     *
     * 언어 서버 쪽(lsp/servers.js 의 어디있나)이 같은 구멍을 같은 꼴로 이미 막았다.
     */
    {
      // 빈칸·^ 없는 폴더로 잰다 — 전체 경로가 갔는지만 보는 검사라, cmd 감싸기의 ^ 가 섞이면 볼 것이 흐려진다.
      const 맨폴더 = join(root, 'pathext');
      mkdirSync(맨폴더, { recursive: true });
      writeFileSync(join(맨폴더, 'stubmcp.cmd'), `@"${process.execPath}" "${서버파일}" %*\r\n`, 'utf8');
      const 온전한가 = (명령, v) => {
        const 모양 = 띄울모양(명령, ['normal'], { PATH: 맨폴더, PATHEXT: v }, root, 'win32');
        // 기본 목록의 확장자는 대문자(.CMD)라 붙여 찾은 이름도 대문자로 온다 — 윈도우 파일 이름은 대소문자를 안 가린다.
        return (모양.인자 ?? []).some((a) => a.toLowerCase().includes(join(맨폴더, 'stubmcp.cmd').toLowerCase()));
      };
      check('★★★ (윈도우) PATHEXT 가 비어 있어도 이름만 적은 .cmd 를 PATH 에서 찾는다',
        온전한가('stubmcp', ''), JSON.stringify(띄울모양('stubmcp', [], { PATH: 맨폴더, PATHEXT: '' }, root, 'win32').인자 ?? []));
      check('★★★ (윈도우) PATHEXT 가 비어 있어도 확장자까지 적은 이름을 전체 경로로 넘긴다',
        온전한가('stubmcp.cmd', ''), JSON.stringify(띄울모양('stubmcp.cmd', [], { PATH: 맨폴더, PATHEXT: '' }, root, 'win32').인자 ?? []));
      check('★★ (윈도우) ";;" 만 든 PATHEXT 도 안 적은 것과 같이 본다',
        온전한가('stubmcp', ';;') && 온전한가('stubmcp.cmd', ';;'), '');
    }
  } else {
    check('(윈도우 아님) .cmd 띄우기는 윈도우에서만 잽니다', true);
  }
  모두닫기();
}

trace('14-202');
/*
 * ── 2.0.2 · 남겨 뒀던 MCP 자리 (M1 · MB3 · MB4 · M3 · M4) ─────────────────────
 */
{
  모두닫기();
  const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 한대 = (모드) => new MCP서버({ 이름: `검사-${모드}`, command: process.execPath, args: [서버파일, 모드], env: null, cwd: root });
  const 끝났나 = async (kid, ms = 4000) => {
    const 끝 = Date.now() + ms;
    while (kid && kid.exitCode === null && kid.signalCode === null && Date.now() < 끝) await 잠깐(50);
    return !kid || kid.exitCode !== null || kid.signalCode !== null;
  };
  const 죽이고기다리기 = async (s) => { const k = s.kid; k.kill(); await 끝났나(k, 3000); await 잠깐(80); };
  const 답글 = (약속) => 약속.then((r) => r.text, (e) => `던짐 ${e.message}`);

  // M1 · MB3 — 쓰던 서버가 저 혼자 죽으면 다음 부름에 되살린다. 한 세션에 되살리기최대 번까지.
  {
    const s = 한대('normal');
    await s.붙기({ timeout: 4000 });
    const 첫아이 = s.kid.pid;
    await 죽이고기다리기(s);
    check('M1 준비: 저 혼자 죽었다', !!s.죽음 && !s.살아있나(), String(s.죽음));
    check('★★ M1 저 혼자 죽은 서버는 쓸 수 있는 것으로 본다 (다음 부름에 되살린다)', s.쓸수있나() && s.되살릴수있나(), `되살린수 ${s.되살린수}`);
    const 하나 = await 답글(s.부르기('위키검색', { q: '되살림' }, { timeout: 5000 }));
    check('★★★ M1 죽은 서버를 다음 부름에 되살려 답을 받는다',
      /찾은 것: 되살림/.test(하나) && s.kid?.pid !== 첫아이 && s.되살린수 === 1 && s.살아있나(), `${하나} · 되살린수 ${s.되살린수}`);
    await 죽이고기다리기(s);
    const 둘 = await 답글(s.부르기('위키검색', { q: '또' }, { timeout: 5000 }));
    check('  두 번째도 되살린다', /찾은 것: 또/.test(둘) && s.되살린수 === 2, `${둘} · 되살린수 ${s.되살린수}`);
    await 죽이고기다리기(s);
    const 셋 = await 답글(s.부르기('위키검색', { q: '셋' }, { timeout: 3000 }));
    check('★★ M1 한 세션에 되살리기최대 번을 넘기면 더 안 띄운다',
      s.되살린수 === 되살리기최대 && !s.쓸수있나() && /던짐 .*끝났습니다/.test(셋), `${셋} · 되살린수 ${s.되살린수}`);
    s.닫기();
  }
  {
    const s = 한대('normal');
    await s.붙기({ timeout: 4000 });
    const k = s.kid;
    s.닫기();
    await 끝났나(k, 3000);
    check('★ M1 우리가 닫은 서버는 되살리지 않는다', !s.쓸수있나() && !s.되살릴수있나(), String(s.죽음));
  }

  // MB4 — 깨우는 동안 누른 ESC 는 그 부름만 곧장 끊는다. 같이 기다리던 부름과 서버는 그대로다.
  {
    const s = 한대('slowinit');
    s.메모로세우기({ 도구: [{ name: '위키검색', inputSchema: { type: 'object' } }] }, null);
    const 끊개 = new AbortController();
    const 시작 = Date.now();
    let 가걸린 = -1;
    const 가약속 = 답글(s.부르기('위키검색', { q: '끊을것' }, { timeout: 5000, signal: 끊개.signal })).then((t) => { 가걸린 = Date.now() - 시작; return t; });
    const 나약속 = 답글(s.부르기('위키검색', { q: '남은것' }, { timeout: 5000 }));
    setTimeout(() => 끊개.abort(), 100);
    const 가 = await 가약속;
    const 나 = await 나약속;
    check('★★ MB4 깨우는 동안 누른 ESC 가 그 부름을 곧장 끊는다 (인사 700ms 를 안 기다린다)',
      /중단했습니다/.test(가) && 가걸린 >= 0 && 가걸린 < 600, `${가걸린}ms · ${가}`);
    check('★★ MB4 같이 기다리던 다른 부름은 안 끊긴다', /찾은 것: 남은것/.test(나), 나);
    check('  서버는 죽음 으로 안 남는다', s.살아있나() && !s.죽음, String(s.죽음));
    const 미리 = new AbortController();
    미리.abort();
    const t = 한대('normal');
    t.메모로세우기({ 도구: [{ name: '위키검색', inputSchema: { type: 'object' } }] }, null);
    const 셋 = await 답글(t.부르기('위키검색', { q: 'x' }, { signal: 미리.signal }));
    check('  이미 멈춘 부름은 서버를 깨우지도 않는다', /중단했습니다/.test(셋) && !t.kid && t.대기, 셋);
    s.닫기();
    t.닫기();
  }

  // M3 — 신호로 끝날 때 거둘 그물에 MCP 서버가 적혀 있다(윈도우에서도 재는 값).
  check('★★ M3 신호로 끝날 때 거둘 것에 MCP 서버 닫기가 적혀 있다', 거둘것에있나(모두닫기));
  check('  끝나는 길(exit)의 그물도 그대로다', process.listeners('exit').includes(모두닫기));

  // M3 — 진짜로 SIGTERM 을 보내 본다. 윈도우는 신호를 보내면 손이 돌기도 전에 Node 가 죽인다.
  if (process.platform !== 'win32') {
    const { spawn } = await import('node:child_process');
    const 아이 = spawn(process.execPath, [join(여기, 'mcp-signal-child.mjs'), 서버파일], { cwd: resolve(여기, '..'), stdio: ['pipe', 'pipe', 'pipe'] });
    let 나온글 = '';
    아이.stdout.setEncoding('utf8');
    아이.stdout.on('data', (d) => { 나온글 += d; });
    아이.stderr.setEncoding('utf8');
    아이.stderr.on('data', (d) => { 나온글 += d; });
    let 끝난것 = null;
    const 닫힘 = new Promise((r) => 아이.on('close', (code, sig) => { 끝난것 = { code, sig }; r(); }));
    let 손자 = null;
    for (let i = 0; i < 300 && 손자 === null; i++) {
      const m = /손자 (\d+)/.exec(나온글);
      if (m) 손자 = Number(m[1]); else await 잠깐(50);
    }
    const 살았나 = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    check('M3 준비: 손자(MCP 서버)가 떴다', Number.isInteger(손자) && 살았나(손자), 나온글.trim().slice(0, 120) || '아무 말도 안 했다');
    if (손자 !== null) {
      아이.kill('SIGTERM');
      await Promise.race([닫힘, 잠깐(12_000)]);
      let 죽었나 = false;
      for (let i = 0; i < 60 && !죽었나; i++) { 죽었나 = !살았나(손자); if (!죽었나) await 잠깐(50); }
      check('★★★ M3 SIGTERM 으로 끝나도 MCP 서버를 거둔다', 죽었나, `손자 ${손자}`);
      check('★★ M3 그리고 deel 은 그 신호로 끝난다 (삼키지 않는다)', 끝난것?.sig === 'SIGTERM', JSON.stringify(끝난것));
      if (!죽었나) { try { process.kill(손자, 'SIGKILL'); } catch { /* 이미 갔다 */ } }
    }
    if (!끝난것) 아이.kill('SIGKILL');
  } else {
    check('(윈도우) SIGTERM 으로 끝내 보기는 유닉스에서 잽니다 — 윈도우는 손이 돌기 전에 죽인다', true);
  }

  // M4 — 설정에서 서버를 빼면 적어 둔 목록도 걷는다. 다 대기로 섰어도, 다 뺐어도.
  {
    const 방 = mkdtempSync(join(tmpdir(), 'deel-mcp-m4-'));
    mkdirSync(join(방, '.deel'), { recursive: true });
    const 적기 = (표) => writeFileSync(join(방, '.deel', 'mcp.json'), JSON.stringify(표), 'utf8');
    const 적힌이름 = () => Object.keys(메모읽기(방)).sort().join(',');
    적기({ mcpServers: { 가: 서버설정('normal'), 나: 서버설정('normal') } });
    await 다붙이기(방, { env: 믿는env, timeout: 4000 });
    모두닫기();
    check('M4 준비: 둘 다 적혔다', 적힌이름() === '가,나', 적힌이름());
    적기({ mcpServers: { 가: 서버설정('normal') } });
    const r = await 다붙이기(방, { env: 믿는env, timeout: 4000 });
    check('★ M4 다 대기로 서도 설정에서 빠진 서버의 메모는 걷는다', r.서버들[0]?.대기 === true && 적힌이름() === '가', `${r.서버들[0]?.대기} · ${적힌이름()}`);
    모두닫기();
    적기({ mcpServers: {} });
    await 다붙이기(방, { env: 믿는env, timeout: 4000 });
    check('★ M4 서버를 다 빼면 적어 둔 목록도 걷는다', 적힌이름() === '' && existsSync(메모자리(방)), 적힌이름() || '(비었다)');
    try { rmSync(방, { recursive: true, force: true }); } catch { /* 자식이 아직 놓지 않았다 */ }
  }
  모두닫기();
}


// 쓴 자리를 이제 치운다.
//
// 전에는 8절 앞에서 치웠다. 그런데 그 뒤로 검사가 더 붙으면서 **지운 폴더에**
// 다시 쓰는 지경이 됐다. 윈도우에서는 자식이 아직 붙들고 있어 rmSync 가 조용히
// 실패해서 폴더가 살아남고, 리눅스에서는 진짜로 지워져서 ENOENT 로 터졌다 —
// 내 PC 에서만 초록인 검사였다. 치우는 자리는 하나고, 그것은 맨 끝이다.
try { rmSync(root, { recursive: true, force: true }); } catch { /* 자식이 아직 놓지 않았다 */ }

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n밖에서 붙인 도구(MCP) 검사  ${D}(진짜 자식 프로세스를 띄워서)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
