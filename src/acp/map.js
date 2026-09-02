// deel 이 흘리는 것을 ACP 가 아는 모양으로 옮긴다.
//
// ── 왜 옮기는 자리를 따로 두나 ──────────────────────────────────────────
//
// 붙이는 일의 값어치는 대부분 여기 있다. 관을 잇는 것은 한 시간이면 되지만,
// **에디터가 무엇을 보여 줄 수 있는가** 는 전부 이 표에서 갈린다.
//
//   갈래(kind)를 안 주면 → 전부 똑같은 회색 점으로 그려진다
//   자리(locations)를 안 주면 → 고친 파일을 눌러도 안 열린다
//   상태(status)를 안 주면 → 도는 중인지 끝났는지 안 보인다
//
// 이 셋은 있어도 없어도 규격에는 안 걸린다. 그래서 대충 붙인 구현은 죄다
// 안 준다. 여기서만 챙기면 같은 프로토콜을 쓰고도 화면이 달라진다.
//
// ── 순수하게 둔다 ───────────────────────────────────────────────────────
//
// 이 파일은 아무것도 안 부르고 아무 데도 안 쓴다. 값을 넣으면 값이 나온다.
// 그래야 진짜 에디터 없이 검사할 수 있다 — 붙인 것이 맞는지 확인하려고
// Zed 를 띄워야 한다면 아무도 확인 안 하게 된다.

/**
 * 도구 이름 → ACP 갈래.
 *
 * 규격이 정한 낱말만 쓴다: read·edit·delete·move·search·execute·think·fetch·
 * switch_mode·other. 모르는 것은 other 다 — 지어내면 클라이언트가 못 알아본다.
 */
const 갈래표 = {
  Read: 'read',
  Outline: 'read',
  Write: 'edit',
  Append: 'edit',
  Edit: 'edit',
  Glob: 'search',
  Grep: 'search',
  Recall: 'search',
  Bash: 'execute',
  Jobs: 'execute',
  Verify: 'execute',
  WebFetch: 'fetch',
  Task: 'think',
  TodoWrite: 'think',
  Skill: 'think',
  Remember: 'other',
};

export function 도구갈래(이름) {
  return 갈래표[String(이름 ?? '')] ?? 'other';
}

/**
 * 사람이 읽을 한 줄.
 *
 * `Read` 만 적으면 열 줄이 전부 `Read` 다. 무엇을 읽었는지가 빠지면 목록을
 * 훑어보는 뜻이 없어진다 — 그럴 거면 아예 안 보여 주는 편이 낫다.
 */
export function 도구이름표(이름, 인자) {
  const a = 인자 ?? {};
  const 첫 = a.file_path ?? a.pattern ?? a.path ?? a.url ?? a.name ?? a.purpose ?? a.목적
    ?? (a.command ? String(a.command).replace(/\s+/g, ' ') : null)
    ?? (Array.isArray(a.files) && a.files.length
      ? `${a.files[0]?.file_path ?? '?'}${a.files.length > 1 ? ` 외 ${a.files.length - 1}개` : ''}`
      : null)
    ?? (Array.isArray(a.edits) && a.edits.length
      ? `${a.edits[0]?.file_path ?? '?'}${a.edits.length > 1 ? ` 외 ${a.edits.length - 1}군데` : ''}`
      : null)
    ?? (Array.isArray(a.paths) && a.paths.length ? `${a.paths.length}개` : null)
    ?? (Array.isArray(a.todos) ? `${a.todos.length}건` : null);
  const 안 = 첫 == null ? '' : 자르기(String(첫), 80);
  return 안 ? `${이름}(${안})` : String(이름 ?? '도구');
}

/**
 * 이 호출이 건드린 파일 자리.
 *
 * 결과에 실린 실제 경로(changed)를 먼저 본다. 인자에 적힌 것은 상대 경로일 수
 * 있는데, 에디터는 절대 경로라야 연다. 인자만 보고 넘기면 눌러도 안 열리는
 * 링크가 되고, 그건 없느니만 못하다.
 */
