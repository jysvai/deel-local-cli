// 대화가 껐다 켜도 이어지는지 검증한다.
//
// 확인할 것:
//   1) 오간 대로 남고, 그대로 되살아나는가
//   2) 도중에 죽어도(마지막 줄이 잘려도) 앞부분은 성한가 — jsonl 을 쓴 이유
//   3) 도구 호출과 결과의 짝이 되살릴 때도 안 깨지는가
//   4) 압축이 일어난 뒤에도 파일이 대화와 맞는가
//   5) 목록에서 어떤 대화인지 알아볼 수 있는가
import { mkdtempSync, rmSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, list, latest, remove, newId, prune, sessionsDir } from '../src/agent/store.js';
import { repairToolPairs } from '../src/agent/session.js';

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

// ── 7. 없는 폴더에서도 안 죽는다 ────────────────────────────────────────
const 빈폴더 = mkdtempSync(join(tmpdir(), 'deel-empty-'));
check('대화 없는 폴더에서 빈 목록', list(빈폴더).length === 0);
check('대화 없는 폴더에서 latest 는 null', latest(빈폴더) === null);
rmSync(빈폴더, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n대화 저장·이어하기 검사  ' + D + '(껐다 켜도 이어지는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
