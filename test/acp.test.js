// 에디터 안에서 deel 이 도는가 (ACP).
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 사내에 반입한 도구는 "터미널을 하나 더 띄우세요" 를 못 넘는다. 개발자는
// 하루 종일 IDE 안에 있고, 창을 옮겨 다녀야 하는 도구는 두 주쯤 뒤에 안 쓴다.
// ACP 를 지키면 Zed·JetBrains·Neovim·Emacs 가 저쪽을 안 고치고 deel 을 붙인다.
//
// 붙는 것은 쉽다. **안 깨지는 것**이 어렵다. 이 프로토콜은 깨질 때 조용히
// 깨진다 — 에디터는 "에이전트가 응답하지 않습니다" 만 띄우고, 왜 그런지는
// 어디에도 안 남는다. 그래서 여기서는 진짜 프로세스를 띄우고 진짜 파이프로
// 주고받으면서, 규격이 못 박은 것들을 하나씩 확인한다.
//
//   · 표준출력에 ACP 말고 아무것도 안 나가는가 (규격이 MUST NOT 이라 적은 것)
//   · 덩이가 아무 데서나 끊겨 와도 붙는가 (한글이 두 덩이에 걸쳐 오는 경우 포함)
//   · id 가 0 인 요청을 알림으로 오해하지 않는가
//   · 취소가 도중에 닿는가 (기다리는 동안 다음 줄을 못 읽으면 영영 안 닿는다)
//   · 승인을 못 물어봤을 때 마음대로 하지 않는가
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 줄나누기, 연결, 오류번호, 모르는방법오류 } from '../src/acp/jsonrpc.js';
import {
  도구갈래, 도구이름표, 도구자리, 도구탈났나, 도구내용,
  도구끝남, 도구시작, 멈춘까닭, 프롬프트글, 되살린것,
} from '../src/acp/map.js';
import { toolSchemas } from '../src/tools/index.js';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-줄나누기');

// ── 덩이를 줄로 붙이기 ──────────────────────────────────────────────────
//
// 파이프는 줄 단위로 안 끊어 준다. 한 덩이에 메시지가 셋 실려 오기도 하고,
// 한 메시지가 셋으로 쪼개져 오기도 한다. 여기가 틀리면 그 위의 모든 것이
// 가끔씩만 동작한다 — 제일 찾기 어려운 종류의 고장이다.
{
  {
    const 나온것 = [];
    const 먹이기 = 줄나누기((줄) => 나온것.push(줄));
    먹이기('{"a":1}\n{"a":2}\n');
    check('한 덩이에 둘이 실려 와도 둘로 나눈다', 나온것.length === 2, JSON.stringify(나온것));
  }

  {
    const 나온것 = [];
    const 먹이기 = 줄나누기((줄) => 나온것.push(줄));
    먹이기('{"a":');
    먹이기('1}');
    check('아직 줄이 안 끝났으면 안 내보낸다', 나온것.length === 0, JSON.stringify(나온것));
    먹이기('\n');
    check('개행이 와야 내보낸다', 나온것.length === 1 && 나온것[0] === '{"a":1}', JSON.stringify(나온것));
  }

  {
    const 나온것 = [];
    const 먹이기 = 줄나누기((줄) => 나온것.push(줄));
    먹이기('{"a":1}\r\n');
    check('\\r\\n 으로 와도 \\r 을 떼고 준다', 나온것[0] === '{"a":1}', JSON.stringify(나온것));
  }

  {
    const 나온것 = [];
    const 먹이기 = 줄나누기((줄) => 나온것.push(줄));
    먹이기('\n\n  \n{"a":1}\n');
    check('빈 줄은 오류로 치지 않고 넘긴다', 나온것.length === 1, JSON.stringify(나온것));
  }

  /*
   * 한글이 덩이 경계에 걸쳐 온다.
   *
   * 이 자리는 반드시 온다. 프롬프트도 파일 내용도 도구 결과도 전부 한글이고,
   * 파이프는 글자 단위가 아니라 바이트 단위로 끊긴다. 덩이마다 따로
   * toString('utf8') 하면 잘린 바이트가 각자 U+FFFD 로 바뀌어 버린다 —
   * JSON 은 여전히 파싱되므로 오류도 안 나고, 글자만 조용히 뭉개진다.
   */
  {
    const 나온것 = [];
    const 먹이기 = 줄나누기((줄) => 나온것.push(줄));
    const 원본 = Buffer.from('{"글":"안녕하세요 세계"}\n', 'utf8');
    // '녕' 한가운데를 자른다.
    const 자를자리 = Buffer.from('{"글":"안', 'utf8').length + 1;
    먹이기(원본.subarray(0, 자를자리));
    먹이기(원본.subarray(자를자리));
    check('한글이 덩이 경계에 걸쳐도 안 뭉개진다',
      나온것.length === 1 && JSON.parse(나온것[0]).글 === '안녕하세요 세계',
      나온것[0] ?? '(안 나옴)');
  }
}

trace('2-JSON-RPC');

// ── 한쪽 끝 ─────────────────────────────────────────────────────────────
{
  const 만들기 = (다루기) => {
    const 나간것 = [];
    const 관 = new 연결({ 보내기: (줄) => 나간것.push(줄), 다루기 });
    return { 관, 나간것, 파싱: () => 나간것.map((s) => JSON.parse(s)) };
  };
  const 잠깐 = () => new Promise((r) => setImmediate(r));

  {
    const { 관, 파싱 } = 만들기(() => ({ 됐다: true }));
    관.받았다('{"jsonrpc":"2.0","id":7,"method":"뭐든","params":{}}');
    await 잠깐();
    const 답 = 파싱()[0];
    check('요청에 같은 id 로 답한다', 답?.id === 7 && 답?.result?.됐다 === true, JSON.stringify(답));
    check('jsonrpc 판을 적는다', 답?.jsonrpc === '2.0');
  }

  /*
   * id 가 0 인 요청.
   *
   * ACP 클라이언트는 실제로 0번부터 센다. `if (msg.id)` 로 보면 이걸 알림으로
   * 읽고 답을 안 보낸다 — 그러면 **첫 initialize 부터** 영영 안 끝난다.
   * 붙자마자 멈추는데 로그에는 아무것도 안 남는다.
   */
  {
    const { 관, 파싱 } = 만들기(() => ({ ok: 1 }));
    관.받았다('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}');
    await 잠깐();
    check('id 가 0 이어도 답한다', 파싱()[0]?.id === 0, JSON.stringify(파싱()));
  }

  {
    const { 관, 나간것 } = 만들기(() => ({ ok: 1 }));
    관.받았다('{"jsonrpc":"2.0","method":"session/cancel","params":{}}');
    await 잠깐();
    check('알림에는 답하지 않는다', 나간것.length === 0, JSON.stringify(나간것));
  }

  {
    const { 관, 파싱 } = 만들기((방법) => { throw 모르는방법오류(방법); });
    관.받았다('{"jsonrpc":"2.0","id":1,"method":"없는것"}');
    await 잠깐();
    check('모르는 방법은 -32601', 파싱()[0]?.error?.code === 오류번호.모르는방법, JSON.stringify(파싱()));
  }

  {
    const { 관, 파싱 } = 만들기(() => ({}));
    관.받았다('이건 JSON 이 아니다');
    await 잠깐();
    const 답 = 파싱()[0];
    check('못 읽는 줄은 -32700 으로 답한다', 답?.error?.code === 오류번호.파싱, JSON.stringify(답));
    check('그때 id 는 null', 답?.id === null, JSON.stringify(답));
  }

  /*
   * 묶음(batch) — `[{…}]` 한 줄.
   *
   * 배열도 typeof 로는 'object' 라 「객체가 아닙니다」 갈래를 지나쳤고, method 가
   * 없으니 id 도 없는 것으로 읽혀 **아무 답도 안 나갔다.** 저쪽은 영영 기다린다.
   * 우리는 묶음을 안 받는다 — 안 받는다고 답한다.
   */
  {
    const { 관, 파싱 } = 만들기(() => ({ ok: 1 }));
    관.받았다('[{"jsonrpc":"2.0","id":99,"method":"뭐든","params":{}}]');
    await 잠깐();
    const 답 = 파싱()[0];
    check('★★ 묶음 한 줄에도 -32600 으로 답한다', 답?.error?.code === 오류번호.잘못된요청 && 답?.id === null,
      JSON.stringify(파싱()));
  }

  {
    const { 관, 파싱 } = 만들기(() => { throw new Error('안쪽에서 터졌다'); });
    관.받았다('{"jsonrpc":"2.0","id":2,"method":"뭐든"}');
    await 잠깐();
    const 답 = 파싱()[0];
    check('다루다 터지면 -32603 과 까닭', 답?.error?.code === 오류번호.안쪽오류 && /터졌다/.test(답?.error?.message ?? ''),
      JSON.stringify(답));
  }

  // 저쪽에 요청을 걸고 답을 받는다. 승인 묻기가 이 길로 간다.
  {
    const { 관, 파싱 } = 만들기(() => ({}));
    const 기다림 = 관.요청('session/request_permission', { sessionId: 'x' });
    const 나간것 = 파싱()[0];
    check('요청에 번호를 붙여 내보낸다', typeof 나간것?.id === 'number' && 나간것.method === 'session/request_permission',
      JSON.stringify(나간것));
    관.받았다(JSON.stringify({ jsonrpc: '2.0', id: 나간것.id, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } }));
    const 받은것 = await 기다림;
    check('저쪽 답이 그 요청으로 돌아온다', 받은것?.outcome?.optionId === 'allow_once', JSON.stringify(받은것));
  }

  /*
   * 관이 닫히면 기다리던 것을 깨뜨려야 한다.
   *
   * 안 깨뜨리면 그 프라미스를 붙들고 있던 자리가 영영 안 끝난다. 사람 눈에는
   * "에디터가 멈췄다" 로 보이고, 원인은 이미 죽은 프로세스라 어디에도 안 남는다.
   */
  {
    const { 관 } = 만들기(() => ({}));
    const 기다림 = 관.요청('아무거나', {});
    관.닫기();
    let 깨졌나 = false;
    try { await 기다림; } catch { 깨졌나 = true; }
    check('관을 닫으면 기다리던 요청이 깨진다', 깨졌나);
  }

  /*
   * ── ★ (사냥5 H5-9) 첫 줄 앞에 BOM 이 붙어 왔다 ──────────────────────────
   *
   * .NET 의 `StreamWriter(Encoding.UTF8)` 같은 것은 첫 바이트에 BOM(EF BB BF) 을
   * 붙인다. 그러면 첫 줄 = initialize 가 JSON 으로 안 풀려 -32700 · id null 로
   * 답했고, 저쪽은 initialize 의 답을 영영 기다렸다. 붙자마자 멈추는 꼴이다.
   */
  {
    const { 관, 파싱 } = 만들기(() => ({ ok: 1 }));
    const 먹이기 = 줄나누기((줄) => 관.받았다(줄));
    const BOM = String.fromCharCode(0xfeff);
    먹이기(Buffer.from(BOM + '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n', 'utf8'));
    await 잠깐();
    check('★ (사냥5 H5-9) 첫 줄 앞에 BOM 이 붙어 와도 그 요청에 답한다',
      파싱()[0]?.id === 1 && 파싱()[0]?.result?.ok === 1, JSON.stringify(파싱()));
  }

  /*
   * ── ★ (사냥5 H5-10) method 가 빈 글인 요청을 「답」 으로 읽었다 ────────────
   *
   * `!온것.method` 는 빈 글도 거짓으로 친다. 그래서 `{"id":77,"method":""}` 가
   * 우리 요청에 대한 답 갈래로 가서 조용히 버려졌고 — 77번에는 아무 답도 안 나갔다.
   * 같은 번호의 요청을 우리가 기다리고 있었으면 그 요청이 엉뚱하게 풀리기도 한다.
   */
  {
    const { 관, 나간것 } = 만들기(() => ({ ok: 1 }));
    const 기다림 = 관.요청('저쪽에건것', {});
    let 풀렸나 = false;
    기다림.then(() => { 풀렸나 = true; }, () => {});
    관.받았다('{"jsonrpc":"2.0","id":77,"method":""}');
    관.받았다('{"jsonrpc":"2.0","id":1,"method":""}');
    await 잠깐();
    const 답들 = 나간것.map((s) => JSON.parse(s)).filter((x) => !('method' in x));
    check('★ (사냥5 H5-10) method 가 빈 글이면 -32600 으로 그 id 에 답한다',
      답들.some((x) => x.id === 77 && x.error?.code === 오류번호.잘못된요청), JSON.stringify(답들));
    check('★ (사냥5 H5-10) 빈 method 줄이 기다리던 우리 요청을 풀지 않는다', !풀렸나, JSON.stringify(답들));
  }

  /*
   * ── ★ (8회차 ACP-3) method 칸이 **아예 없는** 줄을 답으로 읽었다 ───────────
   *
   * 위 H5-10 은 빈 method 만 막았다. 칸째 없으면 `!('method' in 온것)` 이 참이라
   * 그대로 답 갈래로 갔고, result 칸이 없으니 기다리던 우리 요청이 **undefined 로
   * 풀렸다.** 승인 묻기가 이 길로 오므로, 답이 아닌 줄 하나가 승인 결과를 「아무것도
   * 안 고름」 으로 만든다. 그리고 그 id 에는 아무 답도 안 나가 저쪽도 영영 기다린다.
   * 답인지 아닌지는 result·error 칸이 정한다 (JSON-RPC 2.0).
   */
  {
    const { 관, 나간것 } = 만들기(() => ({ ok: 1 }));
    let 풀린것 = '아직';
    관.요청('저쪽에건것', {}).then((v) => { 풀린것 = `풀림:${JSON.stringify(v)}`; }, () => { 풀린것 = '깨짐'; });
    const 건것 = JSON.parse(나간것[0]);
    관.받았다(JSON.stringify({ jsonrpc: '2.0', id: 건것.id, params: {} }));
    await 잠깐();
    /*
     * 「안 푼다」 는 **값으로 안 푼다** 는 뜻이다 (사냥6 막판-뒷단).
     *
     * 여기가 `=== '아직'` 이라 「깨뜨리지도 마라」 까지 못 박고 있었다 — 그러면 저쪽이
     * 규격을 어긴 줄 하나를 보냈을 때 우리 기다림이 **영영 안 끝나는 것**이 옳은 것이
     * 된다. 이 블록 머리말이 하지 말자고 적은 「저쪽도 영영 기다린다」 의 우리 쪽 판이다.
     */
    check('★ (8회차 ACP-3) result·error 가 없는 줄은 기다리던 우리 요청을 값으로 안 푼다', !/^풀림/.test(풀린것), 풀린것);
    check('★★★ (사냥6) 그렇다고 영영 매달려 있지도 않는다 — 까닭을 붙여 깨뜨린다', 풀린것 === '깨짐', 풀린것);
    const 답들 = 나간것.slice(1).map((s) => JSON.parse(s));
    check('★ (8회차 ACP-3) method 칸이 없는 요청에는 그 id 로 -32600 을 답한다',
      답들.some((x) => x.id === 건것.id && x.error?.code === 오류번호.잘못된요청), JSON.stringify(답들));
  }

  /*
   * (ACP-3 곁) 빈 method 에 result 가 같이 붙어 온 줄.
   *
   * 「id 와 method 가 같이 있으면 요청이다」(H5-10) 와 「result·error 가 있어야 답이다」
   * (ACP-3)가 부딪치는 유일한 자리다. 앞의 것이 이긴다 — 안 그러면 빈 method 한 글자로
   * 남이 우리 승인 물음을 제 값으로 풀어 버릴 수 있다.
   */
  {
    const { 관, 나간것 } = 만들기(() => ({ ok: 1 }));
    let 풀린것 = '아직';
    관.요청('승인묻기', {}).then((v) => { 풀린것 = `풀림:${JSON.stringify(v)}`; }, () => { 풀린것 = '깨짐'; });
    const 건것 = JSON.parse(나간것[0]);
    관.받았다(JSON.stringify({ jsonrpc: '2.0', id: 건것.id, method: '', result: { 훔친것: 1 } }));
    await 잠깐();
    check('★ 빈 method 에 result 가 붙어 와도 기다리던 요청을 안 푼다', 풀린것 === '아직', 풀린것);
    check('  그 줄에는 -32600 으로 답한다',
      나간것.slice(1).map((s) => JSON.parse(s)).some((x) => x.id === 건것.id && x.error?.code === 오류번호.잘못된요청),
      JSON.stringify(나간것.slice(1)));
  }

  // error 로 온 진짜 답은 그대로 그 요청을 깨뜨려야 한다 (위 ACP-3 의 반대쪽).
  {
    const { 관, 나간것 } = 만들기(() => ({ ok: 1 }));
    let 끝난것 = '아직';
    관.요청('또건것', {}).then(() => { 끝난것 = '풀림'; }, (e) => { 끝난것 = `깨짐:${e.code}`; });
    관.받았다(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(나간것[0]).id, error: { code: -32601, message: '모름' } }));
    await 잠깐();
    check('(ACP-3 짝) error 로 온 답은 그 요청을 깨뜨린다', 끝난것 === '깨짐:-32601', 끝난것);
  }

  /*
   * ── ★ (6회차 규약6ai-b J2) id 가 null 인 요청을 알림으로 쳤다 ──────────────
   *
   * 알림은 id **칸이 없는** 요청이다(JSON-RPC 2.0). 위 H5-10 머리말도 「id 와 method 가
   * 같이 있으면 요청이다」 라고 적었다. null 을 알림으로 치면 답이 한 줄도 안 나가
   * 저쪽이 영영 기다린다.
   */
  {
    const { 관, 나간것 } = 만들기(() => ({ ok: 1 }));
    관.받았다('{"jsonrpc":"2.0","id":null,"method":"뭐든"}');
    관.받았다('{"jsonrpc":"2.0","method":"알림이다"}');
    await 잠깐();
    const 답들 = 나간것.map((s) => JSON.parse(s));
    check('★ (6회차 규약6ai-b J2) id 가 null 인 요청에도 id:null 로 답한다',
      답들.some((x) => x.id === null && x.result?.ok === 1), JSON.stringify(답들));
    check('(J2 짝) id 칸이 없는 알림에는 여전히 답하지 않는다', 답들.length === 1, JSON.stringify(답들));
  }

  // 내보내는 줄에 개행이 섞이면 그 줄이 두 메시지로 읽힌다. 규격이 금지한다.
  {
    const { 관, 나간것 } = 만들기(() => ({ 글: '첫 줄\n둘째 줄' }));
    관.받았다('{"jsonrpc":"2.0","id":1,"method":"뭐든"}');
    await 잠깐();
    const 줄 = 나간것[0] ?? '';
    check('답 속의 개행이 진짜 개행으로 안 나간다', 줄.split('\n').filter(Boolean).length === 1, JSON.stringify(줄));
    check('그래도 값은 그대로다', JSON.parse(줄).result.글 === '첫 줄\n둘째 줄');
  }
}