export function 도구자리(이름, 인자, 결과) {
  const 모은것 = [];
  const 넣기 = (p) => {
    const s = typeof p === 'string' ? p.trim() : '';
    if (s && !모은것.includes(s)) 모은것.push(s);
  };

  넣기(결과?.changed);
  for (const x of 결과?.여럿 ?? []) 넣기(x?.changed);

  const a = 인자 ?? {};
  넣기(a.file_path);
  넣기(a.path);
  for (const f of Array.isArray(a.files) ? a.files : []) 넣기(f?.file_path);
  for (const e of Array.isArray(a.edits) ? a.edits : []) 넣기(e?.file_path);
  for (const p of Array.isArray(a.paths) ? a.paths : []) 넣기(p);

  return 모은것.slice(0, 20).map((path) => ({ path }));
}

/**
 * 도구가 실제로 탈이 났는가.
 *
 * `error` 만 보면 안 된다. Bash 는 종료코드를, Verify 는 "탈 2개" 를 요약에
 * 담아 돌려준다 — 그것들을 성공으로 칠하면 화면에서 성공과 구별되지 않는다.
 * `deel run` 쪽에서 이미 한 번 데인 자리라 여기서도 같은 눈으로 본다.
 */
export function 도구탈났나(결과) {
  return !!(결과?.error || 결과?.failed);
}

/**
 * 도구 결과를 ACP 가 그릴 수 있는 내용으로.
 *
 * 모델에게 가는 본문을 그대로 실으면 안 된다. 파일 하나를 읽어도 수만 자가
 * 오는데, 그것이 전부 에디터 창으로 흘러가면 사람이 아무것도 못 읽는다.
 * 보여 줄 만큼만 자른다 — 모델이 받는 양은 이것과 무관하게 그대로다.
 */
export function 도구내용(결과, 최대 = 2000) {
  const r = 결과 ?? {};
  const 글 = r.error
    ? String(r.error)
    : (r.content != null ? String(r.content) : (r.summary != null ? String(r.summary) : ''));
  if (!글.trim()) return [];
  return [{ type: 'content', content: { type: 'text', text: 자르기(글, 최대) } }];
}

/**
 * 한 걸음 끝난 도구 호출을 ACP 한 덩이로.
 *
 * @param {string} 아이디  이 세션 안에서 유일한 번호
 * @param {object} ev      loop.js 가 흘린 `tool` 이벤트
 */
export function 도구끝남(아이디, ev) {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: 아이디,
    title: 도구이름표(ev?.name, ev?.args),
    kind: 도구갈래(ev?.name),
    status: 도구탈났나(ev?.result) ? 'failed' : 'completed',
    content: 도구내용(ev?.result),
    locations: 도구자리(ev?.name, ev?.args, ev?.result),
  };
}

/** 이제 막 시작한 도구 호출. */
export function 도구시작(아이디, 이름, 인자) {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: 아이디,
    title: 도구이름표(이름, 인자),
    kind: 도구갈래(이름),
    status: 'in_progress',
    content: [],
    locations: 도구자리(이름, 인자, null),
  };
}

/**
 * deel 이 턴을 끝낸 까닭 → ACP 가 아는 낱말.
 *
 * 규격이 가진 낱말은 다섯뿐이다: end_turn·max_tokens·max_turn_requests·
 * refusal·cancelled. deel 의 '헛돎' 은 여기 딱 맞는 것이 없다.
 *
 * refusal 로 보내고 싶은 마음이 들지만 그러면 안 된다 — 규격은 refusal 일 때
 * "그 사용자 말과 그 뒤의 것은 다음 프롬프트에 넣지 말라" 고 적어 두었다.
 * deel 은 헛돌았을 때 대화를 버리지 않는다. 그래서 end_turn 으로 보내고,
 * **왜 멈췄는지는 말로 따로 흘려 준다**. 낱말이 안 맞으면 낱말을 억지로 맞추는
 * 대신 사람이 읽을 것을 준다.
 */
