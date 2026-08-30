// 그림을 모델에게 보여 주는 길.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 여기서 제일 중요한 검사는 **못 보는 모델에게는 바이트가 안 나간다**는 것이다.
// 그것은 우리 쪽 함수를 우리 쪽 함수로 확인해서는 증명이 안 된다. 그래서 가짜
// 게이트웨이(포트 0)를 띄우고 **서버가 실제로 받은 몸통**을 뒤져서, 거기에
// base64 조각이 한 글자도 없다는 것으로 잰다.
//
// 반대쪽도 같다. 볼 수 있는 모델일 때는 서버가 받은 몸통 안에
// `image_url` 자리에 data: URI 가 통째로 들어 있는지를 본다.
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  그림인가, 그림종류, 그림읽기, 그림메시지, 크기말, 그림장수, 글만,
  그림한장토큰, 기본한도, 한점PNG, 눈검사메시지,
} from '../src/backend/vision.js';
import { TOOLS, toolSchemas } from '../src/tools/index.js';
import { expand } from '../src/agent/mention.js';
import { foldImages } from '../src/agent/compact.js';
import { run } from '../src/agent/loop.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { probe } from '../src/backend/probe.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 점 = Buffer.from(한점PNG, 'base64');

// ── 0. 시험용 파일들 ───────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-vision-'));
const 길 = (n) => join(root, n);

writeFileSync(길('shot.png'), 점);
// 이름은 png 인데 속은 JPEG — 사내에서 화면을 캡처해 옮기다 보면 흔하다.
writeFileSync(길('거짓말.png'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300)]));
// 그림 주소를 받아 저장했더니 로그인 페이지였던 경우.
writeFileSync(길('로그인.png'), '<!doctype html><html><body>로그인이 필요합니다</body></html>', 'utf8');
writeFileSync(길('빈것.png'), Buffer.alloc(0));
// 한도를 넘는 것 — 머리는 진짜 PNG 라 '그림이 아니어서' 막힌 것이 아님을 분명히 한다.
writeFileSync(길('큰것.png'), Buffer.concat([점, Buffer.alloc(기본한도 + 1024)]));
writeFileSync(길('메모.txt'), '그냥 글입니다\n', 'utf8');

// ── 1. 그림인지 알아보기 ───────────────────────────────────────────────
trace('1-알아보기');
{
  for (const n of ['a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'C:\\사진\\화면.Png'])
    check(`그림으로 본다: ${n}`, 그림인가(n) === true);
  for (const n of ['a.txt', 'a.js', 'a.pngx', 'png', '', 'a.svg', 'a.bmp'])
    check(`그림이 아니다: ${n || '(빈 글)'}`, 그림인가(n) === false);

  check('PNG 속을 알아본다', 그림종류(점) === 'image/png', String(그림종류(점)));
  check('JPEG 속을 알아본다', 그림종류(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])) === 'image/jpeg');
  check('GIF 속을 알아본다', 그림종류(Buffer.from('GIF89a............', 'latin1')) === 'image/gif');
  check('WebP 속을 알아본다', 그림종류(Buffer.from('RIFF____WEBPVP8 ', 'latin1')) === 'image/webp');
  check('HTML 은 그림이 아니다', 그림종류(Buffer.from('<!doctype html>....', 'utf8')) === null);
  check('짧은 것은 그림이 아니다', 그림종류(Buffer.from([0x89, 0x50])) === null);

  check('크기를 사람 말로', 크기말(500) === '500B' && 크기말(120 * 1024) === '120KB' && 크기말(3 * 1024 * 1024) === '3.0MB',
    `${크기말(500)} · ${크기말(120 * 1024)} · ${크기말(3 * 1024 * 1024)}`);
}