trace('3-옮기기');

// ── deel 이 흘리는 것을 ACP 모양으로 ────────────────────────────────────
//
// 갈래·자리·상태는 안 줘도 규격에 안 걸린다. 그래서 대충 붙인 구현은 죄다
// 안 준다. 그런데 이 셋이 없으면 에디터에서 전부 똑같은 회색 점이고,
// 고친 파일을 눌러도 안 열린다. 같은 프로토콜을 쓰고도 화면이 달라지는 자리다.
{
  check('읽는 도구는 read', 도구갈래('Read') === 'read');
  check('고치는 도구는 edit', 도구갈래('Edit') === 'edit' && 도구갈래('Write') === 'edit');
  check('찾는 도구는 search', 도구갈래('Grep') === 'search' && 도구갈래('Glob') === 'search');
  check('명령은 execute', 도구갈래('Bash') === 'execute');
  check('밖에서 가져오는 것은 fetch', 도구갈래('WebFetch') === 'fetch');
  check('모르는 도구는 other — 낱말을 지어내지 않는다', 도구갈래('mcp__무엇__무엇') === 'other');
  check('★ 옮기는 도구는 move', 도구갈래('Move') === 'move', 도구갈래('Move'));
  check('★ 언어 서버에 묻는 것도 search', 도구갈래('Def') === 'search' && 도구갈래('Refs') === 'search',
    `${도구갈래('Def')} · ${도구갈래('Refs')}`);

  /*
   * 갈래를 안 주면 에디터는 **전부 똑같은 회색 점**으로 그린다. 도구가 하나
   * 늘 때마다 이 표에 한 줄을 더해야 하는데, 안 더해도 아무 데서도 안 터진다 —
   * 화면만 조용히 밋밋해진다. 그래서 여기서 목록째로 견준다.
   *
   * 정말 갈래가 없는 것(사람에게 묻기·기억하기)만 여기 적어 둔다.
   */
  {
    const 갈래없어도되는것 = new Set(['Ask', 'Remember']);
    const 이름들 = toolSchemas(null, { hasSkills: true, web: true, lsp: true, vision: true })
      .map((t) => t.function?.name).filter(Boolean);
    const 회색 = 이름들.filter((n) => !갈래없어도되는것.has(n) && 도구갈래(n) === 'other');
    check('★★ 도구 목록에 갈래를 안 준 것이 없다', 회색.length === 0,
      회색.length ? `회색 점으로 그려질 것: ${회색.join(' · ')}` : `${이름들.length}개 전부 갈래가 있습니다`);
  }

  check('이름표에 무엇을 만졌는지 넣는다', 도구이름표('Read', { file_path: 'src/runner.js' }) === 'Read(src/runner.js)',
    도구이름표('Read', { file_path: 'src/runner.js' }));
  check('여러 개면 몇 개인지 말한다',
    /외 2개/.test(도구이름표('Write', { files: [{ file_path: 'a.js' }, { file_path: 'b.js' }, { file_path: 'c.js' }] })),
    도구이름표('Write', { files: [{ file_path: 'a.js' }, { file_path: 'b.js' }, { file_path: 'c.js' }] }));
  check('인자가 없어도 안 죽는다', 도구이름표('TodoWrite', null) === 'TodoWrite');

  /*
   * 자리는 결과에 실린 절대 경로를 먼저 쓴다.
   *
   * 인자에 적힌 것은 상대 경로일 수 있는데 에디터는 절대 경로라야 연다.
   * 인자만 보고 넘기면 눌러도 안 열리는 링크가 되고, 그건 없느니만 못하다.
   */
  {
    const 자리 = 도구자리('Edit', { file_path: 'src/runner.js' }, { changed: 'C:\\일감\\src\\runner.js' });
    check('결과의 절대 경로를 먼저 쓴다', 자리[0]?.path === 'C:\\일감\\src\\runner.js', JSON.stringify(자리));
    check('인자 쪽도 같이 담는다', 자리.some((x) => x.path === 'src/runner.js'), JSON.stringify(자리));
  }
  check('만진 파일이 없으면 빈 목록', 도구자리('Bash', { command: 'ls' }, { summary: 'ok' }).length === 0);

  /*
   * 도는 중(tool_call)에는 결과가 아직 없다. 그때 실리는 것은 인자에 적힌
   * **상대 경로뿐**이고, 에디터는 절대 경로라야 연다. 뿌리를 주면 여기서 편다 —
   * 안 펴면 도구가 도는 내내 링크가 다 죽어 있는데 화면에는 멀쩡해 보인다.
   */
  {
    const 뿌리 = join(tmpdir(), '내프로젝트');
    const 편것 = 도구자리('Edit', { file_path: 'src/runner.js' }, null, { 뿌리 });
    check('★★ 도는 중에도 링크가 열리는 절대 경로다',
      편것[0]?.path === join(뿌리, 'src', 'runner.js'), JSON.stringify(편것));
    check('★ 도구시작에도 그대로 실린다',
      도구시작('t1', 'Edit', { file_path: 'src/runner.js' }, { 뿌리 })
        .locations[0]?.path === join(뿌리, 'src', 'runner.js'),
      JSON.stringify(도구시작('t1', 'Edit', { file_path: 'src/runner.js' }, { 뿌리 }).locations));

    // 결과의 절대 경로와 인자의 상대 경로가 같은 파일이면 한 줄이어야 한다.
    // 안 그러면 열리는 링크와 안 열리는 링크가 나란히 뜬다.
    const 겹친것 = 도구자리('Edit', { file_path: 'src/runner.js' },
      { changed: join(뿌리, 'src', 'runner.js') }, { 뿌리 });
    check('★ 같은 파일이 두 줄로 안 뜬다', 겹친것.length === 1, JSON.stringify(겹친것));

    // 되살린 화면에서도 같다 — 지난 대화의 링크가 다 죽어 있으면 안 된다.
    const 되 = 되살린것([
      { role: 'assistant', content: '', tool_calls: [{ id: 'x1', type: 'function', function: { name: 'Edit', arguments: JSON.stringify({ file_path: 'src/runner.js' }) } }] },
      { role: 'tool', tool_call_id: 'x1', content: '고쳤습니다' },
    ], { 뿌리 });
    check('★★ 되살린 도구의 링크도 열린다',
      되[0]?.locations?.[0]?.path === join(뿌리, 'src', 'runner.js'), JSON.stringify(되[0]?.locations));
  }

  /*
   * ★★★ 펼 줄 아는 것과 **펴라고 시키는 것**은 다른 자리다.
   *
   * 위의 검사는 map.js 가 뿌리를 받으면 편다는 것만 잰다. 그런데 뿌리를
   * 넘기는 쪽은 serve.js 이고, 거기서 한 자리만 빠져도 그 길로 나가는 링크는
   * 전부 죽는다 — map.js 는 그대로 초록이고 화면에도 아무 말이 없다.
   *
   * 부르는 자리가 다섯이라 눈으로는 못 지킨다. 글로 지킨다.
   */
  {
    const serve소스 = readFileSync(new URL('../src/acp/serve.js', import.meta.url), 'utf8');
    const 부르는것 = /(도구자리|도구시작|도구끝남|되살린것)\s*\(/g;
    const 뿌리없는것 = [];
    for (const m of serve소스.matchAll(부르는것)) {
      // 여는 괄호부터 짝이 맞는 닫는 괄호까지를 잘라 그 안에 뿌리가 있나 본다.
      let 깊이 = 0;
      let i = m.index + m[0].length - 1;
      for (; i < serve소스.length; i += 1) {
        if (serve소스[i] === '(') 깊이 += 1;
        else if (serve소스[i] === ')') { 깊이 -= 1; if (깊이 === 0) break; }
      }
      const 인자 = serve소스.slice(m.index, i + 1);
      if (!인자.includes('뿌리')) 뿌리없는것.push(`${m[1]} — ${인자.slice(0, 60)}`);
    }
    check(`★★★ serve 가 map 을 부르는 자리 ${[...serve소스.matchAll(부르는것)].length}곳이 전부 뿌리를 넘긴다`,
      뿌리없는것.length === 0, 뿌리없는것.join(' · '));
  }

  /*
   * 이름표는 에디터의 **한 줄** 머리다. 본문 줄이는 자르기() 를 쓰면 끝에
   * `\n… (N자 줄임)` 이 붙어 머리가 두 줄이 되고, 한 줄로 자리를 잡아 둔
   * 쪽에서 그 줄이 깨진다.
   */
  check('★ 이름표에 줄바꿈이 안 들어간다',
    !도구이름표('Bash', { command: `echo ${'a'.repeat(90)}` }).includes('\n'),
    JSON.stringify(도구이름표('Bash', { command: `echo ${'a'.repeat(90)}` })));
  check('★ 이름이 없어도 undefined 라고 안 적는다',
    도구이름표(undefined, { path: 'a.js' }) === '도구(a.js)', 도구이름표(undefined, { path: 'a.js' }));

  /*
   * 탈이 났는지는 error 만 보면 안 된다.
   *
   * Bash 는 종료코드를, Verify 는 "탈 2개" 를 요약에 담아 돌려준다. 그것들을
   * 성공으로 칠하면 에디터 화면에서 성공과 구별되지 않는다.
   */
  check('error 는 실패다', 도구탈났나({ error: '없는 파일' }) === true);
  check('failed 도 실패다', 도구탈났나({ failed: true, summary: '탈 2개' }) === true);
  check('멀쩡하면 성공', 도구탈났나({ summary: '3줄' }) === false);

  {
    const 끝 = 도구끝남('t1', { name: 'Edit', args: { file_path: 'a.js' }, result: { changed: '/w/a.js', summary: '1군데' } });
    check('끝난 것은 tool_call_update', 끝.sessionUpdate === 'tool_call_update');
    check('성공이면 completed', 끝.status === 'completed', 끝.status);
    check('실패면 failed', 도구끝남('t2', { name: 'Read', result: { error: '없다' } }).status === 'failed');
  }

  // 모델에게 가는 본문을 그대로 실으면 에디터 창이 수만 자로 덮인다.
  {
    const 큰것 = 도구내용({ content: '가'.repeat(9000) }, 500);
    check('보여 줄 만큼만 자른다', 큰것[0].content.text.length < 700, String(큰것[0].content.text.length));
    check('자른 것을 자랐다고 말한다', /줄임/.test(큰것[0].content.text));
    check('아무것도 없으면 빈 목록', 도구내용({}).length === 0);
  }

  check('끝났으면 end_turn', 멈춘까닭('done') === 'end_turn');
  check('끊겼으면 cancelled', 멈춘까닭('aborted') === 'cancelled');
  check('걸음 수 상한은 max_turn_requests', 멈춘까닭('limit') === 'max_turn_requests');
  // 헛돎을 refusal 로 보내면 에디터가 이 대화를 버려야 하는 것으로 읽는다.
  check('헛돎은 refusal 이 아니다 — 대화를 버리라는 뜻이 되면 안 된다', 멈춘까닭('stuck') !== 'refusal',
    멈춘까닭('stuck'));

  check('글 덩이에서 말을 뽑는다', 프롬프트글([{ type: 'text', text: '검사 돌려줘' }]) === '검사 돌려줘');
  check('붙임의 알맹이도 같이 넣는다',
    /파일 내용/.test(프롬프트글([{ type: 'resource', resource: { uri: 'file:///a.js', text: '파일 내용' } }])),
    프롬프트글([{ type: 'resource', resource: { uri: 'file:///a.js', text: '파일 내용' } }]));
  check('못 읽는 것은 조용히 버리지 않고 말한다',
    /못 읽/.test(프롬프트글([{ type: 'image', data: 'x', mimeType: 'image/png' }])),
    프롬프트글([{ type: 'image', data: 'x', mimeType: 'image/png' }]));
  /*
   * ── ★ (8회차 ACP-2) 빈 파일을 「못 읽었습니다」 라고 적었다 ───────────────
   *
   * 빈 글도 **읽은 것**이다. `r.text` 가 '' 면 truthy 검사에서 떨어져 알맹이가
   * 아예 없는 붙임(그림·바이너리)과 같은 갈래로 가서 「글이 아니라 못 읽었습니다」
   * 가 붙었다. 모델은 그걸 읽기 실패로 알아듣고 같은 파일을 Read 로 또 연다 —
   * 그리고 또 빈 파일을 본다. 빈 것과 못 읽은 것은 다음에 할 일이 다르다.
   */
  {
    const 빈것 = 프롬프트글([{ type: 'resource', resource: { uri: 'empty.txt', text: '' } }]);
    check('★ (8회차 ACP-2) 빈 붙임을 「못 읽었다」 고 적지 않는다', !/못 읽/.test(빈것), JSON.stringify(빈것));
    check('★ (8회차 ACP-2) 빈 붙임도 어느 파일이 비었는지는 적는다',
      /empty\.txt/.test(빈것) && /빈/.test(빈것), JSON.stringify(빈것));
    const 알맹이없음 = 프롬프트글([{ type: 'resource', resource: { uri: 'bin.png', blob: 'AAA' } }]);
    check('(ACP-2 짝) 글이 아예 안 실려 온 붙임은 그대로 「못 읽었다」 다', /못 읽/.test(알맹이없음), 알맹이없음);
  }

  check('이상한 것이 와도 안 죽는다', 프롬프트글(null) === '' && 프롬프트글([null, 3, 'x']) === '');
}

trace('3-2-되살리기');

// ── 지난 대화를 다시 흘릴 모양으로 ──────────────────────────────────────
//
// session/load 는 되살린 것을 **답으로 돌려주는 자리가 없다.** 오간 말을 전부
// session/update 로 다시 흘려야 한다. 그러니 에디터에 그려지는 지난 대화는
// 여기서 만든 것이 전부다 — 여기서 빠뜨린 것은 화면에서 통째로 사라지고,
// 사람은 기록이 날아간 줄 안다.
{
  const 대화 = [
    { role: 'system', content: '너는 코딩 에이전트다. (아주 긴 지시문)' },
    { role: 'user', content: '집계.py 고쳐줘' },
    {
      role: 'assistant',
      content: '먼저 읽어 보겠습니다.',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: '/일터/집계.py' }) } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: '1  import sys\n2  print(1)\n' },
    { role: 'assistant', content: '고쳤습니다.' },
  ];
  const 나온것 = 되살린것(대화);
  const 갈래 = 나온것.map((u) => u.sessionUpdate);

  check('사람 말을 되살린다', 나온것.some((u) => u.sessionUpdate === 'user_message_chunk' && /집계\.py 고쳐줘/.test(u.content?.text ?? '')),
    JSON.stringify(갈래));
  check('모델 말을 되살린다', 나온것.filter((u) => u.sessionUpdate === 'agent_message_chunk').length === 2, JSON.stringify(갈래));
  check('순서가 오간 그대로다', 갈래.join('>').startsWith('user_message_chunk>agent_message_chunk>tool_call'), 갈래.join('>'));

  /*
   * 시스템 프롬프트는 사람이 한 말이 아니다.
   *
   * 되살려서 흘리면 지난 대화 머리마다 수천 자짜리 지시문이 붙는다. 정작
   * 무슨 얘기를 했는지가 그 아래로 밀려나서 안 보인다.
   */
  check('★ 시스템 프롬프트는 안 흘린다', !나온것.some((u) => /코딩 에이전트다/.test(u.content?.text ?? '')),
    JSON.stringify(나온것.map((u) => (u.content?.text ?? '').slice(0, 20))));

  const 도구 = 나온것.find((u) => u.sessionUpdate === 'tool_call');
  check('도구 호출을 되살린다', !!도구, JSON.stringify(갈래));
  check('무엇을 했는지 이름표에 있다', /Read\(.*집계\.py\)/.test(도구?.title ?? ''), 도구?.title);
  check('갈래를 준다 — 없으면 전부 같은 회색 점이 된다', 도구?.kind === 'read', String(도구?.kind));
  check('만진 파일 자리를 준다 — 눌러서 열 수 있게', 도구?.locations?.[0]?.path === '/일터/집계.py',
    JSON.stringify(도구?.locations));
  check('이미 끝난 일이니 끝난 모습으로 준다', 도구?.status === 'completed', String(도구?.status));
  check('★ 도구 결과도 같이 붙인다 — 무엇을 이미 확인했는지가 거기 있다',
    /import sys/.test(도구?.content?.[0]?.content?.text ?? ''), JSON.stringify(도구?.content));
  // 이미 끝난 것을 '도는 중' 으로 한 번 그렸다가 고칠 까닭이 없다.
  check('되살릴 때는 도는 중을 안 거친다', !갈래.includes('tool_call_update'), 갈래.join('>'));

  /*
   * 답이 안 남은 도구 부름 = 그때 프로그램이 도구 도는 중에 끊긴 것이다.
   *
   * 성공으로 그리면 안 된다. 그 도구가 끝까지 갔는지가 다음에 무엇을 시킬지를
   * 정한다 — 파일을 고치던 중이었을 수도 있다.
   */
  {
    const 끊긴것 = 되살린것([
      { role: 'user', content: '고쳐줘' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c9', type: 'function', function: { name: 'Edit', arguments: '{"file_path":"/a.js"}' } }] },
    ]);
    const t = 끊긴것.find((u) => u.sessionUpdate === 'tool_call');
    check('★ 답이 안 남은 부름은 성공으로 안 그린다', t?.status === 'failed', String(t?.status));
    check('왜 그런지 말해 준다', /끊겼습니다/.test(t?.content?.[0]?.content?.text ?? ''), JSON.stringify(t?.content));
  }

  /*
   * ── ★ (8회차 ACP-1) id 있는 부름이 **남의 답을 뺏었다** ───────────────────
   *
   * id 로 짝이 안 맞으면 이름 큐에서 한 번 더 찾았다. 그 큐에 든 것은 같은 이름을
   * 쓰는 **다른 부름의 답**이다. 그래서 제 답이 안 남은 부름이 남의 답을 달고
   * completed 로 그려졌다 — 바로 위 머리말이 「성공으로 그리면 안 된다」 고 적어 둔
   * 그 자리다. 파일을 고치다 끊긴 자리가 화면에서는 끝난 일이 되고, 사람은 그 위에서
   * 다음 일을 시킨다.
   */
  {
    const 뺏김 = 되살린것([
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.txt"}' } }] },
      { role: 'tool', tool_name: 'Read', content: '이름으로 짝지을 다른 답' },
    ]);
    const t = 뺏김.find((u) => u.sessionUpdate === 'tool_call');
    check('★ (8회차 ACP-1) id 있는 부름은 제 id 의 답이 없으면 실패로 그린다', t?.status === 'failed',
      `${t?.status} · ${JSON.stringify(t?.content?.[0]?.content?.text)}`);
    check('★ (8회차 ACP-1) 이름 큐에서 남의 답을 뺏어 오지 않는다',
      !/다른 답/.test(t?.content?.[0]?.content?.text ?? ''), JSON.stringify(t?.content));
  }

  // ollama 규격은 도구 답에 id 를 안 준다. 이름 차례로 짝을 짓는다.
  {
    const o = 되살린것([
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'Grep', arguments: { pattern: '오류' } } }] },
      { role: 'tool', tool_name: 'Grep', content: '3건 찾음' },
    ]);
    const t = o.find((u) => u.sessionUpdate === 'tool_call');
    check('id 를 안 주는 규격도 짝을 짓는다', t?.status === 'completed' && /3건 찾음/.test(t?.content?.[0]?.content?.text ?? ''),
      JSON.stringify(t));
  }

  // 그림이 붙어 있던 말. 글만 빼고 버리면 그 말을 왜 했는지가 사라진다.
  {
    const g = 되살린것([{ role: 'user', content: [{ type: 'text', text: '이 화면 봐줘' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] }]);
    check('그림이 붙어 있었다는 것은 남긴다', /그림 1장/.test(g[0]?.content?.text ?? ''), JSON.stringify(g[0]));
    check('그림 알맹이는 안 싣는다 — 되살리는 데 base64 를 흘릴 까닭이 없다',
      !/base64|AAA/.test(g[0]?.content?.text ?? ''), JSON.stringify(g[0]));
  }

  check('빈 대화도 안 죽는다', 되살린것([]).length === 0 && 되살린것(null).length === 0);
  check('이상한 것이 섞여 와도 안 죽는다', 되살린것([null, 3, { role: 'user' }]).length === 0,
    JSON.stringify(되살린것([null, 3, { role: 'user' }])));

  // 번호가 겹치면 에디터가 서로 다른 두 호출을 하나로 그린다.
  {
    const 여럿 = 되살린것([
      { role: 'assistant', content: '', tool_calls: [
        { id: 'a', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/1"}' } },
        { id: 'b', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/2"}' } },
      ] },
      { role: 'tool', tool_call_id: 'a', content: '하나' },
      { role: 'tool', tool_call_id: 'b', content: '둘' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/3"}' } }] },
      { role: 'tool', tool_call_id: 'c', content: '셋' },
    ]);
    const 번호들 = 여럿.filter((u) => u.sessionUpdate === 'tool_call').map((u) => u.toolCallId);
    check('★ 도구 번호가 안 겹친다', new Set(번호들).size === 번호들.length && 번호들.length === 3, JSON.stringify(번호들));
    check('짝을 순서대로 맞춘다',
      여럿.filter((u) => u.sessionUpdate === 'tool_call').map((u) => u.content[0].content.text).join('|') === '하나|둘|셋',
      JSON.stringify(여럿.filter((u) => u.sessionUpdate === 'tool_call').map((u) => u.content[0].content.text)));
  }

  // 파일 하나가 수만 자다. 그것이 통째로 에디터로 흘러가면 사람이 못 읽는다.
  {
    const 긴것 = 되살린것([
      { role: 'assistant', content: '', tool_calls: [{ id: 'z', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/big"}' } }] },
      { role: 'tool', tool_call_id: 'z', content: 'ㄱ'.repeat(50000) },
    ]);
    const 글 = 긴것.find((u) => u.sessionUpdate === 'tool_call')?.content?.[0]?.content?.text ?? '';
    check('긴 결과는 보여 줄 만큼만 자른다', 글.length < 3000 && /줄임/.test(글), `${글.length}자`);
  }
}

trace('4-표준출력잠그기');

// ── 표준출력에 ACP 말고 아무것도 안 나가는가 ────────────────────────────
//
// 규격이 MUST NOT 이라 적어 둔 것이다. 어기면 조용히 안 깨진다 — 에디터가
// 그 줄을 파싱하다 실패하고 "응답하지 않습니다" 만 뜬다.
//
// deel 안에는 say() 로 화면에 적는 자리가 수십 군데다. 그 중 하나라도 이
// 모드에서 불리면 관이 깨진다. 그래서 부르는 자리를 하나하나 막는 대신
// 통로 자체를 바꿔 끼웠다. 진짜로 바뀌었는지를 여기서 잰다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-acp-잠금-'));
  const 스크립트 = join(방, '더럽히기.mjs');
  // 임시 폴더에서 도니까 import 는 절대 경로로 적는다. 윈도우에서는 file:// 로
  // 적어야 한다 — C:\ 로 시작하는 경로를 그대로 주면 'C:' 를 프로토콜로 읽는다.
  const 주소 = (...조각) => JSON.stringify(pathToFileURL(join(here, '..', ...조각)).href);
  writeFileSync(스크립트, [
    `import { 표준출력잠그기 } from ${주소('src', 'acp', 'serve.js')};`,
    `import { say } from ${주소('src', 'ui', 'ansi.js')};`,
    'const 내보내기 = 표준출력잠그기();',
    "say('이 줄이 표준출력에 나가면 관이 깨진다');",
    "console.log('console.log 도 마찬가지다');",
    "process.stdout.write('직접 쓴 것도 마찬가지다\\n');",
    '내보내기(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\\n");',
  ].join('\n'), 'utf8');

  const 나온것 = await new Promise((끝) => {
    const kid = spawn(process.execPath, [스크립트], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { err += b; });
    kid.on('close', () => 끝({ out, err }));
  });

  const 줄들 = 나온것.out.split('\n').filter((s) => s.trim());
  check('표준출력에는 ACP 한 줄만 나간다', 줄들.length === 1, JSON.stringify(줄들));
  check('그 한 줄은 제대로 된 JSON', (() => { try { return JSON.parse(줄들[0]).id === 1; } catch { return false; } })(),
    줄들[0] ?? '(없음)');
  check('say() 로 적은 것은 표준오류로 간다', /관이 깨진다/.test(나온것.err), 나온것.err.slice(0, 120));
  check('console.log 도 표준오류로 간다', /console.log 도/.test(나온것.err));

  rmSync(방, { recursive: true, force: true });
}

trace('5-진짜로띄우기');

// ── 진짜 프로세스를 띄워서 ──────────────────────────────────────────────
//
// 여기서부터는 흉내가 아니다. `deel acp` 를 자식 프로세스로 띄우고, 에디터가
// 하는 그대로 표준입력으로 말을 걸고 표준출력을 읽는다. 모델 자리는 이
// 컴퓨터 안(127.0.0.1)의 임시 스텁이다 — 바깥으로는 한 바이트도 안 나간다.

let 느리게 = 0;      // 이 밀리초만큼 뜸을 들이고 답한다 (취소를 재려고)
let 도구번호 = 1;
let 읽기한번 = false;
let 한계알린적 = false;
let 자리없다한횟수 = 0;
let 쓸파일이름 = '늦게쓴것.txt';   // 일부러_써 가 Write 로 만들라고 할 파일 (사냥5 H5-3)
const 받은대화 = [];   // 게이트웨이가 받은 messages 원본 (되살리기를 재려고)

const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (ch) => (body += ch));
  req.on('end', () => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let json = null;
    try { json = body ? JSON.parse(body) : null; } catch { /* 없을 수 있다 */ }
    const 보냄 = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

    if (url === '/v1/models') return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });
    if (url === '/api/v0/models/스텁모델') {
      return 보냄({ id: '스텁모델', max_context_length: 262144, loaded_context_length: 262144 });
    }
    if (url === '/v1/chat/completions') {
      // 나간 몸통을 그대로 적어 둔다. 되살리기가 진짜로 되는지는 화면 글자가
      // 아니라 **모델이 무엇을 받았는가** 로만 잴 수 있다.
      받은대화.push(json?.messages ?? []);
      const 답 = (msg, why) => 보냄({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
        usage: { prompt_tokens: 120, completion_tokens: 12 },
      });
      const 도구답 = (name, args) => 답({
        role: 'assistant', content: null,
        tool_calls: [{ id: `c${도구번호++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      });

      const 사람말 = String([...(json?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '');

      if (/일부러_느리게/.test(사람말) && 느리게) {
        setTimeout(() => 답({ role: 'assistant', content: '늦게 왔습니다' }), 느리게);
        return undefined;
      }
      if (/일부러_읽어/.test(사람말) && !읽기한번) {
        읽기한번 = true;
        return 도구답('Read', { file_path: '읽을것.txt' });
      }
      if (/일부러_명령/.test(사람말) && !읽기한번) {
        읽기한번 = true;
        return 도구답('Bash', { command: 'echo 안녕' });
      }

      /*
       * ── 에디터에 아무 말도 안 가고 있던 세 자리 ────────────────────────
       *
       * 제일 나쁜 것이 말없이 끊김이다. 서버가 끝났다는 말도 없이 멈춘 반쪽
       * 답이 에디터에는 **온전한 답**으로 뜬다. 사람은 그걸 읽고 다음 일로
       * 넘어가는데, 정작 답의 뒷부분은 오지도 않았다.
       */
      if (/일부러_말없이끊김/.test(사람말)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"여기까지 쓰다가 "}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"끊"}}]}\n\n');
        return res.end();
      }
      if (/일부러_한계알림/.test(사람말)) {
        if (!한계알린적) {
          한계알린적 = true;
          return 보냄({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 41003 tokens." } }, 400);
        }
        return 답({ role: 'assistant', content: '(스텁 모델이 답했습니다)' });
      }
      /*
       * 자리가 다 차서 두 번 거절한다.
       *
       * 한 번만 거절하면 배우기(learned)로 끝난다 — 그건 위에서 이미 잰다.
       * 두 번째 거절이 있어야 「접어도 안 들어간다」 가 되고, 그때 비우기가
       * 돈다. 비운 뒤에도 시킨 말은 못 박혀 그대로 실려 오므로 이 갈래는
       * 그 다음 부름에서도 맞는다 — 맞아야 맞는 것이다.
       */
      if (/일부러_자리없음/.test(사람말)) {
        if (자리없다한횟수 < 2) {
          자리없다한횟수++;
          return 보냄({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 41003 tokens." } }, 400);
        }
        return 답({ role: 'assistant', content: '(스텁 모델이 답했습니다)' });
      }
      if (/일부러_길이잘림/.test(사람말)) {
        return 답({ role: 'assistant', content: '여기까지 쓰다가 끊' }, 'length');
      }
      // 파일 하나를 쓰게 한다. 이미 도구 결과가 실려 왔으면 끝낸다 (사냥5 H5-3).
      if (/일부러_써/.test(사람말) && !(json?.messages ?? []).some((m) => m.role === 'tool')) {
        return 도구답('Write', { file_path: 쓸파일이름, content: '늦게 쓴 글\n' });
      }
      // 할 일 목록을 한 번 적게 한다. 이미 도구 결과가 실려 왔으면 끝낸다 — 상태를 안 들고 간다.
      if (/일부러_할일/.test(사람말) && !(json?.messages ?? []).some((m) => m.role === 'tool')) {
        return 도구답('TodoWrite', {
          todos: [
            { text: '버그 A 고치기', state: 'done' },
            { text: '버그 B 고치기', state: 'doing' },
            { text: '버그 C 고치기', state: 'todo' },
          ],
        });
      }
      return 답({ role: 'assistant', content: '(스텁 모델이 답했습니다)' });
    }
    보냄({}, 404);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/v1`;

const home = mkdtempSync(join(tmpdir(), 'deel-acp-home-'));
const work = mkdtempSync(join(tmpdir(), 'deel-acp-work-'));
writeFileSync(join(work, '읽을것.txt'), '한 줄짜리 파일입니다.\n두 번째 줄.\n', 'utf8');
writeFileSync(join(home, 'config.json'), JSON.stringify({
  version: 1, active: 'stub', level: '개발자',
  profiles: [{
    id: 'stub', name: '스텁 연결', kind: 'openai',
    baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델',
    ctx: 32768, streaming: false, tools: true, json: true, think: false,
  }],
}, null, 2), 'utf8');

/**
 * 에디터 흉내. ACP 클라이언트 쪽이다.
 *
 * 일부러 아주 작게 짠다 — 여기가 커지면 무엇을 재는지가 흐려진다.
 */
function 에디터(더줄인자 = [], 환경덧 = {}) {
  const kid = spawn(process.execPath, [진입점, 'acp', '--root', work, ...더줄인자], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEEL_HOME: home, DEEL_NO_OPEN: '1', FORCE_COLOR: '', ...환경덧 },
  });

  const 대기 = new Map();
  let 다음 = 0;
  const 알림들 = [];
  const 날줄 = [];
  const 응답표 = new Map();
  let 표준오류 = '';

  kid.stderr.on('data', (b) => { 표준오류 += b; });

  const 쓰기 = (o) => kid.stdin.write(JSON.stringify(o) + '\n');

  kid.stdout.on('data', 줄나누기((줄) => {
    날줄.push(줄);
    let 온것;
    try { 온것 = JSON.parse(줄); } catch { return; }
    if ('id' in 온것 && !온것.method) {
      const w = 대기.get(온것.id);
      if (!w) return;
      대기.delete(온것.id);
      온것.error ? w.깨기(Object.assign(new Error(온것.error.message), { code: 온것.error.code })) : w.풀기(온것.result);
      return;
    }
    if (온것.method === 'session/update') { 알림들.push(온것.params); return; }
    // 에이전트가 우리에게 건 요청 (승인 묻기가 이 길로 온다)
    if ('id' in 온것) {
      const 답하기 = 응답표.get(온것.method);
      if (답하기) {
        // undefined 를 돌려주면 **안 답하고 들고 있는다** — 사람이 승인 창을 안 누른 채인 판 (사냥5 H5-3).
        const 결과 = 답하기(온것.params, 온것.id);
        if (결과 !== undefined) 쓰기({ jsonrpc: '2.0', id: 온것.id, result: 결과 });
      } else 쓰기({ jsonrpc: '2.0', id: 온것.id, error: { code: -32601, message: '이 클라이언트는 그걸 못 합니다' } });
    }
  }));

  return {
    kid, 알림들, 날줄, 응답표,
    날쓰기: 쓰기,
    표준오류: () => 표준오류,
    요청(방법, 인자) {
      const id = 다음++;   // 0 부터 센다 — 진짜 클라이언트가 그렇게 한다
      return new Promise((풀기, 깨기) => {
        대기.set(id, { 풀기, 깨기 });
        쓰기({ jsonrpc: '2.0', id, method: 방법, params: 인자 ?? {} });
      });
    },
    알림(방법, 인자) { 쓰기({ jsonrpc: '2.0', method: 방법, params: 인자 ?? {} }); },
    끝내기() {
      return new Promise((끝) => {
        kid.on('close', () => 끝());
        try { kid.stdin.end(); } catch { /* 이미 닫혔다 */ }
        setTimeout(() => { try { kid.kill(); } catch { /* 이미 죽었다 */ } }, 4000).unref();
      });
    },
  };
}

const 시간제한 = (p, ms, 무엇) => Promise.race([
  p,
  new Promise((_, 깨기) => setTimeout(() => 깨기(new Error(`${무엇} 가 ${ms}ms 안에 안 끝났습니다`)), ms).unref()),
]);

/*
 * ── 정해 둔 만큼 자지 말고, **될 때까지 본다** ─────────────────────────
 *
 * 여기 두 자리가 `setTimeout(r, 300)` · `setTimeout(r, 700)` 이었다. 둘 다
 * 「이쯤이면 됐겠지」 다. 그 숫자에는 두 가지 값이 붙는다.
 *
 *   빠른 판에서는 **늘 그만큼 논다.** 두 자리에서 1초, 검사 전체로는 더.
 *   느린 판(CI 의 공용 일꾼·윈도우)에서는 **가끔 모자라서** 빨개진다.
 *   그 빨강은 고장이 아니라 그날 그 기계가 느렸다는 뜻이라, 보는 사람은
 *   다시 돌려 보고 넘어간다. 그렇게 몇 번 하면 빨강 자체를 안 믿게 된다.
 *
 * 기다리는 대상이 「무엇이 참이 되는 것」 이면 그것을 보면 된다. 되면 곧장
 * 지나가고, 안 되면 정해 둔 시간까지만 기다렸다 그 사실대로 빨개진다.
 *
 * @returns {Promise<boolean>} 참이 됐으면 true, 시간이 다 갔으면 false
 */
async function 될때까지(볼것, ms = 8000, 사이 = 20) {
  const 끝날때 = Date.now() + ms;
  for (;;) {
    try { if (볼것()) return true; } catch { /* 아직 없는 것을 보면 그럴 수 있다 */ }
    if (Date.now() >= 끝날때) return false;
    await new Promise((r) => { setTimeout(r, 사이).unref?.(); });
  }
}

trace('5-1-악수');

// ── 붙는가 ──────────────────────────────────────────────────────────────
{
  const e = 에디터();
  try {
    const 첫 = await 시간제한(e.요청('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: '검사용 에디터', version: '0.0.1' },
    }), 15000, 'initialize');

    check('규격 판을 답한다', 첫?.protocolVersion === 1, JSON.stringify(첫?.protocolVersion));
    check('제 이름을 말한다', 첫?.agentInfo?.name === 'deel', JSON.stringify(첫?.agentInfo));
    check('판 번호를 지어내지 않는다', /^\d+\.\d+\.\d+$/.test(첫?.agentInfo?.version ?? ''), 첫?.agentInfo?.version);
    // 이 값이 false 면 에디터는 아예 안 물어보고 빈 대화를 연다.
    check('지난 대화를 되살릴 수 있다고 말한다', 첫?.agentCapabilities?.loadSession === true,
      JSON.stringify(첫?.agentCapabilities));
    // 못 하는 것을 할 수 있다고 하면 에디터가 부르고, 그때 빈 화면이 뜬다.
    check('못 하는 것은 여전히 못 한다고 말한다', 첫?.agentCapabilities?.promptCapabilities?.image === false,
      JSON.stringify(첫?.agentCapabilities?.promptCapabilities));

    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    check('세션을 열어 준다', typeof 방?.sessionId === 'string' && 방.sessionId.length > 0, JSON.stringify(방?.sessionId));

    /*
     * 작업 모드를 에디터의 모드 고르개로 내보낸다.
     *
     * 프로토콜에 이미 있는 자리에 deel 것을 얹은 것이다. 이게 붙으면 Zed 의
     * 모드 단추가 deel 의 '계획 / 코드 / 설계' 를 그대로 고른다 — 저쪽은
     * 한 줄도 안 고친다.
     */
    check('작업 모드를 목록으로 내놓는다', (방?.modes?.availableModes?.length ?? 0) >= 5,
      JSON.stringify(방?.modes?.availableModes?.map((m) => m.id)));
    /*
      * 「글이 왔다」 가 아니라 **쓸 수 있는 값인가**를 잰다.
      *
      * 에디터는 이 값으로 모드 단추의 고른 자리를 칠한다. 목록에 없는 이름이
      * 오면 아무것도 안 골라진 채로 그려지고, 그건 화면만 봐서는 우리 탓인지
      * 저쪽 탓인지 알 수가 없다. `typeof … === 'string'` 은 오타 하나까지
      * 통과시킨다 — 그 검사는 이 고장을 한 번도 못 잡는다.
      */
    const 모드목록 = (방?.modes?.availableModes ?? []).map((m) => m.id);
    check('★ 지금 모드가 그 목록 안에 있다', 모드목록.includes(방?.modes?.currentModeId),
      `${방?.modes?.currentModeId} ∉ ${JSON.stringify(모드목록)}`);

    /*
     * ── 값을 잰다, '뭐라도 왔다' 를 재지 않는다 ──────────────────────────
     *
     * 여기는 `바꿈 !== undefined` 였다. 그건 「답이 왔다」 는 뜻일 뿐이라,
     * 모드를 엉뚱한 것으로 바꿔 놔도 초록이다. 규격이 정한 답은 빈 객체이고,
     * **정말 바뀌었는지**는 그 뒤에 적히는 줄로 가린다.
     */
    const 바꿈 = await 시간제한(e.요청('session/set_mode', { sessionId: 방.sessionId, modeId: 'plan' }), 8000, 'set_mode');
    check('모드 바꾸기에 규격대로 빈 객체를 답한다', JSON.stringify(바꿈) === '{}', JSON.stringify(바꿈));
    // 로그가 표준오류로 나가는 데 잠깐 걸린다 — 300ms 를 재지 말고 그 줄을 본다.
    const 바뀐줄 = () => /작업 모드를 plan 로 바꿨습니다/.test(e.표준오류());
    await 될때까지(바뀐줄, 8000);
    check('★ 고른 모드로 진짜 바뀐다', 바뀐줄(),
      (e.표준오류().split('\n').find((l) => /작업 모드를/.test(l)) ?? '그런 줄이 없다').slice(0, 80));

    /*
     * ── (8회차 ACP-4 판정) 처음 받은 값을 그대로 되보낼 수 있나 ────────────
     *
     * 에디터는 session/new 에서 받은 currentModeId 를 그대로 set_mode 로 되보낸다
     * (모드 단추로 원래 자리에 돌아오기). 그 값이 목록에 없거나 거절당하면 돌아갈
     * 자리가 없어진다. 8회차에 「종합(auto)이 목록에 없고 거절당한다」 는 지적이
     * 있었다 — 재 보니 목록에도 있고 받아들여진다. 다시 새지 않게 여기서 못 박는다.
     */
    const 되돌림 = await 시간제한(
      e.요청('session/set_mode', { sessionId: 방.sessionId, modeId: 방?.modes?.currentModeId }), 8000, 'set_mode 처음값');
    check('★ (8회차 ACP-4) 처음 받은 모드를 그대로 되보내도 받아들인다', JSON.stringify(되돌림) === '{}',
      `${방?.modes?.currentModeId} → ${JSON.stringify(되돌림)}`);

    /*
     * ── ★ 없는 모드 이름에 「바꿨다」 고 답했다 ────────────────────────────
     *
     * 정리하면 null 이 나오는 이름을 그대로 넣었다. 답은 `{}` (성공), 모드는
     * null(종합으로 떨어짐), 로그는 「작업 모드를 null 로 바꿨습니다」. 에디터는
     * 고른 단추가 먹힌 줄 안다. 모르는 이름은 잘못된 인자다.
     */
    let 모드오류 = null;
    try {
      await 시간제한(e.요청('session/set_mode', { sessionId: 방.sessionId, modeId: 'bogus' }), 8000, 'set_mode bogus');
    } catch (err) { 모드오류 = err; }
    check('★ 없는 모드 이름에는 -32602 로 답한다', 모드오류?.code === -32602, `${모드오류?.code} · ${모드오류?.message}`);
    check('★ 없는 모드로 바꿨다고 적지 않는다', !/작업 모드를 null 로/.test(e.표준오류()),
      (e.표준오류().split('\n').filter((l) => /작업 모드를/.test(l)).pop() ?? '').slice(0, 80));

    /*
     * ── ★ 상대 경로·없는 폴더를 작업 폴더로 받았다 ────────────────────────
     *
     * 규격은 cwd 를 절대 경로로 주라고 한다. 상대 경로를 받으면 에디터가 연
     * 프로젝트가 아니라 **에디터를 띄운 자리** 기준으로 풀린다 — 방만들기 머리말이
     * 「제일 무서운 종류의 실수」 라고 적은 그것이다. 없는 절대 경로는 대화 폴더를
     * 만들다 그 경로를 통째로 새로 만들었다. 둘 다 잘못된 인자다.
     */
    const 상대첫 = `deel-acp-rel-${process.pid}`;
    const 상대있었나 = existsSync(join(process.cwd(), 상대첫));
    let 상대오류 = null;
    try {
      await 시간제한(e.요청('session/new', { cwd: `${상대첫}/안쪽`, mcpServers: [] }), 20000, 'session/new 상대 cwd');
    } catch (err) { 상대오류 = err; }
    check('★ 상대 경로 cwd 는 -32602 로 거절한다', 상대오류?.code === -32602, `${상대오류?.code} · ${상대오류?.message}`);
    check('★ 띄운 자리에 그 폴더를 만들지 않는다', 상대있었나 || !existsSync(join(process.cwd(), 상대첫)), join(process.cwd(), 상대첫));
    if (!상대있었나) rmSync(join(process.cwd(), 상대첫), { recursive: true, force: true });

    // **있는** 폴더를 가리키는 상대 경로도 거절한다 — 없는 것만 막으면 「있으면 통과」 가 된다.
    // 띄운 자리에서 임시 작업 폴더로 가는 상대 경로를 쓴다. 뚫려도 저장소가 아니라 임시 폴더에 적힌다.
    const 있는상대 = relative(process.cwd(), work);
    if (!isAbsolute(있는상대)) {
      let 있는상대오류 = null;
      try {
        await 시간제한(e.요청('session/new', { cwd: 있는상대, mcpServers: [] }), 20000, 'session/new 있는 상대 cwd');
      } catch (err) { 있는상대오류 = err; }
      check('★ 있는 폴더라도 상대 경로 cwd 는 -32602 로 거절한다', 있는상대오류?.code === -32602,
        `${있는상대} → ${있는상대오류?.code} · ${있는상대오류?.message}`);
    }

    const 없는곳 = join(work, `없는폴더-${process.pid}`, '안쪽');
    let 없음오류 = null;
    try {
      await 시간제한(e.요청('session/new', { cwd: 없는곳, mcpServers: [] }), 20000, 'session/new 없는 cwd');
    } catch (err) { 없음오류 = err; }
    check('★ 없는 폴더 cwd 는 -32602 로 거절한다', 없음오류?.code === -32602, `${없음오류?.code} · ${없음오류?.message}`);
    check('★ 없는 폴더를 새로 만들지 않는다', !existsSync(join(work, `없는폴더-${process.pid}`)), 없는곳);

    /*
     * ── ★★ 대화 이름으로 대화 폴더 밖을 읽고 적었다 ────────────────────────
     *
     * session/load 의 sessionId 를 파일 이름에 그대로 이었다. `../../evil/x` 면
     * 작업 폴더의 `evil/x.jsonl` 을 대화로 읽고, 한 턴 돌면 거기에 대화를 적었다.
     */
    mkdirSync(join(work, 'evil'), { recursive: true });
    writeFileSync(join(work, 'evil', 'x.jsonl'), '', 'utf8');
    let 이름오류 = null;
    try {
      await 시간제한(e.요청('session/load', { sessionId: '../../evil/x', cwd: work, mcpServers: [] }), 20000, 'session/load ../');
    } catch (err) { 이름오류 = err; }
    check('★★ 폴더 밖을 가리키는 대화 이름은 -32602 로 거절한다', 이름오류?.code === -32602, `${이름오류?.code} · ${이름오류?.message}`);
    check('★★ 폴더 밖 파일에는 아무것도 안 적는다', readFileSync(join(work, 'evil', 'x.jsonl'), 'utf8') === '',
      readFileSync(join(work, 'evil', 'x.jsonl'), 'utf8').slice(0, 80));
    rmSync(join(work, 'evil'), { recursive: true, force: true });

    let 코드 = null;
    try { await e.요청('없는/방법', {}); } catch (err) { 코드 = err.code; }
    check('모르는 방법에는 -32601', 코드 === -32601, String(코드));
  } catch (err) {
    check('붙는가 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-2-한턴');

// ── 한 턴이 도는가 ──────────────────────────────────────────────────────
{
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');

    const 끝 = await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '한마디만 해줘' }],
    }), 30000, 'session/prompt');

    check('끝난 까닭을 규격 낱말로 답한다', 끝?.stopReason === 'end_turn', JSON.stringify(끝));

    const 글조각 = e.알림들.filter((u) => u.update?.sessionUpdate === 'agent_message_chunk');
    check('답을 흘려보낸다', 글조각.length > 0, `${e.알림들.length}개 알림`);
    check('흘려보낸 글이 진짜 답이다',
      글조각.map((u) => u.update.content.text).join('').includes('스텁 모델이 답했습니다'),
      글조각.map((u) => u.update.content.text).join('').slice(0, 80));
    check('알림마다 세션을 밝힌다', e.알림들.every((u) => u.sessionId === 방.sessionId));

    // 표준출력에 흘러간 것이 전부 제대로 된 JSON 이어야 한다. 한 줄이라도
    // 아니면 에디터는 그 자리에서 관을 끊는다.
    const 성한줄 = e.날줄.every((줄) => { try { JSON.parse(줄); return true; } catch { return false; } });
    check('표준출력이 전부 ACP 줄이다', 성한줄, e.날줄.find((줄) => { try { JSON.parse(줄); return false; } catch { return true; } }) ?? '');
  } catch (err) {
    check('한 턴 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

// ── 모드를 옮겼으면 옮겼다고 말하는가 ───────────────────────────────────
//
// ★★★ 대화 화면과 `deel run` 은 어느 모드로 갔는지, 무슨 말 때문인지 찍는다.
// 여기만 조용히 옮겼다. 모드는 이 턴에 파일이 바뀌는지를 정하는 값이라,
// 안 말하면 에디터 쪽 사람은 파일을 못 고치는 모드로 바뀐 것을 모른 채
// 「왜 안 고쳐?」 를 본다.
//
// 그리고 겹친 요청을 계획 모드로 보내면 안 된다 — 이어 가는 길이 repl.js
// 에만 있어서, 에디터에서 제일 자연스러운 승인말(「위 계획대로 진행해줘」)이
// 되레 또 계획 모드로 간다. 계획을 두 장 받고 파일은 그대로다.
trace('5-2-5-모드옮긴것을말하나');
{
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '이 폴더 정리해서 만들어줘' }],
    }), 30000, 'session/prompt');

    const 온글 = e.알림들
      .filter((u) => u.update?.sessionUpdate === 'agent_message_chunk')
      .map((u) => u.update.content.text).join('');
    check('★★★ 어느 모드로 옮겼는지 말한다', /◆\s*코드/.test(온글), 온글.slice(0, 160));
    check('★★★ 무슨 말 때문인지도 말한다', /말 속에 .* 가 있어서/.test(온글), 온글.slice(0, 160));
    check('★★★ 계획 모드로 안 보낸다 — 이어 갈 길이 없다',
      !/◆\s*계획/.test(온글), 온글.slice(0, 160));
    check('★★★ 계획부터 안 낸다는 것을 말해 준다',
      /승인받고 이어 갈 길이 없어/.test(온글), 온글.slice(0, 200));
  } catch (err) {
    check('모드 안내 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-3-도구');

// ── 도구를 부르면 에디터가 그릴 수 있게 나가는가 ────────────────────────
{
  읽기한번 = false;
  도구번호 = 1;
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_읽어 줘' }],
    }), 30000, 'session/prompt');

    const 시작 = e.알림들.filter((u) => u.update?.sessionUpdate === 'tool_call').map((u) => u.update);
    const 끝남 = e.알림들.filter((u) => u.update?.sessionUpdate === 'tool_call_update').map((u) => u.update);
    check('도구가 시작됐다고 알린다', 시작.length >= 1, JSON.stringify(시작.map((x) => x.title)));
    check('도구가 끝났다고 알린다', 끝남.length >= 1, JSON.stringify(끝남.map((x) => x.status)));

    // 시작과 끝이 같은 번호여야 하나로 그려진다. 안 맞으면 도구가 두 개로 보인다.
    check('시작과 끝이 같은 번호로 이어진다', 시작.some((s) => 끝남.some((f) => f.toolCallId === s.toolCallId)),
      `${JSON.stringify(시작.map((x) => x.toolCallId))} / ${JSON.stringify(끝남.map((x) => x.toolCallId))}`);

    const 읽은것 = 시작.find((x) => /^Read/.test(x.title ?? ''));
    check('무엇을 읽었는지 이름표에 있다', !!읽은것, JSON.stringify(시작.map((x) => x.title)));
    check('갈래를 read 로 준다', 읽은것?.kind === 'read', JSON.stringify(읽은것?.kind));

    const 자리있는것 = [...시작, ...끝남].find((x) => (x.locations?.length ?? 0) > 0);
    check('만진 파일 자리를 준다 — 눌러서 열 수 있게', !!자리있는것,
      JSON.stringify([...시작, ...끝남].map((x) => x.locations)));

    check('끝난 것은 completed 나 failed 다', 끝남.every((x) => ['completed', 'failed'].includes(x.status)),
      JSON.stringify(끝남.map((x) => x.status)));
  } catch (err) {
    check('도구 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-4-승인');

// ── 승인을 에디터에 물어보는가 ──────────────────────────────────────────
//
// 이게 붙는 것과 안 붙는 것의 차이가 크다. 안 붙으면 물어볼 데가 없어 전부
// 거부하게 되고, 그러면 에디터 안에서는 아무것도 못 하는 도구가 된다.
{
  읽기한번 = false;
  도구번호 = 1;
  const e = 에디터(['--mode', 'strict']);
  const 물어본것 = [];
  e.응답표.set('session/request_permission', (인자) => {
    물어본것.push(인자);
    return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
  });
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_명령 을 돌려줘' }],
    }), 30000, 'session/prompt');

    check('에디터에 승인을 묻는다', 물어본것.length >= 1, `${물어본것.length}번 물음`);
    const 물음 = 물어본것[0];
    check('무엇을 하려는지 같이 준다', /Bash/.test(물음?.toolCall?.title ?? ''), JSON.stringify(물음?.toolCall?.title));
    check('고를 것을 준다', (물음?.options?.length ?? 0) >= 2, JSON.stringify(물음?.options?.map((o) => o.optionId)));
    // 규격이 정한 낱말만 쓴다. 지어내면 에디터가 아이콘을 못 고른다.
    const 아는낱말 = new Set(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
    check('고를 것의 갈래가 규격 낱말이다', (물음?.options ?? []).every((o) => 아는낱말.has(o.kind)),
      JSON.stringify(물음?.options?.map((o) => o.kind)));
    check('세션을 밝힌다', 물음?.sessionId === 방.sessionId);

    const 끝남 = e.알림들.filter((u) => u.update?.sessionUpdate === 'tool_call_update').map((u) => u.update);
    check('허락했으면 실제로 돈다', 끝남.some((x) => x.status === 'completed'), JSON.stringify(끝남.map((x) => x.status)));
  } catch (err) {
    check('승인 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-5-못물어보면');

// ── 못 물어봤을 때 마음대로 하지 않는가 ─────────────────────────────────
//
// 여기서 '그냥 실행' 을 고르고 싶은 유혹이 있다. 안 그러면 승인 창을 아직
// 안 만든 클라이언트에서 아무것도 안 돌아가니까. 그런데 그건 "물어볼 수 없으면
// 마음대로 한다" 는 뜻이다. 아무도 안 보는 자리에서 되돌릴 수 없는 명령이
// 도는 것이 이 프로그램이 제일 피하려는 일이다.
{
  읽기한번 = false;
  도구번호 = 1;
  const e = 에디터(['--mode', 'strict']);   // 응답표를 안 채운다 = 승인을 못 하는 클라이언트
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    const 끝 = await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_명령 을 돌려줘' }],
    }), 30000, 'session/prompt');

    /*
     * 규격이 정한 다섯 낱말 중 하나여야 한다. 아무 글이나 오면 에디터는
     * 턴이 어떻게 끝났는지 모르고, 「멈춤」 인지 「끝남」 인지 화면에
     * 못 그린다. 여기는 못 물어봐서 도구를 거부한 자리라 end_turn 이다 —
     * cancelled 로 오면 사람이 취소한 것처럼 보인다.
     */
    const 끝낱말 = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'];
    check('★ 승인을 못 물어봐도 턴은 규격대로 끝난다 — 서 있지 않는다',
      끝?.stopReason === 'end_turn', `${끝?.stopReason} (받는 말: ${끝낱말.join('·')})`);
    const 끝남 = e.알림들.filter((u) => u.update?.sessionUpdate === 'tool_call_update').map((u) => u.update);
    check('못 물어봤으면 실행하지 않는다', !끝남.some((x) => x.status === 'completed' && /Bash/.test(x.title ?? '')),
      JSON.stringify(끝남.map((x) => `${x.title}:${x.status}`)));
    check('왜 거부했는지 표준오류에 남긴다', /승인을 못 물어봐서 거부/.test(e.표준오류()),
      e.표준오류().slice(-200));
  } catch (err) {
    check('못 물어보면 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-6-취소');

// ── 도중에 취소가 닿는가 ────────────────────────────────────────────────
//
// 취소는 늘 무언가가 돌고 있는 중에 온다. 그게 취소의 정의다. 그래서 들어온
// 줄을 하나씩 기다렸다 처리하면 취소는 영영 안 닿는다 — 앞의 턴이 끝나야
// 읽히는데, 그 턴을 끊으려고 보낸 것이기 때문이다.
{
  느리게 = 3000;
  읽기한번 = false;
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');

    const 턴 = e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_느리게 답해줘' }],
    });
    /*
     * 취소는 **무언가가 돌고 있을 때** 보내야 뜻이 있다. 700ms 를 자고 보내면
     * 느린 판에서는 아직 시작도 안 한 턴에 취소를 던지게 되고, 그건 이 검사가
     * 재려던 것(도는 중에 끼어들 수 있나)이 아니다.
     *
     * 「돌기 시작했다」 의 증거는 **게이트웨이가 그 한마디를 받은 것**이다.
     * 에디터로 흘러나온 알림을 보면 안 된다 — 사람 말을 되비추는 알림은
     * 모델을 부르기 전에 먼저 나가서, 아직 부르지도 않은 턴에 취소를 던지게
     * 된다(그렇게 하니 end_turn 이 돌아왔다). 여기 스텁은 이 한마디를 받고
     * 3초를 끄는 자리라, 받았다는 것이 곧 그 3초 안이라는 뜻이다.
     */
    const 받은수 = 받은대화.length;
    const 돌기시작 = await 될때까지(() => 받은대화.length > 받은수, 10000);
    check('취소를 보내기 전에 턴이 정말 돌고 있다', 돌기시작, `받은 대화 ${받은대화.length}개`);
    e.알림('session/cancel', { sessionId: 방.sessionId });

    const 끝 = await 시간제한(턴, 12000, '취소한 턴');
    check('취소하면 cancelled 로 답한다', 끝?.stopReason === 'cancelled', JSON.stringify(끝));
  } catch (err) {
    check('취소 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    느리게 = 0;
    await e.끝내기();
  }
}

