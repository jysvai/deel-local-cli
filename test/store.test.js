// 대화가 껐다 켜도 이어지는지 검증한다.
//
// 확인할 것:
//   1) 오간 대로 남고, 그대로 되살아나는가
//   2) 도중에 죽어도(마지막 줄이 잘려도) 앞부분은 성한가 — jsonl 을 쓴 이유
//   3) 도구 호출과 결과의 짝이 되살릴 때도 안 깨지는가
//   4) 압축이 일어난 뒤에도 파일이 대화와 맞는가
//   5) 목록에서 어떤 대화인지 알아볼 수 있는가
import {
  mkdtempSync, mkdirSync, rmSync, appendFileSync, existsSync, readFileSync,
  writeFileSync, statSync, chmodSync, readdirSync, utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, list, latest, remove, newId, freeId, prune, sessionsDir } from '../src/agent/store.js';
import { repairToolPairs, Session, 못박을것 } from '../src/agent/session.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-store-'));

// ── 1. 적고 되살리기 ────────────────────────────────────────────────────
const s1 = new Store(root, 'test-001');
s1.begin({ model: 'qwen2.5-coder:7b', base: 'http://127.0.0.1:11434', root });

const 오간것 = [
  { role: 'user', content: '로그 형식 통일해줘' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"src/a.js"}' } }] },
  { role: 'tool', tool_call_id: 'c1', name: 'Read', content: '파일 내용' },
  { role: 'assistant', content: '고쳤습니다.' },
  { role: 'user', content: '하나 더' },
];
for (const m of 오간것) s1.append(m);

check('파일이 만들어짐', existsSync(join(sessionsDir(root), 'test-001.jsonl')));

const 되살림 = new Store(root, 'test-001').load();
check('메시지 수가 같음', 되살림.messages.length === 오간것.length,
  `${되살림.messages.length} / ${오간것.length}`);
check('내용이 그대로', JSON.stringify(되살림.messages) === JSON.stringify(오간것));
check('머리글에 모델이 남음', 되살림.meta?.model === 'qwen2.5-coder:7b', 되살림.meta?.model);
check('머리글에 폴더가 남음', 되살림.meta?.root === root);

// 도구 호출 짝 — 되살린 배열을 그대로 모델에 보낼 수 있어야 한다
let 짝깨짐 = null;
되살림.messages.forEach((m, i) => {
  if (짝깨짐) return;
  if (m.role === 'tool' && !되살림.messages[i - 1]?.tool_calls?.length) 짝깨짐 = `${i}번 tool 앞에 호출 없음`;
  if (m.tool_calls?.length && 되살림.messages[i + 1]?.role !== 'tool') 짝깨짐 = `${i}번 호출 뒤에 결과 없음`;
});
check('도구 호출·결과 짝이 살아 있음', 짝깨짐 === null, 짝깨짐 ?? '');

// ── 2. 도중에 죽어도 앞부분은 성하다 ────────────────────────────────────
const 잘린파일 = join(sessionsDir(root), 'test-002.jsonl');
const s2 = new Store(root, 'test-002');
s2.begin({ model: 'm', root });
s2.append({ role: 'user', content: '첫 줄' });
s2.append({ role: 'assistant', content: '둘째 줄' });
// 세 번째 줄을 쓰다가 전원이 나간 상황
appendFileSync(잘린파일, '{"t":"msg","m":{"role":"user","cont', 'utf8');

const 살린것 = new Store(root, 'test-002').load();
check('잘린 줄은 건너뛰고 앞은 살림', 살린것.messages.length === 2, `${살린것.messages.length}개`);
check('살린 내용이 맞음', 살린것.messages[0].content === '첫 줄' && 살린것.messages[1].content === '둘째 줄');

// 아예 쓰레기가 섞여도 죽지 않는다
writeFileSync(join(sessionsDir(root), 'test-003.jsonl'),
  '{"t":"meta","model":"x"}\n쓰레기줄\n{"t":"msg","m":{"role":"user","content":"살아있음"}}\n', 'utf8');
const 쓰레기 = new Store(root, 'test-003').load();
check('쓰레기 줄을 건너뜀', 쓰레기.messages.length === 1 && 쓰레기.messages[0].content === '살아있음');

// ── 3. 압축 뒤 파일이 대화와 맞는가 ─────────────────────────────────────
const 접힌뒤 = [
  { role: 'user', content: '로그 형식 통일해줘' },
  { role: 'user', content: '[앞선 대화 4개를 요약해 접었습니다.]\n## 목표\n로그 통일' },
  { role: 'user', content: '하나 더' },
];
s1.replace(접힌뒤, '압축 — 4개를 요약으로');
const 접힌것 = new Store(root, 'test-001').load();
check('접힌 뒤 파일이 대화와 같음', JSON.stringify(접힌것.messages) === JSON.stringify(접힌뒤),
  `${접힌것.messages.length}개`);
check('접혀도 머리글은 유지', 접힌것.meta?.model === 'qwen2.5-coder:7b', 접힌것.meta?.model);

// 접은 뒤에 이어 붙여도 맞는다
s1.append({ role: 'assistant', content: '이어서 함' });
check('접은 뒤 덧붙이기도 맞음', new Store(root, 'test-001').load().messages.length === 4);

// ── 4. 목록 ─────────────────────────────────────────────────────────────
const rows = list(root);
check('세 대화가 다 보임', rows.length === 3, `${rows.length}개`);
const t1 = rows.find((r) => r.id === 'test-001');
check('첫 마디로 알아볼 수 있음', t1?.first === '로그 형식 통일해줘', t1?.first);
check('모델 이름이 목록에 있음', t1?.model === 'qwen2.5-coder:7b', t1?.model);
check('턴 수를 셈', t1?.turns === 3, String(t1?.turns));
check('최근 것이 위로', rows[0].at >= rows[1].at);
check('latest 가 가장 최근을 줌', latest(root)?.id === rows[0].id);

// 빈 대화는 목록에 안 뜬다 (머리글만 있고 메시지가 없는 것)
new Store(root, 'test-empty').begin({ model: 'm', root });
check('빈 대화는 목록에서 뺌', list(root).length === 3, `${list(root).length}개`);

// ── 5. 지우기·정리 ──────────────────────────────────────────────────────
check('없는 것 지우면 오류', !!remove(root, '없는대화').error);
check('지워짐', remove(root, 'test-003').removed === 'test-003');
check('지운 뒤 목록에서 사라짐', !list(root).some((r) => r.id === 'test-003'));

// 정리는 최근 것을 함부로 지우지 않는다
const 지운수 = prune(root, { keep: 1, days: 3650 });
check('오래되지 않은 것은 안 지움', 지운수 === 0 && list(root).length === 2, `${지운수}개 지움`);

// ── 5-1. 같은 초에 두 대화를 열어도 안 섞인다 ───────────────────────────
// id 가 초 단위라, 창을 거의 동시에 두 개 열면 이름이 겹친다.
// 겹친 채로 두면 서로 다른 대화가 한 파일에 들어가 되살릴 때 뒤엉킨다.
const 동시 = mkdtempSync(join(tmpdir(), 'deel-race-'));
const a1 = new Store(동시); a1.begin({ model: 'm', root: 동시 }); a1.append({ role: 'user', content: '첫째 대화' });
const a2 = new Store(동시); a2.begin({ model: 'm', root: 동시 }); a2.append({ role: 'user', content: '둘째 대화' });
const a3 = new Store(동시); a3.begin({ model: 'm', root: 동시 }); a3.append({ role: 'user', content: '셋째 대화' });
check('동시에 연 대화는 id 가 다름', new Set([a1.id, a2.id, a3.id]).size === 3, [a1.id, a2.id, a3.id].join(' '));
check('각각 따로 저장됨', list(동시).length === 3, `${list(동시).length}개`);
const 첫마디 = new Set(list(동시).map((r) => r.first));
check('내용이 안 섞임',
  첫마디.size === 3 && ['첫째 대화', '둘째 대화', '셋째 대화'].every((x) => 첫마디.has(x)),
  [...첫마디].join(' / '));
check('각 대화는 1턴씩', list(동시).every((r) => r.turns === 1));

// --resume 으로 이름을 준 경우에는 그 파일에 이어 쓴다 (옆자리로 옮기지 않는다)
const 이어 = new Store(동시, a1.id);
이어.begin({ model: 'm', root: 동시 });
이어.append({ role: 'user', content: '이어서' });
check('이름을 주면 그 파일에 이어 씀', 이어.id === a1.id, `${이어.id} / ${a1.id}`);
// 이어 쓰면 원래 1턴이던 것이 2턴이 된다. 덮어쓰지 않고 뒤에 붙는다는 뜻이다.
check('이어 쓰면 덮지 않고 뒤에 붙음', list(동시).find((r) => r.id === a1.id)?.turns === 2,
  String(list(동시).find((r) => r.id === a1.id)?.turns));
