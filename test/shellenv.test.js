// Bash 자식에게 무엇을 물려주나.
//
// ── 무엇이 새고 있었나 ─────────────────────────────────────────────────
//
// 자식에게 넘기는 환경에서 뺀 것은 **우리 열쇠뿐**이었다(DEEL_API_KEY ·
// DEEL_KEY_*). 그래서 이런 것들이 그대로 넘어갔다.
//
//     OPENAI_API_KEY   ANTHROPIC_API_KEY   GITHUB_TOKEN
//     AWS_SECRET_ACCESS_KEY   NPM_TOKEN   DB_PASSWORD
//
// 넘어간 것 자체보다 그다음이 문제다. 모델이 `env` 나 `printenv` 를 한 번
// 부르면 그 값들이 **도구 결과로 대화에 실려** 게이트웨이로 나가고,
// `.deel/sessions/*.jsonl` 로 디스크에도 남는다. 그리고 모델은
// `env | grep -i proxy` 를 진짜로 자주 부른다 — 사내 프록시를 확인하는 아주
// 정상적인 행동이고, 그 한 줄에 열쇠가 딸려 나온다.
//
// ── 그래서 여기서 재는 것은 셋이다 ─────────────────────────────────────
//
//   1) 열쇠처럼 생긴 이름이 진짜로 빠지나
//   2) **멀쩡한 이름이 안 빠지나** — 이쪽이 더 어렵다. 잘못 빼면 사람은
//      「내 스크립트가 deel 안에서만 안 돈다」 로 끝나고 원인을 못 찾는다
//   3) 뺐다는 것을 말하나 — 값 말고 이름만
import { 셸환경, 비밀환경인가, 남길것읽기, 비밀마디 } from '../src/safety/shellenv.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-빼야할것');

// ── 열쇠처럼 생긴 것 ────────────────────────────────────────────────────
{
  const 빼야할것 = [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
    'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN',
    'DB_PASSWORD', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD',
    'SLACK_BOT_TOKEN', 'HF_TOKEN', 'DOCKER_PASSWORD',
    'GPG_PASSPHRASE', 'GOOGLE_APPLICATION_CREDENTIALS',
    // 사내 이름. 우리가 목록으로 못 박았다면 이건 못 잡았다.
    'SKT_GW_TOKEN', '사내_API_KEY',
  ];
  for (const n of 빼야할것) check(`뺀다: ${n}`, 비밀환경인가(n) === true, '');
}

trace('2-빼면안될것');

// ── 멀쩡한 이름 ─────────────────────────────────────────────────────────
//
// 이쪽이 이 검사의 진짜 값이다. `*KEY*` 같은 통무늬로 걸렀으면 MONKEY_PATCH
// 와 KEYBOARD_LAYOUT 이 같이 걸린다. 그런 오작동은 원인을 못 찾는다.
{
  const 남길것 = [
    // 이게 빠지면 거의 모든 셸 스크립트가 부서진다.
    'PWD', 'OLDPWD', 'PATH', 'HOME', 'SHELL', 'TMPDIR', 'TEMP',
    // 열쇠가 아니라 통로 이름이다. 빼면 `git push` 가 안 된다.
    'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
    // 사내 프록시. 이게 빠지면 사내망에서 아무것도 안 된다.
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
    // 마디로 보기 때문에 안 걸리는 것들.
    'MONKEY_PATCH', 'KEYBOARD_LAYOUT', 'KEYCLOAK_URL', 'TURKEY_TZ',
    'NODE_ENV', 'CI', 'LANG', 'TERM', 'DEEL_HOME',
  ];
  for (const n of 남길것) check(`안 뺀다: ${n}`, 비밀환경인가(n) === false, '');

  // PWD·AUTH 를 일부러 뺀 것을 못 박아 둔다. 나중에 「빠진 것 같은데」 하고
  // 넣으면 유닉스에서 셸 스크립트가 통째로 부서진다.
  check('PWD 는 비밀 마디가 아니다', !비밀마디.includes('PWD'), 비밀마디.join(' '));
  check('AUTH 도 비밀 마디가 아니다', !비밀마디.includes('AUTH'), '');
}

trace('3-환경만들기');

