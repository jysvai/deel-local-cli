// 쓸수록 이 PC 에 맞춰 나아지는지 검증한다.
//
// 여기서 재야 하는 것은 '뭔가 적힌다' 가 아니다. 잘못 배우면 안 배우느니만
// 못하다 — 우연히 한 번 실패한 명령을 "이 PC 에서 안 된다" 고 프롬프트에
// 적어 버리면, 모델이 되는 길을 두고 우회한다.
//
//   1) 확신이 설 때만 말하는가 (한 번 겪은 것은 안 싣는다)
//   2) 프롬프트에 실리는 양이 상한을 안 넘는가
//   3) 폴더 것과 이 PC 것이 안 섞이는가
//   4) 다음에 켤 때 실제로 이어받는가 — 이게 '나아진다' 의 전부다
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 배움, 최대토큰 } from '../src/agent/evolve.js';
import { estimateTokens } from '../src/agent/session.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-evolve-'));
const home = mkdtempSync(join(tmpdir(), 'deel-evolve-home-'));

trace('1-명령배우기');

// ── 명령 ────────────────────────────────────────────────────────────────
{
  const b = new 배움(root, home, '2026-08-26T00:00:00Z');

  b.명령본것('npm test', true);
  check('한 번 된 것은 아직 안 싣는다', b.요약() === null,
    '우연일 수 있다. 두 번은 봐야 한다');

  b.명령본것('npm test -- --watch', true);
  check('두 번 되면 싣는다', /npm test/.test(b.요약() ?? ''), b.요약() ?? '없음');
  check('인자는 빼고 앞머리만 센다', Object.keys(b.폴더.명령).length === 1,
    Object.keys(b.폴더.명령).join(' | '));

  // 프로그램이 아예 없어서 실패한 것은 첫 낱말로 센다 — 'pnpm 이 없다' 는 한 가지 사실이다.
  b.명령본것('pnpm install', false, "'pnpm' is not recognized as an internal or external command");
  b.명령본것('pnpm add x', false, 'spawn pnpm ENOENT');
  check('두 번 안 되면 그것도 싣는다', /pnpm/.test(b.요약() ?? ''), b.요약() ?? '없음');
  check('안 되는 것은 다시 부르지 말라고 적는다', /다시 부르지 마라/.test(b.요약() ?? ''));

  // 됐다 안 됐다 하는 것은 아무 말도 안 한다 — 사실이 아니라 그때그때다.
  b.명령본것('git push', true);
  b.명령본것('git push', false);
  b.명령본것('git push', true);
  check('됐다 안 됐다 하는 것은 안 싣는다', !/git push/.test(b.요약() ?? ''), b.요약() ?? '');
}

trace('2-모델버릇');

// ── 모델 버릇 ───────────────────────────────────────────────────────────
{
  const b = new 배움(root, home, '2026-08-26T00:00:00Z');
  const 모델 = 'qwen2.5-coder:7b';

  b.모델본것(모델, '잘린인자', 5);
  check('걸음이 안 쌓이면 판단하지 않는다', !/잘라 먹/.test(b.요약(모델) ?? ''),
    '5번 잘렸어도 몇 걸음 중인지 모르면 비율이 무의미하다');

  b.모델본것(모델, '걸음', 20);
  check('걸음이 쌓이면 버릇을 말한다', /잘라 먹/.test(b.요약(모델) ?? ''), b.요약(모델) ?? '없음');
  check('무엇을 하라고까지 적는다', /Append/.test(b.요약(모델) ?? ''));
  check('다른 모델 얘기는 안 한다', b.요약('딴모델') === null || !/잘라 먹/.test(b.요약('딴모델') ?? ''));
}

trace('3-토큰보정이어받기');

// ── 토큰 보정 — 다음에 켤 때 이어받는가 ─────────────────────────────────
{
  const b = new 배움(root, home, '2026-08-26T00:00:00Z');
  check('처음엔 아는 배수가 없다', b.아는보정('새모델') === null);

  b.보정본것('새모델', 1.2);
  check('배운 배수를 들고 있는다', Math.abs(b.아는보정('새모델') - 1.2) < 0.01, String(b.아는보정('새모델')));

  b.보정본것('새모델', 1.4);
  const 섞인것 = b.아는보정('새모델');
  check('새 값은 지난 값과 섞는다', 섞인것 > 1.2 && 섞인것 < 1.4, `${섞인것.toFixed(3)}`);

  b.보정본것('새모델', 9);
  check('말도 안 되는 배수는 안 받는다', Math.abs(b.아는보정('새모델') - 섞인것) < 0.001);

  // 여기가 '나아진다' 의 핵심이다 — 껐다 켜도 이어받는가.
  const 다시 = new 배움(root, home, '2026-08-26T00:00:00Z');
  check('껐다 켜도 배수를 이어받는다', Math.abs(다시.아는보정('새모델') - 섞인것) < 0.001,
    `${다시.아는보정('새모델')?.toFixed(3)}`);
}

trace('4-어디에쌓나');

