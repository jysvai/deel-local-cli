// 큰 파일을 시키면 큰 파일이 만들어지는가.
//
// 이 검사 하나가 이번 작업의 통과 기준이다.
//
// 있었던 일:
//   "AX 대시보드 HTML 만들어줘" → 71초 · 도구 13번 · 컨텍스트 소진 · **파일 없음.**
//   모델이 Write 를 부를 때마다 인자 JSON 이 출력 상한에서 잘렸고, 잘린 것은
//   통째로 버려졌다. 모델은 똑같이 다시 보냈고, 똑같은 자리에서 또 잘렸다.
//
//   중간에 한 번 '잘 실패하게' 만든 적이 있다 — 세 번 만에 깔끔히 멈추고
//   "나눠서 시켜 보세요" 라고 말하게. 그건 고친 게 아니다. 사람에게 일을 떠넘긴 것이다.
//
// 그래서 여기서는 딱 하나만 본다 — **파일이 생겼는가. 내용이 온전한가.**
// 몇 번에 나눠 썼는지, 어떤 길로 갔는지는 안 본다. 결과만 본다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { 살린쓰기, partialParse } from '../src/agent/salvage.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { TOOLS, 붙박이그림줄이기 } from '../src/tools/index.js';
import { encode } from '../src/tools/encoding.js';
import { findMatch } from '../src/tools/edit-match.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 만들어야 할 진짜 파일 ────────────────────────────────────────────────
// 1,200줄. 한 번에 못 담는 크기다 — 그게 요점이다.
const 목표줄 = [];
목표줄.push('<!DOCTYPE html>', '<html lang="ko">', '<head>', '<meta charset="utf-8">', '<title>AX 대시보드</title>', '</head>', '<body>');
for (let i = 1; i <= 1190; i++) 목표줄.push(`  <div class="row" data-no="${i}"><span>항목 ${i}</span><b>${i * 7}건</b></div>`);
목표줄.push('</body>', '</html>');
const 목표 = 목표줄.join('\n') + '\n';

trace('1-살리기');

// ── 잘린 JSON 에서 건지는가 ─────────────────────────────────────────────
{
  // 실제로 잘려 오는 모양 그대로. 한글이 \uXXXX 로 오는 게이트웨이가 있다.
  const raw = '{"file_path":"index.html","content":"<!DOCTYPE html>\\n<h1>\\uc548\\ub155</h1>\\n<p>\\ubc18\\ubcf5 \\uc5c5\\ubb34\\ub97c \\uba3c';
  const r = 살린쓰기(raw);
  check('잘려도 경로는 건진다', r?.path === 'index.html', String(r?.path));
  check('받은 데까지 내용을 건진다', r?.content.startsWith('<!DOCTYPE html>'), JSON.stringify(r?.content?.slice(0, 20)));
  check('\\uXXXX 한글이 제대로 풀린다', r?.content.includes('<h1>안녕</h1>'), JSON.stringify(r?.content?.slice(15, 30)));
  check('반쪽 줄은 버린다', !r?.content.includes('먼'), JSON.stringify(r?.content?.slice(-20)));
  check('온전한 줄까지만 남는다', r?.content.endsWith('</h1>\n'), JSON.stringify(r?.content?.slice(-8)));
  check('몇 줄까지 썼는지 안다', r?.lines === 2, String(r?.lines));
  check('마지막 줄을 알려 준다', r?.lastLine === '<h1>안녕</h1>', String(r?.lastLine));
}

{
  // 경로가 잘린 것은 안 건진다 — 엉뚱한 자리에 쓰게 된다.
  const r = 살린쓰기('{"file_path":"src/very/long/pa');
  check('경로가 잘렸으면 안 건진다', r === null, JSON.stringify(r));

  // 내용이 아직 안 온 것도 건질 게 없다.
  check('내용이 없으면 안 건진다', 살린쓰기('{"file_path":"a.txt"') === null, '');

  // escape 가 반토막 난 자리
  const r2 = 살린쓰기('{"file_path":"a.txt","content":"첫 줄\\n둘째 줄\\n셋째\\u12');
  check('반토막 escape 는 버리고 앞은 살린다', r2?.content === '첫 줄\n둘째 줄\n', JSON.stringify(r2?.content));

  // 정상 JSON 이면 partialParse 도 그대로 읽는다
  const p = partialParse('{"a":1,"b":"둘","c":{"d":[1,2]},"e":true}');
  check('멀쩡한 JSON 도 그대로 읽는다',
    p.complete && p.args.a === 1 && p.args.b === '둘' && p.args.c.d[1] === 2 && p.args.e === true,
    JSON.stringify(p.args));
}