// ── 실제로 환경을 만들어 본다 ───────────────────────────────────────────
{
  const 원본 = {
    PATH: '/usr/bin', PWD: '/work', NODE_ENV: 'test',
    HTTPS_PROXY: 'http://gw.example.corp:3128',
    OPENAI_API_KEY: 'sk-남의것', GITHUB_TOKEN: 'ghp_x', DB_PASSWORD: 'p',
    DEEL_API_KEY: 'sk-우리것', DEEL_KEY_PROD: 'sk-우리것2',
  };
  const { env, 뺀것 } = 셸환경(원본);

  check('일할 것은 다 남는다',
    env.PATH === '/usr/bin' && env.PWD === '/work' && env.NODE_ENV === 'test'
      && env.HTTPS_PROXY === 'http://gw.example.corp:3128',
    JSON.stringify(Object.keys(env)));
  check('남의 열쇠는 다 빠진다',
    env.OPENAI_API_KEY === undefined && env.GITHUB_TOKEN === undefined && env.DB_PASSWORD === undefined,
    JSON.stringify(Object.keys(env)));
  check('우리 열쇠도 빠진다',
    env.DEEL_API_KEY === undefined && env.DEEL_KEY_PROD === undefined, '');

  /*
   * 우리 열쇠는 **뺀것 목록에 안 올린다.**
   *
   * 그건 되살릴 방법을 주지 않는 것이고, 되살릴 수 없는 것을 「필요하면
   * 설정에 적으세요」 라고 안내하면 사람이 안 되는 것을 시도한다.
   */
  check('우리 열쇠는 안내 목록에 안 올린다',
    !뺀것.includes('DEEL_API_KEY') && !뺀것.includes('DEEL_KEY_PROD'), 뺀것.join(' '));
  check('남의 열쇠 이름은 말해 준다',
    뺀것.length === 3 && 뺀것.includes('OPENAI_API_KEY') && 뺀것.includes('GITHUB_TOKEN')
      && 뺀것.includes('DB_PASSWORD'), 뺀것.join(' '));
  check('이름은 정렬해서 준다 — 같은 명령이 매번 같은 말을 해야 한다',
    JSON.stringify(뺀것) === JSON.stringify([...뺀것].sort()), 뺀것.join(' '));

  /*
   * **값은 절대 안 준다.**
   *
   * 이름을 적는 것은 원인을 알려 주는 일이고, 값을 적는 것은 방금 막은 것을
   * 되돌리는 일이다. 뺀것 은 도구 결과에 그대로 실려 게이트웨이로 나간다.
   */
  const 통째로 = JSON.stringify(뺀것);
  check('값은 어디에도 안 실린다',
    !통째로.includes('sk-남의것') && !통째로.includes('ghp_x') && !통째로.includes('sk-우리것'),
    통째로);

  // 원본은 안 건드린다. 이걸 어기면 부모 프로세스의 환경이 사라진다.
  check('원본 환경을 안 건드린다', 원본.OPENAI_API_KEY === 'sk-남의것', '');
}

trace('4-되살리기');

// ── 사람이 되살리라고 적은 것 ───────────────────────────────────────────
//
// 사내 저장소를 쓰는 사람은 `npm ci` 에 NPM_TOKEN 이 실제로 필요하다.
// 되살릴 길이 없으면 이 기능은 그 사람에게 그냥 고장이다.
{
  const 원본 = { NPM_TOKEN: 't', GITHUB_TOKEN: 'g', PATH: '/usr/bin' };
  const { env, 뺀것 } = 셸환경(원본, { 남길것: ['NPM_TOKEN'] });
  check('적어 둔 것은 넘어간다', env.NPM_TOKEN === 't', '');
  check('안 적은 것은 그대로 빠진다', env.GITHUB_TOKEN === undefined, '');
  check('되살린 것은 뺀 목록에 없다', 뺀것.length === 1 && 뺀것[0] === 'GITHUB_TOKEN', 뺀것.join(' '));

  // 대소문자를 안 가린다 — 사람이 소문자로 적었다고 안 먹으면, 왜 안 먹는지
  // 알 길이 없다. 환경변수 이름은 윈도우에서 애초에 대소문자를 안 가린다.
  check('대소문자는 안 가린다', 셸환경(원본, { 남길것: ['npm_token'] }).env.NPM_TOKEN === 't', '');
}

trace('5-설정읽기');

// ── 설정에서 꺼내기 ─────────────────────────────────────────────────────
{
  check('한국어 열쇠로 읽는다',
    JSON.stringify(남길것읽기({ 셸환경: { 남길것: ['NPM_TOKEN'] } })) === JSON.stringify(['NPM_TOKEN']), '');
  check('영어 열쇠로도 읽는다',
    JSON.stringify(남길것읽기({ shellEnv: { keep: ['NPM_TOKEN'] } })) === JSON.stringify(['NPM_TOKEN']), '');
  check('없으면 빈 목록', 남길것읽기(null).length === 0 && 남길것읽기({}).length === 0, '');
  check('빈 글자·딴 것은 걸러낸다',
    JSON.stringify(남길것읽기({ 셸환경: { 남길것: ['  ', '', 3, null, ' A '] } })) === JSON.stringify(['A']), '');

  /*
   * 무늬는 안 받는다.
   *
   * `*` 하나로 전부 되살아나면 이 안전장치를 끈 것과 같은데, **껐다는 자각이
   * 없다.** 이름을 하나씩 적게 하면 무엇을 넘기는지 사람이 안다.
   */
  const r = 셸환경({ GITHUB_TOKEN: 'g', NPM_TOKEN: 'n' }, { 남길것: ['*', '*TOKEN*'] });
  check('무늬로는 안 풀린다',
    r.env.GITHUB_TOKEN === undefined && r.env.NPM_TOKEN === undefined, JSON.stringify(Object.keys(r.env)));
}

trace('6-이상한값');

// ── 이상한 것에 안 죽는다 ───────────────────────────────────────────────
{
  check('빈 이름·이상한 값에 안 죽는다', (() => {
    for (const x of [null, undefined, '', 0, {}, []]) if (비밀환경인가(x) !== false) return false;
    return true;
  })(), '');
  check('빈 환경에도 안 죽는다', (() => {
    const r = 셸환경({});
    return Object.keys(r.env).length === 0 && r.뺀것.length === 0;
  })(), '');
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n셸 환경변수 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
