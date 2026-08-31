// 시킨 것을 빼놓고 끝내지 않는다.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 「요청사항이 다량의 요청사항일 경우 몇 번 까먹거나, 요청사항이 누락되거나
//   그런 이슈들이 생겨」
//
// 네 가지를 시키면 셋을 하고 끝낸다. 그것도 조용히 — 안 한 것을 안 했다고
// 말하지 않으니 사람은 다 된 줄 알고 그 위에 다음 것을 쌓는다.
//
// 여태 있던 되밀기(loop.js 의 밀어줄까)로는 이걸 못 잡는다. 그건 **아무것도
// 안 바꿨을 때**만 본다 — 셋을 고쳤으면 뭐라도 바꾼 것이라 그냥 지나간다.
//
// 여기서 재는 것은 셋이다.
//   1) 시킨 말을 항목으로 제대로 쪼개나
//   2) 자국이 하나도 없는 항목을 집어내나 — 그리고 **다 한 것을 안 했다고 안 하나**
//   3) 접힐 때 시킨 말 원문이 살아남나
import { 요청항목들, 빠진것, 빠졌다는말, 알맹이낱말 } from '../src/agent/asks.js';
import { 못박은요청 } from '../src/agent/compact.js';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 제보에 나온 그 요청.
const 네가지 = [
  '1. 붙여넣기 해도 창에 붙여넣기된 내용이 다 뜨는 게 아니야',
  '2. esc 누르면 아직도 작업이 안 멈추는 이슈가 있어',
  '3. 요청사항이 다량일 경우 몇 번 까먹거나 누락되는 이슈가 생겨',
  '4. 다른 cli 쓰다가 deel 쓰면 기능적으로 부족한 부분이 있어',
].join('\n');

trace('1-쪼개기');

// ── 1. 시킨 말을 항목으로 쪼갠다 ───────────────────────────────────────
{
  check('★ 번호 목록을 항목으로 쪼갠다', 요청항목들(네가지).length === 4,
    String(요청항목들(네가지).length));
  check('번호는 빼고 글만 담는다', !/^1\./.test(요청항목들(네가지)[0].글),
    요청항목들(네가지)[0].글);
  check('차례를 매겨 준다', 요청항목들(네가지).map((x) => x.번호).join(',') === '1,2,3,4');

  check('글머리표도 쪼갠다', 요청항목들('- 하나 고쳐\n- 둘 고쳐').length === 2);
  check('닫는 괄호 꼴도 쪼갠다', 요청항목들('1) 하나\n2) 둘').length === 2);

  // 표가 없어도, 줄마다 시키는 꼴이면 그것도 목록이다.
  const 시킴꼴로 = '붙여넣기 표시 고쳐줘\nesc 도 멈추게 해줘\n누락도 막아주세요';
  check('★ 번호가 없어도 줄마다 시키면 목록으로 본다', 요청항목들(시킴꼴로).length === 3,
    String(요청항목들(시킴꼴로).length));

  // 하나짜리는 목록이 아니다. 쪼갤수록 없는 항목이 생기고, 없는 항목을
  // "안 했다" 고 말하는 것이 제일 나쁘다.
  check('한 줄짜리는 목록이 아니다', 요청항목들('이 파일 고쳐줘').length === 0);
  check('표 하나만 있는 것도 목록이 아니다', 요청항목들('- 이것만 고쳐줘').length === 0);
  check('평범한 여러 줄 설명은 목록이 아니다',
    요청항목들('이 코드가 좀 이상해\n어제부터 그래\n한번 봐줘').length === 0,
    JSON.stringify(요청항목들('이 코드가 좀 이상해\n어제부터 그래\n한번 봐줘')));
  check('아무것도 안 줘도 안 터진다', 요청항목들().length === 0 && 요청항목들(null).length === 0);

  // 글 가운데 판 번호를 항목으로 세면 평범한 한마디가 목록으로 둔갑한다.
  check('★ 글 가운데 숫자는 항목이 아니다',
    요청항목들('1.6.1 에서 생긴 문제인데 봐 줄래').length === 0);
}

trace('2-알맹이');