trace('5-7-없는세션');

// ── 없는 세션에 말을 걸면 ───────────────────────────────────────────────
{
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    let 코드 = null;
    let 말 = '';
    try {
      await 시간제한(e.요청('session/prompt', { sessionId: '없는방', prompt: [{ type: 'text', text: '안녕' }] }), 10000, 'prompt');
    } catch (err) { 코드 = err.code; 말 = err.message; }
    check('없는 세션은 잘못된 인자로 답한다', 코드 === -32602, `${코드} · ${말}`);
    check('무엇이 없는지 말한다', /없는방/.test(말), 말);

    // 여기서 프로세스가 죽으면 안 된다. 한 번 잘못 부른 뒤에도 계속 살아야 한다.
    const 또 = await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 10000, '두 번째 initialize');
    check('잘못 부른 뒤에도 계속 산다', 또?.protocolVersion === 1);
  } catch (err) {
    check('없는 세션 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-8-되살리기');

// ── 껐다 켜도 지난 대화가 그대로 있는가 ─────────────────────────────────
//
// 여태는 에디터를 닫았다 열면 빈 대화가 열렸다. 사람은 어제 한 얘기를 처음부터
// 다시 해야 했다 — 무엇을 이미 확인했는지, 무엇을 하지 말라고 했는지 전부.
// 터미널에서는 --resume 으로 되던 것이라 더 이상하게 보였다.
//
// 그래서 여기서는 **프로세스를 진짜로 죽였다가** 새로 띄운다. 같은 프로세스
// 안에서 재면 파일에 제대로 적혔는지를 못 잰다.
{
  읽기한번 = false;
  도구번호 = 1;
  받은대화.length = 0;

  let 대화이름 = null;
  const e1 = 에디터();
  try {
    await 시간제한(e1.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e1.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    대화이름 = 방.sessionId;
    await 시간제한(e1.요청('session/prompt', {
      sessionId: 대화이름,
      prompt: [{ type: 'text', text: '일부러_읽어 줘 — 어제 하던 얘기' }],
    }), 30000, 'session/prompt');
  } catch (err) {
    check('되살리기(앞 대화) — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e1.끝내기();   // 여기서 프로세스가 정말로 죽는다
  }

  /*
   * 도구가 도는 중에 죽은 자리를 만든다.
   *
   * 진짜로 자주 일어나는 일이다 — 명령이 오래 걸려서 에디터를 닫아 버리는 것.
   * 그러면 파일에는 부름만 적히고 답이 없다. 그걸 그대로 모델에게 보내면
   * 규격 서버가 400 을 준다: 되살리자마자 첫 마디에서 죽는다.
   */
  try {
    appendFileSync(
      join(work, '.deel', 'sessions', `${대화이름}.jsonl`),
      JSON.stringify({
        t: 'msg',
        m: {
          role: 'assistant', content: null,
          tool_calls: [{ id: '끊긴부름', type: 'function', function: { name: 'Edit', arguments: '{"file_path":"/고치던것.js"}' } }],
        },
      }) + '\n',
      'utf8',
    );
  } catch (err) {
    check('끊긴 자리 만들기 — 실패', false, String(err?.message ?? err));
  }

  const e2 = 에디터();
  try {
    const 첫 = await 시간제한(e2.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    check('되살릴 수 있다고 말한 그대로다', 첫?.agentCapabilities?.loadSession === true);

    const 되살림 = await 시간제한(e2.요청('session/load', {
      sessionId: 대화이름, cwd: work, mcpServers: [],
    }), 25000, 'session/load');

    const 흘린것 = e2.알림들.map((u) => u.update);
    const 사람말 = 흘린것.filter((u) => u.sessionUpdate === 'user_message_chunk').map((u) => u.content?.text ?? '');
    const 모델말 = 흘린것.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => u.content?.text ?? '');
    const 도구들 = 흘린것.filter((u) => u.sessionUpdate === 'tool_call');

    check('★ 지난 사람 말을 다시 흘려 준다', 사람말.some((t) => /어제 하던 얘기/.test(t)), JSON.stringify(사람말));
    check('★ 지난 모델 말도 다시 흘려 준다', 모델말.some((t) => /스텁 모델이 답했습니다/.test(t)), JSON.stringify(모델말));
    check('★ 지난 도구 호출도 되살린다 — 무엇을 이미 봤는지가 거기 있다',
      도구들.some((t) => /^Read/.test(t.title ?? '')), JSON.stringify(도구들.map((t) => t.title)));
    check('되살린 알림도 세션을 밝힌다', e2.알림들.every((u) => u.sessionId === 대화이름), 대화이름);

    // 끊긴 자리는 끊겼다고 그린다. 성공으로 칠하면 사람은 그 편집이 끝난 줄 안다.
    const 끊긴것 = 도구들.find((t) => /고치던것\.js/.test(JSON.stringify(t.locations ?? [])));
    check('★ 도구 도는 중에 죽은 자리는 끊겼다고 그린다', 끊긴것?.status === 'failed',
      JSON.stringify(도구들.map((t) => `${t.title}:${t.status}`)));
    // 되살린 뒤에도 같은 규칙이다 — 목록에 없는 이름이면 모드 단추가 빈다.
    const 되산모드목록 = (되살림?.modes?.availableModes ?? []).map((m) => m.id);
    check('★ 되살리고 나서도 모드가 그 목록 안에 있다',
      되산모드목록.length > 0 && 되산모드목록.includes(되살림?.modes?.currentModeId),
      `${되살림?.modes?.currentModeId} ∉ ${JSON.stringify(되산모드목록)}`);

    /*
     * ★ 진짜로 재는 것은 이것이다.
     *
     * 화면에만 다시 그리고 모델에게는 안 보내면, 사람은 이어서 얘기하는 줄 알고
     * "아까 그거 마저 해줘" 라고 한다. 모델은 아무것도 모른다. 그건 빈 대화를
     * 여는 것보다 나쁘다 — 사람이 속는다.
     */
    받은대화.length = 0;
    await 시간제한(e2.요청('session/prompt', {
      sessionId: 대화이름, prompt: [{ type: 'text', text: '이어서 해줘' }],
    }), 30000, '이어서 한 턴');

    const 나간것 = 받은대화[0] ?? [];
    const 글다 = JSON.stringify(나간것);
    check('★ 되살린 대화가 모델에게도 실려 나간다', /어제 하던 얘기/.test(글다),
      `${나간것.length}개 메시지`);
    check('새로 친 말도 같이 나간다', /이어서 해줘/.test(글다), `${나간것.length}개 메시지`);

    /*
     * 도구 부름과 답의 짝이 성해야 한다.
     *
     * 도구가 도는 중에 죽었으면 부름만 적히고 답이 없다. 그대로 보내면 규격
     * 서버가 400 을 준다 — 되살리자마자 첫 마디에서 죽는다.
     */
    const 짝없는것 = 나간것.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
      .flatMap((m) => m.tool_calls.map((t) => t.id))
      .filter((id) => !나간것.some((m) => m.role === 'tool' && m.tool_call_id === id));
    check('★ 도구 짝이 안 깨진 채로 나간다 — 깨지면 400 이다', 짝없는것.length === 0, JSON.stringify(짝없는것));

    let 코드 = null; let 말 = '';
    try {
      await 시간제한(e2.요청('session/load', { sessionId: '20200101-000000', cwd: work, mcpServers: [] }), 15000, '없는 대화');
    } catch (err) { 코드 = err.code; 말 = err.message; }
    check('없는 대화를 되살리라면 잘못된 인자로 답한다', 코드 === -32602, `${코드} · ${말}`);
    check('무엇이 없는지 말한다', /20200101-000000/.test(말), 말);
  } catch (err) {
    check('되살리기 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e2.끝내기();
  }
}

trace('5-8b-할일과시킨말');

/*
 * ── ★★ 에디터로 연 대화는 남은 할 일과 시킨 말을 파일에 안 적었다 ─────────
 *
 * 저장 파일은 이 둘을 따로 한 줄씩 적는다(agent/store.js 의 살림따라가기).
 * 그런데 그걸 거는 자리가 터미널(agent/threads.js)에만 있었다. store.js 가
 * 「따로 부르는 자리를 만들면 그 길로 들어온 사람만 이어하기가 반쪽이 된다」
 * 고 적어 둔 바로 그 모양이다 — 에디터를 닫았다 열면 할 일이 사라진다.
 */
{
  let 이름 = null;
  const e1 = 에디터();
  try {
    await 시간제한(e1.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e1.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    이름 = 방.sessionId;
    await 시간제한(e1.요청('session/prompt', {
      sessionId: 이름, prompt: [{ type: 'text', text: '일부러_할일 — 버그 A B C 를 고쳐줘' }],
    }), 30000, 'session/prompt 할일');
    const 줄들 = readFileSync(join(work, '.deel', 'sessions', `${이름}.jsonl`), 'utf8')
      .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    check('★★ 에디터로 연 대화도 할 일을 파일에 적는다', 줄들.some((j) => j.t === 'todo' && j.목록?.length === 3),
      줄들.map((j) => j.t).join(','));
    check('★★ 에디터로 연 대화도 시킨 말 원문을 파일에 적는다', 줄들.some((j) => j.t === 'request' && /버그 A B C/.test(j.글 ?? '')),
      줄들.map((j) => j.t).join(','));
  } catch (err) {
    check('할 일 적기 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e1.끝내기();
  }

  if (이름) {
    const e2 = 에디터();
    try {
      await 시간제한(e2.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
      await 시간제한(e2.요청('session/load', { sessionId: 이름, cwd: work, mcpServers: [] }), 25000, 'session/load 할일');
      await 시간제한(e2.요청('session/prompt', { sessionId: 이름, prompt: [{ type: 'text', text: '이어서 해줘' }] }), 30000, '이어서 한 턴');
      const { Store: 저장 } = await import('../src/agent/store.js');
      const l = new 저장(work, 이름).load();
      check('★ 되살린 뒤 한 턴이 돌아도 할 일이 그대로 이어진다', l.할일?.length === 3, JSON.stringify(l.할일));
      check('★ 되살린 뒤 한 턴의 시킨 말이 새로 적힌다', /이어서 해줘/.test(l.이번요청 ?? ''), JSON.stringify(l.이번요청));
    } catch (err) {
      check('할 일 되살리기 — 통째로 실패', false, String(err?.message ?? err));
    } finally {
      await e2.끝내기();
    }
  }
}

trace('5-8c-다른규격이어받기');

/*
 * ── ★ 다른 규격으로 적힌 대화를 에디터로 이어받으면 지금 규격으로 옮겨 적는다 ─
 *
 * 저장 파일 머리글에는 규격이 없다. 어제 Anthropic 으로 한 대화를 오늘 이 스텁
 * (OpenAI 호환) 프로필로 열면 tool_use 블록이 그대로 나가 첫 마디가 400 이었다.
 * 보내는 사본은 session.js 의 wire() 가 한 번 더 맞추지만, **이력 자체**를 옮겼는지는
 * 로그로만 보인다 — 이어받기에서 옮겨야 다음 저장·접기가 새 모양으로 돈다.
 */
{
  const 이름 = `20260914-000001-${process.pid}`;
  mkdirSync(join(work, '.deel', 'sessions'), { recursive: true });
  writeFileSync(join(work, '.deel', 'sessions', `${이름}.jsonl`), [
    { t: 'meta', at: new Date().toISOString(), model: 'claude-x', root: work },
    { t: 'msg', m: { role: 'user', content: '앤트로픽 때 읽어줘' } },
    { t: 'msg', m: { role: 'assistant', content: [{ type: 'text', text: '읽겠습니다' }, { type: 'tool_use', id: 'toolu_9', name: 'Read', input: { file_path: '읽을것.txt' } }] } },
    { t: 'msg', m: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: '한 줄짜리 파일입니다.' }] } },
    { t: 'msg', m: { role: 'assistant', content: [{ type: 'text', text: '다 읽었습니다' }] } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');

  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    await 시간제한(e.요청('session/load', { sessionId: 이름, cwd: work, mcpServers: [] }), 25000, 'session/load 규격');
    const 옮긴줄 = () => /다른 규격으로 적힌 메시지 \d+개를 openai 모양으로 옮겨 적었습니다/.test(e.표준오류());
    await 될때까지(옮긴줄, 8000);
    check('★ 이어받을 때 다른 규격으로 적힌 이력을 옮겨 적었다고 남긴다', 옮긴줄(),
      (e.표준오류().split('\n').filter((l) => /이어 받았|옮겨 적/.test(l)).pop() ?? '그런 줄이 없다').slice(0, 100));

    받은대화.length = 0;
    await 시간제한(e.요청('session/prompt', { sessionId: 이름, prompt: [{ type: 'text', text: '이어서 해줘' }] }), 30000, '규격 이어서');
    const 나간것 = 받은대화.at(-1) ?? [];
    const 블록 = 나간것.filter((m) => Array.isArray(m.content) && m.content.some((b) => ['tool_use', 'tool_result'].includes(b?.type)));
    const 부름 = 나간것.find((m) => m.tool_calls?.length);
    check('★★ 이어받은 Anthropic 이력이 OpenAI 모양으로 나간다', 블록.length === 0 && 부름?.tool_calls?.[0]?.id === 'toolu_9'
      && 나간것.some((m) => m.role === 'tool' && m.tool_call_id === 'toolu_9'), JSON.stringify(나간것).slice(0, 300));
  } catch (err) {
    check('다른 규격 이어받기 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-9-사실대로-말하는가');

/*
 * ── 에디터에도 사실이 가야 한다 ─────────────────────────────────────────
 *
 * ACP 는 `capped` 하나만 보고 있었다. 나머지 셋 — 말없이 끊김(cutoff) ·
 * 되밀기(nudge) · 서버 한계 배움(learned) — 은 아무 말도 안 가고 있었다.
 * 그 중 cutoff 가 제일 나쁘다. 반쪽 답이 에디터에는 온전한 답으로 뜨고,
 * 사람은 그걸 읽고 다음 일로 넘어간다.
 *
 * 하나 더: `capped` 줄에는 한국어가 박혀 있었다. `/lang en` 으로 켠 사람이
 * 이 자리에서만 한글을 본다.
 */
{
  // 말없이 끊기는 것은 흘려보내는 연결에서만 난다. 그래서 이 절만 살림을 따로 쓴다.
  const 흐름집 = mkdtempSync(join(tmpdir(), 'deel-acp-stream-'));
  writeFileSync(join(흐름집, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁 연결', kind: 'openai',
      baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델',
      ctx: 32768, streaming: true, tools: true, json: true, think: false,
    }],
  }, null, 2), 'utf8');

  const e = 에디터([], { DEEL_HOME: 흐름집 });
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_말없이끊김' }],
    }), 30000, 'session/prompt');

    const 글 = e.알림들
      .filter((u) => u.update?.sessionUpdate === 'agent_message_chunk')
      .map((u) => u.update.content.text).join('');
    check('★ 말없이 끊겼다고 에디터에 적는다', /끝났다는 말 없이/.test(글),
      글.replace(/\n+/g, ' ').slice(0, 120));
    check('받은 데까지는 그대로 보인다', /끊/.test(글), 글.slice(0, 60));
  } catch (err) {
    check('말없이 끊김(ACP) — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
    rmSync(흐름집, { recursive: true, force: true });
  }
}

/*
 * 자리가 다 차서 비운 것은 **오류가 아니다.** 에디터에 오류로 보내면
 * 편집기가 턴이 끝난 줄 알고 되물음을 닫는다 — 정작 일은 이어 가는 중이다.
 */
{
  자리없다한횟수 = 0;
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    const 답 = await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_자리없음 을 해줘' }],
    }), 30000, 'session/prompt');

    const 글 = e.알림들
      .filter((u) => u.update?.sessionUpdate === 'agent_message_chunk')
      .map((u) => u.update.content.text).join('');
    check('★ 자리가 다 차도 에디터에는 끝냈다고 답한다', 답?.stopReason === 'end_turn', JSON.stringify(답));
    check('★ 비우고 이어간다고 에디터에 적는다', /비우고 이어갑니다/.test(글),
      글.replace(/\n+/g, ' ').slice(0, 140));
  } catch (err) {
    check('자리 없음(ACP) — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}
{
  한계알린적 = false;
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_한계알림' }],
    }), 30000, 'session/prompt');

    const 글 = e.알림들
      .filter((u) => u.update?.sessionUpdate === 'agent_message_chunk')
      .map((u) => u.update.content.text).join('');
    check('★ 서버 한계를 배웠다고 에디터에 적는다', /컨텍스트 한계 8,192/.test(글),
      글.replace(/\n+/g, ' ').slice(0, 120));
  } catch (err) {
    check('한계 배움(ACP) — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

{
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_길이잘림' }],
    }), 30000, 'session/prompt');

    const 글 = e.알림들
      .filter((u) => u.update?.sessionUpdate === 'agent_message_chunk')
      .map((u) => u.update.content.text).join('');
    check('잘렸다고 에디터에 적는다', /토큰에서 잘렸습니다/.test(글), 글.replace(/\n+/g, ' ').slice(0, 120));
    /*
     * ★ 이 줄은 여태 한국어가 박혀 있었다. 말 표를 거치는지는 `/lang en`
     * 으로 켜 보면 바로 갈린다 — 거치면 영어가 나오고, 안 거치면 한글 그대로다.
     */
    check('★ 잘림 안내가 말 표를 거친다 (한국어 박아 두지 않는다)',
      /토큰에서 잘렸습니다/.test(글) && !/터미널에서/.test(글),
      글.replace(/\n+/g, ' ').slice(0, 120));
  } catch (err) {
    check('잘림(ACP) — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

{
  // 화면 말을 영어로 켠 사람도 이 자리에서 한글을 보면 안 된다.
  const e = 에디터([], { DEEL_LANG: 'en' });
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    await 시간제한(e.요청('session/prompt', {
      sessionId: 방.sessionId,
      prompt: [{ type: 'text', text: '일부러_길이잘림' }],
    }), 30000, 'session/prompt');

    const 글 = e.알림들
      .filter((u) => u.update?.sessionUpdate === 'agent_message_chunk')
      .map((u) => u.update.content.text).join('');
    /*
     * 잘림 안내 한 줄만 잰다. 같은 화면의 `retry` 줄은 아직 한국어인데,
     * 그건 루프가 만들어 넘기는 글이라 여기서 고칠 자리가 아니다 —
     * 안 고친 것을 이 검사로 덮으면 안 되므로 범위를 좁혀 둔다.
     */
    const 잘림줄 = (글.match(/_\([^)]*(?:cut off at|토큰에서 잘렸습니다)[^)]*\)_/g) ?? []).join(' ');
    check('★ 영어로 켜면 잘림 안내도 영어다', /cut off at/.test(잘림줄) && !/[가-힣]/.test(잘림줄),
      잘림줄.slice(0, 140) || 글.replace(/\n+/g, ' ').slice(0, 140));
  } catch (err) {
    check('잘림 영어(ACP) — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
  }
}