check('이어 써도 첫 마디는 그대로', list(동시).find((r) => r.id === a1.id)?.first === '첫째 대화');
rmSync(동시, { recursive: true, force: true });

// ── 6. id 모양 ──────────────────────────────────────────────────────────
const id = newId(new Date(2026, 7, 24, 9, 5, 3));
check('id 가 시간순으로 정렬됨', id === '20260824-090503', id);
check('id 가 파일 이름으로 안전함', /^[0-9-]+$/.test(id));

// ── 6.5. 도구를 돌리는 도중에 죽은 대화 ─────────────────────────────────
//
// store 는 메시지가 오갈 때마다 즉시 적는다. 그래서 도구가 도는 중에 죽으면
// 호출만 적히고 결과가 없다. 그대로 이어받아 보내면 OpenAI 규격 서버가 400 을
// 낸다 — 이어받자마자 첫 마디에서 죽으니 '이어하기가 고장 났다' 로 보인다.
//
// 여기서 재는 것은 '지웠다' 가 아니라 **다시 보낼 수 있는 모양이 되었는가** 다.
{
  const 짝검사 = (ms) => {
    for (const [i, m] of ms.entries()) {
      if (m.role === 'tool' && !ms[i - 1]?.tool_calls?.length && ms[i - 1]?.role !== 'tool') return `${i}번 결과 앞에 호출 없음`;
      if (m.tool_calls?.length) {
        const 뒤 = ms.slice(i + 1).findIndex((x) => x.role !== 'tool');
        const 결과수 = 뒤 === -1 ? ms.length - i - 1 : 뒤;
        if (결과수 < m.tool_calls.length) return `${i}번 호출 ${m.tool_calls.length}개에 결과 ${결과수}개`;
      }
    }
    return null;
  };
  const 호출 = (...ids) => ({ role: 'assistant', content: null, tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'Read', arguments: '{}' } })) });
  const 결과 = (id) => ({ role: 'tool', tool_call_id: id, content: '읽었다' });

  // 온전한 것은 한 글자도 안 건드린다. 손보는 코드가 멀쩡한 것을 망가뜨리면 더 나쁘다.
  const 온전 = [{ role: 'user', content: '해줘' }, 호출('c1'), 결과('c1'), { role: 'assistant', content: '했다' }];
  const r0 = repairToolPairs(온전);
  check('온전한 이력은 안 건드린다', r0.고친것 === 0 && r0.messages.length === 4, `고친것 ${r0.고친것}`);

  // 호출 둘 중 하나만 끝났다 — 병렬 읽기 도중에 죽은 모양.
  const r1 = repairToolPairs([{ role: 'user', content: '해줘' }, 호출('c1', 'c2'), 결과('c1')]);
  check('결과 없는 호출만 걷어낸다', r1.messages[1]?.tool_calls?.length === 1 && r1.고친것 === 1,
    `호출 ${r1.messages[1]?.tool_calls?.length}개 · 고친것 ${r1.고친것}`);
  check('끝난 쪽 결과는 남는다', r1.messages[2]?.tool_call_id === 'c1');
  check('손본 뒤 다시 보낼 수 있다', 짝검사(r1.messages) === null, 짝검사(r1.messages) ?? '');

  // 결과가 아예 없다. 할 말도 없으면 그 메시지는 남길 이유가 없다.
  const r2 = repairToolPairs([{ role: 'user', content: '해줘' }, 호출('c1')]);
  check('결과가 하나도 없으면 호출째 사라진다', r2.messages.length === 1 && r2.messages[0].role === 'user',
    `${r2.messages.length}개 남음`);

  // 할 말이 있으면 그건 살린다 — 모델이 무슨 생각이었는지가 이어하기의 단서다.
  const r3 = repairToolPairs([{ role: 'user', content: '해줘' },
    { ...호출('c1'), content: '먼저 읽어 보겠습니다' }]);
  check('할 말은 남기고 호출만 떼어 낸다',
    r3.messages[1]?.content === '먼저 읽어 보겠습니다' && !r3.messages[1]?.tool_calls, JSON.stringify(r3.messages[1]));

  // id 를 안 주는 규격(Ollama)은 순서로 짝짓는다.
  const 올라마 = [{ role: 'user', content: '해줘' }, 호출('c1', 'c2', 'c3'),
    { role: 'tool', tool_name: 'Read', content: 'a' }, { role: 'tool', tool_name: 'Read', content: 'b' }];
  const r4 = repairToolPairs(올라마);
  check('id 없는 규격은 순서로 짝짓는다', r4.messages[1]?.tool_calls?.length === 2 && r4.고친것 === 1,
    `호출 ${r4.messages[1]?.tool_calls?.length}개`);

  // 머리가 잘려 결과부터 시작하는 이력.
  const r5 = repairToolPairs([결과('c9'), { role: 'user', content: '이어서' }]);
  check('호출 없이 굴러다니는 결과는 버린다', r5.messages.length === 1 && r5.고친것 === 1);

  // 적다 만 줄이 섞인 이력.
  //
  // 이 함수가 하는 일은 "그대로 보내면 서버가 거절할 것을 걷어내기" 다. 그런데
  // 빈 자리(null)나 role 이 없는 조각은 그대로 통과시켰다 — 그 한 줄이 그대로
  // 서버로 나가서 400 이 된다. 손보고도 못 여는 것은 안 손본 것과 같다.
  const r6 = repairToolPairs([null, { role: 'user', content: '이어서' }, undefined, { content: 'role 이 없음' }, 42]);
  check('빈 자리·role 없는 조각은 걷어낸다',
    r6.messages.length === 1 && r6.messages[0].role === 'user',
    `${r6.messages.length}개 남음: ${JSON.stringify(r6.messages)}`);
  check('걷어낸 만큼 세어서 알려 준다', r6.고친것 === 4, `고친것 ${r6.고친것}`);
  check('걷어낸 뒤에는 보낼 수 있는 모양', 짝검사(r6.messages) === null, 짝검사(r6.messages) ?? '');

  // 진짜 파일을 거쳐서도 되는가 — 도구가 도는 중에 죽은 대화를 그대로 만든다.
  const 죽은 = new Store(root, 'test-끊김');
  죽은.begin({ model: 'm', root });
  죽은.append({ role: 'user', content: '로그 좀 고쳐줘' });
  죽은.append(호출('c1', 'c2'));
  죽은.append(결과('c1'));
  // 여기서 전원이 나갔다 — c2 의 결과가 없다.
  const 되살린 = new Store(root, 'test-끊김').load().messages;
  check('디스크에는 깨진 채로 남아 있다', 짝검사(되살린) !== null, 짝검사(되살린) ?? '안 깨졌다?');
  const 고친것 = repairToolPairs(되살린);
  check('이어받을 때 손보면 성해진다', 짝검사(고친것.messages) === null, 짝검사(고친것.messages) ?? '');
  check('처음 시킨 일은 그대로 있다', 고친것.messages[0]?.content === '로그 좀 고쳐줘');
}