// ── 2. 알맹이 낱말 ─────────────────────────────────────────────────────
//
// 뜻 없는 말이 자국에 보였다고 그 항목을 다룬 것은 아니다. '다른' 은 거의 모든
// 글에 있고, '문제' 와 '이슈' 는 어떤 보고에도 나온다. 안 걸러 두면 "안 한 것"
// 이 하나도 안 잡혀서, 있으나 마나 한 검사가 된다.
{
  const 낱말 = 알맹이낱말('다른 cli 쓰다가 deel 쓰면 기능적으로 부족한 부분이 있어');
  check('★ 뜻 없는 말은 뺀다', !낱말.includes('다른') && !낱말.includes('부분') && !낱말.includes('있어'),
    낱말.join(','));
  check('알맹이는 남긴다', 낱말.includes('cli') && 낱말.includes('deel'), 낱말.join(','));
  check('한 글자는 안 센다', !알맹이낱말('이 것 을 다 해').length,
    알맹이낱말('이 것 을 다 해').join(','));
  check('같은 말은 한 번만', 알맹이낱말('붙여넣기 붙여넣기 붙여넣기').length === 1);
}

trace('3-대조');

// ── 3. 자국이 없는 항목을 집어낸다 ─────────────────────────────────────
{
  // 셋만 하고 끝냈을 때 — 제보받은 그 모양.
  const 셋만 = [
    '☑ 붙여넣기된 내용 표시 고침',
    '☑ esc 누르면 작업이 멈추게 고침',
    '☑ 다른 cli 대비 기능 보강',
    'src/repl.js',
    'src/tools/fastgrep.js',
    '붙여넣기 표시와 esc 중단, cli 기능 보강 세 가지를 고쳤습니다',
  ];
  const 빠짐 = 빠진것({ 요청: 네가지, 자국: 셋만 });
  check('★ 안 한 하나를 집어낸다', 빠짐.length === 1, `${빠짐.length}개: ${빠짐.map((x) => x.번호).join(',')}`);
  check('★ 그것이 3번이다', 빠짐[0]?.번호 === 3, String(빠짐[0]?.번호));
  check('빠진 글을 그대로 들고 있다', /누락/.test(빠짐[0]?.글 ?? ''), 빠짐[0]?.글 ?? '');

  /*
   * 여기가 제일 중요하다.
   *
   * 다 한 일을 "안 했다" 고 말하면 사람은 이 말을 믿지 않게 되고, 그때부터
   * 이 검사는 없느니만 못하다. 그래서 놓치는 쪽으로 틀리게 두었다.
   */
  const 넷다 = [...셋만, '☑ 요청이 많을 때 누락되는 것 고침'];
  check('★ 네 개 다 했으면 아무것도 안 건다', 빠진것({ 요청: 네가지, 자국: 넷다 }).length === 0,
    JSON.stringify(빠진것({ 요청: 네가지, 자국: 넷다 }).map((x) => x.번호)));

  // 말투가 달라도 알아본다. 시킨 말과 한 일의 말투는 원래 다르다.
  const 말투다름 = [
    '☑ 붙여넣은 글을 접힌 칩으로 보여 주기',
    '☑ ESC 중단이 실제로 먹게',
    '☑ 요청 누락 대조',
    '☑ 다중 파일 편집(cli 기능)',
  ];
  check('★ 말투가 달라도 다룬 것으로 본다', 빠진것({ 요청: 네가지, 자국: 말투다름 }).length === 0,
    JSON.stringify(빠진것({ 요청: 네가지, 자국: 말투다름 }).map((x) => x.글.slice(0, 16))));

  /*
   * 뜻 없는 말 하나가 스쳤다고 다룬 것이 아니다.
   *
   * 여기가 없으면, 걸러내기를 통째로 지워도 검사가 거의 안 빨개진다 —
   * 그러면 관문은 남아 있는데 아무것도 안 잡는 상태가 되고, 그건 고쳐 놓은
   * 척만 하는 코드다. 보고에 '문제' 한 마디만 있어도 다 한 것으로 볼 수는 없다.
   */
  const 두루뭉술 = [
    '1. 붙여넣기 표시 고쳐줘',
    '2. 요청이 많을 때 누락되는 문제 고쳐줘',
  ].join('\n');
  const 스친것 = 빠진것({ 요청: 두루뭉술, 자국: ['☑ 붙여넣기 표시 고침', '그 밖의 문제도 살펴봤습니다'] });
  check('★ 뜻 없는 말이 스친 것은 다룬 것이 아니다', 스친것.length === 1 && 스친것[0].번호 === 2,
    JSON.stringify(스친것.map((x) => x.번호)));

  check('아무것도 안 했으면 전부 걸린다', 빠진것({ 요청: 네가지, 자국: [] }).length === 4);
  // 하나짜리 요청은 여기서 안 본다. 그건 되밀기(loop.js)가 볼 일이다.
  check('★ 하나짜리 요청은 대조하지 않는다',
    빠진것({ 요청: '이 파일 고쳐줘', 자국: [] }).length === 0);
  check('아무것도 안 줘도 안 터진다', 빠진것().length === 0);
}

