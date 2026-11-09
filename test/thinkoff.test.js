/**
 * 로컬 연결은 사람이 안 정했으면 생각을 끄고, 끈다는 말이 전선에 실제로 나가는가.
 *
 * 여태 OpenAI 꼴에서는 `off` 가 칸을 안 싣는 것으로 끝났다. llama-server 는 칸이 없으면 제
 * 기본값으로 생각하므로, 화면이 off 여도 모델은 걸음마다 수천 토큰을 생각했다.
 */
import { Session } from '../src/agent/session.js';
import { 첫걸음강도 } from '../src/agent/loop.js';
import { buildBody } from '../src/backend/adapter.js';
import { 기본카드, 배울전선, 카드칸들 } from '../src/backend/wire.js';

const G = '\x1b[32m'; const R = '\x1b[31m'; const X = '\x1b[0m';
let 통과 = 0; let 실패 = 0;
const check = (이름, 됨, 덧 = '') => {
  if (됨) { 통과 += 1; console.log(`  ${G}✓${X} ${이름}`); return; }
  실패 += 1; console.log(`  ${R}✗${X} ${이름} ${R}${덧}${X}`);
};

const 로컬 = { kind: 'openai', base: 'http://127.0.0.1:8099/v1', model: 'qwen3.8-flash-next', ctx: 65536 };
const 올라마 = { kind: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen', ctx: 32768 };
const 바깥 = { kind: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', ctx: 65536 };
const 세션 = (conn, 덧 = {}) => new Session(conn, { root: process.cwd(), work: 'code', ...덧 });
const 몸 = (think, 카드 = null) => buildBody('openai', { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: true, think, 카드 });

console.log('기본값');
check('로컬은 안 정했으면 off', 세션(로컬).think === 'off');
check('Ollama 로컬도 off', 세션(올라마).think === 'off');
check('바깥은 안 정했으면 medium', 세션(바깥).think === 'medium');

console.log('사람이 정한 것');
check('--think 로 넘긴 값을 따른다', 세션(로컬, { think: 'high' }).think === 'high');
{
  const s = 세션(로컬);
  s.think = 'low'; s.thinkSet = true;
  check('/think 로 켜면 켜진다', s.think === 'low');
}

console.log('연결을 갈아타면');
{
  const s = 세션(로컬);
  s.conn = 바깥;
  check('로컬 → 바깥: medium 으로', s.think === 'medium');
  s.conn = 로컬;
  check('바깥 → 로컬: off 로', s.think === 'off');
}

console.log('첫 걸음에 나가는 값');
check('로컬 OpenAI 꼴은 off', 첫걸음강도(세션(로컬), '이 파일 고쳐줘') === 'off');
check('Ollama 는 false', 첫걸음강도(세션(올라마), '이 파일 고쳐줘') === false);
check('바깥에서 끄면 칸을 안 싣는다', 첫걸음강도(세션(바깥, { think: 'off' }), '이 파일 고쳐줘') === undefined);

console.log('전선');
{
  const b = 몸('off');
  check('enable_thinking:false 를 싣는다', b.chat_template_kwargs?.enable_thinking === false, JSON.stringify(b.chat_template_kwargs));
  check('reasoning_effort 는 안 싣는다', !('reasoning_effort' in b));
  check('강도가 있으면 템플릿 칸은 안 싣는다', !('chat_template_kwargs' in 몸('high')));
  check('undefined 면 아무것도 안 싣는다', !('chat_template_kwargs' in 몸(undefined)) && !('reasoning_effort' in 몸(undefined)));
}

console.log('거절하는 서버');
{
  const 카드 = 기본카드({ 규격: 'openai', 모델: 'x', base: 로컬.base });
  const 고침 = 배울전선('Unrecognized request argument supplied: chat_template_kwargs', 'openai');
  check('거절을 알아듣는다', 고침?.무엇 === '템플릿끄기' && 고침?.값 === false, JSON.stringify(고침));
  check('저장되는 칸이다', 카드칸들.includes('템플릿끄기'));
  check('배운 카드에는 안 싣는다', !('chat_template_kwargs' in 몸('off', { ...카드, 템플릿끄기: false })));
}

console.log(`\n${실패 ? R : G}통과 ${통과} · 실패 ${실패}${X}`);
process.exit(실패 ? 1 : 0);
