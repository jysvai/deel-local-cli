/**
 * 로컬 모델의 몫을 터미널이 덜어 주는가.
 *
 * 진짜 모델은 안 띄운다. 나가는 글과 줄어든 양만 잰다.
 */
import { tmpdir } from 'node:os';
import { Session } from '../src/agent/session.js';
import { compact, shouldFold, 장부요약 } from '../src/agent/compact.js';
import { makeScope } from '../src/safety/guard.js';
import { 프레임 } from '../src/ui/inputbox.js';
import { 글끼우기 } from '../src/ui/pastechip.js';
import { width as 글폭 } from '../src/ui/ansi.js';
import { assistantMessage, toolMessage } from '../src/backend/adapter.js';
import { 출력줄이기, 머리꼬리, 로컬출력 } from '../src/tools/shrink.js';
import { 언어잡기, 언어정하기, 지시말, 지시말정하기 } from '../src/i18n/index.js';
import { 보관, 되찾기 } from '../src/agent/archive.js';
import { foldToolResults } from '../src/agent/compact.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../src/tools/index.js';

const G = '\x1b[32m'; const R = '\x1b[31m'; const X = '\x1b[0m';
let 통과 = 0; let 실패 = 0;
const check = (이름, 됨, 덧 = '') => {
  if (됨) { 통과 += 1; console.log(`  ${G}✓${X} ${이름}`); return; }
  실패 += 1; console.log(`  ${R}✗${X} ${이름} ${R}${덧}${X}`);
};

console.log('명령 출력 줄이기');
{
  check('색깔 코드를 뺀다', 출력줄이기('\x1b[32mok\x1b[0m 끝') === 'ok 끝', 출력줄이기('\x1b[32mok\x1b[0m 끝'));
  check('진행률은 마지막 모습만 남긴다', 출력줄이기('10%\r50%\r100%\n끝') === '100%\n끝', 출력줄이기('10%\r50%\r100%\n끝'));
  check('연달아 같은 줄은 하나로 접는다', 출력줄이기('a\na\na\nb') === 'a (위 줄 2번 더)\nb', 출력줄이기('a\na\na\nb'));
  const 많은통과 = [...Array.from({ length: 30 }, (_, i) => `✓ 검사 ${i}`), '✗ 깨진 검사', '30개 통과 · 1개 실패'].join('\n');
  const 줄 = 출력줄이기(많은통과);
  check('★★ 통과 줄이 많으면 뺀다', !/✓ 검사 3/.test(줄) && /통과 줄 30개 뺌/.test(줄), 줄);
  check('★★★ 실패 줄과 결론은 절대 안 뺀다', /✗ 깨진 검사/.test(줄) && /30개 통과 · 1개 실패/.test(줄), 줄);
  check('★ 오류 낌새가 있는 ok 줄은 남긴다', /ok 3 - error handling/.test(출력줄이기([...Array.from({ length: 30 }, (_, i) => `ok ${i}`), 'ok 3 - error handling'].join('\n'))));
  const 통과25 = Array.from({ length: 25 }, (_, i) => `ok ${i}`);
  for (const 상태 of ['passed: false', 'ok: false', 'pass: 0, exceptions: 1']) {
    check(`★★★ 통과처럼 시작해도 실패 상태는 남긴다 — ${상태}`, 출력줄이기([...통과25, 상태].join('\n')).includes(상태));
  }
  check('★★★ 진행률에 덮인 오류도 남긴다', /connection failed/.test(출력줄이기('Error: connection failed\r[OK]')));
  check('통과 줄이 적으면 그대로 둔다', 출력줄이기('✓ 하나\n끝') === '✓ 하나\n끝');
  const 긴글 = `${'앞'.repeat(50)}${'중'.repeat(900)}${'끝오류'.repeat(20)}`;
  const 잘림 = 머리꼬리(긴글, 200);
  check('★★ 길면 끝을 남긴다 — 오류는 대개 끝에 있다', 잘림.endsWith('끝오류') && 잘림.startsWith('앞') && 잘림.length < 240, 잘림.slice(-30));
  check('짧으면 그대로', 머리꼬리('abc', 200) === 'abc');
}

