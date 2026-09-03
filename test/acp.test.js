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
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 줄나누기, 연결, 오류번호, 모르는방법오류 } from '../src/acp/jsonrpc.js';
import {
  도구갈래, 도구이름표, 도구자리, 도구탈났나, 도구내용,
  도구끝남, 멈춘까닭, 프롬프트글, 되살린것,
} from '../src/acp/map.js';
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
      if (/일부러_길이잘림/.test(사람말)) {
        return 답({ role: 'assistant', content: '여기까지 쓰다가 끊' }, 'length');
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
      if (답하기) 쓰기({ jsonrpc: '2.0', id: 온것.id, result: 답하기(온것.params) });
      else 쓰기({ jsonrpc: '2.0', id: 온것.id, error: { code: -32601, message: '이 클라이언트는 그걸 못 합니다' } });
    }
  }));

  return {
    kid, 알림들, 날줄, 응답표,
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
    check('지금 모드도 알려 준다', typeof 방?.modes?.currentModeId === 'string', JSON.stringify(방?.modes?.currentModeId));

    /*
     * ── 값을 잰다, '뭐라도 왔다' 를 재지 않는다 ──────────────────────────
     *
     * 여기는 `바꿈 !== undefined` 였다. 그건 「답이 왔다」 는 뜻일 뿐이라,
     * 모드를 엉뚱한 것으로 바꿔 놔도 초록이다. 규격이 정한 답은 빈 객체이고,
     * **정말 바뀌었는지**는 그 뒤에 적히는 줄로 가린다.
     */
    const 바꿈 = await 시간제한(e.요청('session/set_mode', { sessionId: 방.sessionId, modeId: 'plan' }), 8000, 'set_mode');
    check('모드 바꾸기에 규격대로 빈 객체를 답한다', JSON.stringify(바꿈) === '{}', JSON.stringify(바꿈));
    // 로그가 표준오류로 나가는 데 잠깐 걸린다.
    await new Promise((r) => setTimeout(r, 300));
    check('★ 고른 모드로 진짜 바뀐다', /작업 모드를 plan 로 바꿨습니다/.test(e.표준오류()),
      (e.표준오류().split('\n').find((l) => /작업 모드를/.test(l)) ?? '그런 줄이 없다').slice(0, 80));

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

    check('승인을 못 물어봐도 턴은 끝난다 — 서 있지 않는다', typeof 끝?.stopReason === 'string', JSON.stringify(끝));
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
    await new Promise((r) => setTimeout(r, 700));
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
    check('되살리고 나서 모드도 알려 준다', typeof 되살림?.modes?.currentModeId === 'string', JSON.stringify(되살림));

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