// ── 6.6. 못 적으면 못 적었다고 말한다 ───────────────────────────────────
//
// 이 파일의 첫 줄이 파는 문장이 「껐다 켜도 이어서 하게 한다」 이고, /sessions
// 화면은 대놓고 「지금 대화는 나가지 않아도 계속 저장되고 있습니다」 라고 적어
// 준다. 디스크가 차거나 홈이 읽기 전용이면 그 두 문장이 거짓이 되는데, 여태
// 화면은 아무 말이 없었다 — 사람은 다음 날 --resume 을 쳐 보고서야 안다.
// 그때는 이미 대화가 없다. 감사기록에서 한 것과 같은 방식으로 세어 둔다.
{
  const 막힌곳 = mkdtempSync(join(tmpdir(), 'deel-store-못씀-'));
  // 대화 파일 자리에 **폴더**를 놓는다. 디스크가 찬 것과 같은 모양을 만들되
  // 어느 OS 에서나 똑같이 재현되는 방법이다 (append → EISDIR).
  mkdirSync(sessionsDir(막힌곳), { recursive: true });
  mkdirSync(join(sessionsDir(막힌곳), '막힘.jsonl'));

  const 막힌 = new Store(막힌곳, '막힘');
  막힌.begin({ model: 'm', root: 막힌곳 });
  막힌.append({ role: 'user', content: '이건 안 적힌다' });
  막힌.append({ role: 'assistant', content: '이것도' });

  const 못씀 = 막힌.못쓴것();
  check('못 적은 것을 세어 둔다', 못씀?.수 === 2, `${못씀?.수}건`);
  check('못 적은 까닭도 들고 있다', 못씀?.까닭 === 'EISDIR', String(못씀?.까닭));

  // 화면은 **한 번만** 말한다. 한 줄 못 적을 때마다 말하면 곧 아무도 안 읽는다.
  const 첫번째 = 막힌.처음못쓴것();
  check('처음 물어보면 알려 준다', 첫번째?.수 === 2, `${첫번째?.수}건`);
  check('두 번째부터는 안 알려 준다', 막힌.처음못쓴것() === null);
  check('세어 둔 것은 그대로 남는다', 막힌.못쓴것()?.수 === 2, `${막힌.못쓴것()?.수}건`);

  // 머리글부터 못 적는 경우 — 대화 폴더 자리에 파일이 있어 폴더를 못 만든다.
  // 홈이 읽기 전용일 때가 이 모양이다. 여기서 세지 않으면 「첫 줄도 못 적었는데
  // 아무 일 없었다」 가 되고, 뒤이은 줄들은 그 위에서 조용히 쌓인다.
  const 폴더막힌곳 = mkdtempSync(join(tmpdir(), 'deel-store-폴더막힘-'));
  mkdirSync(join(폴더막힌곳, '.deel'), { recursive: true });
  writeFileSync(join(폴더막힌곳, '.deel', 'sessions'), '여기는 폴더가 아니다', 'utf8');
  const 머리글못씀 = new Store(폴더막힌곳, '아무거나');
  머리글못씀.begin({ model: 'm', root: 폴더막힌곳 });
  check('머리글을 못 적은 것도 센다', 머리글못씀.못쓴것()?.수 === 1, JSON.stringify(머리글못씀.못쓴것()));
  rmSync(폴더막힌곳, { recursive: true, force: true });

  // 통째로 다시 쓰는 길(압축)도 같은 자리에서 샌다.
  막힌.replace([{ role: 'user', content: '접힌 뒤' }], '압축');
  check('압축해 다시 쓰다 깨진 것도 센다', 막힌.못쓴것()?.수 === 3, `${막힌.못쓴것()?.수}건`);

  // 멀쩡한 대화는 아무 말도 안 한다 — 안 쓰는 사람 화면은 그대로여야 한다.
  const 멀쩡 = new Store(막힌곳, '멀쩡');
  멀쩡.begin({ model: 'm', root: 막힌곳 });
  멀쩡.append({ role: 'user', content: '잘 적힌다' });
  check('멀쩡하면 못쓴것 이 null', 멀쩡.못쓴것() === null, JSON.stringify(멀쩡.못쓴것()));
  check('멀쩡하면 처음못쓴것 도 null', 멀쩡.처음못쓴것() === null);

  // 못 읽는 파일 하나 때문에 목록 전체가 죽으면 안 된다. list() 가 폴더의 대화를
  // 하나씩 열어 보므로, 거기서 던지면 /sessions 화면이 통째로 안 뜬다 —
  // 멀쩡히 이어할 수 있는 나머지 대화까지 사람 눈에서 사라진다.
  check('못 읽은 까닭을 담아 돌려준다', new Store(막힌곳, '막힘').load().못읽음 === 'EISDIR',
    String(new Store(막힌곳, '막힘').load().못읽음));
  /*
   * 그렇다고 **없는 셈** 쳐도 안 된다. 여태 못 읽는 대화는 목록에서 통째로
   * 빠졌고, 그런 것뿐이면 화면은 「아직 없습니다. 지금 이 대화가 첫
   * 번째입니다」 라고 말했다 — 어제 한 일이 그대로 있는데 없다고 한 것이다.
   * 이어할 수는 없어도 거기 있다는 것은 말해야 사람이 손을 쓴다.
   */
  // 못 읽는 것이 **가장 최근**일 때가 진짜 판이다 — --continue 가 집는 자리다.
  const 이따가 = new Date(Date.now() + 60000);
  utimesSync(join(sessionsDir(막힌곳), '막힘.jsonl'), 이따가, 이따가);
  const 목록 = list(막힌곳);
  check('★ 못 읽는 대화도 목록에 올린다', 목록.length === 2, 목록.map((r) => r.id).join(' '));
  check('  그리고 그것이 맨 위다', 목록[0]?.id === '막힘', 목록.map((r) => r.id).join(' '));
  const 막힌줄 = 목록.find((r) => r.id === '막힘');
  check('★★ 못 읽었다는 것을 그 줄에 적는다', 막힌줄?.못읽음 === 'EISDIR' && /못 읽었습니다/.test(막힌줄?.first ?? ''),
    JSON.stringify(막힌줄?.first));
  check('멀쩡한 것은 그대로 읽힌다', 목록.find((r) => r.id === '멀쩡')?.turns === 1);
  // --continue 가 못 읽는 것을 집어 오면 빈 대화가 열린다. 사람은 이어진 줄 안다.
  check('★★ --continue 는 못 읽는 것을 안 집는다', latest(막힌곳)?.id === '멀쩡', JSON.stringify(latest(막힌곳)?.id));

  rmSync(막힌곳, { recursive: true, force: true });
}

// ── 6.7. 남은 할 일과 시킨 말 원문도 껐다 켜면 살아난다 ─────────────────
//
// 1.9.2 는 **한 대화 안에서** 접히거나 줄어들 때 이 둘이 사라지던 것을 막았다
// (session.js 의 못박을것). 그런데 둘 다 메모리에만 있어서, 창을 닫는 한 번에
// 그 보호가 통째로 없어졌다 — 이어받으면 오간 말은 돌아오는데 남은 할 일과
// 시킨 말 원문은 안 돌아온다. 「요청사항이 많으면 몇 개 까먹는다」 가 껐다 켜는
// 자리에서 그대로 되풀이되는 셈이다.
{
  const 살림root = mkdtempSync(join(tmpdir(), 'deel-store-살림-'));
  const 살림파일 = join(sessionsDir(살림root), '살림-001.jsonl');
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사용', ctx: 32768 };
  const 셈 = (글, 조각) => 글.split(조각).length - 1;

  const 어제 = new Session(conn, { root: 살림root });
  const 어제store = new Store(살림root, '살림-001');
  어제store.begin({ model: '검사용', root: 살림root });
  어제store.살림따라가기(어제);

  어제.이번요청 = '로그 형식 통일하고, 테스트도 붙이고, README 도 고쳐줘';
  어제.할일 = [
    { text: '로그 형식 통일', state: 'done' },
    { text: '테스트 붙이기', state: 'in_progress' },
    { text: 'README 고치기', state: 'pending' },
  ];
  어제store.append({ role: 'user', content: 어제.이번요청 });

  const 적힌것 = readFileSync(살림파일, 'utf8');
  check('할 일이 파일에 남는다', 적힌것.includes('"t":"todo"'));
  check('시킨 말 원문도 파일에 남는다', 적힌것.includes('"t":"request"'));

  // 안 바뀌었으면 한 줄도 안 늘린다. 메시지마다 목록을 통째로 다시 적으면
  // 긴 대화에서 파일이 몇 배가 되고, 그 값은 매번 사람이 기다리는 시간이다.
  어제store.append({ role: 'assistant', content: '하겠습니다' });
  const 두번째 = readFileSync(살림파일, 'utf8');
  check('안 바뀌면 할 일을 다시 안 적는다', 셈(두번째, '"t":"todo"') === 1, `${셈(두번째, '"t":"todo"')}줄`);
  check('안 바뀌면 시킨 말도 다시 안 적는다', 셈(두번째, '"t":"request"') === 1, `${셈(두번째, '"t":"request"')}줄`);

  // 바뀌면 적는다 — 마지막 것이 이긴다(못 박은 것과 같은 방식).
  어제.할일 = 어제.할일.map((t) => ({ ...t, state: 'done' }));
  어제store.append({ role: 'assistant', content: '다 했습니다' });
  check('바뀌면 다시 적는다', 셈(readFileSync(살림파일, 'utf8'), '"t":"todo"') === 2);

  // 껐다 켠다 — 새 Session, 새 Store. 여기가 여태 비어 있던 자리다.
  const 오늘 = new Session(conn, { root: 살림root });
  new Store(살림root, '살림-001').살림따라가기(오늘);
  check('남은 할 일이 그대로 돌아온다',
    JSON.stringify(오늘.할일) === JSON.stringify(어제.할일), JSON.stringify(오늘.할일));
  check('시킨 말 원문도 그대로 돌아온다', 오늘.이번요청 === 어제.이번요청, 오늘.이번요청);
  check('못 박을 것이 이어받기 뒤에도 같다', 못박을것(오늘) === 못박을것(어제),
    못박을것(오늘).slice(0, 60));

  // 압축이 돌아도 안 지워진다 — 못 박은 것과 같은 이유다. 파일을 새로 쓰면서
  // 안 옮기면 '접거나 요약해도 안 지워진다' 가 바로 그 요약에서 거짓이 된다.
  //
  // 여기서 일부러 **메시지를 안 붙이고** 할 일만 바꾼 뒤 접는다. 접는 자리가
  // 파일만 보고 옮기면 이 마지막 변화가 통째로 사라진다 — 제일 크게 잃는 자리다.
  어제.할일 = [...어제.할일, { text: '접기 직전에 생긴 일', state: 'pending' }];
  어제store.replace([{ role: 'user', content: '요약된 대화' }], '압축');
  const 압축뒤 = new Session(conn, { root: 살림root });
  new Store(살림root, '살림-001').살림따라가기(압축뒤);
  check('압축해 다시 써도 할 일이 남는다',
    JSON.stringify(압축뒤.할일) === JSON.stringify(어제.할일), JSON.stringify(압축뒤.할일));
  check('압축해 다시 써도 시킨 말이 남는다', 압축뒤.이번요청 === 어제.이번요청, 압축뒤.이번요청);

  // 적힌 것이 없는 새 갈래에 붙일 때 들고 있던 것을 빈 값으로 덮으면 안 된다.
  const 새갈래 = new Session(conn, { root: 살림root });
  새갈래.이번요청 = '방금 시킨 말';
  new Store(살림root, '살림-빈것').begin({ model: '검사용', root: 살림root }).살림따라가기(새갈래);
  check('적힌 게 없으면 들고 있던 것을 안 지운다', 새갈래.이번요청 === '방금 시킨 말', 새갈래.이번요청);

  rmSync(살림root, { recursive: true, force: true });
}