trace('5-11-인증방법을-말하는가');

// ── 5-11. 우리가 어떻게 인증받는지 말하는가 ─────────────────────────────
//
// ACP 의 `initialize` 응답에는 `authMethods` 자리가 있다. 여기 아무것도 안
// 적으면 에디터는 「이 에이전트는 인증이 필요 없다」 로 읽는다. 그런데 deel 은
// 연결 정보가 없으면 아무 일도 못 한다 — `deel setup` 을 먼저 쳐야 한다.
//
// 그러면 에디터에서 처음 붙인 사람은 이렇게 된다:
//
//   Zed 에서 deel 추가  →  대화 열기  →  "저장된 연결이 없습니다" 오류
//   →  이게 인증 문제인지 버그인지 화면만 봐서는 모른다
//
// 규격에는 그 자리가 있다. Terminal Auth — 「터미널에서 이 인자로 나를 다시
// 띄우면 설정이 끝난다」 고 말하는 방법이다. deel 은 그 명령이 이미 있다:
// `deel setup`. 없는 것을 만드는 게 아니라 **있는 것을 말하는** 일이다.
//
// 그리고 이 말은 ACP 레지스트리(agentclientprotocol/registry)에 실리는
// 조건이기도 하다 — CI 가 initialize 를 불러 authMethods 에 type 이
// 'agent' 나 'terminal' 인 것이 하나라도 있는지 본다. 빈 배열이면 떨어진다.
{
  const e = 에디터();
  try {
    const r = await 시간제한(e.요청('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'ACP Registry Validator', version: '1.0.0' },
      clientCapabilities: { terminal: true, fs: { readTextFile: true, writeTextFile: true } },
    }), 15000, 'initialize');

    const 방법들 = r?.authMethods;
    check('★★ 인증 방법을 비워 두지 않는다', Array.isArray(방법들) && 방법들.length > 0,
      JSON.stringify(방법들));

    // 레지스트리가 보는 조건 그대로 — type 이 agent 나 terminal 인 것이 하나라도.
    const 쓸만한 = (방법들 ?? []).filter((m) => m?.type === 'agent' || m?.type === 'terminal');
    check('★★ type 이 agent 나 terminal 인 방법이 있다', 쓸만한.length > 0,
      JSON.stringify((방법들 ?? []).map((m) => m?.type)));

    const 터미널 = (방법들 ?? []).find((m) => m?.type === 'terminal');
    check('★ 터미널 인증에 id·name·description 이 다 있다',
      !!터미널?.id && !!터미널?.name && !!터미널?.description, JSON.stringify(터미널));

    // args 는 **실제로 도는 명령**이어야 한다. 여기가 틀리면 에디터가 사람에게
    // 없는 명령을 치라고 시킨다.
    check('★★ 터미널 인증이 가리키는 것이 진짜 deel 명령이다',
      Array.isArray(터미널?.args) && 터미널.args[0] === 'setup', JSON.stringify(터미널?.args));

    // 이 이름은 **사람이 에디터에서 눈으로 보는 글**이고, 우리 안내문도 그걸
    // 그대로 옮겨 적어 두었다. 여기를 고치면서 안내문을 안 고치면, 화면에 뜬
    // 단추와 문서에 적힌 단추의 이름이 달라진다 — 처음 붙인 사람은 자기가 뭘
    // 잘못했는지부터 찾는다. 그러니 두 글이 같은지 여기서 잰다.
    for (const 문서 of ['README.md', 'README.ko.md']) {
      const 적힌것 = readFileSync(join(here, '..', 문서), 'utf8');
      check(`★ ${문서} 에 적어 둔 인증 방법 이름이 진짜 보내는 이름과 같다`,
        적힌것.includes(터미널?.name ?? '\u0000'), 터미널?.name ?? '(없음)');
    }

    // 규격에 있는 방법이니 불렀을 때 터지면 안 된다.
    const 답 = await 시간제한(e.요청('authenticate', { methodId: 터미널?.id }), 10000, 'authenticate');
    check('★ 그 방법으로 authenticate 를 불러도 안 터진다', !!답 && typeof 답 === 'object',
      JSON.stringify(답));

    /*
     * ── ★ (8회차 ACP-5) 빈 methodId 가 그냥 통과했다 ──────────────────────
     *
     * 모르는 방법은 -32602 로 막는데, 그 검사가 `골라온것 &&` 로 시작해서 **빈 글은
     * 아예 안 봤다.** 그래서 `{"methodId":""}` 와 methodId 를 안 준 요청이 성공으로
     * 돌아갔다 — 위 H5-10(빈 method) 과 같은 꼴이다. methodId 는 규격이 반드시
     * 주라고 한 칸이고, 빈 글은 우리가 내놓은 방법 중 어느 것도 아니다. 성공이라
     * 답하면 에디터는 있지도 않은 방법으로 인증이 끝난 줄 알고 그 뒤를 잇는다.
     */
    let 빈방법 = null;
    try {
      await 시간제한(e.요청('authenticate', { methodId: '' }), 10000, 'authenticate 빈칸');
    } catch (err) { 빈방법 = err; }
    check('★ (8회차 ACP-5) 빈 methodId 는 -32602 로 거절한다', 빈방법?.code === -32602,
      `${빈방법?.code} · ${빈방법?.message ?? '(통과했다)'}`);
    check('★ (8회차 ACP-5) 무엇을 보내야 하는지 같이 적는다', /terminal-setup/.test(String(빈방법?.message ?? '')),
      String(빈방법?.message ?? '').slice(0, 140));

    let 안준것 = null;
    try {
      await 시간제한(e.요청('authenticate', {}), 10000, 'authenticate 없음');
    } catch (err) { 안준것 = err; }
    check('★ (8회차 ACP-5) methodId 를 아예 안 줘도 거절한다', 안준것?.code === -32602,
      `${안준것?.code} · ${안준것?.message ?? '(통과했다)'}`);
  } catch (err) {
    check('인증 방법 — 통째로 실패', false, String(err?.message ?? err) + ' | ' + e.표준오류().slice(-400));
  } finally {
    await e.끝내기();
  }
}