trace('2-Append도구');

// ── Append 가 나눠 쓰기를 해내는가 ──────────────────────────────────────
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-append-'));
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  ctx.history.nextTurn();

  TOOLS.Write.run({ file_path: 'out.txt', content: '첫째 줄\n둘째 줄\n' }, ctx);
  const r1 = TOOLS.Append.run({ file_path: 'out.txt', content: '셋째 줄\n' }, ctx);
  const r2 = TOOLS.Append.run({ file_path: 'out.txt', content: '넷째 줄\n' }, ctx);
  const 나온것 = readFileSync(join(방, 'out.txt'), 'utf8');
  check('이어 붙인 내용이 순서대로 들어간다', 나온것 === '첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n', JSON.stringify(나온것));
  check('전체가 몇 줄인지 사실대로 말한다', /전체 4줄/.test(r2.content), r2.content);
  check('붙인 줄 수를 알려 준다', r1.summary.startsWith('+1줄'), r1.summary);

  // 되돌리기 스냅샷은 턴마다 한 번만. 여덟 번 붙이면 이력에 여덟 벌 쌓이면 안 된다.
  const 이력 = ctx.history.all().filter((x) => x.path.endsWith('out.txt'));
  check('한 턴에 스냅샷은 한 벌만 쌓인다', 이력.length === 1, `${이력.length}벌`);

  // 되돌리면 Write 하기 전 상태 — 즉 파일이 없던 상태로.
  ctx.history.undo(1);
  check('되돌리면 붙인 것까지 통째로 사라진다', !existsSync(join(방, 'out.txt')), '');

  // 없는 파일에 붙이면 새로 만든다. 길을 잃은 모델이 여기서 또 막히면 안 된다.
  const r3 = TOOLS.Append.run({ file_path: '없던것.txt', content: '처음\n' }, ctx);
  check('없는 파일에 붙이면 새로 만든다', existsSync(join(방, '없던것.txt')), String(r3.error));

  // CP949 파일에 붙이면 CP949 로 붙어야 한다. 섞이면 그 파일은 그대로 깨진다.
  const cp = join(방, '사내.txt');
  writeFileSync(cp, encode('가나다\n', 'euc-kr').buf);
  TOOLS.Append.run({ file_path: '사내.txt', content: '라마바\n' }, ctx);
  const 붙은것 = readFileSync(cp);
  check('CP949 파일에는 CP949 로 붙인다', 붙은것.equals(encode('가나다\n라마바\n', 'euc-kr').buf), 붙은것.toString('hex'));

  // BOM 파일 한가운데에 BOM 이 또 박히면 안 된다.
  const bom = join(방, 'bom.csv');
  writeFileSync(bom, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('이름,수량\n', 'utf8')]));
  TOOLS.Append.run({ file_path: 'bom.csv', content: '볼펜,3\n' }, ctx);
  const b = readFileSync(bom);
  check('BOM 은 앞에 한 번만 있는다', b.indexOf(Buffer.from([0xEF, 0xBB, 0xBF]), 3) === -1, b.toString('hex').slice(0, 40));
  check('BOM 뒤 내용이 이어진다', b.subarray(3).toString('utf8') === '이름,수량\n볼펜,3\n', JSON.stringify(b.subarray(3).toString('utf8')));

  rmSync(방, { recursive: true, force: true });
}

trace('3-끝까지만들기');