/*
 * ── 6.8. 할 일 목록에 낀 빈 칸 하나가 대화를 통째로 죽였다 (8회차 세션 3) ─
 *
 * 할 일 목록은 대화 파일(`{"t":"todo","목록":[…]}`)에서 그대로 돌아온다. 반쯤 적히다
 * 끊긴 줄이나 사람이 손으로 고친 파일에서는 그 배열에 `null` 이 낄 수 있다.
 *
 * 못박은할일() 의 거르개는 `x?.state` 라 그 `null` 을 「안 끝난 것」 으로 통과시켰고,
 * 바로 다음 줄 map 은 `x.state` 라 거기서 TypeError 로 던졌다. 던지는 자리가
 * **접기·줄이기**여서, 자리가 차는 순간 그 대화는 더 이어지지 않는다.
 */
{
  const 살림root = mkdtempSync(join(tmpdir(), 'deel-store-빈할일-'));
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사용', ctx: 32768 };
  const 파일 = join(sessionsDir(살림root), '빈할일-001.jsonl');
  const s = new Session(conn, { root: 살림root });
  const st = new Store(살림root, '빈할일-001');
  st.begin({ model: '검사용', root: 살림root });
  st.append({ role: 'user', content: '두 가지 해줘' });
  // 손으로 고쳐진(또는 반쯤 적힌) 목록 줄을 그대로 얹는다.
  appendFileSync(파일, `${JSON.stringify({ t: 'todo', 목록: [{ text: '살아 있는 할 일', state: 'pending' }, null] })}\n`, 'utf8');
  new Store(살림root, '빈할일-001').살림따라가기(s);
  check('★ 빈 칸이 낀 목록도 파일에서 돌아온다', (s.할일 ?? []).length === 2, JSON.stringify(s.할일));

  let 던짐 = null;
  let 글 = '';
  try { 글 = 못박을것(s); } catch (e) { 던짐 = e; }
  check('★★ 목록에 낀 빈 칸에 접기·줄이기가 안 죽는다 (8회차 세션 3)', 던짐 === null,
    던짐 ? `${던짐.constructor.name}: ${던짐.message}` : '');
  check('★ 그래도 진짜 할 일은 그대로 박힌다', 글.includes('살아 있는 할 일'), 글.slice(0, 120));
  check('  빈 칸이 빈 줄로 박히지는 않는다', !/☐\s*$/m.test(글), JSON.stringify(글));
  rmSync(살림root, { recursive: true, force: true });
}

// ── 7. 없는 폴더에서도 안 죽는다 ────────────────────────────────────────
const 빈폴더 = mkdtempSync(join(tmpdir(), 'deel-empty-'));
check('대화 없는 폴더에서 빈 목록', list(빈폴더).length === 0);
check('대화 없는 폴더에서 latest 는 null', latest(빈폴더) === null);
rmSync(빈폴더, { recursive: true, force: true });

/*
 * ── 대화 파일을 아무나 읽으면 안 된다 ───────────────────────────────────
 *
 * 여기 남는 것은 대화 전체다 — 사람이 붙여 넣은 글, 읽은 파일 내용, 모델이
 * 쓴 답. 설정 파일은 config.js 가 만들 때 0600 을 걸어 두는데 대화 파일에는
 * 그게 없었다. 홈이 공유 폴더에 있거나 같은 PC 를 여럿이 쓰면 그대로 읽힌다.
 *
 * 윈도우(NTFS)에서는 chmod 가 아무 일도 안 한다 — 권한이 ACL 로 정해지기
 * 때문이다. 거기서는 모드를 재지 않고 **재는 척도 하지 않는다.**
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-store-권한-'));
  const s = new Store(방, 'perm-001');
  s.begin({ model: 'm', base: 'http://127.0.0.1:1', root: 방 });
  s.append({ role: 'user', content: '사내 계정 비번은 …' });
  const 파일 = join(sessionsDir(방), 'perm-001.jsonl');
  /*
   * 건 결과는 어느 판에서든 남긴다. 다만 **윈도우에서 성공으로 남기면 안
   * 된다** — 거기서 chmod 는 아무 일도 안 하고 성공한다. 그 성공을 그대로
   * 적으면 바로 위 머리말이 스스로 금지한 「잠근 척」 이 된다.
   */
  const 잠금맞나 = (v) => (process.platform === 'win32' ? v?.못함 === 'windows' : v?.모드 === 0o600);
  check('★ 건 결과를 밖에서 볼 수 있게 남긴다', 잠금맞나(s.잠금), JSON.stringify(s.잠금));
  check('파일이 실제로 있다 (건 자리가 허공이 아니다)', existsSync(파일), 파일);
  if (process.platform === 'win32') {
    check('윈도우에서는 모드를 안 잰다 (NTFS 는 ACL 이라 chmod 가 아무 일도 안 한다)',
      new Store(방, 'perm-001').load().messages.length === 1);
  } else {
    check('★ 대화 파일이 정말 0600 이다', (statSync(파일).mode & 0o777) === 0o600,
      '0' + (statSync(파일).mode & 0o777).toString(8));
  }

  // 압축이 일어나면 파일을 통째로 다시 쓴다. 그때 잠금이 풀리면 안 된다.
  s.잠금 = null;
  s.replace([{ role: 'user', content: '줄인 것' }], '압축');
  check('★ 통째로 다시 쓴 뒤에 다시 건다', 잠금맞나(s.잠금), JSON.stringify(s.잠금));
  if (process.platform !== 'win32') {
    check('★ 다시 쓴 뒤에도 정말 0600 이다', (statSync(파일).mode & 0o777) === 0o600,
      '0' + (statSync(파일).mode & 0o777).toString(8));
  } else {
    check('다시 쓴 뒤에도 대화가 성하다', new Store(방, 'perm-001').load().messages.length === 1);
  }
  rmSync(방, { recursive: true, force: true });
}


// ── 9. 못 적은 것을 적은 셈 치지 않는다 ─────────────────────────────────
//
// 여기가 남은 할 일과 시킨 말이 **조용히 영영** 없어지던 길이다. 못 적었는데
// 적은 셈으로 표시해 두면, 디스크가 다시 나아져도 그 값은 이미 「안 바뀐 것」
// 이라 두 번 다시 안 적힌다. 잠깐 막힌 것이 영구 손실이 되는 자리다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-살림-'));
  const st = new Store(방, 'ㅅ1');
  st.begin({ model: 'm', root: 방 });
  const session = { 할일: [{ 무엇: '가' }], 이번요청: '처음 시킨 말' };
  st.살림따라가기(session);

  chmodSync(st.file, 0o444);              // 못 쓰게 막는다
  session.할일 = [{ 무엇: '나' }];
  session.이번요청 = '바꿔 시킨 말';
  st.살림적기();
  check('못 적은 것을 센다', st.못쓴것()?.수 >= 1, JSON.stringify(st.못쓴것()));

  chmodSync(st.file, 0o666);              // 다시 쓸 수 있게 된다
  st.살림적기();
  const 살린것 = new Store(방, 'ㅅ1').load();
  check('★★ 다시 쓸 수 있게 되면 못 적었던 할 일이 들어간다',
    JSON.stringify(살린것.할일) === JSON.stringify([{ 무엇: '나' }]), JSON.stringify(살린것.할일));
  check('★★ 시킨 말도 마찬가지다', 살린것.이번요청 === '바꿔 시킨 말', JSON.stringify(살린것.이번요청));
  rmSync(방, { recursive: true, force: true });
}