trace('5-12-연결이-없으면-인증하라고-하는가');

// ── 5-12. 설정이 없으면 「인증하라」 고 답하는가 ─────────────────────────
//
// 위에서 방법을 적어 놓기만 하고, 정작 설정이 없을 때 엉뚱한 오류를 내면
// 에디터는 그 방법을 띄울 줄 모른다. 규격이 그 자리에 쓰라고 정해 둔 번호가
// 있다 — AUTH_REQUIRED(-32000). 이 번호를 봐야 에디터가 「인증」 단추를
// 그린다. 잘못된인자(-32602)로 답하면 그냥 빨간 글씨가 뜬다.
{
  // 설정 파일이 없는 빈 집으로 띄운다 — 처음 깐 사람과 같은 상태다.
  const 빈집 = mkdtempSync(join(tmpdir(), 'deel-acp-noconf-'));
  const e = 에디터([], { DEEL_HOME: 빈집 });
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    let 잡은것 = null;
    try {
      await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    } catch (err) { 잡은것 = err; }

    check('연결이 없으면 세션을 안 연다', !!잡은것, '(열렸다)');
    check('★★ 인증이 필요하다는 번호로 답한다 (-32000)', 잡은것?.code === -32000,
      `code=${잡은것?.code} · ${잡은것?.message ?? ''}`);
    check('★ 무엇을 하면 되는지 같이 적는다', /deel setup/.test(String(잡은것?.message ?? '')),
      String(잡은것?.message ?? '').slice(0, 120));
  } catch (err) {
    check('인증 필요 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
    rmSync(빈집, { recursive: true, force: true });
  }
}