export function 멈춘까닭(까닭) {
  switch (까닭) {
    case 'aborted': return 'cancelled';
    case 'limit': return 'max_turn_requests';
    case 'stuck': return 'end_turn';
    default: return 'end_turn';
  }
}

/**
 * 메시지 하나에서 사람이 읽을 글만 뽑는다.
 *
 * content 는 글 한 덩어리일 때도 있고, 그림이 섞인 배열일 때도 있다
 * (backend/vision.js). 배열에서 글만 빼고 그림은 조용히 버리면, 되살린
 * 화면에서 "이 말을 왜 했는지" 가 사라진다 — 몇 장이 붙어 있었는지는 적는다.
 */
function 글만(m) {
  const c = m?.content;
  let 글 = '';
  let 장수 = Array.isArray(m?.images) ? m.images.length : 0;   // ollama 규격
  if (typeof c === 'string') 글 = c;
  else if (Array.isArray(c)) {
    const 조각 = [];
    for (const p of c) {
      if (p?.type === 'text' && typeof p.text === 'string') 조각.push(p.text);
      else if (p?.type === 'image_url') 장수++;
    }
    글 = 조각.join('\n');
  }
  글 = 글.trim();
  if (장수) 글 = 글 ? `${글}\n\n_(그림 ${장수}장)_` : `_(그림 ${장수}장)_`;
  return 글;
}

/** 저장된 도구 인자. 규격에 따라 글일 수도, 이미 풀린 것일 수도 있다. */
function 인자풀기(x) {
  if (x && typeof x === 'object') return x;
  if (typeof x !== 'string' || !x.trim()) return {};
  try { return JSON.parse(x); } catch { return {}; }
}

/**
 * 저장된 대화를 에디터에 다시 흘려 줄 알림 묶음으로.
 *
 * ── 왜 이 자리가 필요한가 ───────────────────────────────────────────────
 *
 * session/load 는 "지난 대화를 되살려라" 는 부름인데, 규격에는 되살린 것을
 * **답으로 돌려주는 자리가 없다.** 오간 말을 전부 session/update 로 다시
 * 흘려야 한다. 그러니까 에디터가 그리는 지난 대화는 여기서 만든 것이 전부다 —
 * 여기서 빠뜨린 것은 화면에서 통째로 사라지고, 사람은 기록이 날아간 줄 안다.
 *
 * 도구 호출은 시작·끝 두 번으로 안 나눈다. 이미 끝난 일을 '도는 중' 으로 한 번
 * 그렸다가 고칠 까닭이 없다. 끝난 모습 한 덩이만 준다.
 *
 * @param {object[]} messages  store.js 가 읽어 온 대화
 * @returns {object[]} session/update 의 update 자리에 그대로 넣을 것들
 */
