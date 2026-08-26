// 증거 — 「다 됐습니다」 대신 검토할 수 있는 것을 내놓는다.
//
// ── 왜 만드나 ───────────────────────────────────────────────────────────
//
// 2026년 조사로는 개발자의 **96%가 AI 가 쓴 코드를 온전히 믿지 않는데, 매번
// 확인하는 사람은 48%** 다. 38%는 "사람 코드보다 리뷰가 더 힘들다"고 답한다.
//
// 왜 더 힘든가. 사람이 낸 코드는 "왜 이렇게 했나" 를 물으면 답이 온다. 에이전트가
// 낸 코드는 **"끝났습니다" 한 줄**과 함께 온다. 그 한 줄은 검토할 수가 없다.
// 무엇을 근거로 끝났다고 하는지가 그 안에 없기 때문이다.
//
// 그래서 이 파일이 하는 일은 하나다 — **말을 증거로 바꾼다.**
//
//   무엇을 바꿨나   파일과 줄 수
//   무엇을 돌렸나   명령과 그 결과
//   무엇이 증명됐나 고친 **뒤에** 돌아서 **성공한** 것이 있는가
//
// ── 제일 중요한 칸 ──────────────────────────────────────────────────────
//
// 바꾼 것을 늘어놓는 일은 /diff 도 한다. 여기서만 하는 것은 **증명 안 된 것**을
// 증명 안 됐다고 말하는 것이다.
//
// 고쳐 놓고 아무것도 안 돌렸으면 아무것도 증명되지 않았다. 검사가 빨간데
// 돌리기는 했다고 초록으로 치면 그건 **빨간 검사를 증거로 내미는** 셈이다.
// 고치기 **전에** 돌린 검사는 고친 것을 증명하지 못한다 — "아까 돌렸으니 됐다" 가
// 제일 흔한 자기기만이다. 셋 다 여기서 걸러진다.
//
// ── 안 하는 것 ──────────────────────────────────────────────────────────
//
// 프롬프트에 안 싣는다. 이건 사람이 보는 것이지 모델에게 먹이는 것이 아니다.
// 실으면 컨텍스트만 먹고, 모델이 제가 만든 증거를 다시 읽는 이상한 고리가 생긴다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** 이 명령들은 '확인했다' 로 친다. 돌렸다고 다 증거가 되는 것은 아니다. */
const 확인하는명령 = /(^|[\s|;&])(npm|pnpm|yarn|bun)\s+(test|run\s+(test|check|lint|build|verify|typecheck))|(^|[\s|;&])(pytest|jest|vitest|mocha|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test|dotnet\s+test|tsc|eslint|ruff|mypy)\b/i;

/** 우리 쪽 확인 도구. Bash 를 안 거치고 확인하는 길이다. */
const 확인하는도구 = new Set(['Verify', 'Test']);

/**
 * 이번 대화의 증거를 모은다.
 *
 * @param {object} session
 * @param {object} o
 * @param {object} o.audit      safety/audit.js 의 Audit
 * @param {number} o.최근       감사기록을 몇 줄까지 볼까
 * @param {Date}   o.바꾼때     파일을 언제 고쳤다고 볼까 (검사가 고정할 수 있게)
 */