{
  // 연결이 없어 인증필요로 끝나도 모아 둔 소식은 로그에 남긴다. 안 믿는 폴더의 설정을
  // 안 읽은 것이 바로 연결이 없는 까닭일 수 있다 — 소식을 비우는 자리가 그보다 아래였다.
  const 빈집 = mkdtempSync(join(tmpdir(), 'deel-acp-noconf2-'));
  const 방 = mkdtempSync(join(tmpdir(), 'deel-acp-noconf2-work-'));
  mkdirSync(join(방, '.deel'), { recursive: true });
  writeFileSync(join(방, '.deel', 'config.json'),
    JSON.stringify({ profiles: [{ id: 'r', baseUrl: 'http://127.0.0.1:1', model: 'm' }] }), 'utf8');
  const e = 에디터([], { DEEL_HOME: 빈집 });
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    try {
      await 시간제한(e.요청('session/new', { cwd: 방, mcpServers: [] }), 20000, 'session/new');
    } catch { /* 인증필요로 오는 것이 맞다 — 위 검사가 잰다 */ }
    // 로그(표준오류)와 답(표준출력)은 다른 관이라 도착 차례가 안 정해져 있다.
    for (let i = 0; i < 30 && !/deel trust/.test(e.표준오류()); i++) await new Promise((r) => setTimeout(r, 100));
    check('★★ 연결이 없어도 모아 둔 소식(안 믿는 폴더 설정)을 로그에 남긴다', /deel trust/.test(e.표준오류()),
      e.표준오류().replace(/\s+/g, ' ').slice(-160));
  } catch (err) {
    check('연결 없음 소식 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
    rmSync(빈집, { recursive: true, force: true });
    rmSync(방, { recursive: true, force: true });
  }
}