// ── 2. 읽기 — 못 실을 것은 왜인지 말한다 ───────────────────────────────
trace('2-읽기');
{
  const 좋은것 = 그림읽기(길('shot.png'));
  check('멀쩡한 PNG 를 읽는다', 좋은것.ok === true && 좋은것.mime === 'image/png', JSON.stringify(좋은것.왜 ?? 좋은것.mime));
  check('base64 로 돌려준다', 좋은것.b64 === 한점PNG, 좋은것.b64?.slice(0, 20));

  // 확장자를 믿지 않는다. 여기서 image/png 라고 적어 보내면 게이트웨이가 400 을 준다.
  const 거짓말 = 그림읽기(길('거짓말.png'));
  check('이름이 png 여도 속이 JPEG 면 JPEG 라고 적는다', 거짓말.ok === true && 거짓말.mime === 'image/jpeg', String(거짓말.mime));

  const 로그인 = 그림읽기(길('로그인.png'));
  check('그림이 아닌 것은 안 싣는다', 로그인.ok === false, JSON.stringify(로그인.mime));
  check('무엇이 잘못됐는지 말한다', /속은 그림이 아닙니다/.test(로그인.왜 ?? ''), 로그인.왜);

  const 빈것 = 그림읽기(길('빈것.png'));
  check('빈 파일은 빈 파일이라고 한다', 빈것.ok === false && /빈 파일/.test(빈것.왜 ?? ''), 빈것.왜);

  const 큰것 = 그림읽기(길('큰것.png'));
  check('한도를 넘으면 안 싣는다', 큰것.ok === false, String(큰것.mime));
  check('얼마나 큰지·한도가 얼마인지 같이 말한다',
    /4\.0MB/.test(큰것.왜 ?? '') && /한도/.test(큰것.왜 ?? ''), 큰것.왜);
  check('줄여 주지 않는다고 정직하게 말한다', /안 깔고 도는 것이 규칙/.test(큰것.왜 ?? ''), 큰것.왜?.slice(-40));
  check('큰 것은 읽지도 않는다 (b64 를 안 만든다)', 큰것.b64 === undefined);

  const 없는것 = 그림읽기(길('없는.png'));
  check('없는 파일도 조용히 안 넘어간다', 없는것.ok === false && /못 읽었습니다/.test(없는것.왜 ?? ''), 없는것.왜);
}

// ── 3. 규격별 메시지 모양 ──────────────────────────────────────────────
trace('3-모양');
{
  const 그림들 = [{ b64: 한점PNG, mime: 'image/png', show: 'shot.png' }];
  const o = 그림메시지('openai', { 글: '이거 봐', 그림들 });
  check('OpenAI 는 content 배열', Array.isArray(o.content) && o.content.length === 2);
  check('OpenAI 는 글이 먼저', o.content[0].type === 'text' && o.content[0].text === '이거 봐');
  check('OpenAI 는 data: URI', o.content[1].type === 'image_url'
    && o.content[1].image_url.url === `data:image/png;base64,${한점PNG}`, o.content[1]?.image_url?.url?.slice(0, 30));

  const l = 그림메시지('ollama', { 글: '이거 봐', 그림들 });
  check('Ollama 는 content 가 그냥 글', l.content === '이거 봐');
  check('Ollama 는 images 배열', Array.isArray(l.images) && l.images[0] === 한점PNG);
  check('Ollama 에는 data: 머리말을 안 붙인다', !l.images[0].startsWith('data:'), l.images[0].slice(0, 12));

  check('장수를 규격 둘 다에서 센다', 그림장수(o) === 1 && 그림장수(l) === 1, `${그림장수(o)} · ${그림장수(l)}`);
  check('그림 없는 메시지는 0장', 그림장수({ role: 'user', content: '글만' }) === 0);
  check('글만 뽑아낸다', 글만(o) === '이거 봐' && 글만(l) === '이거 봐');

  const 눈검사 = 눈검사메시지('openai');
  check('눈 검사는 1×1 점 하나로', 눈검사.content[1].image_url.url.includes(한점PNG));
  check('눈 검사 그림은 아주 작다', 점.length < 200, `${점.length}바이트`);
}