// ── 진짜로 돌려 본다: 잘리는 서버에서 1,200줄 파일이 만들어지는가 ────────
//
// 가짜 게이트웨이가 max_tokens 를 **진짜로 지킨다.** 요청한 상한보다 긴 답은
// 그 자리에서 잘라 버린다. 실제 서버가 하는 일 그대로다.
// 모델 쪽은 "Write 로 시작해서 Append 로 이어 붙인다" 는 것만 안다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-bigfile-'));
  let 보낸데까지 = 0;        // 모델이 지금까지 보낸 줄 수
  const 상한기록 = [];

  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: '가짜' }] }));
      }
      const 요청 = JSON.parse(body || '{}');
      const 상한 = 요청.max_tokens ?? 4096;
      상한기록.push({ max_tokens: 요청.max_tokens, max_completion_tokens: 요청.max_completion_tokens });

      // 도구 결과에 '몇 줄까지 썼다' 가 들어 있으면 그 다음부터 이어 보낸다.
      // 실제 모델이 우리 안내문을 읽고 하는 일을 그대로 흉내 낸다.
      const 마지막결과 = [...(요청.messages ?? [])].reverse().find((m) => m.role === 'tool');
      const m = String(마지막결과?.content ?? '').match(/(\d+)줄(?:까지 저장됨|, 지금 전체 (\d+)줄)/);
      if (m) 보낸데까지 = Number(m[2] ?? m[1]);

      const 처음 = 보낸데까지 === 0;
      if (보낸데까지 >= 목표줄.length) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '대시보드를 만들었습니다.' } }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }));
      }

      // 모델은 '남은 것 전부' 를 한 번에 보내려 든다. 약한 모델이 실제로 그런다.
      const 남은것 = 목표줄.slice(보낸데까지).join('\n') + '\n';
      const 인자 = JSON.stringify({ file_path: 'dashboard.html', content: 남은것 });
      // 서버가 상한을 지킨다 — 토큰을 글자로 어림해 그 자리에서 자른다.
      const 글자상한 = 상한 * 3;
      const 잘린인자 = 인자.length > 글자상한 ? 인자.slice(0, 글자상한) : 인자;
      const 잘렸나 = 잘린인자.length < 인자.length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          index: 0,
          finish_reason: 잘렸나 ? 'length' : 'tool_calls',
          message: {
            role: 'assistant', content: null,
            tool_calls: [{
              id: `c${상한기록.length}`, type: 'function',
              function: { name: 처음 ? 'Write' : 'Append', arguments: 잘린인자 },
            }],
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 500 },
      }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  allowEndpoint(base);

  // 컨텍스트 32k. 사용자가 쓰던 조건이다.
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: '가짜', ctx: 32768, streaming: false, tools: true };
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  const session = new Session(conn, { root: 방, think: 'off', maxSteps: 40 });

  const ev = [];
  for await (const e of run(session, ctx, 'AX 대시보드 HTML 만들어줘')) ev.push(e);

  const 만든것 = join(방, 'dashboard.html');
  check('★ 파일이 실제로 만들어졌다', existsSync(만든것), existsSync(만든것) ? '있음' : '없음');

  const 나온것 = existsSync(만든것) ? readFileSync(만든것, 'utf8') : '';
  check('★ 내용이 처음부터 끝까지 온전하다', 나온것 === 목표,
    나온것 === 목표 ? `${나온것.split('\n').length - 1}줄` : `${나온것.split('\n').length - 1}줄 / 목표 ${목표줄.length}줄`);
  check('★ 끝맺음 태그까지 다 있다', 나온것.trimEnd().endsWith('</html>'), JSON.stringify(나온것.trimEnd().slice(-20)));
  check('★ 중간에 헛돌다 멈추지 않았다', !ev.some((e) => e.type === 'stuck'),
    ev.find((e) => e.type === 'stuck')?.why ?? '');
  check('★ 걸음 수를 다 쓰고 끝나지 않았다', !ev.some((e) => e.type === 'limit'), '');
  check('끝맺을 때 파일을 확인해서 알려 준다',
    (ev.find((e) => e.type === 'done')?.files ?? []).some((f) => f.path === 만든것 && f.lines === 1199),
    JSON.stringify(ev.find((e) => e.type === 'done')?.files));

  // 나눠 쓰기가 실제로 일어났는지 (한 번에 됐다면 이 검사가 무의미하니 같이 본다)
  const 쓰기횟수 = ev.filter((e) => e.type === 'tool' && (e.name === 'Write' || e.name === 'Append')).length;
  check('한 번에 안 되는 크기를 나눠서 해냈다', 쓰기횟수 >= 2, `${쓰기횟수}번에 나눠 씀`);

  // 두 이름으로 상한을 같이 보냈는가 (GPT-5 계열 게이트웨이는 뒤엣것만 본다)
  check('상한을 두 이름으로 같이 보낸다',
    상한기록.every((x) => x.max_tokens > 0 && x.max_completion_tokens === x.max_tokens),
    JSON.stringify(상한기록[0]));

  srv.close();
  rmSync(방, { recursive: true, force: true });
}