const 로컬 = { model: 'qwen3.8-flash-next', base: 'http://127.0.0.1:8099/v1', ctx: 65536, kind: 'openai' };
const 바깥 = { model: 'gpt-x', base: 'https://api.example.com/v1', ctx: 65536, kind: 'openai' };

console.log('시키는 말');
{
  언어정하기('ko');
  언어잡기({ env: { DEEL_LANG: 'ko' }, cfg: null });
  const 로컬글 = String(new Session(로컬, { root: tmpdir(), work: 'code' }).wire()[0].content);
  check('★★★ 로컬은 영어로 시킨다', /You are deel/.test(로컬글) && !/너는 deel 다/.test(로컬글), 로컬글.slice(0, 80));
  check('★★★ 답은 사람 말로 받는다', /답은 한국어로 해라/.test(로컬글));
  const 바깥글 = String(new Session(바깥, { root: tmpdir(), work: 'code' }).wire()[0].content);
  check('★★ 바깥 연결은 그대로 한국어로 시킨다', /너는 deel 다/.test(바깥글), 바깥글.slice(0, 80));
  new Session(로컬, { root: tmpdir(), work: 'code' });
  언어잡기({ env: { DEEL_LANG: 'ko', DEEL_PROMPT_LANG: 'ko' }, cfg: null });
  check('★★ 사람이 정한 말이 이긴다', 지시말() === 'ko', 지시말());
  지시말정하기(null);
}

console.log('한 번에 크게 접기');
{
  언어잡기({ env: { DEEL_LANG: 'ko', DEEL_PROMPT_LANG: 'ko' }, cfg: null });
  const s = new Session(로컬, { root: tmpdir(), work: 'code' });
  const 큰글 = '가나다 '.repeat(1800);
  s.messages = [];
  for (let i = 0; i < 12; i += 1) {
    s.messages.push({ role: 'user', content: `${i}번째 일을 해 줘` });
    s.messages.push(assistantMessage('openai', { content: `${i}번째`, toolCalls: [{ id: `r${i}`, name: 'Read', args: { file_path: `src/f${i}.js` } }] }));
    s.messages.push(toolMessage('openai', { callId: `r${i}`, name: 'Read', content: 큰글 }));
  }
  s.messages.push({ role: 'user', content: '마지막 요청' });
  const r = await compact(s, { auto: true, 부르기: async () => { throw new Error('모델을 부르면 안 된다'); } });
  check('★★★ 찔끔이 아니다 — 절반 넘게 줄인다', r.ok && r.after < r.before * 0.5, `${r.before} → ${r.after}`);
  check('★★ 원문을 찾는 길을 알려 준다', /Recall/.test(String(r.summary)), String(r.summary).slice(-80));
  check('★ 막 시킨 말은 남는다', s.messages.at(-1).content === '마지막 요청');
  지시말정하기(null);
}

