// 적어 둔 규칙이 진짜 그렇게 도나.
//
// ── 왜 이게 있어야 했나 ────────────────────────────────────────────────
//
// 규칙은 적어 두면 조용히 돈다. 그래서 **잘못 적은 규칙은 티가 안 난다.**
//
//     "deny": ["Bash(rm -rf*)"]
//
// 이건 `rm -rf /` 를 막는다. 그런데 `sudo rm -rf /` 는 안 막는다 — 무늬가
// 앞부터 맞아야 하기 때문이다. 적은 사람은 막힌 줄 알고 지낸다. 안 막혔다는
// 것은 **진짜로 지워진 날**에야 안다.
//
// 안전장치가 안 걸린 것과 안전장치가 없는 것은 다르다. 뒤엣것은 사람이
// 조심하고, 앞엣것은 사람이 마음을 놓는다. 그래서 앞엣것이 더 나쁘다.
//
// 여기서 재는 것은 그 함정이 진짜로 잡히나다 — 무늬가 맞는 보기와 안 맞는
// 보기를 같이 넣고, 확인이 그 차이를 말하는지 본다.
import {
  규칙모으기, 어떻게할까, 확인목록, 확인인자, 확인돌리기, 정책잊기,
} from '../src/safety/policy.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 정책 파일이 이 PC 에 있으면 결과가 섞인다. 없는 자리를 가리켜 둔다.
const 원래정책 = process.env.DEEL_POLICY;
process.env.DEEL_POLICY = '/이런/자리는/없다/policy.json';
정책잊기();

const 설정 = {
  permissions: {
    allow: ['Bash(npm test*)', 'Read'],
    deny: ['Bash(rm -rf*)', 'WebFetch'],
    확인: [
      { 도구: 'Bash', 값: 'rm -rf /tmp/x', 이래야: 'deny' },
      { 도구: 'Bash', 값: 'npm test -- --watch', 이래야: 'allow' },
      { 도구: 'Bash', 값: 'ls', 이래야: '모름' },
    ],
  },
};
const 규칙들 = 규칙모으기(설정, { env: process.env, platform: 'linux' });

trace('1-보기읽기');

// ── 설정에서 보기를 읽는다 ──────────────────────────────────────────────
{
  const 것들 = 확인목록(설정);
  check('적어 둔 보기를 다 읽는다', 것들.length === 3, String(것들.length));
  check('도구를 안 적으면 Bash 로 본다',
    확인목록({ permissions: { 확인: [{ 값: 'ls', 이래야: '모름' }] } })[0]?.도구 === 'Bash', '');
  check('영어 열쇠로도 읽는다',
    확인목록({ permissions: { checks: [{ tool: 'Read', value: 'a.md', expect: 'allow' }] } }).length === 1, '');

  /*
   * 이상하게 적은 보기는 **버린다.**
   *
   * 「이래야: 막힘」 처럼 적어 두면 그건 세 값 중 어느 것도 아니라 늘 틀린
   * 것으로 나온다 — 규칙은 멀쩡한데 확인만 빨개진다. 그러면 사람은 확인을
   * 안 믿게 되고, 진짜 빨간 것도 같이 안 본다.
   */
  const 이상한것 = 확인목록({
    permissions: {
      확인: [
        { 도구: 'Bash', 값: 'ls', 이래야: '막힘' },     // 없는 값
        { 도구: 'Bash', 이래야: 'deny' },                 // 값이 없음
        { 도구: 'Bash', 값: '', 이래야: 'deny' },        // 값이 빔
        'ls',                                              // 글자
        null,
      ],
    },
  });
  check('이상하게 적은 보기는 버린다', 이상한것.length === 0, JSON.stringify(이상한것));
  check('확인 칸이 없으면 빈 목록',
    확인목록({}).length === 0 && 확인목록(null).length === 0 && 확인목록({ permissions: {} }).length === 0, '');
}

trace('2-도구마다다른칸');

// ── 도구마다 보는 칸이 다르다 ───────────────────────────────────────────
//
// 걸리나() 는 Bash 면 command 를, 파일 도구면 file_path 를 본다. 확인에서
// 사람은 값 하나만 적으므로 여기서 그 도구가 보는 칸에 넣어 줘야 한다.
// 안 넣으면 보기가 **늘 「안 걸림」** 으로 나온다 — 검사가 아무것도 안 재면서
// 초록으로 남는 가장 나쁜 모양이다.
{
  check('Bash 는 command 로 싼다', 확인인자('Bash', 'ls').command === 'ls', '');
  check('WebFetch 는 url 로 싼다', 확인인자('WebFetch', 'http://x').url === 'http://x', '');
  check('Grep 은 pattern 으로 싼다', 확인인자('Grep', 'foo').pattern === 'foo', '');
  check('나머지는 file_path 로 싼다',
    확인인자('Read', 'a.md').file_path === 'a.md' && 확인인자('Write', 'a.md').file_path === 'a.md', '');

  // 진짜로 걸리는지까지 본다. 싸기만 하고 안 걸리면 아무 뜻이 없다.
  check('★ 싸 놓은 것이 실제로 규칙에 걸린다',
    어떻게할까(규칙들, 'WebFetch', 확인인자('WebFetch', 'http://x')).답 === 'deny', '');
}