// ── 4. Read 도구 — 눈이 없으면 바이트를 안 만든다 ──────────────────────
trace('4-Read');
{
  const 만들기 = (눈) => ({ scope: makeScope(root), seen: new Set(), 눈있나: 눈 });

  const 없을때 = TOOLS.Read.run({ file_path: 'shot.png' }, 만들기(false));
  check('눈이 없어도 오류로 끝내지 않는다', !없을때.error, 없을때.error ?? '');
  check('못 본다고 말해 준다', /그림을 못 봅니다/.test(없을때.content ?? ''), 없을때.content?.split('\n')[1]);
  check('코드처럼 읽지 말라고 막아 준다', /코드처럼 읽으려 하지 마세요/.test(없을때.content ?? ''));
  check('눈이 없으면 바이트가 아예 없다', !JSON.stringify(없을때).includes(한점PNG.slice(0, 24)));
  check('눈이 없으면 그림을 안 딸려 보낸다', 없을때.그림 === undefined);

  const 있을때 = TOOLS.Read.run({ file_path: 'shot.png' }, 만들기(true));
  check('눈이 있으면 그림을 딸려 보낸다', 있을때.그림?.b64 === 한점PNG, 있을때.그림?.mime);
  check('그래도 도구 결과 글에는 base64 가 안 들어간다', !String(있을때.content).includes(한점PNG.slice(0, 24)),
    있을때.content);
  check('크기와 종류를 적어 준다', /그림 · \d+B · image\/png/.test(있을때.content ?? ''), 있을때.content);

  const 큰것 = TOOLS.Read.run({ file_path: '큰것.png' }, 만들기(true));
  check('큰 그림은 오류로 돌려준다', !!큰것.error && /한도/.test(큰것.error), 큰것.error?.slice(0, 60));

  const 글파일 = TOOLS.Read.run({ file_path: '메모.txt' }, 만들기(true));
  check('글 파일은 예전 그대로 읽힌다', /그냥 글입니다/.test(글파일.content ?? ''), 글파일.summary);
}

// ── 5. @ 로 지목했을 때 ────────────────────────────────────────────────
trace('5-지목');
{
  const scope = makeScope(root);
  const 있을때 = expand('@shot.png 이거 왜 이래?', { scope, 눈있나: true });
  check('눈이 있으면 그림으로 붙인다', 있을때.그림들.length === 1 && 있을때.그림들[0].b64 === 한점PNG);
  check('붙였다고 표시한다', 있을때.attached[0]?.그림 === true && 있을때.attached[0]?.bytes === 점.length,
    JSON.stringify(있을때.attached[0]));
  check('보낼 글에는 base64 가 안 섞인다', !있을때.text.includes(한점PNG.slice(0, 24)));
  check('사람이 쓴 말은 그대로 남는다', 있을때.text.startsWith('@shot.png 이거 왜 이래?'));

  const 없을때 = expand('@shot.png 이거 왜 이래?', { scope, 눈있나: false });
  check('눈이 없으면 한 장도 안 붙인다', 없을때.그림들.length === 0);
  check('눈이 없으면 바이트가 아예 없다', !JSON.stringify(없을때).includes(한점PNG.slice(0, 24)));
  check('대신 못 본다고 적는다', /그림을 못 봅니다/.test(없을때.text), 없을때.text.split('\n').pop());

  const 로그인 = expand('@로그인.png 봐줘', { scope, 눈있나: true });
  check('그림이 아닌 것은 안 붙이고 이유를 적는다',
    로그인.그림들.length === 0 && /속은 그림이 아닙니다/.test(로그인.text), 로그인.text.split('\n').pop());

  // 글 파일 지목은 예전과 똑같아야 한다 — 이 슬라이스가 건드리면 안 되는 자리다.
  const 글 = expand('@메모.txt 봐줘', { scope, 눈있나: true });
  check('글 파일 지목은 그대로', 글.attached.length === 1 && /그냥 글입니다/.test(글.text), 글.text.slice(-40));
}