trace('4-큰덩이편집');

// ── 아주 큰 덩이를 old_string 으로 넘겼을 때 ────────────────────────────
//
// 모델은 큰 파일을 고칠 때 덩이를 통째로 old_string 에 담아 보낸다. 그런데
// 정확히 일치하지 않으면 느슨한 단계로 넘어가면서 그 덩이로 정규식을 만든다.
// 4만 자를 넘으면 정규식이 만들어지기는 하는데 **돌릴 때** 터진다 —
// new RegExp 를 감싼 try 는 만들 때만 보므로 그 SyntaxError 가 그대로 튀어
// 나가서, "찾지 못했습니다" 대신 도구가 죽는다.
//
// 3,000줄짜리 덩이는 실제로 오는 크기다. 죽는 대신 못 찾았다고 말해야 한다.
{
  const 큰덩이 = Array.from({ length: 3000 }, (_, i) => `  const v${i} = f(${i});`).join('\n');
  let 죽었나 = null;
  let 답 = null;
  try { 답 = findMatch('짧은 글 한 줄\n', 큰덩이); } catch (e) { 죽었나 = e; }
  check('아주 큰 old_string 에서 안 죽는다', !죽었나,
    죽었나 ? `${죽었나.constructor.name}: ${String(죽었나.message).slice(0, 40)}` : `${큰덩이.length}자`);
  check('못 찾았으면 못 찾았다고 답한다', !죽었나 && 답?.ok === false, JSON.stringify(답?.reason ?? null));

  // 큰 덩이라도 정확히 있으면 찾아야 한다 — 무조건 포기하는 것으로 고치면 안 된다.
  let 큰것찾기 = null;
  try { 큰것찾기 = findMatch(`머리\n${큰덩이}\n꼬리\n`, 큰덩이); } catch (e) { 큰것찾기 = { ok: false, reason: e.constructor.name }; }
  check('큰 덩이도 그대로 있으면 찾는다', 큰것찾기?.ok === true, JSON.stringify(큰것찾기?.reason ?? 큰것찾기?.tier));
}

trace('4.5-그림이박힌파일읽기');