export function 되살린것(messages, { 최대내용 = 2000 } = {}) {
  const 줄 = Array.isArray(messages) ? messages : [];

  /*
   * 도구 답을 먼저 줄 세운다.
   *
   * 답(role:'tool')은 부름보다 뒤에 온다. 앞에서부터 한 번에 그리려면 미리
   * 찾아 둬야 한다. OpenAI 규격은 id 로 짝을 짓고, ollama 규격은 id 를 안 주므로
   * 이름별 차례로 짝을 짓는다 (session.js 의 repairToolPairs 와 같은 눈).
   */
  const id로 = new Map();
  const 이름으로 = new Map();
  for (const m of 줄) {
    if (m?.role !== 'tool') continue;
    if (m.tool_call_id != null) id로.set(m.tool_call_id, m.content);
    else if (m.tool_name) {
      const q = 이름으로.get(m.tool_name) ?? [];
      q.push(m.content);
      이름으로.set(m.tool_name, q);
    }
  }

  const 나온것 = [];
  let 말번호 = 0;
  let 도구번호 = 0;

  for (const m of 줄) {
    if (!m || typeof m !== 'object') continue;
    // 시스템 프롬프트는 사람이 한 말이 아니다. 되살리면 매번 대화 머리에
    // 수천 자짜리 지시문이 붙어서, 정작 무슨 얘기를 했는지가 안 보인다.
    if (m.role === 'system' || m.role === 'tool') continue;

    if (m.role === 'user') {
      const 글 = 글만(m);
      if (글) 나온것.push({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 글 } });
      continue;
    }
    if (m.role !== 'assistant') continue;

    말번호++;
    const 생각 = typeof m.thinking === 'string' ? m.thinking.trim() : '';
    if (생각) {
      나온것.push({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 자르기(생각, 최대내용) },
        messageId: `h${말번호}`,
      });
    }
    const 글 = 글만(m);
    if (글) {
      나온것.push({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 글 },
        messageId: `h${말번호}`,
      });
    }

    for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
      const fn = tc?.function ?? tc ?? {};
      const 이름 = String(fn.name ?? tc?.name ?? '도구');
      const 인자 = 인자풀기(fn.arguments ?? fn.args ?? tc?.args);

      let 답;
      if (tc?.id != null && id로.has(tc.id)) 답 = id로.get(tc.id);
      else {
        const q = 이름으로.get(이름);
        if (q?.length) 답 = q.shift();
      }

      /*
       * 답이 안 남은 부름 = 그때 프로그램이 도구 도는 중에 끊긴 것이다.
       *
       * 성공으로 그리면 안 된다. 그 도구가 끝까지 갔는지 아닌지가 다음에 무엇을
       * 시킬지를 정한다 — 파일을 고치던 중이었을 수도 있다.
       */
      const 없음 = 답 === undefined || 답 === null;
      나온것.push({
        sessionUpdate: 'tool_call',
        toolCallId: `h${말번호}-${++도구번호}`,
        title: 도구이름표(이름, 인자),
        kind: 도구갈래(이름),
        // 남은 글만 보고 성공·실패를 점치지 않는다. 도구마다 실패를 적는 말이
        // 달라서, 맞히려 들면 멀쩡한 것을 빨갛게 칠하게 된다.
        status: 없음 ? 'failed' : 'completed',
        content: 없음
          ? [{ type: 'content', content: { type: 'text', text: '결과가 안 남았습니다 — 이 도구가 도는 중에 끊겼습니다.' } }]
          : [{ type: 'content', content: { type: 'text', text: 자르기(String(답), 최대내용) } }],
        locations: 도구자리(이름, 인자, null),
      });
    }
  }

  return 나온것;
}

/**
 * 프롬프트로 온 덩이들에서 글만 뽑는다.
 *
 * resource 는 알맹이가 실려 오므로 그대로 쓴다. resource_link 는 주소만 오는데,
 * 그래도 주소를 적어 준다 — 모델이 그 자리를 Read 로 열어 볼 수 있다.
 * 그림·소리는 읽을 방법이 없다. 조용히 버리지 않고 무엇을 못 읽었는지 적는다.
 */
export function 프롬프트글(덩이들) {
  const 조각 = [];
  for (const b of Array.isArray(덩이들) ? 덩이들 : []) {
    if (!b || typeof b !== 'object') continue;
    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string' && b.text) 조각.push(b.text);
        break;
      case 'resource': {
        const r = b.resource ?? {};
        if (typeof r.text === 'string' && r.text) {
          조각.push(`--- ${r.uri ?? '붙임'} ---\n${r.text}`);
        } else if (r.uri) {
          조각.push(`(붙임: ${r.uri} — 글이 아니라 못 읽었습니다)`);
        }
        break;
      }
      case 'resource_link':
        if (b.uri) 조각.push(`(붙임: ${b.uri})`);
        break;
      case 'image':
      case 'audio':
        조각.push(`(${b.type === 'image' ? '그림' : '소리'}이 붙어 왔지만 이 모델로는 못 읽습니다)`);
        break;
      default:
        break;
    }
  }
  return 조각.join('\n\n').trim();
}

function 자르기(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}\n… (${t.length - n}자 줄임)` : t;
}