export function 증거모으기(session, { audit = null, 최근 = 400, 바꾼때 = null } = {}) {
  /*
   * 감사기록은 폴더에 하나뿐이고 계속 덧붙는다. 그대로 읽으면 **지난주에 돌린
   * 검사**가 오늘 고친 파일의 증거로 붙는다 — 증거를 모으는 도구가 거짓 증거를
   * 만드는 셈이다. 이번 세션 것만 본다.
   */
  const 이번세션 = audit?.session ?? null;
  const 기록 = (() => {
    try {
      const 전부 = audit?.recent?.(최근) ?? [];
      return 이번세션 ? 전부.filter((r) => r?.session === 이번세션) : 전부;
    } catch { return []; }
  })();

  // 돌린 것 — Bash 와 확인 도구만. 파일을 읽은 것까지 증거라고 하면 목록이
  // 길어지기만 하고, 읽은 것은 아무것도 증명하지 않는다.
  const 돌린것 = [];
  for (const r of 기록) {
    if (r?.kind !== 'tool') continue;
    const 도구 = String(r.tool ?? '');
    if (도구 !== 'Bash' && !확인하는도구.has(도구)) continue;
    돌린것.push({
      도구,
      무엇: String(r.target ?? ''),
      됐나: r.ok !== false,
      남긴말: r.ok === false ? `실패 — ${String(r.note ?? '').slice(0, 120)}` : String(r.note ?? '').slice(0, 120),
      때: r.at ?? null,
      확인인가: 확인하는도구.has(도구) || 확인하는명령.test(String(r.target ?? '')),
    });
  }

  const 확인시도 = 돌린것.filter((x) => x.확인인가);
  const 언제고쳤나 = 바꾼때 ? new Date(바꾼때).getTime() : null;

  const 바꾼것 = [];
  const 증명안된것 = [];
  for (const [파일, d] of session?.changes ?? new Map()) {
    // 고친 **뒤에** 돌린 확인만 본다.
    const 쓸것 = 확인시도.filter((x) => {
      if (언제고쳤나 == null || !x.때) return true;   // 시각을 모르면 순서를 안 따진다
      return new Date(x.때).getTime() >= 언제고쳤나;
    });
    /*
     * **마지막** 확인이 증거다. 성공한 것 중 마지막이 아니다.
     *
     * 빌드가 통과하고 그 뒤에 검사가 깨졌는데 앞의 초록을 들고 와서
     * "확인됐습니다" 하면 그게 거짓 증거다. 사람이 보는 순서로 생각하면
     * 답이 분명하다 — 마지막에 돌린 것이 빨간데 확인됐을 리가 없다.
     */
    const 마지막 = 쓸것.length ? 쓸것[쓸것.length - 1] : null;
    const 증명 = 마지막?.됐나 ? 마지막.무엇 : null;
    const 한줄 = { 파일, 더한줄: d.added ?? 0, 뺀줄: d.removed ?? 0, 고친횟수: d.times ?? 0, 증명 };
    바꾼것.push(한줄);
    if (!증명) {
      증명안된것.push({
        파일,
        왜: 왜못믿나(돌린것, 마지막, 언제고쳤나),
      });
    }
  }

  return {
    바꾼것,
    돌린것,
    증명안된것,
    // 화면이 한눈에 쓸 수 있게 미리 세어 둔다.
    셈: {
      파일: 바꾼것.length,
      더한줄: 바꾼것.reduce((a, x) => a + x.더한줄, 0),
      뺀줄: 바꾼것.reduce((a, x) => a + x.뺀줄, 0),
      돌린것: 돌린것.length,
      실패한것: 돌린것.filter((x) => !x.됐나).length,
      증명안됨: 증명안된것.length,
    },
  };
}

function 왜못믿나(돌린것, 마지막, 언제고쳤나) {
  if (!돌린것.length) return '고친 뒤에 아무것도 안 돌렸습니다 — 무엇도 확인되지 않았습니다.';
  const 확인시도 = 돌린것.filter((x) => x.확인인가);
  if (!확인시도.length) return '명령은 돌렸지만 검사·빌드는 안 돌렸습니다.';
  if (마지막 && !마지막.됐나) {
    return `마지막으로 돌린 \`${마지막.무엇}\` 이 실패했습니다 — 그 앞이 통과했어도 지금 상태를 증명하지 못합니다.`;
  }
  if (!마지막 && 언제고쳤나 != null) return '검사가 이 파일을 고치기 전에 돌았습니다 — 그 뒤 바뀐 것은 확인되지 않았습니다.';
  return '확인되지 않았습니다.';
}

/** 사람이 읽고 남길 수 있는 글. 마크다운. */
export function 증거글(증거, { 제목 = '작업 증거' } = {}) {
  const e = 증거 ?? {};
  const 줄 = [`# ${제목}`, ''];

  줄.push('## 바꾼 것', '');
  if (!e.바꾼것?.length) 줄.push('바꾼 파일이 없습니다.', '');
  else {
    줄.push('| 파일 | 더함 | 뺌 | 확인한 것 |', '|---|---|---|---|');
    for (const x of e.바꾼것) {
      줄.push(`| ${x.파일} | +${x.더한줄} | -${x.뺀줄} | ${x.증명 ? `\`${x.증명}\`` : '**없음**'} |`);
    }
    줄.push('');
  }

  줄.push('## 돌린 것', '');
  if (!e.돌린것?.length) 줄.push('돌린 명령이 없습니다.', '');
  else {
    for (const x of e.돌린것) {
      줄.push(`- ${x.됐나 ? '✓' : '✗'} \`${x.무엇}\`${x.남긴말 ? ` — ${x.남긴말}` : ''}`);
    }
    줄.push('');
  }

  // 이 절이 이 글의 요점이다. 비어 있으면 비어 있다고 분명히 적는다.
  줄.push('## 증명 안 된 것', '');
  if (!e.증명안된것?.length) 줄.push('없습니다 — 바꾼 것마다 뒤에 돌린 확인이 있습니다.', '');
  else {
    for (const x of e.증명안된것) 줄.push(`- **${x.파일}** — ${x.왜}`);
    줄.push('');
  }

  return 줄.join('\n');
}

/**
 * 파일로 남긴다. 화면은 스크롤로 사라지고, 검토는 나중에 다른 사람이 한다.
 *
 * @returns {string|null} 적은 자리. 못 적었으면 null — 못 적어도 대화는 계속된다.
 */
export function 증거적기(root, 증거, 이름 = '증거') {
  try {
    const dir = join(root, '.deel', '증거');
    mkdirSync(dir, { recursive: true });
    const 자리 = join(dir, `${String(이름).replace(/[^\w가-힣.-]/g, '_')}.md`);
    writeFileSync(자리, 증거글(증거), 'utf8');
    return 자리;
  } catch { return null; }
}
