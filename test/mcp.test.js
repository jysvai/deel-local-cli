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
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  설정읽기, 다붙이기, 이름풀기, 도구정의, 도구최대, 살아있는수, 모두닫기, 깨끗한환경 } from '../src/backend/mcp.js';
import { VERSION } from '../src/version.js';
import { toolSchemas, runTool } from '../src/tools/index.js';
import { Audit } from '../src/safety/audit.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-mcp-'));
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

  writeFileSync(join(root, '.deel', 'mcp.json'), '{ 깨진 JSON', 'utf8');
  check('깨진 설정은 이유를 말한다', !!설정읽기(root).오류, 설정읽기(root).오류 ?? '');
  check('깨진 설정이어도 안 터진다', 설정읽기(root).서버들.length === 0);

  rmSync(join(root, '.deel', 'mcp.json'));
  check('설정이 없으면 없다고 한다', 설정읽기(root).있음 === false);
}

trace('3-붙기');

{
  설정쓰기({ mcpServers: { 사내위키: 서버설정() } });
  const r = await 다붙이기(root, { audit: new Audit(root) });
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
  const r = await 다붙이기(root, { timeout: 2500 });
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
  const r = await 다붙이기(root, { timeout: 1200 });
  const 걸린시간 = Date.now() - t0;
  check('답 없는 서버에서 안 멈춘다', 걸린시간 < 6000, `${(걸린시간 / 1000).toFixed(1)}초`);
  check('답 없는 서버는 못 붙었다고 한다', r.서버들.length === 0 && r.못한것.length === 1, JSON.stringify(r.못한것));
  check('시간 초과라고 말해 준다', /초 안에 답이 없습니다/.test(r.못한것[0]?.왜 ?? ''), r.못한것[0]?.왜);
}

{
  // stdout 에 JSON 아닌 것을 쏟는 서버. 로그를 그냥 찍는 서버가 실제로 흔하다.
  설정쓰기({ mcpServers: { 수다쟁이: 서버설정('garbage') } });
  const r = await 다붙이기(root, { timeout: 2500 });
  check('규격 밖의 잡소리는 버리고 계속 간다', r.서버들.length === 1, JSON.stringify(r.못한것));
  for (const s of r.서버들) s.닫기();
}

{
  // 도구를 40개 주는 서버. 스키마가 통째로 매 요청에 실리므로 무한정 받으면
  // 컨텍스트가 조용히 줄어든다. 자르되 **잘랐다고 말한다.**
  설정쓰기({ mcpServers: { 욕심쟁이: 서버설정('many') } });
  const r = await 다붙이기(root, { timeout: 2500 });
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
  const r = await 다붙이기(root, { offline: true });
  check('오프라인이면 안 띄운다', r.서버들.length === 0 && r.잠김 === true);
  check('왜 안 띄웠는지 말한다', /오프라인/.test(r.못한것[0]?.왜 ?? ''), r.못한것[0]?.왜);
}

// ── 우리 환경변수를 남의 프로세스에 넘기지 않는다 ───────────────────────
//
// DEEL_* 에는 게이트웨이 열쇠가 들어 있을 수 있다. 그 값이 넘어가면
// 어디로 가는지 우리가 알 수 없다.
{
  process.env.DEEL_SECRET_TEST = '열쇠-절대-새면-안-됨';
  설정쓰기({ mcpServers: { 환경보는놈: { ...서버설정(), env: { 내가준값: '이건괜찮다' } } } });
  const r = await 다붙이기(root, { timeout: 2500 });
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
  const r = await 다붙이기(root, { timeout: 2500 });

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
  const r = await 다붙이기(root, { timeout: 2500 });
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
  const r = await 다붙이기(root, { timeout: 2500 });

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
  const r = await 다붙이기(root, { timeout: 2500 });
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

try { rmSync(root, { recursive: true, force: true }); } catch { /* 자식이 아직 놓지 않았다 */ }

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


const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n밖에서 붙인 도구(MCP) 검사  ${D}(진짜 자식 프로세스를 띄워서)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