// ── 10. 접는 자리는 옆에 쓰고 갈아 끼운다 ───────────────────────────────
//
// 이 파일 머리말이 jsonl 을 고른 까닭이 「통째로 다시 쓰면 그 순간 파일이
// 깨진다」 인데, 정작 통째로 다시 쓰는 자리가 replace() 였다. 반쯤 쓰다 죽으면
// 원본은 이미 잘려 있고 새것은 안 끝났다 — 그 한 번에 대화 전체가 없어진다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-접기-'));
  const st = new Store(방, 'ㅈ1');
  st.begin({ model: 'm', root: 방 });
  for (let i = 0; i < 5; i++) st.append({ role: 'user', content: '중요한 말 ' + i });
  st.replace([{ role: 'user', content: '줄인 것' }], '압축');
  check('접으면 새 내용으로 바뀐다', new Store(방, 'ㅈ1').load().messages.length === 1);
  check('★ 옆에 쓰던 것을 안 남긴다',
    readdirSync(sessionsDir(방)).every((n) => n.endsWith('.jsonl')), readdirSync(sessionsDir(방)).join(' '));

  // 옆에 쓸 자리를 막아 둔다 — 디스크가 차거나 폴더가 막힌 판과 같은 꼴이다.
  mkdirSync(st.file + '.새로');
  const 접기전 = new Store(방, 'ㅈ1').load().messages.length;
  st.replace([{ role: 'user', content: '더 줄인 것' }], '압축');
  check('★★ 옆에 못 쓰면 원본을 안 건드린다',
    new Store(방, 'ㅈ1').load().messages.length === 접기전, String(new Store(방, 'ㅈ1').load().messages.length));
  check('★★ 그리고 못 썼다고 센다', st.못쓴것()?.수 >= 1, JSON.stringify(st.못쓴것()));
  rmSync(방, { recursive: true, force: true });
}

// ── 11. 정리·이름·첫 마디 ───────────────────────────────────────────────
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-정리-'));
  const dir = sessionsDir(방);
  mkdirSync(dir, { recursive: true });
  const 이제 = Date.now();
  /*
   * 개수를 1000 으로 끊어 놓으면 정작 **제일 오래된 것들**이 그 뒤에 있어서
   * 영영 안 지워진다. 폴더가 끝없이 자라지 말라고 있는 함수가 딱 그 일을
   * 못 하게 된다 — 그래서 몇 달 쓴 사람만 디스크가 찬다.
   */
  for (let i = 0; i < 1005; i++) {
    const f = join(dir, `2026-${String(i).padStart(4, '0')}.jsonl`);
    writeFileSync(f, JSON.stringify({ t: 'msg', m: { role: 'user', content: 'x' } }) + '\n', 'utf8');
    const 때 = new Date(이제 - (i >= 1000 ? 400 : 1) * 86400000 - i * 1000);
    utimesSync(f, 때, 때);
  }
  const 지운수 = prune(방, { keep: 30, days: 30 });
  check('★★ 대화가 1000개를 넘어도 오래된 것을 지운다', 지운수 === 5, `${지운수}개`);
  check('  실제로 그만큼 줄었다', list(방, { limit: 9999, 속까지: false }).length === 1000,
    String(list(방, { limit: 9999, 속까지: false }).length));

  // 못 지운 것을 지웠다고 세면, 폴더가 왜 안 줄어드는지 아무도 못 찾는다.
  const 막힌곳 = mkdtempSync(join(tmpdir(), 'deel-정리2-'));
  mkdirSync(sessionsDir(막힌곳), { recursive: true });
  const 옛날 = new Date(이제 - 400 * 86400000);
  writeFileSync(join(sessionsDir(막힌곳), 'ㄱ.jsonl'), '{}' + '\n', 'utf8');
  utimesSync(join(sessionsDir(막힌곳), 'ㄱ.jsonl'), 옛날, 옛날);
  mkdirSync(join(sessionsDir(막힌곳), 'ㄴ.jsonl'));      // 이건 못 지운다
  utimesSync(join(sessionsDir(막힌곳), 'ㄴ.jsonl'), 옛날, 옛날);
  check('★ 못 지운 것은 지웠다고 안 센다', prune(막힌곳, { keep: 0, days: 30 }) === 1,
    String(prune(막힌곳, { keep: 0, days: 30 })));
  rmSync(막힌곳, { recursive: true, force: true });

  /*
   * ── ★★ (사냥5 H5-2) 방금 이어받은 대화를 정리가 지웠다 ─────────────────────
   *
   * 정리는 파일 시각만 본다. 한 달 전 대화를 --resume · session/load 로 이어받으면
   * 그 파일은 **아직 한 줄도 안 늘어서** 시각이 한 달 전 그대로다. 그런데 이어받기
   * 바로 뒤에 prune() 이 돌아 그 파일을 지웠고, 다음 한 줄은 머리글도 옛 대화도 없는
   * 새 파일에 적혔다. 지금 쓰는 대화는 시각과 상관없이 남긴다.
   */
  const 지킴곳 = mkdtempSync(join(tmpdir(), 'deel-정리3-'));
  mkdirSync(sessionsDir(지킴곳), { recursive: true });
  for (const 이름 of ['이어받은것', '버릴것']) {
    writeFileSync(join(sessionsDir(지킴곳), `${이름}.jsonl`), '{}' + '\n', 'utf8');
    utimesSync(join(sessionsDir(지킴곳), `${이름}.jsonl`), 옛날, 옛날);
  }
  const 지킨수 = prune(지킴곳, { keep: 0, days: 30, 남길것: ['이어받은것'] });
  check('★★ (사냥5 H5-2) 남길것에 든 대화는 오래됐어도 안 지운다',
    existsSync(join(sessionsDir(지킴곳), '이어받은것.jsonl')), readdirSync(sessionsDir(지킴곳)).join(' '));
  check('★ (사냥5 H5-2) 남길것에 안 든 오래된 대화는 그대로 지운다',
    !existsSync(join(sessionsDir(지킴곳), '버릴것.jsonl')) && 지킨수 === 1, `${지킨수}개 · ${readdirSync(sessionsDir(지킴곳)).join(' ')}`);
  rmSync(지킴곳, { recursive: true, force: true });

  /*
   * ── ★★ (사냥5 H5-1) 파일이 없다고 빈 이름은 아니다 ──────────────────────────
   *
   * 빈 이름인지 **그 폴더의 대화 파일**로만 봤다. 에디터 프로세스 하나가 두 프로젝트를
   * 같은 초에 열면 두 폴더 다 파일이 없어 둘 다 같은 이름을 받았고, ACP 는 그 이름
   * 하나로 방을 찾으므로 A 탭의 말이 B 방으로 갔다. 부르는 쪽이 피할 이름을 준다.
   */
  const 이름곳 = mkdtempSync(join(tmpdir(), 'deel-이름-'));
  const 그때 = new Date(2026, 8, 15, 7, 11, 32);
  const 첫이름 = newId(그때);
  check('★★ (사냥5 H5-1) freeId 는 파일이 없어도 피할 이름이면 옆 이름을 준다',
    freeId(sessionsDir(이름곳), 그때, (id) => id === 첫이름) === `${첫이름}-2`,
    freeId(sessionsDir(이름곳), 그때, (id) => id === 첫이름));
  const 이미쓴 = new Set();
  const 가 = new Store(이름곳, null, { 피할것: (id) => 이미쓴.has(id) });
  이미쓴.add(가.id);
  const 나 = new Store(이름곳, null, { 피할것: (id) => 이미쓴.has(id) });
  check('★★ (사냥5 H5-1) 새 Store 도 피할 이름을 비켜 짓는다', 가.id !== 나.id, `${가.id} · ${나.id}`);
  rmSync(이름곳, { recursive: true, force: true });

  rmSync(방, { recursive: true, force: true });
}