// ── 폴더 것과 이 PC 것 ──────────────────────────────────────────────────
{
  const b = new 배움(root, home, '2026-08-26T00:00:00Z');
  check('폴더 것은 폴더에 남는다', existsSync(join(root, '.deel', '배운것.json')));
  check('이 PC 것은 설정 폴더에 남는다', existsSync(join(home, '배운것.json')));

  const 폴더글 = readFileSync(join(root, '.deel', '배운것.json'), 'utf8');
  check('명령은 폴더 쪽에만 있다', 폴더글.includes('npm test') && !폴더글.includes('qwen2.5-coder'));
  const 집글 = readFileSync(join(home, '배운것.json'), 'utf8');
  check('모델 얘기는 이 PC 쪽에만 있다', 집글.includes('qwen2.5-coder') && !집글.includes('npm test'));

  // 폴더를 옮겨도 모델에 대해 알아낸 것은 따라온다.
  const 딴폴더 = mkdtempSync(join(tmpdir(), 'deel-evolve2-'));
  const c2 = new 배움(딴폴더, home, '2026-08-26T00:00:00Z');
  check('폴더를 옮기면 명령은 두고 간다', !/npm test/.test(c2.요약('qwen2.5-coder:7b') ?? ''));
  check('폴더를 옮겨도 모델 버릇은 따라온다', /잘라 먹/.test(c2.요약('qwen2.5-coder:7b') ?? ''),
    c2.요약('qwen2.5-coder:7b') ?? '없음');
  rmSync(딴폴더, { recursive: true, force: true });
}

trace('5-상한');

// ── 자리를 얼마나 먹나 ──────────────────────────────────────────────────
{
  const 많은폴더 = mkdtempSync(join(tmpdir(), 'deel-evolve3-'));
  const b = new 배움(많은폴더, home, '2026-08-26T00:00:00Z');
  for (let i = 0; i < 60; i++) { b.명령본것(`명령${i} 아주긴인자${'가'.repeat(30)}`, true); b.명령본것(`명령${i} 또다른인자`, true); }

  const 요약 = b.요약('qwen2.5-coder:7b') ?? '';
  check('프롬프트에 실리는 양이 상한 안', estimateTokens(요약) <= 최대토큰,
    `${estimateTokens(요약)}토큰 / 상한 ${최대토큰}`);
  check('표가 끝없이 자라지 않는다', Object.keys(b.폴더.명령).length <= 40,
    `${Object.keys(b.폴더.명령).length}개`);
  rmSync(많은폴더, { recursive: true, force: true });
}

trace('6-지우기');

// ── 지우기 ──────────────────────────────────────────────────────────────
{
  const b = new 배움(root, home, '2026-08-26T00:00:00Z');
  check('지우기 전에는 뭔가 있다', b.요약('qwen2.5-coder:7b') !== null);
  b.지우기('전부');
  check('지우면 프롬프트에 아무것도 안 붙는다', b.요약('qwen2.5-coder:7b') === null);
  check('지운 것은 껐다 켜도 안 돌아온다',
    new 배움(root, home, '2026-08-26T00:00:00Z').요약('qwen2.5-coder:7b') === null);
}

trace('7-못써도안죽는다');

// ── 못 적는 자리에서도 대화는 계속돼야 한다 ─────────────────────────────
//
// 「안 죽는다」를 check(…, true) 로 적지 않는다. 위 네 번의 호출이 던지면
// 파일이 통째로 죽고 run.mjs 가 '비정상 종료' 로 잡는다 — 늘 초록인 줄을
// 하나 더 두는 것은 통과 건수만 부풀린다.
{
  const b = new 배움(null, null, '2026-08-26T00:00:00Z');
  b.명령본것('npm test', true).명령본것('npm test', true).모델본것('m', '걸음', 20).보정본것('m', 1.1);
  check('저장할 자리가 없어도 프롬프트는 성하다', typeof b.요약('m') === 'string' || b.요약('m') === null);
}