trace('4-되미는말');

// ── 4. 되밀 때 무엇을 말하나 ───────────────────────────────────────────
{
  const 빠짐 = 빠진것({ 요청: 네가지, 자국: ['☑ 붙여넣기 표시', '☑ esc 중단'] });
  const 말 = 빠졌다는말(빠짐);
  check('몇 가지가 빠졌는지 센다', /2가지/.test(말), 말.split('\n')[0]);
  // "빠뜨린 것이 있습니다" 만으로는 모델이 무엇을 빠뜨렸는지 못 찾는다.
  // 못 찾으니까 빠뜨린 것이다.
  check('★ 무엇이 빠졌는지 그대로 다시 적어 준다',
    /누락되는/.test(말) && /기능적으로/.test(말), 말);
  check('번호도 같이 준다', /3\./.test(말) && /4\./.test(말), 말);
  // 못 하는 것을 억지로 시키면 안 된다. 못 하면 못 한다고 말할 길을 준다.
  check('★ 못 하는 것이면 밝히라고 한다', /못 하는 것이면/.test(말), 말.split('\n').at(-1));
  check('말없이 빼놓지 말라고 못 박는다', /말없이 빼놓고/.test(말));

  const 영어 = 빠졌다는말(빠짐, { 영어: true });
  check('영어로도 말한다', /have not addressed 2/.test(영어), 영어.split('\n')[0]);
}

trace('5-접혀도-남나');

// ── 5. 접힐 때 시킨 말이 살아남는가 ────────────────────────────────────
//
// 요약 지시에는 「## 목표 — 사용자가 무엇을 시켰는가」 가 있다. 그런데 요약은
// 요약이다. 네 가지를 적어 준 요청이 「네 가지를 고쳐 달라고 했다」 한 줄로
// 뭉개지고, 그 네 가지가 무엇이었는지는 사라진다. 그러면 남은 것을 이어 하려
// 해도 무엇이 남았는지 모른다.
{
  const 박은것 = 못박은요청({ 이번요청: 네가지 });
  check('★ 시킨 말이 글자 그대로 실린다',
    박은것.includes('요청사항이 다량일 경우 몇 번 까먹거나 누락되는 이슈가 생겨'),
    박은것.slice(0, 60));
  check('네 항목이 다 실린다',
    ['붙여넣기', 'esc', '누락', 'cli'].every((x) => 박은것.includes(x)), 박은것.length + '자');
  check('요약이 아니라 원문이라고 밝힌다', /원문 그대로/.test(박은것), 박은것.split('\n')[0]);
  check('빠짐없이 하라고 못 박는다', /빠짐없이/.test(박은것));

  // 시킨 말이 없으면 아무것도 안 붙인다 — 빈 표를 붙이면 자리만 먹는다.
  check('시킨 말이 없으면 안 붙인다', 못박은요청({}) === '' && 못박은요청() === '');
  check('빈 글도 안 붙인다', 못박은요청({ 이번요청: '   ' }) === '');

  // 아주 긴 붙여넣기까지 통째로 다시 실으면 접은 뜻이 없어진다.
  const 긴것 = 못박은요청({ 이번요청: `${'가'.repeat(3000)}\n마지막줄` });
  check('★ 너무 길면 앞부분만 — 접은 뜻이 없어지면 안 된다', 긴것.length < 1500, `${긴것.length}자`);
  check('줄였다는 것을 밝힌다', /뒷부분 줄임/.test(긴것));
  // 앞부분을 남기는 까닭: 항목 목록은 대개 글 앞머리에 있다.
  check('앞부분을 남긴다', 긴것.includes('가'.repeat(100)));
}

trace('6-루프에서-진짜로');

