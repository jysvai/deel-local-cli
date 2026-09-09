// 아무도 안 부르는 **말**을 잡는다.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// 열쇠 여섯 개가 네 나라 말로 다 옮겨진 채 아무 데서도 안 불리고 있었다.
//
//     common.no · common.yes · common.seeHelp · common.unknownCommand
//     run.turnFoot · sum.readAs
//
// 스물네 줄이다. 그리고 이건 그냥 쓰레기가 아니라 **비용**이다. 새 말을 넣는
// 사람은 네 파일을 다 채워야 하고(`짝없는열쇠` 가 그걸 시킨다), 옮기는 사람은
// 안 쓰이는 줄까지 옮긴다. 지워야 할 것을 옮기느라 시간을 쓴다.
//
// ── 짝검사는 이걸 못 잡는다 ─────────────────────────────────────────────
//
// 이미 있는 `짝없는열쇠` 는 **네 언어가 서로 맞는지**만 본다. 넷 다 똑같이
// 안 쓰이면 그건 완벽한 짝이다. 그래서 초록이었다.
//
//   짝검사    ko 에 있는데 en 에 없다     → 잡는다
//   이 검사   넷 다 있는데 아무도 안 쓴다 → 잡는다
//
// ── 이어 붙여 만드는 열쇠를 헛잡으면 안 된다 ────────────────────────────
//
// 열쇠 이름을 통째로 적어 두지 않고 만들어 쓰는 자리가 여럿이다.
//
//     말(`cmd.${이름}.desc`)          commands.js
//     말(`unit.${갈래}${홑?'1':''}`)  i18n/index.js
//     말(`head.mode.${m.영}`)         ui/status.js
//
// 이런 것을 「안 쓰인다」 고 지우면 화면에 열쇠 이름이 그대로 뜬다. 그래서
// **앞머리를 소스에서 직접 찾아** 산 것으로 친다. 새 갈래를 만드는 사람이
// 이 파일을 고칠 일이 없어야 한다 — 고쳐야 하는 검사는 언젠가 꺼진다.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ko } from '../src/i18n/ko.js';
import { trace } from './trace.mjs';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 훑기 = (d, 모음 = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) 훑기(p, 모음);
    else if (/\.(m?js|cjs)$/.test(e.name)) 모음.push(p);
  }
  return 모음;
};

/*
 * 말집 넷은 뺀다 — 거기엔 모든 열쇠가 당연히 적혀 있으니 넣으면 전부 「쓰인다」 가
 * 된다. 그런데 `i18n/index.js` 는 **넣어야** 한다: `세말()` 이 `unit.` 을 거기서
 * 이어 붙인다. 그 파일까지 빼면 unit 열쇠 열둘이 죄다 헛걸린다 (실제로 그랬다).
 */
const 말집인가 = (p) => /i18n[\\/](ko|en|ja|zh)\.js$/.test(p);
const 소스들 = ['src', 'bin', 'tools']
  .flatMap((r) => 훑기(join(뿌리, r)))
  .filter((p) => !말집인가(p));
const 뭉치 = 소스들.map((p) => readFileSync(p, 'utf8')).join('\n');

// ── 1. 모든 열쇠가 어딘가에서 불린다 ────────────────────────────────────
trace('1-죽은말');
{
  /*
   * 이어 붙이는 앞머리를 소스에서 긁는다. `말(`cmd.${...}`)` 같은 자리에서
   * `cmd.` 를 뽑아낸다. 이렇게 해야 새 갈래가 생겨도 이 파일을 안 고친다.
   */
  const 앞머리들 = [...new Set(
    [...뭉치.matchAll(/[`'"]([a-zA-Z][\w]*(?:\.[\w]+)*\.?)\$\{/g)].map((m) => m[1]),
  )].filter((p) => p.includes('.'));

  const 열쇠들 = Object.keys(ko);
  const 적혀있나 = (k) => 뭉치.includes(`'${k}'`) || 뭉치.includes(`"${k}"`) || 뭉치.includes(`\`${k}\``);
  const 죽은것 = 열쇠들.filter((k) => !적혀있나(k) && !앞머리들.some((p) => k.startsWith(p)));

  check('★★ 이어 붙이는 앞머리를 실제로 찾아냈다 — 못 찾으면 헛경보가 쏟아진다',
    앞머리들.length >= 4, 앞머리들.join(' · '));
  check('★★★ 아무도 안 부르는 말이 없다',
    죽은것.length === 0, 죽은것.slice(0, 12).join(' · '));
}

// ── 2. 반대쪽 — 소스가 부르는데 말집에 없는 열쇠 ────────────────────────
trace('2-없는말');
{
  /*
   * 이쪽이 더 나쁘다. 없는 열쇠를 부르면 화면에 **열쇠 이름이 그대로** 뜬다
   * (`net.limit.guardrail` 같은 글이 사람에게 보인다). 오타 한 번이면 나고,
   * 그 화면을 볼 때까지 아무도 모른다.
   *
   * 여기서는 우리 말집 꼴로 보이는 것만 본다 — 점이 든 소문자 낱말. 아무
   * 글이나 주워 오면 도구 이름·파일 이름까지 열쇠로 오해한다.
   */
  const 부른것 = new Set();
  for (const m of 뭉치.matchAll(/(?:^|[^\w.])(?:말|옮긴말|말모두|옮겨졌나)\(\s*'([a-z][\w]*(?:\.[\w]+)+)'/g)) {
    부른것.add(m[1]);
  }
  const 없는것 = [...부른것].filter((k) => !(k in ko));
  check('★★★ 부르는 열쇠는 모두 말집에 있다 — 없으면 화면에 열쇠 이름이 뜬다',
    없는것.length === 0, 없는것.join(' · '));
  check('★★ 부르는 자리를 실제로 세었다', 부른것.size >= 50, `${부른것.size}개`);
}

// ── 3. 빈 값이 없다 ─────────────────────────────────────────────────────
trace('3-빈값');
{
  /*
   * 빈 글은 「옮겼다」 로 세어지는데 화면에는 아무것도 안 뜬다. 짝검사도
   * 통과한다 — 열쇠는 있으니까. 있는 것과 보이는 것은 다르다.
   */
  const 빈것 = Object.entries(ko).filter(([, v]) => typeof v === 'string' && v.trim() === '');
  check('★★★ 값이 빈 열쇠가 없다', 빈것.length === 0, 빈것.map(([k]) => k).join(' · '));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n죽은 말 검사  ${D}(넷 다 똑같이 안 쓰이면 그건 완벽한 짝이다)${X}\n`);
console.log(`  ${D}열쇠 ${Object.keys(ko).length}개 · 소스 ${소스들.length}개를 훑음${X}`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