{
  // 대괄호로 여는 것은 우리가 끼워 넣은 글이라 건너뛴다. 그런데 사람도
  // 「[급함] 로그인이 안 됩니다」 처럼 적는다 — 그 대화가 목록에서 「(빈 대화)」
  // 가 됐다. 있는 대화를 없다고 적은 것이다.
  const 방 = mkdtempSync(join(tmpdir(), 'deel-첫마디-'));
  const st = new Store(방, 'ㅁ1');
  st.begin({ model: 'm', root: 방 });
  st.append({ role: 'user', content: '[급함] 로그인이 안 됩니다' });
  check('★ 대괄호로 연 진짜 질문을 「빈 대화」 라고 안 한다',
    list(방)[0]?.first === '[급함] 로그인이 안 됩니다', JSON.stringify(list(방)[0]?.first));

  /*
   * ── 8회차 판정 · 대괄호 하나로 제목이 두 번 어긋났다 ──────────────────
   *
   * 위 고침은 「남는 것이 없으면 첫 마디를 쓴다」 였다. 그런데 **남는 것이
   * 있을 때**는 여전히 건너뛴다 — 사람이 「[급함] …」 로 열고 그 뒤에 한 마디만
   * 더 하면 목록에 **둘째 마디**가 뜬다. 처음 물은 것이 목록에서 사라진다.
   *
   * 반대쪽도 있다. 우리가 끼워 넣은 글(접은 요약 · 딴 모델에게 물어본 결과)만
   * 남은 대화에서는 `?? 쓸만한[0]` 이 **그 끼운 글**을 제목으로 고른다.
   * 사람이 한 적 없는 말이 그 대화의 이름이 된다.
   */
  {
    const 방2 = join(root, "대괄호2");
    mkdirSync(join(방2, ".deel", "sessions"), { recursive: true });
    const st2 = new Store(방2, "괄호-002");
    st2.begin({ model: "m", base: "http://127.0.0.1:1", root: 방2 });
    st2.append({ role: "user", content: "[급함] 로그인이 안 됩니다" });
    st2.append({ role: "assistant", content: "봤습니다" });
    st2.append({ role: "user", content: "다시 해봐도 같아요" });
    check("★★ 대괄호로 연 첫 물음이 뒤엣말에 밀리지 않는다",
      list(방2)[0]?.first === "[급함] 로그인이 안 됩니다", JSON.stringify(list(방2)[0]?.first));

    const 방3 = join(root, "대괄호3");
    mkdirSync(join(방3, ".deel", "sessions"), { recursive: true });
    const st3 = new Store(방3, "괄호-003");
    st3.begin({ model: "m", base: "http://127.0.0.1:1", root: 방3 });
    st3.append({ role: "user", content: "[앞선 대화 7개를 요약해 접었습니다. 아래가 그 요약입니다.]" + String.fromCharCode(10) + "요약 본문" });
    check("★★ 우리가 끼운 글은 그 대화의 제목이 안 된다",
      list(방3)[0]?.first === "(빈 대화)", JSON.stringify(list(방3)[0]?.first));

    // 사람이 대괄호만으로 한 마디를 적었으면 그건 사람 말이다 — 그대로 제목이 된다.
    const 방4 = join(root, "대괄호4");
    mkdirSync(join(방4, ".deel", "sessions"), { recursive: true });
    const st4 = new Store(방4, "괄호-004");
    st4.begin({ model: "m", base: "http://127.0.0.1:1", root: 방4 });
    st4.append({ role: "user", content: "[이게 무슨 뜻이죠]" });
    check("  대괄호만으로 적은 사람 말은 그대로 제목이 된다",
      list(방4)[0]?.first === "[이게 무슨 뜻이죠]", JSON.stringify(list(방4)[0]?.first));
  }
  rmSync(방, { recursive: true, force: true });
}

{
  /*
   * `deel sessions --rm ../../어딘가` 는 대화 폴더 **밖**을 지우고도 화면에는
   * 「지웠습니다」 라고 적었다. 무엇을 지웠는지 사람이 못 알아본다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-이름-'));
  mkdirSync(sessionsDir(방), { recursive: true });
  const 밖 = join(방, '남의것.jsonl');
  writeFileSync(밖, '지우면 안 되는 것', 'utf8');
  const r = remove(방, '../../남의것');
  check('★★ 대화 폴더 밖은 안 지운다', !!r.error && existsSync(밖), JSON.stringify(r));
  rmSync(방, { recursive: true, force: true });
}

{
  /*
   * 폴더를 못 만들었으면 **연 것이 아니다.** 연 것으로 적어 두면 잠깐 막혔던
   * 것이 풀린 뒤에도 두 번 다시 안 만들어 본다 — 그 대화는 끝까지 한 줄도
   * 안 남는다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-폴더-'));
  mkdirSync(join(방, '.deel'), { recursive: true });
  writeFileSync(sessionsDir(방), '폴더 자리를 파일이 막고 있다', 'utf8');
  const st = new Store(방, 'ㅍ1');
  st.append({ role: 'user', content: '첫 줄' });
  check('폴더를 못 만들면 못 적었다고 센다', st.못쓴것()?.수 >= 1, JSON.stringify(st.못쓴것()));
  rmSync(sessionsDir(방));                 // 막고 있던 것을 치운다
  st.append({ role: 'user', content: '둘째 줄' });
  check('★★ 막힌 것이 풀리면 그때부터는 적는다',
    new Store(방, 'ㅍ1').load().messages.length === 1, String(new Store(방, 'ㅍ1').load().messages.length));
  rmSync(방, { recursive: true, force: true });
}

{
  /*
   * 이름을 못 잡으면 begin() 은 쉰 번을 되풀이하다 **아무 파일도 없이** 돌아왔다.
   * 화면은 「계속 저장되고 있습니다」 라고 말하는데 파일은 하나도 없다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-이름겹침-'));
  const dir = sessionsDir(방);
  mkdirSync(dir, { recursive: true });
  // 시각을 못 박는다. 파일 천 개를 만드는 사이에 초가 넘어가면 겹칠 일이
  // 없어져서, 재려던 판이 조용히 사라진다.
  const 이제 = new Date(2026, 0, 1, 12, 0, 0);
  const 밑 = newId(이제);
  writeFileSync(join(dir, `${밑}.jsonl`), '{}' + '\n', 'utf8');
  for (let n = 2; n < 1000; n++) writeFileSync(join(dir, `${밑}-${n}.jsonl`), '{}' + '\n', 'utf8');
  writeFileSync(join(dir, `${밑}-${process.pid}.jsonl`), '{}' + '\n', 'utf8');
  const 고른것 = freeId(dir, 이제);
  check('★★ 이름이 다 차 있어도 안 쓰는 이름을 고른다',
    !existsSync(join(dir, `${고른것}.jsonl`)), 고른것);
  const st = new Store(방, 고른것);
  st.begin({ model: 'm', root: 방 });
  st.append({ role: 'user', content: '이 말은 남아야 한다' });
  check('★★ 그 이름으로 정말 적힌다',
    st.못쓴것() === null && new Store(방, st.id).load().messages.length === 1,
    `${st.id} · ${JSON.stringify(st.못쓴것())}`);
  rmSync(방, { recursive: true, force: true });
}

/*
 * ── ★ 반쪽 줄 뒤에 이어 적으면 첫 새 줄이 그 반쪽에 붙어 버린다 ─────────────
 *
 * 이 파일 머리가 재는 「도중에 죽어도 앞부분은 성한가」 의 **다음 날** 이다.
 * 반쪽 줄은 읽을 때 건너뛰니 앞부분은 성하다. 그런데 --resume 으로 그 파일에
 * 이어 적으면 첫 새 줄이 개행 없는 반쪽 줄 **뒤에 그대로 붙어** 한 줄이 되고,
 * 그 줄은 JSON 이 아니라서 다음에 읽을 때 통째로 건너뛴다 — 이어받은 뒤 사람이
 * 처음 한 말이 조용히 없어진다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-store-half-'));
  const s = new Store(방, 'half-1');
  s.begin({ model: 'm', root: 방 });
  s.append({ role: 'user', content: '첫 요청' });
  appendFileSync(s.file, '{"t":"msg","m":{"role":"tool","tool_call_id":"c1","content":"반쯤', 'utf8');

  const 이어 = new Store(방, 'half-1');
  이어.load();
  이어.begin({ model: 'm', root: 방 });
  이어.append({ role: 'user', content: '이어받은 뒤 첫 말' });
  이어.append({ role: 'assistant', content: '네 이어서 합니다' });
  const 다시 = new Store(방, 'half-1').load().messages.map((m) => m.content);
  check('★★ 반쪽 줄 뒤에 이어 적어도 이어받은 뒤 첫 말이 남는다',
    다시.includes('이어받은 뒤 첫 말') && 다시.includes('네 이어서 합니다'), JSON.stringify(다시));
  check('반쪽 줄 앞의 것도 그대로다', 다시[0] === '첫 요청', JSON.stringify(다시));
  rmSync(방, { recursive: true, force: true });
}

/*
 * ── ★ 메모장이 BOM 을 붙여 저장한 대화 파일 ───────────────────────────────
 *
 * 윈도우에서 대화 파일을 열어 보고 저장하면 첫 줄 앞에 BOM(U+FEFF) 이 붙는다.
 * 그러면 첫 줄 JSON 이 안 풀려서 머리글이 통째로 없는 대화가 된다 — 목록의
 * 모델은 `?` 이고, 접을 때 replace() 가 머리글을 모델·폴더 없이 새로 쓴다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-store-bom-'));
  mkdirSync(sessionsDir(방), { recursive: true });
  writeFileSync(join(sessionsDir(방), 'bom.jsonl'),
    String.fromCharCode(0xFEFF) + '{"t":"meta","model":"bm","root":"x"}\r\n{"t":"msg","m":{"role":"user","content":"한글 요청"}}\r\n', 'utf8');
  const st = new Store(방, 'bom');
  check('★ BOM 이 붙은 파일도 머리글을 읽는다', st.load().meta?.model === 'bm', JSON.stringify(st.load().meta));
  check('★ readMeta 도 머리글을 읽는다', st.readMeta()?.model === 'bm', JSON.stringify(st.readMeta()));
  check('★ 목록에서 모델이 ? 가 아니다', list(방)[0]?.model === 'bm', JSON.stringify(list(방)[0]?.model));
  st.replace(st.load().messages, '압축');
  const 새머리 = new Store(방, 'bom').readMeta();
  check('★★ BOM 파일을 접어 다시 써도 모델·폴더가 남는다', 새머리?.model === 'bm' && 새머리?.root === 'x', JSON.stringify(새머리));
  rmSync(방, { recursive: true, force: true });
}

/*
 * ── ★★ 대화 이름이 폴더 밖을 가리키면 읽지도 적지도 않는다 ────────────────
 *
 * 이름을 경로에 그대로 이어 붙인다. `remove()` 만 이름을 봤고, 읽기·적기·
 * 갈아 끼우기는 안 봤다. 그래서 에디터가 session/load 로 `../../evil/x` 를
 * 주면 대화 폴더 밖의 `evil/x.jsonl` 을 대화로 읽고, 한 턴이 돌면 거기에 대화를
 * 적었다. 이름을 받는 문이 셋(--resume · session/load · /sessions)이라 검사는
 * 이름이 경로가 되는 **한 자리**(Store)에 둔다.
 */
{
  const { 대화이름인가 } = await import('../src/agent/store.js');
  check('★ 대화 이름 검사를 내보낸다', typeof 대화이름인가 === 'function', typeof 대화이름인가);
  if (typeof 대화이름인가 === 'function') {
    check('★ 보통 이름은 된다', 대화이름인가('20260914-101010') && 대화이름인가('20260914-101010-2') && 대화이름인가('crash1'));
    check('★ 경로가 섞인 이름은 안 된다',
      ['../../evil/x', '..', 'a/b', 'a\\b', 'C:x', '', ' ', '.'].every((x) => !대화이름인가(x)));
  }
  const 방 = mkdtempSync(join(tmpdir(), 'deel-store-name-'));
  mkdirSync(join(방, 'evil'), { recursive: true });
  const 밖 = join(방, 'evil', 'x.jsonl');
  const 원래 = '{"t":"msg","m":{"role":"user","content":"밖에 있던 글"}}\n';
  writeFileSync(밖, 원래, 'utf8');
  const st = new Store(방, '../../evil/x');
  check('★★ 폴더 밖 파일을 대화로 읽지 않는다', st.load().messages.length === 0, JSON.stringify(st.load().messages));
  st.begin({ model: 'm', root: 방 });
  st.append({ role: 'user', content: '새 말' });
  st.못박기목록([{ 번호: 1, 말: 'x' }]);
  st.replace([{ role: 'user', content: '요약' }], '압축');
  check('★★ 폴더 밖 파일에 한 줄도 안 적는다', readFileSync(밖, 'utf8') === 원래, JSON.stringify(readFileSync(밖, 'utf8').slice(0, 120)));
  check('★ 못 적었다고 센다 — 저장된다고 말하지 않는다', st.못쓴것() !== null, JSON.stringify(st.못쓴것()));
  rmSync(방, { recursive: true, force: true });
}

// ── 적기가 한 번 막힌 뒤 반쪽 줄 뒤에 붙였다 (6회차 Gemini 저장6w-a2 X1) ──────
//
// 반쪽 줄로 끝난 파일에 이어 적을 때 끝을 한 번만 본다(#줄끝봤나). 그런데 본 표시를
// 적기 **전에** 세워서, 첫 적기가 막히면(읽기 전용 · 잠김 · 디스크 가득) 다음 줄이
// 개행 없이 반쪽 뒤에 붙었다. 그 줄은 적었다고 셈도 안 오르고 다시 읽으면 사라진다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-store-halfretry-'));
  const id = '20260915-120000';
  mkdirSync(sessionsDir(방), { recursive: true });
  const f = join(sessionsDir(방), `${id}.jsonl`);
  writeFileSync(f, JSON.stringify({ t: 'meta', model: 'm' }) + '\n'
    + JSON.stringify({ t: 'msg', m: { role: 'user', content: '옛말' } }) + '\n' + '{"t":"msg","m":{"ro', 'utf8');
  const st = new Store(방, id);
  st.begin({ model: 'm' });
  chmodSync(f, 0o444);
  st.append({ role: 'user', content: '첫말' });
  chmodSync(f, 0o644);
  const 막혔나 = st.못쓴수 === 1;
  st.append({ role: 'user', content: '둘째말' });
  const 다시 = new Store(방, id).load().messages.map((m) => m.content);
  if (막혔나) {
    check('★ (6회차 X1) 적기가 한 번 막힌 뒤에도 다음 줄을 반쪽 줄 뒤에 붙이지 않는다', 다시.includes('옛말') && 다시.includes('둘째말'), JSON.stringify(다시));
  } else {
    console.log('  (X1 판은 읽기 전용이 적기를 안 막는 환경이라 건너뜀 — 관리자 권한 등)');
  }
  rmSync(방, { recursive: true, force: true });
}