/*
 * ── 919줄인데 5MB 인 파일 ───────────────────────────────────────────────
 *
 * 사내 업무용 HTML 은 그림을 파일 안에 base64 로 박아 넣는다. 줄
 * 수는 멀쩡한데 한 줄이 메가바이트다. 그런 파일을 시켰을 때 실제로 이랬다 —
 *
 *   ◧ Read(…문서.html)   919줄     ← 열한 번
 *   ▶ Bash(node -e "s.replace(/data:image\/…base64,[^\"']+/g,'…')")
 *     └ 막힘 — 작업 범위 밖입니다
 *   ⏺ Ask → "어떤 내용을 수정할까요?"
 *
 * 모델은 **base64 를 지워야 읽을 수 있다는 것을 스스로 알아냈다.** 그 명령이
 * 막히니 열한 번을 다시 읽고, 그래도 못 봐서 사람에게 되물었다.
 *
 * 여기서 재는 것은 "그림을 뺐나" 가 아니라 **모델이 몇 줄이나 보게 되나** 다.
 * 그게 이 결함의 크기이자 고쳤는지의 기준이다.
 */
{
  const 그림 = 'A'.repeat(1200000);
  const 줄들 = [];
  for (let i = 0; i < 919; i++) {
    줄들.push(i % 150 === 7
      ? `    <img src="data:image/png;base64,${그림}">`
      : `    <div class="section">본문 단락 ${i}</div>`);
  }
  const 번호붙이기 = (ls) => ls.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
  // Read 가 실어 보내는 상한과 같은 값으로 잰다 (tools/index.js 의 MAX_OUT).
  const 보이는줄 = (s) => (s.slice(0, 30000).match(/\n/g) ?? []).length + 1;

  const 그대로 = 보이는줄(번호붙이기(줄들));
  const 줄인것 = 붙박이그림줄이기(줄들);
  const 줄인뒤 = 보이는줄(번호붙이기(줄인것.줄들));

  check('그림을 안 빼면 문서가 거의 안 보인다', 그대로 < 20, `${그대로}/919줄`);
  check('그림을 빼면 문서 대부분이 보인다', 줄인뒤 > 500, `${그대로}/919줄 → ${줄인뒤}/919줄`);
  check('뺀 만큼을 얼마인지 알려 준다', /8\.0MB|8\.1MB/.test(줄인것.알림), 줄인것.알림.slice(0, 70));
  check('파일이 그대로라는 것과 Edit 주의를 같이 적는다',
    /파일은 그대로/.test(줄인것.알림) && /old_string/.test(줄인것.알림), 줄인것.알림.slice(0, 90));

  // 뼈대는 한 글자도 안 잃어야 한다. 그림만 빼는 것이지 문서를 줄이는 게 아니다.
  const 본문줄 = 줄인것.줄들.filter((l) => l.includes('본문 단락'));
  check('그림이 아닌 줄은 한 글자도 안 건드린다',
    본문줄.length === 912 && 본문줄.every((l, i) => l === 줄들.filter((x) => x.includes('본문 단락'))[i]),
    `${본문줄.length}줄`);
  // 그림 줄도 사라지지 않는다 — 어디에 무엇이 있었는지는 남아야 고칠 수 있다.
  check('그림 줄 자체는 남는다',
    줄인것.줄들.filter((l) => l.includes('data:image/png;base64,')).length === 7,
    `${줄인것.줄들.filter((l) => l.includes('base64')).length}줄`);

  // 작은 그림은 그냥 둔다. 아이콘 하나까지 가리면 오히려 못 알아본다.
  const 작은것 = 붙박이그림줄이기([`<img src="data:image/gif;base64,${'B'.repeat(80)}">`]);
  check('작은 그림은 그대로 둔다', 작은것.몇개 === 0, `${작은것.몇개}개 줄임`);
}

trace('4-2-안보여준것을지우게두지않는다');