/*
 * ── 전선 모양은 모델과 주소를 함께 열쇠로 쓴다 (backend/wire.js) ────────
 *
 * 모델 이름만으로는 못 가른다. 같은 `claude-opus-5` 라도 회사 직통과 사내
 * 게이트웨이가 받는 것이 다르고, 게이트웨이는 제 나름대로 깎아서 넘긴다.
 * 한 열쇠로 뭉치면 한쪽에서 배운 것이 다른 쪽을 망가뜨린다 — 그리고 그
 * 고장은 400 으로만 나타나서, 화면에서는 열쇠가 틀린 것과 구별이 안 된다.
 */
{
  const r2 = mkdtempSync(join(tmpdir(), 'deel-wire-'));
  const h2 = mkdtempSync(join(tmpdir(), 'deel-wire-home-'));
  const b = new 배움(r2, h2);
  const 카드 = { 눈금: ['low', 'medium', 'high'], 캐시: 'explicit', 생각형식: 'adaptive' };
  b.전선본것('claude-opus-5', 'https://api.anthropic.com/v1', 카드);

  check('★ 배운 전선을 다시 읽는다',
    JSON.stringify(b.아는전선('claude-opus-5', 'https://api.anthropic.com/v1')) === JSON.stringify(카드),
    JSON.stringify(b.아는전선('claude-opus-5', 'https://api.anthropic.com/v1')));

  /*
   * 주소는 host 만 본다. 경로에는 배포 이름·판 번호가 붙어서, 사람이 설정을
   * 조금만 바꿔도 배운 것이 매번 새것이 된다 — 그러면 영영 못 배운 것과 같다.
   */
  check('★ 같은 host 면 경로가 달라도 같은 것으로 본다',
    b.아는전선('claude-opus-5', 'https://api.anthropic.com/v2/뭔가') !== null);

  check('★★ 주소가 다르면 남의 것을 안 준다',
    b.아는전선('claude-opus-5', 'https://gw.사내.example.com/v1') === null,
    JSON.stringify(b.아는전선('claude-opus-5', 'https://gw.사내.example.com/v1')));
  check('모델이 다르면 안 준다',
    b.아는전선('gpt-5', 'https://api.anthropic.com/v1') === null);

  // 다시 켰을 때 그대로 있어야 뜻이 있다. 안 그러면 세션마다 같은 400 을 다시 맞는다.
  const 다시 = new 배움(r2, h2);
  check('★ 껐다 켜도 남아 있다',
    JSON.stringify(다시.아는전선('claude-opus-5', 'https://api.anthropic.com/v1')) === JSON.stringify(카드),
    JSON.stringify(다시.아는전선('claude-opus-5', 'https://api.anthropic.com/v1')));

  // 빈 것으로 부르면 아무 일도 안 한다 — 못 배운 것을 배운 척하면 안 된다.
  const 전 = JSON.stringify(다시.아는전선('claude-opus-5', 'https://api.anthropic.com/v1'));
  다시.전선본것('claude-opus-5', 'https://api.anthropic.com/v1', null);
  check('빈 것으로는 안 덮는다',
    JSON.stringify(다시.아는전선('claude-opus-5', 'https://api.anthropic.com/v1')) === 전);

  /*
   * ── 한 호스트에 창구가 둘인 자리 ────────────────────────────────────
   *
   * 경로를 뺐더니 mantle 이 걸렸다 — `/openai/v1` 과 `/anthropic/v1` 이
   * **같은 호스트에 같은 모델 이름**으로 서 있다(providers/bedrock.js).
   * 규격을 안 가르면 OpenAI 창구에서 배운 `생각형식:'effort'` 가 Anthropic
   * 창구 카드 위에 얹히고, 그러면 그 창구에서는 생각도 캐시 표식도 조용히
   * 다 꺼진다 — 이번 판이 고치려던 두 가지가 켠 적도 없이 꺼져 있게 된다.
   */
  const 맨틀 = 'https://bedrock-mantle.us-east-1.api.aws';
  다시.전선본것('claude-opus-5', `${맨틀}/openai/v1`, { 생각형식: 'effort', 캐시: 'auto' }, 'openai');
  다시.전선본것('claude-opus-5', `${맨틀}/anthropic/v1`, { 생각형식: 'adaptive', 캐시: 'explicit' }, 'anthropic');

  check('★★ 같은 호스트라도 규격이 다르면 남의 카드를 안 준다',
    다시.아는전선('claude-opus-5', `${맨틀}/anthropic/v1`, 'anthropic')?.생각형식 === 'adaptive',
    JSON.stringify(다시.아는전선('claude-opus-5', `${맨틀}/anthropic/v1`, 'anthropic')));
  check('★★ 반대쪽도 제 것을 받는다',
    다시.아는전선('claude-opus-5', `${맨틀}/openai/v1`, 'openai')?.생각형식 === 'effort',
    JSON.stringify(다시.아는전선('claude-opus-5', `${맨틀}/openai/v1`, 'openai')));
  check('★ 캐시 칸도 안 섞인다',
    다시.아는전선('claude-opus-5', `${맨틀}/anthropic/v1`, 'anthropic')?.캐시 === 'explicit',
    JSON.stringify(다시.아는전선('claude-opus-5', `${맨틀}/anthropic/v1`, 'anthropic')?.캐시));

  // 규격을 안 주고 물으면 옛 열쇠를 본다. 옛 열쇠에 적힌 것이 없으면 없다고 한다 —
  // 모르는 채로 남의 카드를 주는 것보다 짐작으로 새로 서는 편이 안전하다.
  check('규격 없이 물으면 남의 것을 안 준다',
    다시.아는전선('claude-opus-5', `${맨틀}/anthropic/v1`) === null,
    JSON.stringify(다시.아는전선('claude-opus-5', `${맨틀}/anthropic/v1`)));

  rmSync(r2, { recursive: true, force: true });
  rmSync(h2, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n겪어 본 것 검사  ${D}(쓸수록 이 PC 에 맞춰 나아지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