console.log('큰 파일 읽기');
{
  const 폴더 = mkdtempSync(join(tmpdir(), 'deel-bigread-'));
  const 앱 = Array.from({ length: 1542 }, (_, n) => (n % 30 === 0 ? `function item${n + 1}(a, b) { // calculation` : `  const value${n + 1} = compute(a, b, ${n + 1}) + offset;`)).join('\n');
  writeFileSync(join(폴더, 'app.js'), 앱);
  writeFileSync(join(폴더, 'small.js'), 'const a = 1;\nconst b = 2;\n');
  const 문맥 = (창, 로컬값 = true) => ({ scope: makeScope(폴더), seen: new Set(), 모델컨텍스트: 창, ...(로컬값 ? { 로컬: true } : {}) });
  const 읽기 = (인자, 창 = 30464, 로컬값 = true) => TOOLS.Read.run({ file_path: join(폴더, 'app.js'), ...인자 }, 문맥(창, 로컬값));
  const 번호들 = (글) => [...String(글).matchAll(/^\s*(\d+)\t/gm)].map((m) => Number(m[1]));
  const 첫 = await 읽기({});
  const 받은줄 = 번호들(첫.content);
  check('★★★ 줄 중간에서 안 잘린다', !/자 잘림/.test(첫.content), String(첫.content).slice(-60));
  check('★★★ 화면 줄 수가 모델이 받은 줄 수와 같다', 첫.summary.startsWith(`${받은줄.length}/1542`), `${첫.summary} · ${받은줄.length}`);
  check('★★ 예전 88줄보다 훨씬 많이 준다', 받은줄.length > 250, String(받은줄.length));
  check('★★★ 이어 읽을 자리를 정확히 말한다', Number(/Next: offset=(\d+)/.exec(첫.content)?.[1]) === 받은줄.at(-1) + 1, String(첫.content).slice(-80));
  check('★★ 뒤쪽에 무엇이 있는지 지도를 준다', /item1501:1501/.test(첫.content), String(첫.content).slice(-120));
  const 본것 = new Set(); let 자리 = 1; let 판수 = 0;
  while (자리 && 판수 < 12) {
    const r = await 읽기({ offset: 자리 });
    for (const n of 번호들(r.content)) 본것.add(n);
    자리 = Number(/Next: offset=(\d+)/.exec(r.content)?.[1] ?? 0);
    판수 += 1;
  }
  check('★★★ 안내대로 읽으면 빈 줄 없이 끝까지 간다', 본것.size === 1542, `${본것.size}줄 · ${판수}판`);
  const 둘째 = await 읽기({ offset: 400 });
  check('★ 이어 읽을 때는 지도를 또 안 준다', !/Later in this file/.test(둘째.content));
  const 작은것 = await TOOLS.Read.run({ file_path: join(폴더, 'small.js') }, 문맥(30464));
  check('★ 다 들어가면 안내를 안 붙인다', !/Next: offset|Later in this file/.test(작은것.content));
  const 바깥 = await 읽기({}, 30464, false);
  check('★★ 바깥에는 로컬 안내를 안 붙인다', !/Next: offset|Later in this file/.test(바깥.content));
  writeFileSync(join(폴더, 'doc.md'), [`![그림](data:image/png;base64,${'A'.repeat(25000)})`, ...Array.from({ length: 99 }, (_, i) => `문단 ${i + 2}`)].join('\n'));
  const 그림글 = await TOOLS.Read.run({ file_path: join(폴더, 'doc.md') }, 문맥(8000, false));
  check('★★★ 박힌 그림은 줄인 뒤에 재서 뒷줄을 안 잃는다', 번호들(그림글.content).length === 100, 그림글.summary);
  writeFileSync(join(폴더, 'min.js'), [`const a = '${'x'.repeat(9000)}';`, ...Array.from({ length: 9 }, (_, i) => `const b${i} = ${i};`)].join('\n'));
  const 긴줄 = await TOOLS.Read.run({ file_path: join(폴더, 'min.js') }, 문맥(8000));
  check('★★★ 한 줄이 한도보다 길어도 이어 읽을 자리를 말한다', /Next: offset=2/.test(긴줄.content), String(긴줄.content).slice(-60));
  const 바깥줄 = 번호들(바깥.content);
  check('★★★ 바깥도 줄 중간에서 안 잘린다', !/자 잘림/.test(바깥.content), String(바깥.content).slice(-60));
  check('★★★ 바깥도 화면 줄 수와 어디까지 읽었는지가 맞다', 바깥.summary.startsWith(`${바깥줄.length}/1542`) && String(바깥.content).includes(`전체 1542줄 중 ${바깥줄.at(-1)}줄까지`), `${바깥.summary} · ${String(바깥.content).slice(-30)}`);
  rmSync(폴더, { recursive: true, force: true, maxRetries: 3 });
}