// ── 안 보여 준 그림을 모델이 지우게 두지 않는다 ─────────────────────────
//
// 위 줄이기는 **읽을 때만** 그림을 뺀다. 파일은 그대로다. 그런데 그 다음이
// 문제였다 — 모델은 그렇게 받은 글을 손봐서 Write 로 통째로 덮어쓴다. 제가
// 못 본 그림은 새 내용에 없으니 **사용자 파일에서 그림이 사라진다.**
//
//   ◧ Read(보고서.html)   1425줄 · 그림 8.0MB 생략
//   ◈ Write(보고서.html)  1420줄        ← 8MB 짜리 그림 일곱 개가 여기서 없어진다
//
// 오류도 없고 화면도 멀쩡하다. 파일을 열어 봐야 안다 — 그림이 있던 자리에
// 깨진 아이콘만 남는다. 몇 주 뒤에 알아채면 되돌릴 방법도 없다.
//
// 안 보여 준 것에 대한 책임은 우리에게 있다. 모델은 있는 줄 몰랐던 것을
// 지킬 수 없다. 그래서 재는 것은 **파일이 바이트 하나까지 그대로인가** 다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-img-'));
  const 파일 = join(방, '보고서.html');
  const 그림태그 = (n) => `<img src="data:image/png;base64,${'A'.repeat(n)}">`;
  const 원본 = `<html>\n<h1>분기 보고</h1>\n${그림태그(3000)}\n${그림태그(3000)}\n<p>끝</p>\n</html>`;
  writeFileSync(파일, 원본, 'utf8');
  const 원래바이트 = readFileSync(파일).length;

  const c = {
    scope: makeScope(방), history: new History(방), audit: new Audit(방),
    seen: new Set(), 모델컨텍스트: 200000, enc: new Map(),
  };

  const 읽은것 = await TOOLS.Read.run({ file_path: '보고서.html' }, c);
  check('준비: 읽을 때 그림이 빠진다', /생략/.test(읽은것.summary), 읽은것.summary);

  // ① 모델이 **본 대로** 되쓴다 — 생략 표시가 그대로 들어간 채로.
  const 본대로 = 읽은것.content.split('\n')
    .filter((l) => /^\s*\d+\t/.test(l)).map((l) => l.replace(/^\s*\d+\t/, '')).join('\n');
  const 쓴것1 = await TOOLS.Write.run(
    { file_path: '보고서.html', content: 본대로.replace('분기 보고', '2분기 보고') }, c,
  );
  check('★ 생략 표시를 되쓰면 막는다', !!쓴것1.error, JSON.stringify(쓴것1).slice(0, 90));
  check('몇 개를 잃는지 숫자로 말한다', /그림 2개 중 2개/.test(쓴것1.error ?? ''), (쓴것1.error ?? '').split('\n')[0]);
  check('자리 표시라는 것을 알려 준다', /자리 표시/.test(쓴것1.error ?? ''), (쓴것1.error ?? '').split('\n')[1] ?? '');
  check('어떻게 하면 되는지 준다 (Edit)', /Edit/.test(쓴것1.error ?? ''), '');

  // ② 모델이 img 줄을 **통째로 지우고** 쓴다. 이쪽이 더 흔하고, 생략 표시도 없다.
  const 쓴것2 = await TOOLS.Write.run(
    { file_path: '보고서.html', content: '<html>\n<h1>2분기 보고</h1>\n<p>끝</p>\n</html>' }, c,
  );
  check('★ img 줄을 지우고 써도 막는다 (표시가 없어도 개수로 잡는다)', !!쓴것2.error,
    JSON.stringify(쓴것2).slice(0, 90));

  check('★ 파일이 바이트 하나까지 그대로다', readFileSync(파일).length === 원래바이트,
    `${원래바이트} → ${readFileSync(파일).length}`);

  /*
   * ★ 반대쪽. 그림을 그대로 들고 오면 통과해야 한다.
   *
   * 이걸 같이 안 재면 Write 를 통째로 막아 놓고도 위가 전부 초록이 된다.
   */
  const 쓴것3 = await TOOLS.Write.run(
    { file_path: '보고서.html', content: 원본.replace('분기 보고', '3분기 보고') }, c,
  );
  check('★ 그림을 그대로 들고 오면 쓴다', !쓴것3.error, JSON.stringify(쓴것3).slice(0, 90));
  check('실제로 고쳐졌다', readFileSync(파일, 'utf8').includes('3분기 보고'));
  check('그림도 그대로 남았다', readFileSync(파일, 'utf8').split('base64,').length - 1 === 2);

  // 그림이 없던 파일은 이 검사에 안 걸린다. 평범한 덮어쓰기가 막히면 안 된다.
  writeFileSync(join(방, '그냥.txt'), '한 줄\n두 줄\n', 'utf8');
  const 쓴것4 = await TOOLS.Write.run({ file_path: '그냥.txt', content: '바뀐 줄\n' }, c);
  check('★ 그림 없는 파일은 그냥 덮어쓴다', !쓴것4.error, JSON.stringify(쓴것4).slice(0, 90));

  rmSync(방, { recursive: true, force: true });
}

trace('5-치움');
resetNet();

/*
 * ── ★ 조각만 읽었으면 그렇다고 표시한다 ────────────────────────────────
 *
 * `부분인가` 는 「우리가 들고 있는 것이 파일 전부가 아니다」 는 뜻이다.
 * 읽은 파일 기억(agent/filemem.js)이 이 깃발 하나로 갈린다 — 조각을 통째로
 * 읽은 것처럼 기억해 두면, 다음에 같은 파일을 읽을 때 「앞에서 읽은
 * 그대로입니다」 가 나간다. 모델은 **안 본 데를 봤다고 여긴다.**
 *
 * filemem 쪽은 깃발을 넣어 주면 제대로 도는 것을 이미 재고 있었다. 안 재던
 * 것은 **Read 가 그 깃발을 세우는가** 였다. 그 자리를 `부분인가: false` 로
 * 고정해도 전체 검사가 초록이었다 — 이미 한 번 겪은 고장과 똑같은 모양의
 * 다음 고장이 거기 있었다.
 */