// ── 빈 대화가 스무 개 넘게 쌓이면 --continue 가 못 찾았다 (6회차 Gemini 저장6w-b2 Y4) ──
//
// 터미널은 켜자마자, 에디터는 새 대화 창마다 머리글 줄을 적는다. 말 없이 끝낸 파일을
// 치우는 자리는 없다. latest() 가 최근 20개만 봐서, 그 스물이 다 머리글뿐이면 어제
// 대화가 그대로 있는데 「이어갈 대화가 없다」 가 됐다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-store-latest-empty-'));
  mkdirSync(sessionsDir(방), { recursive: true });
  const 머리 = JSON.stringify({ t: 'meta', model: 'm' }) + '\n';
  const 성한 = join(sessionsDir(방), '20260901-090000.jsonl');
  writeFileSync(성한, 머리 + JSON.stringify({ t: 'msg', m: { role: 'user', content: '어제 일' } }) + '\n', 'utf8');
  const 어제 = new Date(Date.now() - 86400000);
  utimesSync(성한, 어제, 어제);
  for (let i = 0; i < 25; i++) writeFileSync(join(sessionsDir(방), `20260915-1300${String(i).padStart(2, '0')}.jsonl`), 머리, 'utf8');
  check('★ (6회차 Y4) 머리글만 있는 빈 대화가 스물다섯 개 쌓여도 --continue 는 그 뒤의 성한 대화를 찾는다',
    latest(방)?.id === '20260901-090000', JSON.stringify(latest(방)?.id));
  rmSync(성한, { force: true });
  check('짝: 성한 대화가 없으면 여전히 없다고 한다', latest(방) === null, JSON.stringify(latest(방)?.id));
  rmSync(방, { recursive: true, force: true });
}

/*
 * ── 8회차 판정 · 할 일과 시킨 말이 디스크에 영영 안 적혔다 ─────────────
 *
 * `#살림되살리기` 는 파일에서 읽은 것이 없으면 세션이 들고 있던 값을 그대로
 * 두는데(맞다), 그러면서 `적은할일`·`적은요청` 을 **세션 값으로** 채웠다.
 * 그 둘은 「여기까지는 이미 적었다」 는 표식이다. 한 줄도 안 적고 적었다고
 * 표시했으니, 뒤이은 `살림적기` 는 「안 바뀜」 으로 보고 **영영 안 적는다.**
 *
 * 374–379 주석이 바로 이 길을 적어 뒀다 — 「못 적었는데 적은 셈으로 표시해
 * 두면 … 여기가 바로 남은 할 일과 시킨 말이 조용히 없어지던 길이다.」
 * 그 주석 바로 위에서 같은 일이 벌어지고 있었다. 반쪽 붙은 고침이다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-살림적기-'));
  const conn0 = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: '', model: 'm', ctx: 8000 };
  const 세션 = new Session(conn0, { root: 방 });
  세션.할일 = [{ text: '인코딩 고치기', state: 'doing' }];
  세션.이번요청 = '파일 인코딩을 안 깨지게 해줘';

  const 가게 = new Store(방);
  가게.begin({ model: 'm', root: 방 });
  가게.살림따라가기(세션);
  가게.append({ role: 'user', content: '해줘' });
  가게.살림적기();

  const 적힌것 = readFileSync(가게.file, 'utf8');
  check('★★★ 세션이 들고 있던 할 일이 디스크에 적힌다',
    /"t":"todo"/.test(적힌것), 적힌것.split('\n').map((l) => l.slice(0, 24)).join(' | ').slice(0, 160));
  check('★★★ 세션이 들고 있던 시킨 말도 디스크에 적힌다',
    /"t":"request"/.test(적힌것), 적힌것.split('\n').map((l) => l.slice(0, 24)).join(' | ').slice(0, 160));

  const 다시 = new Store(방, 가게.id).load();
  check('  그래서 껐다 켜도 그대로 돌아온다',
    다시.할일?.[0]?.text === '인코딩 고치기' && 다시.이번요청 === '파일 인코딩을 안 깨지게 해줘',
    JSON.stringify({ 할일: 다시.할일, 요청: 다시.이번요청 }));

  // 빈 세션까지 적지는 않는다 — 안 바뀐 것은 한 줄도 안 늘린다는 약속 그대로.
  const 방2 = mkdtempSync(join(tmpdir(), 'deel-살림빈-'));
  const 빈세션 = new Session(conn0, { root: 방2 });
  const 가게2 = new Store(방2);
  가게2.begin({ model: 'm', root: 방2 });
  가게2.살림따라가기(빈세션);
  가게2.살림적기();
  check('★ 아무것도 없는 세션은 빈 줄을 안 늘린다',
    !/"t":"todo"|"t":"request"/.test(readFileSync(가게2.file, 'utf8')),
    readFileSync(가게2.file, 'utf8').split('\n').map((l) => l.slice(0, 20)).join(' | '));

  rmSync(방, { recursive: true, force: true });
  rmSync(방2, { recursive: true, force: true });
}

/*
 * ── 8회차 판정 · 되감기 한 번이 다음 되감기를 막았다 ───────────────────
 *
 * `#쪽지빼기` 는 박힌 쪽지를 뺄 때 **새 객체**를 짓는다. 그 머리말이 「새 객체를
 * 지으면 턴표·박은쪽지 표가 그 메시지를 못 알아본다」 고 적어 뒀는데, 챙긴 것은
 * 박은쪽지 하나뿐이었다. 턴표는 안 옮겼다.
 *
 * 그래서 되감기 뒤 `#턴표.filter((x) => messages.includes(x.표))` 가 그 턴을
 * 통째로 떨어뜨린다 — 메시지는 멀쩡히 남아 있는데 걷을 자리를 못 찾아
 * **다음 `/undo` 가 「걷은것: 0」 으로 끝난다.**
 */
{
  const conn0 = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: '', model: 'm', ctx: 8000 };
  const s = new Session(conn0, { root });
  s.턴시작(1);
  s.push({ role: 'user', content: '첫 턴 일' });
  s.push({ role: 'assistant', content: '했습니다' });
  s.턴시작(2);
  s.push({ role: 'user', content: '둘째 턴 일' });
  s.push({ role: 'assistant', content: '했습니다2' });

  const 자리앞 = s.턴자리();
  check('먼저: 턴이 둘로 잡혔다 (이 검사의 밑천)', 자리앞.length >= 2, JSON.stringify(자리앞.map((x) => x.턴)));

  const 둘째 = 자리앞[자리앞.length - 1].턴;
  const 첫째 = 자리앞[자리앞.length - 2].턴;
  const r2 = s.되감기([둘째]);
  check('  둘째 턴은 걷힌다', r2.걷은것 > 0, JSON.stringify(r2));
  check('★★★ 되감기 한 뒤에도 앞 턴의 자리가 남아 있다',
    s.턴자리().some((x) => x.턴 === 첫째), JSON.stringify(s.턴자리().map((x) => x.턴)));
  const r1 = s.되감기([첫째]);
  check('★★★ 그래서 다음 되감기가 실제로 걷는다',
    r1.걷은것 > 0, JSON.stringify(r1));
}