trace('5-10-탭마다-MCP-를-다시-띄우나');

/*
 * ── 탭을 열 때마다 남의 프로세스를 한 벌씩 더 띄우고 있었다 ────────────
 *
 * 에디터에서 `session/new` 는 **탭 하나**다. 사람은 한 프로젝트를 열어 놓고
 * 탭을 서너 개 띄운다 — 그게 에디터를 쓰는 이유다.
 *
 * 그런데 방만들기() 가 방마다 다붙이기() 를 새로 불렀다. 같은 폴더, 같은
 * `.deel/mcp.json` 인데도 탭 셋이면 서버 프로세스가 세 벌 뜬다. MCP 서버는
 * 남의 프로그램이라 무엇을 들고 뜨는지 우리는 모른다 — 인덱스를 통째로
 * 메모리에 올리는 것도 있고, 뜰 때마다 원격에 붙는 것도 있다.
 *
 * 값도 두 번 치른다. 붙기 자체가 왕복 두 번(initialize + tools/list)이고,
 * 그 사이 탭은 멈춰 있다. 탭을 여는 데 걸리는 시간이 서버 수만큼 늘어난다.
 *
 * 그래서 **폴더 하나에 한 벌**이다. 여기서는 서버가 뜰 때마다 파일에 한 줄씩
 * 적게 해 놓고, 탭 셋을 열어 그 줄이 하나인지 본다.
 */
{
  const 엠씨피 = mkdtempSync(join(tmpdir(), 'deel-acp-mcp-'));
  mkdirSync(join(엠씨피, '.deel'), { recursive: true });
  const 뜬자국 = join(엠씨피, '뜬자국.txt');
  const 서버파일 = join(엠씨피, 'stub.mjs');
  const 줄바꿈 = String.fromCharCode(10);
  writeFileSync(서버파일, [
    "import { appendFileSync } from 'node:fs';",
    'const NL = String.fromCharCode(10);',
    // 뜨자마자 한 줄. 붙기에 성공하든 말든 **프로세스가 떴다**는 사실을 남긴다.
    `appendFileSync(${JSON.stringify(뜬자국)}, '떴음' + NL);`,
    "let 찌꺼기 = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (d) => {",
    '  찌꺼기 += d;',
    '  let i;',
    '  while ((i = 찌꺼기.indexOf(NL)) >= 0) {',
    '    const 줄 = 찌꺼기.slice(0, i); 찌꺼기 = 찌꺼기.slice(i + 1);',
    '    if (!줄.trim()) continue;',
    '    let j; try { j = JSON.parse(줄); } catch { continue; }',
    "    if (j.method === 'initialize') 답(j.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: '탭스텁', version: '1.0.0' } });",
    "    else if (j.method === 'tools/list') 답(j.id, { tools: [{ name: '재보기', description: '스텁', inputSchema: { type: 'object', properties: {} } }] });",
    "    else if (j.id != null) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { code: -32601, message: '모름' } }) + NL);",
    '  }',
    '});',
    "function 답(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + NL); }",
  ].join(줄바꿈), 'utf8');
  writeFileSync(join(엠씨피, '.deel', 'mcp.json'), JSON.stringify({
    mcpServers: { 탭스텁: { command: process.execPath, args: [서버파일] } },
  }, null, 2), 'utf8');

  /*
   * 임시 폴더는 당연히 「안 믿는 폴더」 다. 그런데 MCP 는 이제 믿는 폴더에서만
   * 띄운다 — 남의 저장소에 딸려 온 mcp.json 으로 남의 프로그램이 돌면 안 된다
   * (backend/mcp.js). 여기서 재려는 것은 「탭을 여럿 열어도 한 벌만 뜨나」 이므로
   * 그 문은 여기서 명시적으로 열어 둔다.
   */
  const e = 에디터([], { DEEL_TRUST_ALL: '1' });
  try {
    await 시간제한(e.요청('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } }), 15000, 'initialize');
    const 방들 = [];
    for (let n = 0; n < 3; n++) {
      방들.push(await 시간제한(e.요청('session/new', { cwd: 엠씨피, mcpServers: [] }), 20000, `session/new ${n}`));
    }
    const 뜬수 = readFileSync(뜬자국, 'utf8').split('\n').filter(Boolean).length;
    check('탭 셋이 다 열렸다', 방들.every((x) => x?.sessionId) && new Set(방들.map((x) => x.sessionId)).size === 3,
      방들.map((x) => x?.sessionId).join(' · '));
    check('★★ 같은 폴더면 탭을 몇 개 열어도 MCP 는 한 벌만 뜬다', 뜬수 === 1, `탭 3개 · 뜬 프로세스 ${뜬수}벌`);

    // 폴더가 다르면 당연히 따로 떠야 한다 — 안 그러면 옆 프로젝트의 도구가 딸려 온다.
    await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new (다른 폴더)');
    check('다른 폴더는 그 폴더 것을 따로 본다', readFileSync(뜬자국, 'utf8').split('\n').filter(Boolean).length === 1,
      '(work 에는 mcp.json 이 없다)');
  } catch (err) {
    check('탭마다 MCP — 통째로 실패', false, String(err?.message ?? err) + ' | ' + e.표준오류().slice(-600));
  } finally {
    await e.끝내기();
    rmSync(엠씨피, { recursive: true, force: true });
  }
}

const 대화줄들 = (뿌리, 이름) => {
  try {
    return readFileSync(join(뿌리, '.deel', 'sessions', `${이름}.jsonl`), 'utf8')
      .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const 첫인사 = { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'x', version: '1' } };

trace('사냥5-H5-1-두폴더-같은초');
/*
 * ── ★★ (사냥5 H5-1) 폴더가 다른 두 탭이 같은 대화 이름을 받았다 ──────────
 *
 * 대화 이름은 초 단위이고, 빈 이름인지는 **그 폴더의 대화 파일**로만 봤다. 한
 * 프로세스에서 두 프로젝트를 같은 초에 열면 두 방이 같은 sessionId 를 받고, 방들
 * 에는 뒤엣것만 남는다. A 탭에 한 말이 B 폴더의 대화 파일에 적히고, 모델은 B 를
 * 작업 폴더로 안다 — 파일을 고치면 **남의 프로젝트**를 고친다.
 */
{
  const 둘째 = mkdtempSync(join(tmpdir(), 'deel-acp-둘째-'));
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', 첫인사), 15000, 'initialize');
    const 이름쌍 = [];
    for (let n = 0; n < 3; n++) {
      // 초가 막 바뀐 자리에서 둘을 한꺼번에 연다 — 같은 초에 떨어지게.
      await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 20));
      const [가, 나] = await 시간제한(Promise.all([
        e.요청('session/new', { cwd: work, mcpServers: [] }),
        e.요청('session/new', { cwd: 둘째, mcpServers: [] }),
      ]), 30000, 'session/new 둘');
      이름쌍.push([가?.sessionId, 나?.sessionId]);
    }
    check('★★ (사냥5 H5-1) 같은 초에 두 폴더를 열어도 대화 이름이 안 겹친다',
      이름쌍.every(([a, b]) => a && b && a !== b), JSON.stringify(이름쌍));

    const [가이름] = 이름쌍.at(-1);
    await 시간제한(e.요청('session/prompt', { sessionId: 가이름, prompt: [{ type: 'text', text: '가-폴더에-한-말' }] }), 30000, 'prompt 가');
    check('★★ (사냥5 H5-1) A 탭에 한 말은 A 폴더의 대화 파일에 적힌다',
      대화줄들(work, 가이름).some((j) => j.m?.content === '가-폴더에-한-말'), 가이름);
    const 둘째곳 = join(둘째, '.deel', 'sessions');
    const 샌것 = existsSync(둘째곳)
      ? readdirSync(둘째곳).filter((f) => readFileSync(join(둘째곳, f), 'utf8').includes('가-폴더에-한-말')) : [];
    check('★★ (사냥5 H5-1) B 폴더의 대화 파일에는 A 탭의 말이 안 적힌다', 샌것.length === 0, 샌것.join(' '));

    // B 폴더에도 같은 이름의 대화 파일이 있다. 그걸 B 로 되살리라는데 A 방을 돌려주면 안 된다.
    mkdirSync(둘째곳, { recursive: true });
    writeFileSync(join(둘째곳, `${가이름}.jsonl`),
      JSON.stringify({ t: 'meta', model: '스텁모델' }) + '\n'
      + JSON.stringify({ t: 'msg', m: { role: 'user', content: '둘째-폴더의-옛-말' } }) + '\n', 'utf8');
    let 엇갈림 = null;
    try {
      await 시간제한(e.요청('session/load', { sessionId: 가이름, cwd: 둘째, mcpServers: [] }), 20000, 'session/load 엇갈림');
    } catch (err) { 엇갈림 = err; }
    check('★★ (사냥5 H5-1) 다른 폴더로 이미 열린 대화 이름을 이 폴더로 되살리라면 -32602 로 거절한다',
      엇갈림?.code === -32602, `${엇갈림?.code} · ${엇갈림?.message}`);
  } catch (err) {
    check('사냥5 H5-1 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
    rmSync(둘째, { recursive: true, force: true });
  }
}

trace('사냥5-H5-2-이어받은-대화를-정리가-지우나');
/*
 * ── ★★ (사냥5 H5-2) 되살리자마자 그 대화 파일을 정리가 지웠다 ─────────────
 *
 * prune() 은 파일 시각만 본다. 한 달 넘은 대화를 session/load 로 되살리면 그 파일은
 * 아직 한 줄도 안 늘어 시각이 옛날 그대로라, 되살리기 바로 뒤의 정리가 그 파일을
 * 지웠다. 에디터에는 지난 대화가 그려지고, 다음 한 줄은 머리글도 옛 대화도 없는 새
 * 파일에 적힌다. 같은 폴더에 탭을 하나 더 열어도 그 정리가 또 돈다.
 */
{
  const 옛집 = mkdtempSync(join(tmpdir(), 'deel-acp-정리-'));
  const 곳 = join(옛집, '.deel', 'sessions');
  mkdirSync(곳, { recursive: true });
  const 줄 = (o) => JSON.stringify(o) + '\n';
  for (let i = 0; i < 31; i++) {
    writeFileSync(join(곳, `20260901-0000${String(i).padStart(2, '0')}.jsonl`),
      줄({ t: 'meta', model: '스텁모델' }) + 줄({ t: 'msg', m: { role: 'user', content: `최근 ${i}` } }), 'utf8');
  }
  const 옛이름 = '20260101-090000';
  const 옛파일 = join(곳, `${옛이름}.jsonl`);
  writeFileSync(옛파일, 줄({ t: 'meta', model: '스텁모델', root: 옛집 })
    + 줄({ t: 'msg', m: { role: 'user', content: '옛-대화의-물음' } })
    + 줄({ t: 'msg', m: { role: 'assistant', content: '옛-대화의-답' } }), 'utf8');
  const 예전 = new Date(Date.now() - 40 * 86400000);
  utimesSync(옛파일, 예전, 예전);
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', 첫인사), 15000, 'initialize');
    await 시간제한(e.요청('session/load', { sessionId: 옛이름, cwd: 옛집, mcpServers: [] }), 20000, 'session/load 옛');
    check('★★ (사냥5 H5-2) 되살린 오래된 대화 파일을 정리가 바로 지우지 않는다', existsSync(옛파일), 옛파일);
    // 같은 폴더에 탭을 하나 더 연다 — 그 탭의 정리도 열려 있는 대화를 지우면 안 된다.
    await 시간제한(e.요청('session/new', { cwd: 옛집, mcpServers: [] }), 20000, 'session/new 옛집');
    check('★★ (사냥5 H5-2) 같은 폴더에 탭을 더 열어도 열려 있는 대화를 안 지운다', existsSync(옛파일), 옛파일);
    await 시간제한(e.요청('session/prompt', { sessionId: 옛이름, prompt: [{ type: 'text', text: '되살린-뒤-한마디' }] }), 30000, 'prompt 옛');
    const 적힌 = 대화줄들(옛집, 옛이름);
    check('★★ (사냥5 H5-2) 되살린 뒤 한 말이 머리글·옛 대화와 같은 파일에 이어 적힌다',
      적힌.some((j) => j.t === 'meta') && 적힌.some((j) => j.m?.content === '옛-대화의-물음')
        && 적힌.some((j) => j.m?.content === '되살린-뒤-한마디'),
      적힌.map((j) => j.t + (j.m ? `:${String(j.m.content ?? '').slice(0, 10)}` : '')).join(','));
  } catch (err) {
    check('사냥5 H5-2 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e.끝내기();
    rmSync(옛집, { recursive: true, force: true });
  }
}

trace('사냥5-H5-3-승인-기다리다-취소');
/*
 * ── ★★ (사냥5 H5-3) 취소한 턴이 늦게 온 허락으로 파일을 썼다 ───────────────
 *
 * 승인 창을 띄워 두고 사람이 안 누른 채 취소했다. 승인 기다림이 턴의 끊기 신호를
 * 안 봐서 그 턴은 취소된 뒤에도 답을 계속 기다렸고, 에디터가 새 한마디를 보내면
 * 두 턴이 한 대화를 같이 밟았다. 그러다 옛 창의 「이번만 실행」 이 늦게 닿자
 * **취소한 턴이 파일을 썼다.** 대화 파일에는 새 턴의 말이 두 번 적히고 도구 결과는
 * 제 부름에서 떨어진 자리에 적혔다 — 되살리면 규격 서버가 400 을 주는 모양이다.
 */
{
  읽기한번 = false;
  쓸파일이름 = `늦게쓴것-${process.pid}.txt`;
  const e = 에디터(['--mode', 'strict']);
  const 물음들 = [];
  e.응답표.set('session/request_permission', (인자, id) => { 물음들.push({ id, 인자 }); return undefined; });
  try {
    await 시간제한(e.요청('initialize', 첫인사), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    let 첫끝 = null;
    const 첫턴 = e.요청('session/prompt', { sessionId: 방.sessionId, prompt: [{ type: 'text', text: '일부러_써 줘' }] })
      .then((r) => { 첫끝 = r; }, (err) => { 첫끝 = { 오류: String(err?.message ?? err) }; });
    const 물었나 = await 될때까지(() => 물음들.length > 0, 15000);
    check('(사냥5 H5-3) 쓰기 전에 에디터에 승인을 묻는다', 물었나, `${물음들.length}번`);
    e.알림('session/cancel', { sessionId: 방.sessionId });
    const 끝났나 = await 될때까지(() => 첫끝 !== null, 5000);
    check('★★ (사냥5 H5-3) 승인을 기다리는 중에 취소하면 그 턴이 곧 cancelled 로 끝난다',
      끝났나 && 첫끝?.stopReason === 'cancelled', JSON.stringify(첫끝));

    await 시간제한(e.요청('session/prompt', { sessionId: 방.sessionId, prompt: [{ type: 'text', text: '둘째-턴-한마디' }] }), 30000, '둘째 턴');
    // 옛 창의 허락이 이제야 닿는다.
    if (물음들[0]) e.날쓰기({ jsonrpc: '2.0', id: 물음들[0].id, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } });
    await 시간제한(첫턴, 15000, '첫 턴');
    // **안 일어나는 것**을 재므로 될때까지로는 못 잰다 — 늦게 돈다면 돌 만큼만 기다린다.
    await new Promise((r) => setTimeout(r, 1000));
    check('★★ (사냥5 H5-3) 취소한 턴은 늦게 온 허락으로 파일을 쓰지 않는다', !existsSync(join(work, 쓸파일이름)), 쓸파일이름);

    const 말들 = 대화줄들(work, 방.sessionId).filter((j) => j.t === 'msg').map((j) => j.m);
    const 둘째수 = 말들.filter((m) => m.role === 'user' && m.content === '둘째-턴-한마디').length;
    const 모양 = 말들.map((m) => `${m.role}${m.tool_calls ? '(부름)' : ''}`).join(',');
    check('★ (사냥5 H5-3) 대화 파일에 둘째 턴의 말이 한 번만 적힌다', 둘째수 === 1, `${둘째수}번 · ${모양}`);
    check('★ (사냥5 H5-3) 도구 결과가 제 부름 바로 뒤에 적힌다',
      말들.every((m, i) => m.role !== 'tool' || (말들[i - 1]?.role === 'assistant' && 말들[i - 1]?.tool_calls?.length) || 말들[i - 1]?.role === 'tool'),
      모양);
  } catch (err) {
    check('사냥5 H5-3 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    rmSync(join(work, 쓸파일이름), { force: true });
    await e.끝내기();
  }
}

trace('사냥5-H5-3b-취소없이-새-한마디');
/*
 * ── ★★ (사냥5 H5-3) 취소 없이 새 한마디가 끼어들면 두 턴이 한 대화를 같이 밟았다 ──
 *
 * 규격은 턴을 겹쳐 보내지 말라지만 안 지키는 클라이언트가 있다. 새 한마디는 앞 턴을
 * 끊기만 하고 **물러나기를 안 기다렸다.** 앞 턴은 승인 기다림을 거둔 뒤에도 「거부됨」
 * 도구 결과를 적는 걸음이 남아 있는데, 그 사이 새 턴이 제 말을 먼저 밀어 넣었다.
 * 그러면 도구 결과가 제 부름에서 떨어져 새 사람 말 뒤에 적히고(되살리면 400),
 * 앞 턴의 마지막 적기가 새 턴의 말까지 한 번 더 적었다.
 */
{
  읽기한번 = false;
  쓸파일이름 = `끼어듦-${process.pid}.txt`;
  const e = 에디터(['--mode', 'strict']);
  const 물음들 = [];
  e.응답표.set('session/request_permission', (인자, id) => { 물음들.push({ id, 인자 }); return undefined; });
  try {
    await 시간제한(e.요청('initialize', 첫인사), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    let 첫끝 = null;
    const 첫턴 = e.요청('session/prompt', { sessionId: 방.sessionId, prompt: [{ type: 'text', text: '일부러_써 줘' }] })
      .then((r) => { 첫끝 = r; }, (err) => { 첫끝 = { 오류: String(err?.message ?? err) }; });
    const 물었나 = await 될때까지(() => 물음들.length > 0, 15000);
    check('(사냥5 H5-3b) 쓰기 전에 에디터에 승인을 묻는다', 물었나, `${물음들.length}번`);
    // 취소 없이 곧장 새 한마디.
    const 둘째 = await 시간제한(e.요청('session/prompt', { sessionId: 방.sessionId, prompt: [{ type: 'text', text: '끼어든-둘째-한마디' }] }), 30000, '끼어든 둘째 턴');
    await 시간제한(첫턴, 15000, '첫 턴');
    check('(사냥5 H5-3b) 끼어든 새 한마디는 끝까지 돈다', 둘째?.stopReason === 'end_turn', JSON.stringify(둘째));
    check('★ (사냥5 H5-3b) 끊긴 앞 턴은 cancelled 로 끝난다', 첫끝?.stopReason === 'cancelled', JSON.stringify(첫끝));
    check('★★ (사냥5 H5-3b) 끊긴 앞 턴은 파일을 안 쓴다', !existsSync(join(work, 쓸파일이름)), 쓸파일이름);

    const 말들 = 대화줄들(work, 방.sessionId).filter((j) => j.t === 'msg').map((j) => j.m);
    const 모양 = 말들.map((m) => `${m.role}${m.tool_calls ? '(부름)' : ''}${m.role === 'user' ? `:${String(m.content ?? '').slice(0, 6)}` : ''}`).join(',');
    const 끼어든수 = 말들.filter((m) => m.role === 'user' && m.content === '끼어든-둘째-한마디').length;
    check('★★ (사냥5 H5-3b) 끼어든 한마디가 대화 파일에 한 번만 적힌다', 끼어든수 === 1, `${끼어든수}번 · ${모양}`);
    const 부른자리 = 말들.findIndex((m) => m.role === 'assistant' && m.tool_calls?.length);
    check('★★ (사냥5 H5-3b) 앞 턴의 도구 결과가 새 한마디보다 먼저, 제 부름 바로 뒤에 적힌다',
      부른자리 >= 0 && 말들[부른자리 + 1]?.role === 'tool'
        && 말들.findIndex((m) => m.role === 'user' && m.content === '끼어든-둘째-한마디') > 부른자리 + 1,
      모양);
  } catch (err) {
    check('사냥5 H5-3b — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    rmSync(join(work, 쓸파일이름), { force: true });
    await e.끝내기();
  }
}

trace('사냥5-H5-6-두창이-같은대화');
/*
 * ── ★★ (사냥5 H5-6) 다른 창 때문에 못 적은 것을 아무에게도 안 말했다 ────────
 *
 * 에디터 창 둘이 같은 대화를 되살리면, 뒤에 적는 쪽은 섞지 않으려고 안 적고 센다
 * (agent/store.js 의 OTHER_WINDOW). 대화 화면은 그 셈을 한 번 말해 주는데 여기는
 * store.못쓴것 을 한 번도 안 봤다. 둘째 창에서 한 말은 조용히 버려지고, 사람은
 * 다음에 되살릴 때에야 그 말이 없다는 것을 안다.
 */
{
  const 두창 = mkdtempSync(join(tmpdir(), 'deel-acp-두창-'));
  const 곳 = join(두창, '.deel', 'sessions');
  mkdirSync(곳, { recursive: true });
  const 이름 = '20260910-101010';
  writeFileSync(join(곳, `${이름}.jsonl`),
    JSON.stringify({ t: 'meta', model: '스텁모델' }) + '\n'
    + JSON.stringify({ t: 'msg', m: { role: 'user', content: '둘이-같이-연-대화' } }) + '\n', 'utf8');
  const e1 = 에디터();
  const e2 = 에디터();
  try {
    for (const e of [e1, e2]) await 시간제한(e.요청('initialize', 첫인사), 15000, 'initialize');
    for (const e of [e1, e2]) await 시간제한(e.요청('session/load', { sessionId: 이름, cwd: 두창, mcpServers: [] }), 20000, 'session/load');
    await 시간제한(e1.요청('session/prompt', { sessionId: 이름, prompt: [{ type: 'text', text: '첫-창-한마디' }] }), 30000, '첫 창');
    await 시간제한(e2.요청('session/prompt', { sessionId: 이름, prompt: [{ type: 'text', text: '둘째-창-한마디' }] }), 30000, '둘째 창');
    await 될때까지(() => /OTHER_WINDOW/.test(e2.표준오류()), 5000);
    check('★★ (사냥5 H5-6) 다른 창이 적고 있어 못 적었으면 로그에 남긴다', /OTHER_WINDOW/.test(e2.표준오류()),
      e2.표준오류().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 200));
    const 둘째창글 = e2.알림들.map((u) => u.update?.content?.text ?? '').join('');
    check('★★ (사냥5 H5-6) 에디터 화면에도 안 적히고 있다고 말한다', /OTHER_WINDOW/.test(둘째창글), 둘째창글.slice(-160));
  } catch (err) {
    check('사냥5 H5-6 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    await e1.끝내기();
    await e2.끝내기();
    rmSync(두창, { recursive: true, force: true });
  }
}

trace('사냥5-H5-8-모델을-기다리다-관이-닫힘');
/*
 * ── ★★ (사냥5 H5-8) 에디터를 닫았는데 모델 답을 끝까지 기다렸다 ─────────────
 *
 * 관이 닫히면 마무리는 관만 닫고 돌던 턴은 안 끊었다. 그래서 느린 모델을 기다리던
 * 턴이 **답이 올 때까지** 살아 있었고, 프로세스도 그만큼 안 끝났다. 에디터는 이미
 * 닫혔는데 그 뒤에 온 답이 대화 파일에 적혔다 — 아무도 못 본 답이다.
 */
{
  느리게 = 6000;
  const e = 에디터();
  try {
    await 시간제한(e.요청('initialize', 첫인사), 15000, 'initialize');
    const 방 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new');
    const 받은수 = 받은대화.length;
    e.요청('session/prompt', { sessionId: 방.sessionId, prompt: [{ type: 'text', text: '일부러_느리게 닫힐때까지' }] }).catch(() => {});
    const 돌기시작 = await 될때까지(() => 받은대화.length > 받은수, 10000);
    check('(사냥5 H5-8) 관을 닫기 전에 턴이 모델을 기다리고 있다', 돌기시작, `${받은대화.length}`);
    const 닫힘 = new Promise((r) => e.kid.on('close', () => r(true)));
    const 처음 = Date.now();
    e.kid.stdin.end();
    const 닫혔나 = await Promise.race([닫힘, new Promise((r) => { setTimeout(() => r(false), 4500).unref(); })]);
    const 걸림 = Date.now() - 처음;
    check('★★ (사냥5 H5-8) 턴이 모델을 기다리는 중에 관이 닫히면 답을 안 기다리고 곧 끝난다', 닫혔나 === true && 걸림 < 4000, `${걸림}ms`);
    check('★ (사냥5 H5-8) 닫힌 뒤에 온 답을 대화 파일에 안 적는다',
      !대화줄들(work, 방.sessionId).some((j) => j.m?.content === '늦게 왔습니다'), 방.sessionId);
  } catch (err) {
    check('사냥5 H5-8 — 통째로 실패', false, String(err?.message ?? err));
  } finally {
    느리게 = 0;
    try { e.kid.kill(); } catch { /* 이미 끝났다 */ }
  }
}

trace('6회차-N9-두연결-두탭');
/*
 * ── ★★ (6회차 N9) 연결이 다른 두 탭 — 둘째를 열면 첫 탭이 막혔다 ─────────────
 *
 * 문지기(safety/network.js)의 allowEndpoint 는 「이전에 올린 것은 지운다」 — 부르는
 * 쪽이 지금 열려 있어야 할 것 **전부**를 한 번에 말하라는 약속이다. 그런데 방마다
 * 제 주소 하나만 올렸다. 에디터에서 연결이 다른 프로젝트 둘을 열면 둘째 탭을 여는
 * 순간 첫 탭의 주소가 지워져, 첫 탭의 다음 한마디가 「허용되지 않은 주소입니다」 로
 * 막혔다.
 */
{
  let 둘째받은수 = 0;
  const 둘째서버 = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const 보냄 = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (url === '/v1/models') return 보냄({ data: [{ id: '둘째모델', object: 'model' }] });
      if (url === '/v1/chat/completions') {
        둘째받은수 += 1;
        return 보냄({ id: 'y', object: 'chat.completion', model: '둘째모델', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '(둘째 연결이 답했습니다)' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
      }
      return 보냄({}, 404);
    });
  });
  await new Promise((r) => 둘째서버.listen(0, '127.0.0.1', r));
  const 둘째base = `http://127.0.0.1:${둘째서버.address().port}/v1`;
  const 두집 = mkdtempSync(join(tmpdir(), 'deel-acp-두연결-'));
  const 나폴더 = mkdtempSync(join(tmpdir(), 'deel-acp-나-'));
  const 틀 = { kind: 'openai', auth: 'none', apiKey: '', ctx: 32768, streaming: false, tools: true, json: true, think: false };
  writeFileSync(join(두집, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [
      { id: 'stub', name: '스텁 연결', baseUrl: base, model: '스텁모델', ...틀 },
      { id: 'stub2', name: '둘째 연결', baseUrl: 둘째base, model: '둘째모델', ...틀 },
    ],
  }, null, 2), 'utf8');
  mkdirSync(join(나폴더, '.deel'), { recursive: true });
  writeFileSync(join(나폴더, '.deel', 'config.json'), JSON.stringify({ active: 'stub2' }), 'utf8');
  const { 믿기 } = await import('../src/safety/trust.js');
  믿기(나폴더, { env: { ...process.env, DEEL_HOME: 두집 } });

  const e = 에디터([], { DEEL_HOME: 두집 });
  const 탭글 = (sid) => e.알림들.filter((p) => p.sessionId === sid).map((p) => p.update?.content?.text ?? '').join('');
  try {
    await 시간제한(e.요청('initialize', 첫인사), 15000, 'initialize');
    const 가 = await 시간제한(e.요청('session/new', { cwd: work, mcpServers: [] }), 20000, 'session/new 가');
    await 시간제한(e.요청('session/prompt', { sessionId: 가.sessionId, prompt: [{ type: 'text', text: '두연결-가-첫말' }] }), 30000, 'prompt 가 첫말');
    const 나 = await 시간제한(e.요청('session/new', { cwd: 나폴더, mcpServers: [] }), 20000, 'session/new 나');
    await 시간제한(e.요청('session/prompt', { sessionId: 나.sessionId, prompt: [{ type: 'text', text: '두연결-나-첫말' }] }), 30000, 'prompt 나 첫말');
    check('(6회차 N9 먼저) 둘째 탭은 둘째 연결로 간다', 둘째받은수 >= 1, `둘째 받은 수 ${둘째받은수} · ${탭글(나.sessionId).slice(-160)}`);

    const 앞수 = 받은대화.length;
    await 시간제한(e.요청('session/prompt', { sessionId: 가.sessionId, prompt: [{ type: 'text', text: '두연결-가-둘째말' }] }), 30000, 'prompt 가 둘째말');
    const 가글 = 탭글(가.sessionId);
    check('★★ (6회차 N9) 둘째 탭을 연 뒤에도 첫 탭의 말이 첫 연결에 닿는다',
      받은대화.length > 앞수 && !/허용되지 않은 주소/.test(가글), 가글.slice(-240));
  } catch (err) {
    check('두 연결 두 탭 — 통째로 실패', false, String(err?.message ?? err) + ' | ' + e.표준오류().slice(-600));
  } finally {
    await e.끝내기();
    둘째서버.close();
    rmSync(두집, { recursive: true, force: true });
    rmSync(나폴더, { recursive: true, force: true });
  }
}

srv.close();
rmSync(home, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\nACP 검사  ${D}(에디터 안에서 deel 이 도는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
