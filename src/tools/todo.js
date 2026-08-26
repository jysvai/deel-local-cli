// 할 일 목록. 긴 작업에서 모델이 길을 잃지 않게 붙잡아 준다.
//
// 왜 필요한가:
//   "이거 세 군데 고치고 테스트 돌려줘" 같은 일을 시키면, 도구를 열댓 번 부르는 사이
//   모델이 처음 시킨 것 중 하나를 슬그머니 빠뜨린다. 컨텍스트가 접히면 더 심해진다.
//   목록을 눈에 보이게 들고 있으면 그 일이 크게 준다.
//
// 규칙 하나: 진행 중은 한 번에 하나.
//   여러 개를 한꺼번에 '하는 중' 으로 두면 결국 아무것도 안 끝난다.
//   여기서 막아 두면 모델이 순서를 정하고 하나씩 닫는다.

export const STATES = ['todo', 'doing', 'done'];

const 표시 = { todo: '☐', doing: '▶', done: '☑' };

function 정리(items) {
  const out = [];
  for (const [i, x] of (items ?? []).entries()) {
    const text = String(x?.text ?? x?.content ?? '').trim();
    if (!text) continue;
    let state = String(x?.state ?? x?.status ?? 'todo').toLowerCase();
    if (state === 'in_progress' || state === 'in-progress') state = 'doing';
    if (state === 'completed' || state === 'complete') state = 'done';
    if (state === 'pending') state = 'todo';
    if (!STATES.includes(state)) state = 'todo';
    out.push({ id: i + 1, text: text.slice(0, 200), state });
  }
  return out;
}

export function render(items) {
  if (!items.length) return '할 일이 없습니다.';
  const 남은 = items.filter((x) => x.state !== 'done').length;
  const lines = items.map((x) => `${표시[x.state]} ${x.text}`);
  lines.push('', `${items.length}개 중 ${items.length - 남은}개 완료`);
  return lines.join('\n');
}

export const TODO_TOOL = {
  schema: {
    name: 'TodoWrite',
    /*
     * 문장 차례가 곧 중요도다.
     *
     * 창이 좁으면 tools/index.js 가 **뒤에서부터 문장째로 잘라 낸다**(설명길이).
     * 그러니 규격(state·doing)이 뒤에 있으면 작은 모델에서 조용히 사라진다.
     * 규격 → 규칙 → 조언 차례로 둔다.
     *
     * '세 단계 이상 걸리는 일이면' 이라고 적었더니 모델이 그걸 **세 개를 적으라는
     * 말**로 읽었다. 열 단계짜리 일도 세 줄로 뭉쳐 나왔다. 그래서 개수 이야기를
     * 따로 못 박는다 — 개수는 일의 크기가 정하는 것이고 상한이 없다.
     */
    description:
      '할 일 목록을 만들고 갱신한다. 여러 단계가 걸리는 일이면 먼저 목록을 만들고, '
      + '하나를 끝낼 때마다 바로 갱신한다. 목록 전체를 매번 통째로 보낸다. '
      + 'state 는 todo(아직) / doing(하는 중) / done(끝) 셋 중 하나이고, doing 은 한 번에 하나만 둔다. '
      + '단계 수는 일의 크기가 정한다 — 정해진 개수도 상한도 없다. '
      + '개수를 맞추려고 다른 일을 한 줄에 뭉치지 마라. '
      + '각 단계는 끝났는지 따로 확인할 수 있는 크기로 적어라.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          // 인자 설명은 따로 잘리므로, 개수 이야기를 여기에도 한 번 둔다.
          // 창이 좁아 바깥 설명이 잘려 나가도 이건 남는다.
          description: '할 일 전체 목록. 개수 제한 없음 — 일의 크기만큼 적는다',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: '무엇을 할지 한 줄' },
              state: { type: 'string', enum: STATES, description: 'todo / doing / done' },
            },
            required: ['text', 'state'],
          },
        },
      },
      required: ['todos'],
    },
  },

  run(args, ctx) {
    const items = 정리(args?.todos);
    if (!items.length) return { error: '할 일이 비어 있습니다.' };

    const 하는중 = items.filter((x) => x.state === 'doing');
    if (하는중.length > 1) {
      return {
        error: `'하는 중' 은 한 번에 하나만 둡니다. 지금 ${하는중.length}개입니다: `
          + 하는중.map((x) => x.text).join(', ')
          + '\n  하나만 doing 으로 두고 나머지는 todo 로 되돌리세요.',
      };
    }

    const 이전 = ctx.todos ?? [];
    ctx.todos = items;

    const 끝난것 = items.filter((x) => x.state === 'done').length;
    const 새로끝난 = items.filter((x) =>
      x.state === 'done' && !이전.some((y) => y.text === x.text && y.state === 'done'));

    return {
      content: render(items),
      summary: `${끝난것}/${items.length} 완료${새로끝난.length ? ` · 방금 ${새로끝난.length}개` : ''}`,
      todos: items,
    };
  },
};