// ── 6. 루프가 실제로 되미는가 ──────────────────────────────────────────
//
// 위까지는 순수 함수를 쟀다. 그런데 이 결함이 잡으려는 것은 "턴이 끝날 때
// 실제로 걸리나" 이고, 그건 루프를 돌려 봐야만 안다. 특히 여태 있던
// 되밀기(손댄파일.size 로 빠져나가는 쪽)와 안 부딪히는지가 요점이다 —
// 셋을 고쳤으면 뭐라도 바꾼 것이라 그쪽은 그냥 지나간다.
{
  let 대본 = [];
  let 차례 = 0;
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const 보내기 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (String(req.url).endsWith('/models')) return 보내기({ data: [{ id: '스텁모델' }] });
      const 걸음 = 대본[차례++] ?? { text: '(대본 끝)' };
      const 답 = 걸음.도구
        ? { role: 'assistant', content: null,
          tool_calls: [{ id: `c${차례}`, type: 'function',
            function: { name: 걸음.도구.name, arguments: JSON.stringify(걸음.도구.args) } }] }
        : { role: 'assistant', content: 걸음.text };
      return 보내기({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: 걸음.도구 ? 'tool_calls' : 'stop', message: 답 }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;
  allowEndpoint(주소);

  const 돌려보기 = async (대본줄) => {
    대본 = 대본줄; 차례 = 0;
    const 방 = mkdtempSync(join(tmpdir(), 'deel-asks-'));
    const conn = { kind: 'openai', base: 주소, auth: 'none', key: '', model: '스텁모델', ctx: 32768, streaming: false, tools: true };
    const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
    const session = new Session(conn, { root: 방, mode: 'auto', think: 'off' });
    const 것들 = [];
    for await (const ev of run(session, ctx, 네가지)) 것들.push(ev);
    rmSync(방, { recursive: true, force: true });
    return 것들;
  };

  // 셋만 하고 끝내려 한다. 되민 뒤에도 그대로.
  const 셋만보고 = '붙여넣기 표시, esc 중단, cli 기능 보강 세 가지를 고쳤습니다.';
  const 것들 = await 돌려보기([
    { 도구: { name: 'Write', args: { file_path: '기록.md', content: '고침\n' } } },
    { text: 셋만보고 },
    { text: 셋만보고 },
  ]);

  const 되민것 = 것들.filter((e) => e.type === 'nudge');
  check('★ 빼놓고 끝내려 하면 되민다', 되민것.length === 1, 것들.map((e) => e.type).join(','));
  check('되민 까닭을 밝힌다', 되민것[0]?.why === '요청누락', 되민것[0]?.why ?? '');
  check('무엇이 빠졌는지 이벤트에 담는다', 되민것[0]?.빠진?.[0]?.번호 === 3,
    JSON.stringify(되민것[0]?.빠진?.map((x) => x.번호) ?? []));

  const 끝난것 = 것들.find((e) => e.type === 'done');
  check('★ 되밀고도 그대로면 사람에게 말한다', 끝난것?.빠진?.length === 1,
    JSON.stringify(끝난것?.빠진?.map((x) => x.번호) ?? []));
  // 두 번 세 번 미는 것은 모델이 못 하는 일을 억지로 시키는 꼴이고,
  // 그 왕복은 사람이 낸다.
  check('★ 되밀기는 한 번뿐이다', 되민것.length === 1, `${되민것.length}번`);

  // 네 가지를 다 다뤘으면 아무 일도 없어야 한다. 이쪽이 더 중요하다 —
  // 멀쩡한 턴에 잔소리가 붙으면 사람은 곧 이 말을 안 읽는다.
  const 다한것 = await 돌려보기([
    { 도구: { name: 'Write', args: { file_path: '기록.md', content: '고침\n' } } },
    { text: '붙여넣기 표시, esc 중단, 요청 누락 대조, cli 기능 보강 네 가지를 다 고쳤습니다.' },
  ]);
  check('★ 다 다뤘으면 안 민다', !다한것.some((e) => e.type === 'nudge'), 다한것.map((e) => e.type).join(','));
  check('★ 다 다뤘으면 끝에 아무 말도 안 붙는다',
    (다한것.find((e) => e.type === 'done')?.빠진 ?? []).length === 0,
    JSON.stringify(다한것.find((e) => e.type === 'done')?.빠진 ?? []));

  srv.close();
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n요청 지키기 검사  ${D}(시킨 것을 빼놓고 끝내지 않는가 · 접혀도 원문이 남는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