console.log('로컬 접기');
{
  const 찬 = (모델요약) => {
    const 세션 = new Session({ ...로컬, ...(모델요약 ? { 모델요약: true } : {}) }, { root: tmpdir(), work: 'code' });
    세션.messages = [{ role: 'user', content: '가'.repeat(120000) }];
    return 세션;
  };
  check('★★★ 로컬 자동 압축은 앞머리를 가르는 접기를 안 한다', shouldFold(찬(false)) === false);
  check('★ 모델 요약을 쓰는 연결은 전처럼 접는다', shouldFold(찬(true)) === true);
  check('★ [deel] 재촉은 사람 말로 안 적는다', !/그만 읽어/.test(장부요약([{ role: 'user', content: '고쳐 줘' }, { role: 'user', content: '[deel] 그만 읽어' }])));
}

console.log('입력 상자');
{
  const 글 = '‘/Users/a/프로젝트’ “여기” — 끝…';
  const 판 = 프레임({ 글, 커서: 글.length, 폭: 60 });
  check('★★★ 칸이 흔들리는 글자를 상자에 그대로 안 낸다', !판.줄들.some((l) => /[‘’“”—…]/.test(l)), 판.줄들.join('|').slice(0, 120));
  check('★★★ 상자 줄이 창을 안 넘는다', 판.줄들.every((l) => 글폭(l) <= 60));
  const 같은 = 프레임({ 글: "'/Users/a/프로젝트' \"여기\" - 끝.", 커서: 글.length, 폭: 60 });
  check('★★ 커서 자리가 안 틀어진다', 판.커서.열 === 같은.커서.열 && 판.커서.위 === 같은.커서.위, JSON.stringify([판.커서, 같은.커서]));
  const 빈 = 글끼우기('', 0, '@a.png');
  check('★★ 빈 입력에 그림을 끼운다', 빈.줄 === '@a.png ' && 빈.커서 === 7, JSON.stringify(빈));
  const 뒤 = 글끼우기('이거 봐', 4, '@a.png');
  check('★★ 앞 글과 안 붙는다', 뒤.줄 === '이거 봐 @a.png ' && 뒤.커서 === 뒤.줄.length, JSON.stringify(뒤));
  const 가운데 = 글끼우기('앞 뒤', 2, '@a.png');
  check('★ 커서 자리에 끼운다', 가운데.줄 === '앞 @a.png 뒤', JSON.stringify(가운데));
}

console.log('처음 시킨 말');
{
  언어잡기({ env: { DEEL_LANG: 'ko', DEEL_PROMPT_LANG: 'ko' }, cfg: null });
  const 긴요구 = `${'요구사항 '.repeat(200)}마지막 조건: CP949 로 저장`;
  const 대화 = [{ role: 'user', content: 긴요구 }, ...Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `${i}번째` }))];
  const 장부 = 장부요약(대화);
  check('★★★ 턴이 많아도 긴 첫 요구의 끝이 남는다', /CP949/.test(장부), 장부.slice(0, 80));
  check('★ 최근 말도 남는다', /11번째/.test(장부));
  지시말정하기(null);
}