trace('9-조각표시');
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-part-'));
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  const p = join(방, '백줄.txt');
  writeFileSync(p, Array.from({ length: 100 }, (_, i) => `${i + 1}번째 줄 내용`).join('\n') + '\n', 'utf8');

  const 통째로 = await TOOLS.Read.run({ file_path: p }, ctx);
  check('다 준 경우에는 조각이라고 안 한다', 통째로.부분인가 !== true,
    `부분인가=${String(통째로.부분인가)} · ${통째로.summary ?? ''}`);

  const 잘라읽기 = await TOOLS.Read.run({ file_path: p, offset: 10, limit: 5 }, ctx);
  check('★ offset·limit 로 잘라 읽으면 조각이라고 표시한다', 잘라읽기.부분인가 === true,
    `부분인가=${String(잘라읽기.부분인가)} · ${잘라읽기.summary ?? ''}`);

  // 창이 작아 다 못 싣는 경우도 조각이다. 이쪽이 사람 눈에 더 안 보인다.
  const 좁은ctx = { ...ctx, seen: new Set(), 모델컨텍스트: 4096 };
  const 긴것 = join(방, '아주긴것.txt');
  writeFileSync(긴것, Array.from({ length: 8000 }, (_, i) => `${i} 아주 긴 줄을 넣어 창을 넘긴다`).join('\n'), 'utf8');
  const 다못준것 = await TOOLS.Read.run({ file_path: 긴것 }, 좁은ctx);
  check('★ 창이 작아 다 못 실었을 때도 조각이라고 표시한다', 다못준것.부분인가 === true,
    `부분인가=${String(다못준것.부분인가)} · ${다못준것.summary ?? ''}`);

  /*
   * ★ 그리고 그 깃발이 **파일 기억까지 닿는지** 본다.
   *
   * 깃발만 세우고 안 넘겨 주면 아무 소용이 없다. 조각을 두 번 읽었을 때
   * 두 번째가 「앞에서 읽은 그대로입니다」 가 되면 안 된다.
   */
  const { 파일기억 } = await import('../src/agent/filemem.js');
  const 기억 = new 파일기억();
  기억.실을것(p, 잘라읽기.content, { 부분인가: !!잘라읽기.부분인가 });
  const 두번째 = 기억.실을것(p, 잘라읽기.content, { 부분인가: !!잘라읽기.부분인가 });
  check('★ 조각은 두 번 읽어도 「그대로입니다」 라고 안 한다', 두번째.어떻게 === 'full', 두번째.어떻게);

  rmSync(방, { recursive: true, force: true });
}

trace('N-이어붙이는-값');

