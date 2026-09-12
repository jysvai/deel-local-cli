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
import { join } from 'node:path';
import {
  설정읽기, 다붙이기, 이름풀기, 도구정의, 도구최대, 살아있는수, 모두닫기, 깨끗한환경,
  메모자리, 메모읽기, 메모유효, 지문, 쓸만한메모 } from '../src/backend/mcp.js';
import { VERSION } from '../src/version.js';
import { toolSchemas, runTool } from '../src/tools/index.js';
import { Audit } from '../src/safety/audit.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-mcp-'));
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
else if (모드 === 'garbage') { process.stdout.write('이건 JSON 이 아닙니다\\n'); }
if (모드 !== 'silent') 듣기();
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
      답(j.id, {
        protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: '스텁MCP', version: '9.9.9' },
      });
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
      if (j.params.name === '이슈보기') 답(j.id, { content: [{ type: 'text', text: '그런 이슈 없음' }], isError: true });
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

  writeFileSync(join(root, '.deel', 'mcp.json'), '{ 깨진 JSON', 'utf8');
  check('깨진 설정은 이유를 말한다', !!설정읽기(root).오류, 설정읽기(root).오류 ?? '');
  check('깨진 설정이어도 안 터진다', 설정읽기(root).서버들.length === 0);

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
  const 첫판 = await 다붙이기(root, { timeout: 2500, env: 믿는env });
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