console.log('손실 없이 되찾기');
{
  const root = mkdtempSync(join(tmpdir(), 'deel-archive-'));
  const 원문 = 'const a = 1; // 한글 주석\n'.repeat(2000);
  const n = 보관(root, 원문);
  check('★★★ 넣은 글이 한 글자도 안 다르게 돌아온다', 되찾기(root, n) === 원문);
  check('번호가 늘어난다', 보관(root, 'x') === n + 1);
  const 긴출력 = Array.from({ length: 4000 }, (_, i) => `줄 ${i}`).join('\n');
  const 나간것 = 로컬출력(긴출력, 500, root);
  check('★★★ 잘린 명령 출력도 번호로 통째로 되찾는다', 되찾기(root, Number(/Recall id=(\d+)/.exec(나간것)?.[1])) === 긴출력, 나간것.slice(-40));
  check('★ 안 넘치면 번호를 안 붙인다', !/Recall/.test(로컬출력('짧다', 500, root)));
  check('없는 번호는 null', 되찾기(root, 999) === null);
  check('★★ 경로를 번호로 못 속인다', 되찾기(root, '../../secret') === null && 되찾기(root, 1.5) === null);

  언어잡기({ env: { DEEL_LANG: 'ko', DEEL_PROMPT_LANG: 'en' }, cfg: null });
  const s = new Session(로컬, { root, work: 'code' });
  s.messages = [];
  const 큰글 = '비밀아닌 원문 줄\n'.repeat(3000);
  for (let i = 0; i < 12; i += 1) {
    s.messages.push({ role: 'user', content: `${i}번째` });
    s.messages.push(assistantMessage('openai', { content: '', toolCalls: [{ id: `b${i}`, name: 'Bash', args: { command: `make ${i}` } }] }));
    s.messages.push(toolMessage('openai', { callId: `b${i}`, name: 'Bash', content: `${i}번 결과\n${큰글}` }));
  }
  s.messages.push({ role: 'user', content: '이어서' });
  const r = await compact(s, { auto: true, 부르기: async () => { throw new Error('모델을 부르면 안 된다'); } });
  const 번호 = Number(/Recall id=(\d+)/.exec(String(r.summary))?.[1]);
  check('★★★ 요약에 원문 번호가 있다', 번호 > 0, String(r.summary).slice(-100));
  const 돌아온것 = 되찾기(root, 번호) ?? '';
  check('★★★ 접힌 도구 결과가 통째로 돌아온다', 돌아온것.includes('0번 결과') && 돌아온것.split('비밀아닌 원문 줄').length > 3000, String(돌아온것.length));
  check('★★ 부른 인자도 돌아온다', /make 0/.test(돌아온것));
  const 줄은몫 = 1 - r.after / r.before;
  check('★★★ 75% 넘게 줄인다', 줄은몫 > 0.75, `${r.before} → ${r.after} (${Math.round(줄은몫 * 100)}%)`);
  console.log(`    ${r.before.toLocaleString('en-US')} → ${r.after.toLocaleString('en-US')} 토큰 · 모델 호출 0회`);

  const 도구 = TOOLS.Recall;
  const ctx = { scope: { root }, 모델컨텍스트: 65536 };
  const 답 = await 도구.run({ id: 번호 }, ctx);
  check('★★ Recall id 가 원문을 돌려주고 이어 읽을 자리를 알려 준다', /0번 결과/.test(답.content) && /offset \d+/.test(답.content), String(답.content).slice(-60));
  const 다음 = await 도구.run({ id: 번호, offset: Number(/offset (\d+)/.exec(답.content)[1]) }, ctx);
  check('이어 읽기가 된다', !다음.error && 다음.content.length > 0);
  check('없는 번호는 오류로 답한다', Boolean((await 도구.run({ id: 99999 }, ctx)).error));

  const 접을판 = new Session(로컬, { root, work: 'code' });
  접을판.messages = [];
  for (let i = 0; i < 8; i += 1) {
    접을판.messages.push(assistantMessage('openai', { content: '', toolCalls: [{ id: `r${i}`, name: 'Read', args: { file_path: `f${i}.js` } }] }));
    접을판.messages.push(toolMessage('openai', { callId: `r${i}`, name: 'Read', content: `${i}번째 ${큰글}` }));
  }
  foldToolResults(접을판, { 이득문턱: 0 });
  const 접힌 = 접을판.messages.find((m) => m.role === 'tool' && /Recall id=/.test(String(m.content)));
  const 접힌번호 = Number(/Recall id=(\d+)/.exec(String(접힌?.content))?.[1]);
  check('★★★ 접은 도구 결과도 번호로 되찾는다', (되찾기(root, 접힌번호) ?? '').includes('번째 비밀아닌'), String(접힌?.content).slice(0, 80));
  지시말정하기(null);
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}

console.log(`\n${실패 ? R : G}통과 ${통과} · 실패 ${실패}${X}`);
process.exitCode = 실패 ? 1 : 0;