/*
 * ── 8회차 판정 · 빈 글로 적은 시킨 말이 안 되살아난다 ────────────────────
 *
 * 파일에 `""` 로 적힌 시킨 말은 「빈 것으로 적혔다」 이고 `null` 은 「적힌 적이
 * 없다」 다. 507–508 이 그렇게 갈라 놓고 되살리는 쪽만 `if (이번요청)` 이라,
 * 빈 글이 falsy 로 떨어져 **세션이 들고 있던 옛 말**이 그대로 남았다.
 * 되감기 직후(이번요청 = "")에 갈래를 바꾸면 방금 되돌린 일이 되살아난다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), "deel-빈요청-"));
  const conn0 = { kind: "openai", base: "http://127.0.0.1:1/v1", auth: "none", key: "", model: "m", ctx: 8000 };
  const 가게 = new Store(방, "빈요청-001");
  가게.begin({ model: "m", base: "http://127.0.0.1:1", root: 방 });
  appendFileSync(가게.file, JSON.stringify({ t: "request", at: new Date().toISOString(), 글: "" }) + String.fromCharCode(10));

  const 세션 = new Session(conn0, { root: 방 });
  세션.이번요청 = "되돌리기 전에 시킨 옛 말";
  가게.살림따라가기(세션);
  check("★★★ 파일에 빈 글로 적힌 시킨 말이 그대로 되살아난다",
    세션.이번요청 === "", JSON.stringify(세션.이번요청));

  // 반대쪽 — 적힌 적이 없으면(null) 세션이 들고 있던 것을 그대로 둔다.
  const 가게2 = new Store(방, "빈요청-002");
  가게2.begin({ model: "m", base: "http://127.0.0.1:1", root: 방 });
  const 세션2 = new Session(conn0, { root: 방 });
  세션2.이번요청 = "안 덮여야 하는 말";
  가게2.살림따라가기(세션2);
  check("  적힌 적이 없으면 세션 값을 안 덮는다",
    세션2.이번요청 === "안 덮여야 하는 말", JSON.stringify(세션2.이번요청));

  rmSync(방, { recursive: true, force: true });
}

/*
 * ── 8회차 판정 · 쪽지를 뺀 메시지가 턴표에서 떨어진다 ────────────────────
 *
 * `#쪽지빼기` 는 쪽지를 빼면서 **새 객체**를 짓는다. 그 메시지가 어떤 턴의
 * 자리표이기도 하면, 되감기 끝의 `#턴표.filter(messages.includes(x.표))` 가
 * 그 턴을 통째로 떨어뜨린다 — 메시지는 멀쩡히 남아 있는데 **다음 `/undo` 가
 * 「걷은것 0」 으로 끝난다.**
 */
{
  const conn0 = { kind: "openai", base: "http://127.0.0.1:1/v1", auth: "none", key: "", model: "m", ctx: 8000 };
  const s = new Session(conn0, { root });
  s.턴시작(1);
  s.push({ role: "user", content: "첫 턴 일 [박은쪽지]" });
  s.push({ role: "assistant", content: "했습니다" });
  s.턴시작(2);
  s.push({ role: "user", content: "둘째 턴 일" });
  s.push({ role: "assistant", content: "했습니다2" });

  const 앞자리 = s.턴자리();
  const 첫째 = 앞자리[앞자리.length - 2];
  const 둘째 = 앞자리[앞자리.length - 1];
  // 둘째 턴이 박은 쪽지가 **첫째 턴의 자리표 메시지**에 들어 있다 (접으면 이렇게 된다).
  const 첫말 = s.messages[첫째.자리];
  s.박은쪽지표시(첫말, "[박은쪽지]");
  check("먼저: 자리표 메시지에 그 쪽지가 들어 있다 (이 검사의 밑천)",
    String(첫말.content).includes("[박은쪽지]"), String(첫말.content));

  s.되감기([둘째.턴]);
  check("  되감으면 그 쪽지는 빠진다",
    !s.messages.some((m) => String(m?.content ?? "").includes("[박은쪽지]")),
    JSON.stringify(s.messages.map((m) => m?.content)));
  check("★★★ 쪽지를 뺐어도 그 메시지의 턴 자리는 남아 있다",
    s.턴자리().some((x) => x.턴 === 첫째.턴), JSON.stringify(s.턴자리().map((x) => x.턴)));
  const 뒤것 = s.되감기([첫째.턴]);
  check("★★★ 그래서 다음 되감기가 실제로 걷는다", 뒤것.걷은것 > 0, JSON.stringify(뒤것));
}

/*
 * ── 새로 연 창(우리가 지은 이름)도 남이 적는지 본다 (2.0.2 · 527) ──────────────
 *
 * 다른 창이 `--continue` 로 이 대화를 집어 오면, 뒤에 연 창만 멈추고 먼저 연 창은 그 창의
 * 줄 사이에 제 줄을 섞었다. 접으면 그 창의 줄을 통째로 지웠다. 먼저 적은 쪽이 이어 간다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-store-527-'));
  const 가 = new Store(방).begin({ model: '검사용', root: 방 });   // 새로 연 창 — 이름은 우리가 지었다
  const 나 = new Store(방, 가.id).begin({ model: '검사용', root: 방 });   // 다른 창이 --continue 로 같은 대화를 연다
  나.append({ role: 'user', content: '나 창이 먼저 적는다' });
  가.append({ role: 'user', content: '가 창이 섞어 적는다' });
  const 글 = readFileSync(가.file, 'utf8');
  check('★★ 527 지은 이름의 창도 남이 적은 뒤에는 섞어 적지 않는다',
    가.auto && !글.includes('가 창이 섞어 적는다') && 가.못쓴것()?.까닭 === 'OTHER_WINDOW', JSON.stringify(가.못쓴것()));
  가.replace([{ role: 'user', content: '가 창의 요약' }], '압축');
  check('★★ 527 그리고 접기로 남의 줄을 지우지 않는다', readFileSync(가.file, 'utf8').includes('나 창이 먼저 적는다'));
  나.append({ role: 'user', content: '나 창이 이어 적는다' });
  check('  먼저 적은 쪽은 그대로 이어 적는다', readFileSync(가.file, 'utf8').includes('나 창이 이어 적는다') && !나.못쓴것(), JSON.stringify(나.못쓴것()));
  rmSync(방, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });

const G ='\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n대화 저장·이어하기 검사  ' + D + '(껐다 켜도 이어지는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