trace('3-함정');

// ── 이 검사가 존재하는 이유 ─────────────────────────────────────────────
//
// `Bash(rm -rf*)` 는 앞부터 맞아야 하므로 `sudo rm -rf` 를 안 막는다.
// 사람은 막은 줄 알고 지낸다.
{
  const 앞부터 = 어떻게할까(규칙들, 'Bash', { command: 'rm -rf /tmp/x' });
  const sudo붙은것 = 어떻게할까(규칙들, 'Bash', { command: 'sudo rm -rf /tmp/x' });
  check('★★ Bash(rm -rf*) 는 rm 으로 시작할 때만 막는다', 앞부터.답 === 'deny', 앞부터.답);
  check('★★ sudo 를 앞에 붙이면 안 막힌다 — 이게 그 함정이다',
    sudo붙은것.답 === '모름', sudo붙은것.답);

  // 그래서 확인이 그것을 **말해 줘야** 한다.
  const 결과 = 확인돌리기(규칙들, [
    { 도구: 'Bash', 값: 'sudo rm -rf /tmp/x', 이래야: 'deny' },
  ]);
  check('★★ 확인이 그 어긋남을 잡는다', 결과[0].맞나 === false, JSON.stringify(결과[0]));
  check('★ 무엇이 나왔는지도 말한다', 결과[0].나온것 === '모름', 결과[0].나온것);

  // 별표를 앞에도 붙이면 잡힌다. 고친 뒤에는 통과해야 한다.
  const 고친규칙 = 규칙모으기({ permissions: { deny: ['Bash(*rm -rf*)'] } }, { env: process.env, platform: 'linux' });
  check('★★ 앞에도 별표를 붙이면 막힌다 — 고치는 법이 이것이다',
    확인돌리기(고친규칙, [{ 도구: 'Bash', 값: 'sudo rm -rf /tmp/x', 이래야: 'deny' }])[0].맞나 === true, '');
}

trace('4-확인돌리기');

// ── 다 돌렸을 때 ────────────────────────────────────────────────────────
{
  const 결과 = 확인돌리기(규칙들, 확인목록(설정));
  check('보기 수만큼 결과가 나온다', 결과.length === 3, String(결과.length));
  check('★ 적어 둔 대로면 다 맞다', 결과.every((x) => x.맞나), 결과.filter((x) => !x.맞나).map((x) => x.값).join(' · '));

  // 어느 규칙이 정했는지까지 들고 있어야 한다. 「막힙니다」 만 말하면
  // 무엇을 지워야 풀리는지 알 길이 없다.
  const 막힌것 = 결과.find((x) => x.나온것 === 'deny');
  check('★★ 어느 규칙이 정했는지 들고 있다', 막힌것?.규칙 === 'Bash(rm -rf*)', String(막힌것?.규칙));
  check('★★ 그 규칙이 어디에 적혔는지도 들고 있다', 막힌것?.출처 === '설정', String(막힌것?.출처));

  // 아무 규칙에도 안 걸리는 것은 규칙이 null 이다. 「걸리는 규칙 없음」 을
  // 화면이 그렇게 적을 수 있어야 한다.
  const 안걸린것 = 결과.find((x) => x.나온것 === '모름');
  check('안 걸린 것은 규칙이 비어 있다', 안걸린것?.규칙 === null, String(안걸린것?.규칙));

  check('보기가 없으면 빈 결과', 확인돌리기(규칙들, []).length === 0 && 확인돌리기(규칙들, null).length === 0, '');
}

trace('5-금지가이긴다');

// ── 금지가 허락을 이긴다 ────────────────────────────────────────────────
//
// 둘 다 걸리면 금지다. 반대로 하면 규칙 하나를 잘못 적어 둔 것으로 금지가
// 통째로 무력해진다. 확인이 그 차례를 그대로 재야 한다.
{
  const 둘다 = 규칙모으기(
    { permissions: { allow: ['Bash(npm*)'], deny: ['Bash(npm publish*)'] } },
    { env: process.env, platform: 'linux' },
  );
  const r = 확인돌리기(둘다, [
    { 도구: 'Bash', 값: 'npm publish', 이래야: 'deny' },
    { 도구: 'Bash', 값: 'npm test', 이래야: 'allow' },
  ]);
  check('★★ 둘 다 걸리면 금지가 이긴다', r[0].맞나 && r[0].규칙 === 'Bash(npm publish*)', JSON.stringify(r[0]));
  check('금지에 안 걸리면 허락이 먹는다', r[1].맞나 && r[1].규칙 === 'Bash(npm*)', JSON.stringify(r[1]));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n규칙 확인 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);

if (원래정책 === undefined) delete process.env.DEEL_POLICY; else process.env.DEEL_POLICY = 원래정책;
정책잊기();
process.exitCode = fail.length ? 1 : 0;