// ── 6. 가짜 게이트웨이가 실제로 받은 것 ────────────────────────────────
trace('6-실제요청');
const 받은몸통 = [];
let 규격 = 'openai';
const server = createServer((q, res) => {
  let body = '';
  q.on('data', (d) => (body += d));
  q.on('end', () => {
    받은몸통.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const 첫번째 = 받은몸통.length === 1;
    if (규격 === 'ollama') {
      return res.end(JSON.stringify(첫번째
        ? { message: { content: '', tool_calls: [{ function: { name: 'Read', arguments: { file_path: 'shot.png' } } }, { function: { name: 'Read', arguments: { file_path: '거짓말.png' } } }] }, prompt_eval_count: 10, eval_count: 3 }
        : { message: { content: '흰 점 하나가 보입니다.' }, done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 }));
    }
    res.end(JSON.stringify(첫번째
      ? {
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: 't1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: 'shot.png' }) } },
              { id: 't2', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: '거짓말.png' }) } },
            ],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }
      : {
        choices: [{ message: { content: '흰 점 하나가 보입니다.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const 포트 = server.address().port;
const base = `http://127.0.0.1:${포트}/v1`;
resetNet();
allowEndpoint(base);
allowEndpoint(`http://127.0.0.1:${포트}`);

const 돌리기 = async (conn, 말, { 눈있나 = false, 그림들 = null } = {}) => {
  받은몸통.length = 0;
  const s = new Session(conn, { root });
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root),
    seen: new Set(), 눈있나,
  };
  ctx.history.nextTurn();
  const 것들 = [];
  for await (const ev of run(s, ctx, 말, { 그림들 })) 것들.push(ev);
  return { s, 것들 };
};

{
  // 눈이 있는 모델 — 서버가 받은 몸통에 data: URI 가 통째로 들어 있어야 한다.
  규격 = 'openai';
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true, vision: true };
  const { s } = await 돌리기(conn, 'shot.png 좀 봐줘', { 눈있나: true });

  const 마지막 = 받은몸통[받은몸통.length - 1] ?? '';
  check('두 번 오갔다', 받은몸통.length === 2, `${받은몸통.length}번`);
  check('서버가 그림을 실제로 받았다', 마지막.includes(`data:image/png;base64,${한점PNG}`));
  check('image_url 자리로 갔다', /"type":"image_url"/.test(마지막));

  // 도구 결과에는 base64 가 없어야 한다 — 있으면 자리만 두 배로 먹는다.
  const 도구말 = s.messages.filter((m) => m.role === 'tool');
  check('도구 결과에는 base64 가 없다', !JSON.stringify(도구말).includes(한점PNG.slice(0, 24)));

  /*
   * 짝이 안 깨져야 한다.
   *
   * 한 턴에 Read 를 두 번 불렀다. 도구 결과 **사이에** 사람 말이 끼면 뒤에 오는
   * 도구 결과가 짝을 잃고 게이트웨이가 통째로 400 을 준다. 그래서 그림은
   * 도구 결과가 다 들어간 뒤에 **한 번에** 붙어야 한다. 한 장짜리로 재면
   * 이 규칙을 어겨도 검사가 안 걸린다 — 그래서 두 장으로 잰다.
   */
  const 역할들 = s.messages.map((m) => m.role);
  const 도구자리 = 역할들.map((r, i) => (r === 'tool' ? i : -1)).filter((i) => i >= 0);
  check('Read 가 두 번 불렸다', 도구자리.length === 2, JSON.stringify(역할들));
  check('도구 결과 사이에 아무것도 안 낀다', 도구자리[1] - 도구자리[0] === 1, JSON.stringify(역할들));
  const 그림자리 = s.messages.findIndex((m, i) => i > 0 && 그림장수(m) > 0);
  check('그림은 도구 결과가 다 끝난 뒤에 붙는다', 그림자리 > 도구자리[1], `도구끝 ${도구자리[1]} · 그림 ${그림자리}`);
  check('두 장이 한 메시지에 같이 붙는다', 그림장수(s.messages[그림자리]) === 2, `${그림장수(s.messages[그림자리])}장`);
  check('그림 메시지는 사람 말 자리다', s.messages[그림자리]?.role === 'user');
  check('짝이 하나도 안 남는다', s.messages.filter((m) => m.role === 'tool').length
    === s.messages.filter((m) => m.tool_calls?.length).flatMap((m) => m.tool_calls).length,
    `결과 ${s.messages.filter((m) => m.role === 'tool').length}`);
}

{
  // 눈이 없는 모델 — 바이트가 한 글자도 안 나가야 한다. 이게 이 슬라이스의 핵심 검사다.
  규격 = 'openai';
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true, vision: false };
  const { s } = await 돌리기(conn, 'shot.png 좀 봐줘', { 눈있나: false });

  const 다 = 받은몸통.join('');
  check('바이트가 한 글자도 안 나갔다', !다.includes(한점PNG.slice(0, 24)));
  check('image_url 자리 자체가 없다', !/image_url/.test(다));
  check('그림 대신 못 본다는 말이 갔다', /그림을 못 봅니다/.test(다));
  check('대화에도 그림이 안 남았다', s.messages.every((m) => 그림장수(m) === 0));
}

{
  // Ollama 규격 — images 배열로, data: 머리말 없이.
  규격 = 'ollama';
  const conn = { kind: 'ollama', base: `http://127.0.0.1:${포트}`, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true, vision: true };
  const { s } = await 돌리기(conn, 'shot.png 좀 봐줘', { 눈있나: true });
  const 마지막 = 받은몸통[받은몸통.length - 1] ?? '';
  check('Ollama 는 images 로 받는다', /"images":\["iVBOR/.test(마지막), 마지막.slice(0, 0) || 마지막.match(/"images":\[.{0,12}/)?.[0]);
  check('Ollama 몸통에 data: 머리말이 없다', !마지막.includes('data:image'));
  check('Ollama 도 짝이 안 깨진다', s.messages.filter((m) => m.role === 'tool').length === 2,
    JSON.stringify(s.messages.map((m) => m.role)));
  규격 = 'openai';
}

{
  // @ 로 지목해서 보낸 그림도 실제로 나가야 한다.
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true, vision: true };
  const scope = makeScope(root);
  const r = expand('@shot.png 이거 봐', { scope, 눈있나: true });
  받은몸통.length = 0;
  const s = new Session(conn, { root });
  const ctx = { scope, history: new History(root), audit: new Audit(root), seen: new Set(), 눈있나: true };
  ctx.history.nextTurn();
  // 첫 응답이 도구를 부르지 않도록 몸통 셈을 하나 흘려 둔다.
  받은몸통.push('(미리 채움)');
  for await (const ev of run(s, ctx, r.text, { 그림들: r.그림들 })) { void ev; }
  const 나간것 = 받은몸통.slice(1).join('');
  check('@ 로 붙인 그림이 실제로 나간다', 나간것.includes(`data:image/png;base64,${한점PNG}`));
  check('@ 로 붙인 그림은 첫 사람 말에 실린다', 그림장수(s.messages[0]) === 1, JSON.stringify(s.messages[0]?.role));
}

// ── 7. 창 셈 — 그림 한 장이 대화를 접게 만들면 안 된다 ─────────────────
trace('7-셈');
{
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, vision: true };
  const 없는것 = new Session(conn, { root });
  없는것.push({ role: 'user', content: '이거 봐' });
  const 앞 = 없는것.breakdown().used;

  const 있는것 = new Session(conn, { root });
  // 3MB 짜리 그림 하나. 글자로 세면 100만 토큰이 넘는다.
  const 큰b64 = 'A'.repeat(3 * 1024 * 1024);
  있는것.push(그림메시지('openai', { 글: '이거 봐', 그림들: [{ b64: 큰b64, mime: 'image/png' }] }));
  const 뒤 = 있는것.breakdown().used;

  check('그림 한 장을 글자 수로 세지 않는다', 뒤 - 앞 < 그림한장토큰 * 2, `${뒤 - 앞} 토큰 늘어남`);
  check('그래도 공짜로 치지는 않는다', 뒤 - 앞 >= 그림한장토큰 * 0.8, `${뒤 - 앞} 토큰`);
  check('창이 다 찬 것으로 보지 않는다', 뒤 < 있는것.breakdown().total, `${뒤} / ${있는것.breakdown().total}`);

  // Ollama 규격도 같아야 한다.
  const 올 = new Session({ ...conn, kind: 'ollama' }, { root });
  올.push(그림메시지('ollama', { 글: '이거 봐', 그림들: [{ b64: 큰b64, mime: 'image/png' }] }));
  check('Ollama 규격도 똑같이 센다', 올.breakdown().used - 앞 < 그림한장토큰 * 2, `${올.breakdown().used - 앞} 토큰`);
}

// ── 8. 오래된 그림 빼기 ────────────────────────────────────────────────
trace('8-빼기');
{
  const 만들기 = (n) => 그림메시지('openai', { 글: `${n}번째 화면`, 그림들: [{ b64: 한점PNG, mime: 'image/png' }] });
  const s = { messages: [{ role: 'user', content: '처음 부탁' }, 만들기(1), 만들기(2), 만들기(3)] };
  const r = foldImages(s);
  check('최근 두 장만 남긴다', r.뺀것 === 1, `${r.뺀것}장 뺌`);
  check('뺀 자리에 무엇이었는지 남는다', /그림 1장은 자리를 비우려고 뺐습니다/.test(s.messages[1].content), s.messages[1].content);
  check('사람이 쓴 말은 그대로 남는다', s.messages[1].content.startsWith('1번째 화면'), s.messages[1].content);
  check('남긴 것은 안 건드린다', 그림장수(s.messages[2]) === 1 && 그림장수(s.messages[3]) === 1);
  check('그림 없는 사람 말은 손 안 댄다', s.messages[0].content === '처음 부탁');

  // Ollama 규격도 images 를 지워야 한다 — 안 지우면 뺐다면서 안 뺀 것이 된다.
  const o = { messages: [그림메시지('ollama', { 글: '옛것', 그림들: [{ b64: 한점PNG }] }), 그림메시지('ollama', { 글: 'a', 그림들: [{ b64: 한점PNG }] }), 그림메시지('ollama', { 글: 'b', 그림들: [{ b64: 한점PNG }] })] };
  foldImages(o);
  check('Ollama 도 실제로 빠진다', 그림장수(o.messages[0]) === 0 && o.messages[0].images === undefined,
    JSON.stringify(o.messages[0]).slice(0, 60));
}

// ── 9. 도구 설명 — 못 보는 모델에게는 말하지 않는다 ────────────────────
trace('9-설명');
{
  const 설명 = (v) => toolSchemas(['Read'], { vision: v })[0].function.description;
  check('눈이 있으면 그림 이야기를 한다', /화면 사진·그림/.test(설명(true)), 설명(true).slice(-40));
  check('눈이 없으면 아예 말을 안 꺼낸다', !/화면 사진·그림/.test(설명(false)));
  check('나머지 설명은 그대로', 설명(true).startsWith(설명(false)));
}

// ── 10. 눈이 있는지 물어보기 ───────────────────────────────────────────
trace('10-눈검사');
{
  // 그림이 든 메시지를 거절하는 서버.
  const 받은것 = [];
  let 받아주나 = true;
  const s2 = createServer((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      const u = new URL(q.url, 'http://127.0.0.1');
      받은것.push({ 길: u.pathname, 몸: body });
      const 보내 = (코드, 것) => { res.writeHead(코드, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(것)); };
      if (/image_url|"images"/.test(body) && !받아주나) {
        return 보내(400, { error: { message: 'this model does not support image input' } });
      }
      보내(200, { choices: [{ message: { content: '점' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    });
  });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${s2.address().port}/v1`;
  allowEndpoint(b2);

  받아주나 = true;
  const 잘됨 = await probe({ kind: 'openai', base: b2, auth: 'none', key: '', model: 'fake' });
  const 눈칸 = 잘됨.results.find((r) => r.id === 'vision');
  check('그림을 받는 서버는 눈 있음', 잘됨.facts.vision === true && 눈칸.status === 'ok', JSON.stringify(눈칸?.detail));
  const 눈요청 = 받은것.find((x) => /image_url/.test(x.몸));
  check('물어볼 때 1×1 점만 보낸다', 눈요청?.몸.includes(한점PNG), 눈요청 ? '보냄' : '안 보냄');
  check('진짜 화면은 안 보낸다', (눈요청?.몸.length ?? 0) < 2000, `${눈요청?.몸.length}바이트`);

  받은것.length = 0;
  받아주나 = false;
  const 안됨 = await probe({ kind: 'openai', base: b2, auth: 'none', key: '', model: 'fake' });
  const 눈칸2 = 안됨.results.find((r) => r.id === 'vision');
  check('거절하는 서버는 눈 없음', 안됨.facts.vision === false && 눈칸2.status === 'no', JSON.stringify(눈칸2?.detail));
  check('무엇 때문인지 서버 말을 그대로 옮긴다', /does not support image input/.test(눈칸2?.detail ?? ''), 눈칸2?.detail);
  check('그림은 안 보낸다고 알린다', /그림은 안 보냅니다/.test(눈칸2?.detail ?? ''), 눈칸2?.detail);

  s2.close();
}

server.close();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n그림 보기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
