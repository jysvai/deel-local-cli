// 진단 결과를 화면에 표로 그리고, "이걸로 돌릴 수 있는지" 판정한다.
import { c, say, rule, pad, width, mark } from './ui/ansi.js';

const ICON = { ok: mark.ok, no: mark.no, warn: mark.warn, skip: c.gray('·') };
const WORD = { ok: c.green('됨'), no: c.red('안됨'), warn: c.yellow('조건부'), skip: c.gray('확인불가') };

export function renderLine(r) {
  const icon = ICON[r.status] ?? ' ';
  const label = pad(r.label, 20);
  const time = r.ms ? c.gray(pad(`${r.ms}ms`, 8, 'right')) : ' '.repeat(8);
  say(`  ${icon} ${label} ${pad(WORD[r.status], 12)} ${time}  ${c.gray(r.detail)}`);
}

export function renderHeader(facts) {
  say('');
  rule('연결', 74);
  const kindName = facts.shape === 'ollama' ? 'Ollama 자체 규격' : 'OpenAI 호환';
  const rows = [
    ['규격', kindName],
    ['주소', facts.base],
    ['인증', facts.auth === 'none' ? '없음' : facts.auth],
    ['모델', facts.model],
  ];
  for (const [k, v] of rows) say(`  ${c.gray(pad(k, 8))} ${v}`);
  say('');
  rule('검사', 74);
}

// 판정 — 무엇을 할 수 있고 무엇이 막히는지 사람 말로.
export function verdict(facts, results) {
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  const get = (id) => by[id]?.status;
  const notes = [];
  let level;

  if (get('chat') !== 'ok') {
    level = 'stop';
    notes.push('기본 대화가 안 됩니다. 주소·키·모델 이름을 먼저 확인해야 합니다.');
    return { level, notes };
  }

  const toolsOk = get('tools') === 'ok' && get('toolresult') === 'ok';
  const toolsPartial = ['ok', 'warn'].includes(get('tools'));

  if (!toolsPartial) {
    level = 'blocked';
    notes.push('도구 호출이 안 됩니다 — 이 상태로는 파일을 읽거나 고칠 수 없습니다.');
    notes.push('게이트웨이가 tools 필드를 지우는지 관리자에게 확인이 필요합니다.');
  } else if (toolsOk) {
    level = 'ready';
    notes.push('도구 호출과 결과 되돌리기가 모두 확인됐습니다. 에이전트 루프를 그대로 올릴 수 있습니다.');
  } else {
    level = 'limited';
    notes.push('도구는 부르는데 인자나 결과 활용이 불안정합니다. 3단계(편집 신뢰성)에 시간을 더 씁니다.');
  }

  if (get('json') !== 'ok') notes.push('구조적 출력이 약합니다 — 편집 형식을 프롬프트로 강제하고 검사를 붙입니다.');
  if (get('stream') !== 'ok') notes.push('스트리밍이 없습니다 — 화면은 스피너로 대체하고 기능은 동일하게 갑니다.');
  if (get('system') === 'warn') notes.push('시스템 지시를 약하게 따릅니다 — 스킬을 적게, 짧게 올려야 합니다.');
  if (get('think') === 'ok') notes.push('추론 강도가 모델 층에서 적용됩니다 — /think 로 바로 조절됩니다.');
  else notes.push('추론 강도는 루프 층(계획 강제·도구 호출 상한·자기검증 횟수)으로 조절합니다.');
  if (!facts.ctx) notes.push('컨텍스트 길이를 서버가 안 알려줍니다 — 설정에서 직접 넣어야 합니다.');

  return { level, notes };
}

const VERDICT_STYLE = {
  ready:   { tag: c.green('  준비됨  '), line: '이 연결로 deel 를 돌릴 수 있습니다.' },
  limited: { tag: c.yellow(' 제한적 '), line: '돌아가긴 합니다. 편집 신뢰성 보강이 필요합니다.' },
  blocked: { tag: c.red('  막힘  '),  line: '핵심 기능이 막혀 있습니다. 아래를 먼저 해결해야 합니다.' },
  stop:    { tag: c.red(' 연결실패 '), line: '연결 자체가 되지 않았습니다.' },
};

export function renderVerdict(v) {
  const s = VERDICT_STYLE[v.level];
  say('');
  rule('판정', 74);
  say(`  ${s.tag}  ${c.bold(s.line)}`);
  say('');
  for (const n of v.notes) say(`    ${c.gray('•')} ${n}`);
  say('');
}

// 사내망에서 캡처 대신 파일로 가져올 수 있게 — 색 없는 평문.
export function plainReport(facts, results, v) {
  const at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const lines = [
    'deel 연결 진단 보고서',
    `생성 시각   ${at}`,
    '',
    `규격        ${facts.shape === 'ollama' ? 'Ollama 자체 규격' : 'OpenAI 호환'}`,
    `주소        ${facts.base}`,
    `인증        ${facts.auth === 'none' ? '없음' : facts.auth}`,
    `모델        ${facts.model}`,
    `컨텍스트    ${facts.ctx ? facts.ctx.toLocaleString() + ' 토큰' : '미상'}`,
    '',
    '검사 결과',
    '-'.repeat(70),
  ];
  const plain = { ok: '됨', no: '안됨', warn: '조건부', skip: '확인불가' };
  for (const r of results) {
    const label = r.label + ' '.repeat(Math.max(0, 20 - width(r.label)));
    const state = plain[r.status] + ' '.repeat(Math.max(0, 10 - width(plain[r.status])));
    const t = r.ms ? `${r.ms}ms` : '';
    const time = ' '.repeat(Math.max(0, 9 - t.length)) + t;
    lines.push(`  ${label} ${state} ${time}  ${r.detail}`);
  }
  lines.push('-'.repeat(70), '', `판정: ${v.level}`, '');
  for (const n of v.notes) lines.push(`  - ${n}`);
  lines.push('');
  return lines.join('\n');
}