// ── 이어 붙이는 값이 파일 크기를 따라가면 안 된다 ────────────────────────
//
// Append 의 설명문이 「한 번에 다 담으려다 잘리는 것보다 나눠서 확실히 남기는
// 편이 낫다」 다. 그 말대로 하면 한 파일에 Append 가 스무 번쯤 불린다.
//
// 그런데 그 스무 번이 매번 파일을 통째로 읽고 있었다. 한 번에 세 벌씩이다.
//
//   바이너리인가(abs)   readFileSync 전체 — 정작 looksBinary 는 앞 8000바이트만 본다
//   재는인코딩(abs)     readFileSync 전체 — 붙일 때마다 같은 답을 다시 잰다
//   줄수(abs, 원래)     readFileSync 전체 + 해독 + split('\n')
//
// 30MB 짜리 로그에 다섯 줄 붙이는 데 1초가 든다. 붙이는 내용은 다섯 줄인데
// 450MB 를 읽는다. 그리고 그 값은 화면에 안 나온다 — 모델이 느려 보일 뿐이다.
//
// 그래서 **파일 크기와 상관없어야 한다** 를 잰다. 시계로 재는 검사는 기계
// 속도를 타므로, 같은 기계에서 잰 작은 파일과 견준다. 배수로 보면 기계가
// 빠르든 느리든 같은 뜻이 된다.
{
  const 뿌리 = mkdtempSync(join(tmpdir(), 'deel-append-'));
  const ctx = {
    scope: makeScope(뿌리), history: new History(뿌리), audit: new Audit(뿌리),
    seen: new Set(), enc: new Map(),
  };
  const 붙이기 = (이름, 글) => TOOLS.Append.run({ file_path: 이름, content: 글 }, ctx);

  // 30MB. 한 줄 240바이트 남짓으로 채운다.
  const 한줄 = '가'.repeat(79) + '\n';
  const 큰줄수 = Math.round(30 * 1024 * 1024 / Buffer.byteLength(한줄, 'utf8'));
  writeFileSync(join(뿌리, '큰것.txt'), 한줄.repeat(큰줄수), 'utf8');
  writeFileSync(join(뿌리, '작은것.txt'), 한줄.repeat(5), 'utf8');

  const 재기 = (이름) => {
    // 첫 판은 버린다 — 모듈 데우기가 섞이면 배수가 거짓말을 한다.
    붙이기(이름, '데우기\n');
    const 시작 = process.hrtime.bigint();
    for (let n = 0; n < 5; n++) 붙이기(이름, `줄 ${n}\n`);
    return Number(process.hrtime.bigint() - 시작) / 1e6;
  };
  const 작은값 = 재기('작은것.txt');
  const 큰값 = 재기('큰것.txt');
  const 배수 = 큰값 / Math.max(작은값, 1);

  check('★★ 30MB 파일에 이어 붙이는 값이 크기를 안 탄다',
    배수 <= 5 && 큰값 < 250,
    `작은 파일 ${작은값.toFixed(0)}ms · 30MB ${큰값.toFixed(0)}ms · ${배수.toFixed(1)}배`);

  // ── 값을 깎았다고 수가 틀리면 안 된다 ──────────────────────────────────
  //
  // 전체 줄 수는 모델이 「어디까지 썼나」 를 세는 데 쓰는 수다. 매번 다시 세는
  // 대신 들고 더하기로 바꾸면, 아래 다섯 가지가 전부 맞아야 그 값이 참이다.
  const 줄따기 = (r) => Number(/전체 (\d+)줄/.exec(r?.content ?? '')?.[1] ?? -1);

  writeFileSync(join(뿌리, '끝에줄바꿈.txt'), 'ㄱ\nㄴ\n', 'utf8');
  check('끝이 줄바꿈이면 그대로 더한다', 줄따기(붙이기('끝에줄바꿈.txt', 'ㄷ\nㄹ\n')) === 4, 'ㄱㄴ + ㄷㄹ = 4');

  // 마지막 줄이 안 끝난 파일. 붙인 첫 줄은 **그 줄에 이어진다** — 한 줄 덜 는다.
  writeFileSync(join(뿌리, '끝에줄바꿈없음.txt'), 'ㄱ\nㄴ', 'utf8');
  check('끝이 줄바꿈이 아니면 첫 줄은 이어 붙는다', 줄따기(붙이기('끝에줄바꿈없음.txt', '더\n다음\n')) === 3, 'ㄱ + ㄴ더 + 다음 = 3');

  check('없던 파일은 새로 만들고 그만큼 센다', 줄따기(붙이기('처음.txt', 'ㄱ\nㄴ\nㄷ\n')) === 3);
  check('두 번째부터도 맞다', 줄따기(붙이기('처음.txt', 'ㄹ\n')) === 4);
  check('세 번째도 맞다', 줄따기(붙이기('처음.txt', 'ㅁ\nㅂ\n')) === 6);

  // CP949 파일에 이어 붙여도 인코딩과 줄 수가 같이 맞아야 한다.
  writeFileSync(join(뿌리, '한글.txt'), encode('결재\n요청\n', 'euc-kr').buf);
  const 한글결과 = 붙이기('한글.txt', '드립니다\n');
  check('CP949 파일도 줄 수가 맞다', 줄따기(한글결과) === 3, 한글결과?.content);
  check('CP949 파일은 CP949 로 이어진다',
    readFileSync(join(뿌리, '한글.txt')).equals(encode('결재\n요청\n드립니다\n', 'euc-kr').buf));

  // ★ 밖에서 파일이 바뀌면 들고 있던 수는 거짓말이 된다. 다시 세야 한다.
  writeFileSync(join(뿌리, '처음.txt'), 'ㄱ\n', 'utf8');
  check('★ 남이 파일을 갈아치우면 다시 센다', 줄따기(붙이기('처음.txt', 'ㄴ\n')) === 2,
    '밖에서 1줄로 줄여 놓았다');

  rmSync(뿌리, { recursive: true, force: true });
}


const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n큰 파일 만들기 검사  ${D}(사람이 쪼개 주지 않아도 끝까지 만드는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
