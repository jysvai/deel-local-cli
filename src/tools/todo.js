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

import { 말 } from '../i18n/index.js';

/* 결과 한 줄을 잇는다 — 빈 조각은 버린다(tools/index.js 의 이어 와 같은 것). */
const 이어 = (...조각들) => 조각들.filter((x) => x != null && String(x) !== '').join(' · ');
const STATES = ['todo', 'doing', 'done'];

const 표시 = { todo: '☐', doing: '▶', done: '☑' };

/**
 * 받은 줄을 다듬는다. **버린 줄은 세어서 같이 돌려준다.**
 *
 * 여태 text 없는 줄을 여기서 조용히 버렸다. 그게 이 도구가 막으라고 있는 바로 그 일이다 —
 * 세 줄을 보냈는데 두 줄이 저장되고, 사라진 한 줄에 대해 아무도 아무 말을 안 했다.
 * 무엇을 못 받았는지는 부르는 쪽이 사람에게 말해야 하므로, 버린 줄의 칸 이름까지 들려 보낸다.
 *
 * @returns {{목록: object[], 버린칸: string[], 버린수: number}}
 */
function 정리(items) {
  const out = [];
  const 버린칸 = [];
  let 버린수 = 0;
  for (const [i, x] of (items ?? []).entries()) {
    const text = String(x?.text ?? x?.content ?? '').trim();
    if (!text) {
      버린수 += 1;
      if (x && typeof x === 'object') 버린칸.push(...Object.keys(x));
      continue;
    }
    let state = String(x?.state ?? x?.status ?? 'todo').toLowerCase();
    if (state === 'in_progress' || state === 'in-progress') state = 'doing';
    if (state === 'completed' || state === 'complete') state = 'done';
    if (state === 'pending') state = 'todo';
    if (!STATES.includes(state)) state = 'todo';
    out.push({ id: i + 1, text: text.slice(0, 200), state });
  }
  return { 목록: out, 버린칸, 버린수 };
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
    /*
     * ── 배열이 아니면 **무엇을 보내야 하는지** 말한다 (사냥5 L4) ────────────
     *
     * 여기는 받은 것을 그대로 정리() 에 넘겼다. 그래서 `todos: "할 일"` 이 오면
     * `(items ?? []).entries is not a function` 이라는 날것 TypeError 가 도구 결과로
     * 나갔다. 모델은 그 말에서 고칠 자리를 못 찾고 같은 모양으로 또 보낸다.
     *
     * 글자로 싼 JSON 배열(`"[{\"text\":…}]"`)은 풀어서 받는다 — 모델이 인자를 한 겹
     * 더 싸서 보내는 일은 흔하고, 뜻은 분명하다. 그 밖의 것은 꼴을 적어 돌려보낸다.
     */
    let 받은것 = args?.todos;
    if (typeof 받은것 === 'string') {
      try { const 푼것 = JSON.parse(받은것); if (Array.isArray(푼것)) 받은것 = 푼것; } catch { /* 아래에서 꼴을 알려 준다 */ }
    }
    if (받은것 != null && !Array.isArray(받은것)) {
      return {
        error: `todos 는 배열이어야 합니다 (받은 것: ${typeof 받은것}). `
          + '[{"text": "할 일 한 줄", "state": "todo"}, …] 꼴로 목록 전체를 보내세요.',
      };
    }
    const { 목록: items, 버린칸, 버린수 } = 정리(받은것);
    /*
     * 「할 일이 비어 있습니다」 한 줄은 셋을 못 가른다 — todos 칸을 빼먹었나
     * (`{tasks: […]}`), 줄마다 text 가 없나(`{title: …}`), 정말 빈 목록인가.
     * 앞 둘은 위 L4 와 같은 자리다: 모델은 고칠 곳을 못 찾고 같은 꼴로 또 보낸다.
     * 그래서 받은 칸 이름과 보낼 꼴을 같이 돌려준다. 칸 이름은 모델이 지은 것이라
     * 여덟 개·마흔 자에서 자른다. (6회차 할일6aq-b T2)
     */
    const 꼴 = 'todos 에 [{"text": "할 일 한 줄", "state": "todo"}, …] 꼴로 목록 전체를 보내세요.';
    const 칸들 = (것들) => [...new Set(것들)].slice(0, 8).map((k) => String(k).slice(0, 40)).join(', ') || '없음';
    if (!items.length) {
      // ── 비었으면 **왜 비었는지** 가른다 (6회차 할일6aq-b T2) ─────────────────
      if (받은것 == null) {
        return { error: `todos 칸이 없습니다 (받은 칸: ${칸들(Object.keys(args ?? {}))}). ${꼴}` };
      }
      if (받은것.length) {
        return { error: `할 일 줄마다 비어 있지 않은 text 가 있어야 합니다 (받은 칸: ${칸들(버린칸)}). ${꼴}` };
      }
      return { error: `할 일이 비어 있습니다. ${꼴}` };
    }
    /*
     * ── 버린 줄이 있으면 **말한다** (8회차 확인) ──────────────────────────────
     *
     * 줄 전부에 text 가 없으면 위에서 말해 줬는데, **하나라도 성했으면** 그냥 성공이었다.
     * 세 줄을 보냈는데 두 줄짜리 목록이 아무 말 없이 저장되고, 빠진 할 일은 사라졌다.
     * 할 일이 사라지는 걸 막으려고 있는 도구가 할 일을 사라지게 하는 자리다.
     *
     * 반쪽짜리 목록을 저장하지 않는다. 저장해 두면 다음 갱신은 그 반쪽을 기준으로 삼고,
     * 사라진 줄은 영영 안 돌아온다. 몇 줄을 왜 못 받았는지 적어 통째로 다시 받는다.
     */
    if (버린수) {
      return {
        error: `할 일 ${버린수}줄에 비어 있지 않은 text 가 없어 받지 못했습니다 (그 줄들이 보낸 칸: ${칸들(버린칸)}).`
          + ` 반쪽짜리 목록은 저장하지 않았습니다 — ${꼴}`,
      };
    }

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

    /*
     * ── 똑같은 목록을 또 보냈으면 그렇다고 말한다 ────────────────────────
     *
     * 「폴더 정리 해줘」 에서 이 자리가 걸렸다. 모델이 파일을 옮긴 뒤
     * 목록을 갱신하려 했는데, 끝난 줄을 done 으로 안 바꾸고 **글자 하나
     * 안 틀린 같은 목록**을 다시 보냈다. 그러면 여기서는 성공으로 돌려주고
     * 「3개 중 1개 완료」 라는 앞과 똑같은 글이 나간다. 모델 쪽에서 보면
     * 갱신이 된 것이므로, 다음 걸음에 또 같은 것을 보낸다. 그렇게 세 번이면
     * 헛돈다고 판정돼 턴이 죽었다.
     *
     * 오류로 만들지는 않는다. 목록은 실제로 저장됐고, 틀린 것을 한 것도
     * 아니다. 다만 **아무 일도 안 일어났다는 사실**과 그럴 때 무엇을 해야
     * 하는지를 그 자리에서 알려 준다.
     */
    const 같은목록 = 이전.length === items.length
      && items.every((x, i) => 이전[i]?.text === x.text && 이전[i]?.state === x.state);
    if (같은목록) {
      return {
        content: `${render(items)}\n\n`
          + '이 목록은 앞에 보낸 것과 글자 하나까지 같습니다 — 바뀐 것이 없습니다.\n'
          + '방금 끝낸 일이 있으면 그 줄을 done 으로 바꿔서 보내고,'
          + ' 없으면 목록을 다시 보내지 말고 다음 일을 하세요.',
        summary: 말('sum.noChange'),
        todos: items,
        안바뀜: true,
      };
    }

    const 끝난것 = items.filter((x) => x.state === 'done').length;
    const 새로끝난 = items.filter((x) =>
      x.state === 'done' && !이전.some((y) => y.text === x.text && y.state === 'done'));

    return {
      content: render(items),
      summary: 이어(
        말('sum.doneOf', { 끝: 끝난것, 전체: items.length }),
        새로끝난.length ? 말('sum.justDone', { n: 새로끝난.length }) : '',
      ),
      todos: items,
    };
  },
};
