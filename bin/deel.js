#!/usr/bin/env node
// deel 진입점. 외부 의존성 없음 — Node 표준 기능만 씁니다.
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { c, say, mark, rule, clip, width } from '../src/ui/ansi.js';
import { runSetup, runDiagnose, showStatus, banner } from '../src/setup.js';
import { chatLoop } from '../src/repl.js';
import { runOnce } from '../src/oneshot.js';
import { packSelf, audit, reviewSheet } from '../src/pack/selfpack.js';
import { sbom, 심사명세, 명세요약 } from '../src/pack/sbom.js';
import { runScan } from '../src/backend/scanui.js';
import { closeConnections } from '../src/backend/http.js';
import { parseSize } from '../src/backend/ctxsize.js';
import { runSessions } from '../src/agent/sessionui.js';
import { acp } from '../src/acp/serve.js';
import { runCompletion } from '../src/completion.js';
import { runReset } from '../src/reset.js';
import { 마크다운, 읽는갈래 } from '../src/tools/doc2md.js';
import { 언어잡기, 언어, 말 } from '../src/i18n/index.js';
import { 믿기, 안믿기, 믿는목록, 프로젝트금지칸 } from '../src/safety/trust.js';
import { load as 설정읽기 } from '../src/config.js';
import { 규칙모으기, 어떻게할까, 확인목록, 확인인자, 확인돌리기 } from '../src/safety/policy.js';
import { 기록자리, 세기, 도구차례, 막힘차례, 셈JSON } from '../src/stats.js';
import { 진찰 } from '../src/doctor.js';
import { 설명, 설명줄들 } from '../src/configexplain.js';

const MIN_NODE = 20;

/**
 * 지금 판 번호.
 *
 * package.json 에서 읽는다. 코드에 따로 적어 두면 올릴 때 한쪽만 고치는 날이
 * 반드시 온다 — 그러면 화면이 거짓말을 하기 시작한다. 못 읽으면 못 읽었다고
 * 말한다. 모르는 값을 그럴듯한 숫자로 지어내지 않는다.
 */
function 판번호() {
  const 뒤 = `(Node ${process.versions.node} · ${process.platform})`;
  try {
    const j = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return `  deel ${j.version}  ${뒤}`;
  } catch {
    return `  deel (판 번호를 못 읽었습니다)  ${뒤}`;
  }
}

/*
 * 켤 때 말을 한 번 정한다.
 *
 * 여태 이 자리가 비어 있었다. 말을 정하는 곳이 repl.js 하나뿐이라서,
 * `deel audit`·`deel pack`·`deel sbom` 은 **언제나 한국어**로 나왔다 —
 * /lang en 으로 쓰던 사람이 심사에 낼 서류를 뽑으면 한글 문서가 나왔다는 뜻이다.
 *
 * 설정을 못 읽어도 죽지 않는다. 말 하나 때문에 `deel --version` 이 안 되면 안 된다.
 */
function 말정하기() {
  let cfg = null;
  try { cfg = 설정읽기(); } catch { /* 설정이 없어도 기본 말로 돈다 */ }
  return 언어잡기({ cfg });
}

// 사내 반입용 묶음 만들기.
function runPack(flags) {
  const 한국어 = 언어() === 'ko';
  const out = flags.out ? String(flags.out) : join(process.cwd(), 한국어 ? 'deel-반입.zip' : 'deel-import.zip');
  const r = packSelf(out);
  const a = r.audit;
  say('');
  rule(한국어 ? '반입 묶음' : 'Review package', 70);
  say(`  ${mark.ok} ${c.bold(r.out)}`);
  say(`     ${c.gray(한국어 ? `${r.files}개 파일 · ${(r.bytes / 1024).toFixed(1)}KB` : `${r.files} files · ${(r.bytes / 1024).toFixed(1)}KB`)}`);
  say('');
  const 없음 = 한국어 ? '없음' : 'none';
  const 개 = (n, 단위) => (한국어 ? `${n}${단위}` : String(n));
  /*
   * 이름 칸을 손으로 띄우지 않는다.
   *
   * 한글은 한 글자가 두 칸이라 「의존성」 과 「Dependencies」 를 같은 수의
   * 빈칸으로 맞출 수 없다. 손으로 맞춰 두면 말을 바꾸는 순간 줄이 어긋난다 —
   * 실제로 영어판이 처음에 그렇게 어긋났다.
   */
  const 칸 = (ko, en) => (한국어 ? ko : en.padEnd(18));
  say(`  ${c.gray(칸('의존성          ', 'Dependencies'))}${a.deps.length === 0 ? c.green(개(0, '개')) : c.red(개(a.deps.length, '개'))}`);
  say(`  ${c.gray(칸('설치 스크립트   ', 'Install scripts'))}${a.lifecycle.length === 0 ? c.green(없음) : c.red(a.lifecycle.join(', '))}`);
  say(`  ${c.gray(칸('외부 import     ', 'External imports'))}${a.외부모듈.length === 0 ? c.green(개(0, '건')) : c.red(개(a.외부모듈.length, '건'))}`);
  say(`  ${c.gray(칸('네트워크 호출   ', 'Network calls'))}${개(a.calls.net.length, '곳')} ${c.gray(한국어 ? '(설정한 주소로만)' : '(only to the configured address)')}`);
  say(`  ${c.gray(칸('포트 열기       ', 'Listening ports'))}${a.calls.listen.length === 0 ? c.green(없음) : c.red(개(a.calls.listen.length, '곳'))}`);
  say('');
  /*
   * 여기 적는 이름은 zip 안에 진짜로 든 이름이어야 한다.
   *
   * 안내 글과 실제 파일 이름이 어긋나면, 받은 사람은 없는 파일을 찾다가
   * 묶음이 잘못 만들어진 줄 안다 — 서류를 못 믿게 되는 자리다.
   */
  if (한국어) {
    say(`  ${c.gray('안에 반입심사서.txt · sbom.cdx.json · 심사명세.json 이 같이 들어 있습니다.')}`);
    say(`  ${c.gray('사람이 읽을 것 한 장, 스캐너에 넣을 것 두 장입니다 — 그대로 제출하시면 됩니다.')}`);
    say(`  ${c.gray('내용만 먼저 보시려면')} ${c.cyan('deel audit')}`);
  } else {
    say(`  ${c.gray('It contains import-review.txt · sbom.cdx.json · audit-spec.json.')}`);
    say(`  ${c.gray('One document to read, two to feed a scanner — submit them as they are.')}`);
    say(`  ${c.gray('To see the contents first:')} ${c.cyan('deel audit')}`);
  }
  say('');
  return 0;
}

/*
 * `deel config explain <칸>` — 이 값은 어디서 왔나 (src/configexplain.js).
 *
 * 설정을 읽는 자리가 넷이라(정책·환경변수·프로젝트·이 PC), 「파일에 분명히
 * 적어 놨는데 안 먹는다」 가 흔하다. 그때 사람은 그 파일만 고치다가 설정이라는
 * 것을 안 믿게 된다. 층을 열어 보여 주면 5초에 끝나는 일이다.
 */
function runConfig(args, flags) {
  const 무엇 = String(args[0] ?? '');
  const 칸 = String(args[1] ?? '');
  if (무엇 !== 'explain' || !칸) {
    say('');
    say(`  ${c.cyan('deel config explain <칸>')}  ${c.gray('이 값이 어디서 왔는지')}`);
    say(`  ${c.gray('보기:')} ${c.white('deel config explain offline')} ${c.gray('·')} ${c.white('deel config explain profiles.사내.model')}`);
    say('');
    return 1;
  }
  const r = 설명(칸, { root: flags.root ? String(flags.root) : process.cwd() });
  if (flags.json === true) { process.stdout.write(JSON.stringify(r) + '\n'); return 0; }

  const 표 = { 값: c.bold('='), 없음: c.gray('·'), 이김: mark.ok, 아래: c.gray('·'), 안읽음: c.yellow('⚠'), 참고: c.gray('i') };
  say('');
  say(`  ${c.bold(칸)}`);
  say('');
  for (const 줄 of 설명줄들(r)) {
    const 글 = 줄.갈래 === '값' ? c.white(줄.글) : 줄.글;
    say(`  ${표[줄.갈래] ?? ' '} ${글}${줄.곁 ? `  ${c.gray(줄.곁)}` : ''}`);
  }
  say('');
  return r.이긴층 ? 0 : 0;
}

/*
 * `deel doctor` — 붙기 전에 이 자리의 조건을 하나씩 본다 (src/doctor.js).
 *
 * 화면 한 장이 그대로 담당자에게 보낼 질문이 되게 하는 것이 목표다. 그래서
 * 값마다 **어디서 온 값인지**를 같이 적는다 — 환경변수가 파일을 이기고 있는
 * 것을 모르면 사람은 파일만 백 번 고친다.
 */
async function runDoctor(flags) {
  const { load: 읽기, activeProfile: 고른것, resolveKey: 열쇠풀기, configPath: 설정경로 } =
    await import('../src/config.js');
  const { 지금모드, 바깥인가, 나갈수있나 } = await import('../src/safety/runmode.js');
  const { allowEndpoint } = await import('../src/safety/network.js');

  banner();
  let cfg = null;
  try { cfg = 읽기(); } catch { /* 설정이 망가져도 아래에서 말한다 */ }
  const prof = cfg ? 고른것(cfg) : null;

  /*
   * 두드려도 되는 자리인지 먼저 본다.
   *
   * 진단한다고 자물쇠를 넘어가면 안 된다 — 여기서 한 번 나가 버리면 「나가는
   * 주소는 사람이 정한 하나뿐」 이 진단 명령 하나로 깨진다.
   */
  const 모드 = 지금모드({ online: flags.online === true, offline: !!(flags.offline ?? prof?.offline ?? cfg?.offline) });
  const 나감 = prof ? 나갈수있나(모드, { 바깥: 바깥인가(prof.baseUrl), 허가: prof.online === true }) : { 물어볼까: false };
  const 두드려도되나 = !!prof && !나감.물어볼까 && !모드.허가무시;
  if (두드려도되나) allowEndpoint(prof.baseUrl);

  const { 줄들 } = await 진찰({
    cfg, prof,
    root: flags.root ? String(flags.root) : process.cwd(),
    설정자리: 설정경로(),
    열쇠: prof ? 열쇠풀기(prof) : '',
    바깥가도되나: 두드려도되나,
  });

  const 표 = { ok: mark.ok, warn: mark.warn, no: c.red('✗'), unknown: c.gray('?') };
  say('');
  for (const x of 줄들) {
    const 이름 = String(x.이름) + ' '.repeat(Math.max(0, 14 - width(String(x.이름))));
    say(`  ${표[x.상태] ?? ' '} ${c.gray(이름)} ${x.값}${x.덧말 ? c.gray(`  — ${x.덧말}`) : ''}`);
  }
  say('');
  const 탈 = 줄들.filter((x) => x.상태 === 'no').length;
  if (탈) {
    say(`  ${c.red(`${탈}군데가 막혀 있습니다.`)} ${c.gray('위 줄을 그대로 담당자에게 보내시면 됩니다.')}`);
    say('');
    return 1;
  }
  say(`  ${c.gray('여기까지는 괜찮습니다. 모델이 도구를 부를 수 있는지는')} ${c.cyan('deel diagnose')}`);
  say('');
  return 0;
}

/*
 * `deel stats [--days N] [--all] [--json]` — 이 폴더에서 무엇을 했나.
 *
 * 감사기록은 여태 쓰기만 하고 아무도 안 읽는 파일이었다. 무엇을 언제 어떻게
 * 했는지 전부 남는다고 팔아 놓고, 적힌 것을 사람 말로 되돌려 주는 명령이
 * 없었다 (src/stats.js 머리말).
 */
function runStats(flags) {
  const 자리 = 기록자리(flags.root ? String(flags.root) : process.cwd());
  const 전부 = flags.all === true || flags.all === 'true';
  const 날수 = 전부 ? null : Math.max(1, parseInt(String(flags.days ?? '30'), 10) || 30);
  const 셈 = 세기(자리, { 날수 });
  const json = flags.json === true || flags.json === 'true';

  if (json) { process.stdout.write(JSON.stringify(셈JSON(셈)) + '\n'); return 셈.있나 ? 0 : 1; }

  say('');
  if (!셈.있나) {
    // 없는 것을 「0회」 로 찍으면 안 쓴 것과 기록이 없는 것이 같아 보인다.
    say(`  ${mark.warn} ${말('stats.none')}`);
    say(`  ${c.gray(자리)}`);
    say('');
    return 1;
  }

  const 기간 = 셈.처음 ? `${셈.처음.slice(0, 10)} → ${셈.마지막.slice(0, 10)}` : '(빈 기록)';
  say(`  ${c.bold(말('stats.title'))}  ${c.gray(자리)}`);
  say('');
  /*
   * 이름 칸은 **화면 칸수**로 맞춘다.
   *
   * 한글은 한 글자가 두 칸이라 padEnd 로 맞추면 어긋난다 — 「막힘」 과
   * 「되돌리기」 가 같은 자리에서 시작하지 않는다. 말을 바꿀 때마다 손으로
   * 다시 맞추게 되는 것도 같은 까닭이다 (bin/deel.js 의 반입 묶음 화면에
   * 같은 이야기가 한 번 적혀 있다).
   */
  const 칸 = (s) => `  ${c.gray(String(s) + ' '.repeat(Math.max(0, 12 - width(String(s)))))}`;
  say(`${칸(말('stats.period'))} ${기간}  ${c.gray(말('stats.activeDays', { n: 셈.날.size }))}`
    + (셈.날수 ? c.gray(`  · ${말('stats.window', { n: 셈.날수 })}`) : ''));
  say(`${칸(말('stats.turns'))} ${셈.대화.toLocaleString()}  ${c.gray(말('stats.sessions', { n: 셈.세션.size }))}`);
  const 실패말 = 셈.도구
    ? c.gray(`  · ${말('stats.failed', { n: 셈.도구실패 })} (${((셈.도구실패 / 셈.도구) * 100).toFixed(1)}%)`)
    : '';
  say(`${칸(말('stats.tools'))} ${셈.도구.toLocaleString()}${실패말}`);

  const 표 = 도구차례(셈);
  if (표.length) {
    say('');
    for (const x of 표) {
      const 실패 = x.실패 ? c.yellow(`  ${말('stats.failed', { n: x.실패 })}`) : '';
      say(`    ${c.white(x.이름.padEnd(12))} ${String(x.수).padStart(6)}${실패}`);
    }
  }

  /*
   * 막힌 것은 0 이어도 적는다.
   *
   * 규칙을 적어 둔 사람이 알아야 하는 것은 「몇 번 막혔나」 보다 **한 번도 안
   * 걸렸다**는 사실이다. 안 걸리는 규칙은 규칙이 아니라 적어 둔 글이다
   * (`deel rules check` 가 같은 이야기를 다른 쪽에서 한다).
   */
  say('');
  say(`${칸(말('stats.blocked'))} ${셈.막힘.toLocaleString()}`);
  for (const x of 막힘차례(셈)) say(`    ${c.gray('·')} ${x.왜} ${c.gray(`${x.수}회`)}`);
  say(`${칸(말('stats.undos'))} ${셈.되돌림.toLocaleString()}`);
  if (셈.비밀) say(`${칸(말('stats.masked'))} ${셈.비밀.toLocaleString()}`);

  // 못 읽은 줄을 조용히 넘기면 위 숫자가 통째로 거짓말이 된다.
  if (셈.깨진줄) {
    say('');
    say(`  ${mark.warn} ${c.yellow(말('stats.broken', { n: 셈.깨진줄 }))}`);
  }
  if (셈.지난줄) say(`  ${c.gray(말('stats.older', { n: 셈.지난줄 }))}`);
  // 토큰과 돈은 이 파일에 없다. 없는 것을 지어내지 않고, 어디서 보는지 말한다.
  say('');
  say(`  ${c.gray(말('stats.noCost'))}`);
  say('');
  return 0;
}

/*
 * `deel trust [--off] [--list]` — 이 폴더의 프로젝트 설정을 읽을 것인가.
 *
 * 설정 파일 `.deel/config.json` 은 저장소에 딸려 온다. 남의 저장소 하나를
 * 받은 것만으로 오간 말이 다른 주소로 가고, `열쇠받기` 명령이 이 계정
 * 권한으로 도는 길이 여기다 — 그 명령은 도구 승인 화면보다 **앞**이라
 * 어떤 승인 정책으로도 안 걸린다.
 *
 * 그래서 기본은 안 읽는 것이고, 읽게 하는 것은 **사람이 먼저 낸 명령**이다.
 * 켤 때마다 물어보는 길도 있었지만 그 물음은 맨 앞에 뜨고, 앞에 뜨는 물음은
 * 안 읽힌다 — 사람은 대화를 하러 온 것이지 물음에 답하러 온 것이 아니다.
 */
function runTrust(flags) {
  const 여기 = process.cwd();

  if (flags.list === true || flags.list === 'true') {
    const 것들 = 믿는목록();
    say('');
    say(`  ${c.bold(말('trust.listTitle'))}`);
    say('');
    if (!것들.length) say(`  ${c.gray(말('trust.listNone'))}`);
    for (const x of 것들) say(`  ${c.gray('·')} ${x}`);
    say('');
    say(`  ${c.gray(말('trust.blockedTitle'))}`);
    for (const { 칸, 열쇠 } of 프로젝트금지칸) say(`  ${c.gray('·')} ${c.white(칸)}  ${c.gray(말(열쇠))}`);
    say('');
    return 0;
  }

  if (flags.off === true || flags.off === 'true') {
    const r = 안믿기(여기);
    say('');
    if (!r.ok) { say(`  ${mark.warn} ${말('trust.saveFail')} — ${r.왜}`); say(''); return 1; }
    say(`  ${mark.ok} ${r.뺐나 ? 말('trust.removed') : 말('trust.notListed')} ${c.gray(여기)}`);
    // 위 폴더 때문에 아직 믿기는 것을 말 안 하면, 「뺐습니다」 가 거짓말이 된다.
    if (r.위폴더) say(`  ${mark.warn} ${말('trust.parentStill')} ${c.gray(r.위폴더)}`);
    say('');
    return 0;
  }

  const r = 믿기(여기);
  say('');
  if (!r.ok) { say(`  ${mark.warn} ${말('trust.saveFail')} — ${r.왜}`); say(''); return 1; }
  say(`  ${mark.ok} ${r.이미 ? 말('trust.already') : 말('trust.trusted')} ${c.gray(여기)}`);
  say('');
  say(`  ${c.gray(말('trust.blockedTitle'))}`);
  for (const { 칸, 열쇠 } of 프로젝트금지칸) say(`  ${c.gray('·')} ${c.white(칸)}  ${c.gray(말(열쇠))}`);
  say('');
  return 0;
}

/*
 * `deel rules [check [명령]] [--tool Bash]` — 적어 둔 규칙이 진짜 그렇게 도나.
 *
 * 규칙은 적어 두면 조용히 돈다. 그래서 **잘못 적은 규칙은 티가 안 난다.**
 * `Bash(rm -rf*)` 는 `rm -rf /` 를 막지만 `sudo rm -rf /` 는 안 막는다 —
 * 무늬가 앞부터 맞아야 하기 때문이다. 적은 사람은 막힌 줄 알고 지내고,
 * 안 막혔다는 것은 진짜로 지워진 날에야 안다.
 *
 * 그래서 이 명령이 있다. 규칙을 적자마자 확인할 수 있어야 한다.
 */
function runRules(args, flags) {
  const cfg = 설정읽기();
  const 규칙들 = 규칙모으기(cfg);
  const 어느도구 = flags.tool ? String(flags.tool) : 'Bash';

  // `deel rules check "명령"` — 이 하나를 어느 규칙이 어떻게 정하나.
  if (args[0] === 'check' && args[1]) {
    const 값 = args.slice(1).join(' ');
    const r = 어떻게할까(규칙들, 어느도구, 확인인자(어느도구, 값));
    const 표 = { deny: c.red('막힙니다'), allow: c.green('묻지 않고 합니다'), 모름: c.yellow('모드가 정합니다') };
    say('');
    say(`  ${c.gray(어느도구)} ${c.white(값)}`);
    say(`    ${표[r.답]}`);
    // 어느 줄 때문인지까지 말해야 사람이 제 설정을 고칠 수 있다. 「막힙니다」
    // 만 말하면 무엇을 지워야 풀리는지 알 길이 없다.
    if (r.규칙) say(`    ${c.gray(`${r.출처}의 ${r.규칙}`)}`);
    else say(`    ${c.gray('걸리는 규칙이 없습니다')}`);
    say('');
    return 0;
  }

  // `deel rules check` — 설정에 적어 둔 보기를 다 돌린다. CI 에 거는 모양이다.
  if (args[0] === 'check') {
    const 보기들 = 확인목록(cfg);
    if (!보기들.length) {
      say('');
      say(`  ${mark.warn} 확인할 보기가 없습니다.`);
      say(`  ${c.gray('설정의 permissions 에 이렇게 적어 두면 여기서 돌립니다:')}`);
      say(`  ${c.gray('  "확인": [{ "도구": "Bash", "값": "sudo rm -rf /tmp", "이래야": "deny" }]')}`);
      say(`  ${c.gray('이래야 는 deny · allow · 모름 셋 중 하나입니다.')}`);
      say('');
      return 1;
    }
    const 결과 = 확인돌리기(규칙들, 보기들);
    const 틀린것 = 결과.filter((x) => !x.맞나);
    say('');
    for (const x of 결과) {
      const 표시 = x.맞나 ? c.green('✓') : c.red('✗');
      const 곁 = x.맞나
        ? c.gray(x.규칙 ? `${x.출처}의 ${x.규칙}` : '걸리는 규칙 없음')
        : c.red(`${x.이래야} 이어야 하는데 ${x.나온것}`);
      say(`  ${표시} ${c.gray(x.도구)} ${c.white(clip(x.값, 44))}  ${곁}`);
    }
    say('');
    say(틀린것.length
      ? `  ${mark.warn} ${결과.length}개 중 ${틀린것.length}개가 적어 둔 것과 다릅니다.`
      : `  ${mark.ok} ${결과.length}개 다 적어 둔 대로입니다.`);
    say('');
    // 틀리면 0 이 아닌 값으로 끝낸다. CI 가 보는 것은 이 숫자다.
    return 틀린것.length ? 1 : 0;
  }

  // 그냥 `deel rules` — 지금 걸려 있는 것을 늘어놓는다.
  say('');
  say(`  ${c.bold('적어 둔 규칙')} ${c.gray('— 이건 승인 모드보다 셉니다')}`);
  say('');
  if (!규칙들.deny.length && !규칙들.allow.length) say(`  ${c.gray('적어 둔 규칙이 없습니다.')}`);
  for (const r of 규칙들.deny) say(`  ${c.red('✗')} ${c.white(r.원문)}  ${c.gray(r.출처)}`);
  for (const r of 규칙들.allow) say(`  ${c.green('✓')} ${c.white(r.원문)}  ${c.gray(r.출처)}`);
  if (규칙들.정책곳) say(`  ${c.gray(`관리 정책 ${규칙들.정책곳} — 이 파일은 고칠 수 없습니다`)}`);
  if (규칙들.탈) say(`  ${mark.warn} ${c.yellow(규칙들.탈)}`);
  say('');
  say(`  ${c.gray('이 명령이 어떻게 되는지:')} ${c.cyan('deel rules check "sudo rm -rf /tmp"')}`);
  say(`  ${c.gray('적어 둔 보기를 다 돌리기:')}   ${c.cyan('deel rules check')}`);
  say('');
  return 0;
}

// 묶지 않고 심사 내용만 보기.
function runAudit() {
  say('');
  say(reviewSheet(audit(), new Date().toISOString().replace('T', ' ').slice(0, 19)));
  return 0;
}

/*
 * 기계가 읽는 심사 서류만 따로 뽑기.
 *
 * 반입 심사는 사람만 보는 절차가 아니다. 보안팀은 SBOM 을 스캐너에 먹이고,
 * 운영팀은 감사기록 사양을 보고 수집 규칙을 짠다. zip 을 통째로 만들지 않고
 * 그 두 장만 필요할 때가 실제로 더 잦다 — 심사 양식에 첨부하는 자리다.
 */
/*
 * `deel doc2md <파일> [--out 이름.md]` — 문서를 마크다운으로.
 *
 * 읽는 일은 이미 있는 세 읽개가 그대로 한다(docs.js · xlsx.js · pdf.js).
 * 여기서 새로 들이는 것은 없다 — 의존성 0개는 그대로다.
 *
 * `--out` 이 없으면 표준출력으로 낸다. 파이프에 바로 물리는 자리라
 * 여기서는 say() 를 안 쓴다 (completion 과 같은 규칙이다).
 */
function runDoc2md(args, flags) {
  const 파일 = args[0];
  if (!파일) {
    say(`  ${mark.warn} 바꿀 파일을 주세요: ${c.white('deel doc2md 보고서.pptx')}`);
    say(`  ${c.gray('직접 읽는 것:')} ${읽는갈래.join(c.gray(' · '))}`);
    return 1;
  }
  const r = 마크다운(파일);
  if (!r.ok) {
    say('');
    for (const 줄 of String(r.error).split('\n')) say(`  ${mark.warn} ${줄}`);
    say('');
    return 1;
  }
  // 못 읽은 쪽·자른 자리는 **반드시** 말한다. 조용히 자르면 받은 사람은
  // 그게 문서 전부인 줄 알고 그 위에 판단을 쌓는다.
  if (flags.out) {
    const 자리 = String(flags.out);
    writeFileSync(자리, r.md, 'utf8');
    say('');
    say(`  ${mark.ok} ${c.bold(자리)}  ${c.gray(r.summary)}`);
    for (const 줄 of r.말 ?? []) say(`  ${c.gray(`· ${줄}`)}`);
    say('');
    return 0;
  }
  // 글은 표준출력, 말은 표준오류로 나눈다. 그래야 `> 보고서.md` 로 받아도
  // 「몇 자에서 잘랐습니다」 가 파일 안에 섞여 들어가지 않는다.
  process.stdout.write(`${r.md}\n`);
  for (const 줄 of r.말 ?? []) process.stderr.write(`${줄}\n`);
  return 0;
}

function runSbom(flags) {
  const a = audit();
  const at = new Date();
  const 어느것 = String(flags.only ?? '').toLowerCase();
  const 낼것 = 어느것 === 'sbom' ? sbom(a, { at })
    : 어느것 === '명세' || 어느것 === 'spec' ? 심사명세(a, { at })
      : { sbom: sbom(a, { at }), 심사명세: 심사명세(a, { at }) };
  const 글 = JSON.stringify(낼것, null, 2);

  if (flags.out) {
    const 자리 = String(flags.out);
    writeFileSync(자리, 글, 'utf8');
    say('');
    say(`  ${mark.ok} ${c.bold(자리)}`);
    say('');
    for (const 줄 of 명세요약(심사명세(a, { at })).split('\n')) say(`  ${c.gray(줄)}`);
    say('');
    return 0;
  }

  /*
   * 표준출력으로 그냥 흘린다.
   *
   * `deel sbom > sbom.json` 이나 `deel sbom | jq` 로 쓰는 자리다. 여기에
   * 안내 글을 섞으면 그 파이프가 통째로 깨진다 — say() 를 쓰지 않는 이유다.
   */
  process.stdout.write(글 + '\n');
  return 0;
}

// 값을 안 받는 깃발. 뒤에 오는 낱말을 제 값으로 삼키지 않게 여기 적어 둔다.
//
// 실제로 이랬다 — deel run --json "검사 돌려줘" 를 쳤더니 --json 이 뒤의 말을
// 통째로 삼켰다. 시킬 말이 사라졌으니 "무엇을 시킬지 적어 주세요" 가 떴는데,
// 화면만 보면 왜 그런지 알 길이 없다. 깃발을 앞에 두는 것은 아주 흔한 습관이다.
const BOOL = new Set(['help', 'version', 'offline', 'online', 'continue', 'json', 'quiet', 'yes', 'no-tui', 'tui', 'all', 'no-hooks']);

function parse(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    // -v 도 받는다. 판 번호를 묻는 방법이 도구마다 달라서 셋 다 되게 둔다.
    if (a === '-v' || a === '-V') { flags.version = true; continue; }
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) flags[k] = inline;
      else if (!BOOL.has(k) && argv[i + 1] && !argv[i + 1].startsWith('-')) flags[k] = argv[++i];
      else flags[k] = true;
    } else args.push(a);
  }
  // 명령은 플래그가 아닌 첫 낱말. 없으면 상태 보기.
  return { cmd: args[0] ?? '', args: args.slice(1), flags };
}

function help() {
  banner();
  say(`  ${c.bold('사용법')}`);
  say('');
  say(`    ${c.cyan('deel')}                        대화 시작 (이 폴더에서)`);
  say(`    ${c.cyan('deel run "<시킬 말>"')}        한 번만 돌고 끝내기 (스크립트·배치용)`);
  say(`    ${c.cyan('deel scan')}                   이 PC 에 떠 있는 로컬 서버 전부 찾기`);
  say(`    ${c.cyan('deel sessions')}               이 폴더에 남아 있는 대화 목록`);
  say(`    ${c.cyan('deel setup')}                  연결 설정 (주소·키·모델)`);
  say(`    ${c.cyan('deel status')}                 연결 상태 보기`);
  say(`    ${c.cyan('deel diagnose')}               저장된 연결로 진단 다시 돌리기`);
  say(`    ${c.cyan('deel reset')}                  설정·기억·기록 지우기 ${c.gray('(그냥 치면 보여만 줍니다)')}`);
  say(`    ${c.cyan('deel completion <셸>')}        탭 완성 스크립트 ${c.gray('(bash · zsh · powershell)')}`);
  say(`    ${c.cyan('deel --version')}              판 번호 ${c.gray('(-v 도 됩니다)')}`);
  say('');
  say(`  ${c.bold('여러 로컬을 같이 쓸 때')}`);
  say('');
  say(`    ${c.cyan('deel scan --save')}            찾은 서버·모델을 전부 등록`);
  say(`    ${c.gray('--ports 9000,9100')}   기본 자리 말고 더 볼 포트`);
  say(`    ${c.gray('--host <주소>')}       기본은 127.0.0.1`);
  say(`    ${c.gray('--key <키>')}          키가 필요한 로컬 서버일 때`);
  say(`    ${c.gray('대화 중')} ${c.cyan('/model')} ${c.gray('로 서버·모델을 골라 바꿉니다.')}`);
  say('');
  say(`  ${c.bold('에디터 안에서 쓰기')} ${c.gray('— Zed · JetBrains · Neovim · Emacs')}`);
  say('');
  say(`    ${c.cyan('deel acp')}                    에디터가 띄우는 자리 (ACP). 사람이 직접 칠 명령은 아닙니다`);
  say(`    ${c.gray('에디터 설정에 이 명령을 적어 두면 그 안에서 deel 이 돕니다.')}`);
  say(`    ${c.gray('승인 창·모드 고르개·고친 파일 링크가 에디터 것으로 그려집니다.')}`);
  say('');
  say(`  ${c.bold('되돌아가기')} ${c.gray('— 지우려고 다시 깔지 않아도 됩니다')}`);
  say('');
  say(`    ${c.cyan('deel reset')}                  무엇이 얼마나 있는지 보여 주고 묻습니다 ${c.gray('(아무것도 안 지웁니다)')}`);
  say(`    ${c.gray('deel reset model')}      연결·프로필·잠긴 열쇠`);
  say(`    ${c.gray('deel reset memory')}     기억 (.deel/memory.md)`);
  say(`    ${c.gray('deel reset sessions')}   대화 기록`);
  say(`    ${c.gray('deel reset learned')}    배운 것 (이 PC + 이 폴더)`);
  say(`    ${c.gray('deel reset plugins')}    설치한 플러그인`);
  say(`    ${c.gray('deel reset all')}        위 전부 ${c.gray('— 플러그인·되돌리기·감사기록은 빼고')}`);
  say(`    ${c.gray('--hard')}                ${c.yellow('되돌리기 스냅샷·감사기록까지')}. all 에서만 씁니다`);
  say(`    ${c.gray('--yes')}                 안 묻고 지웁니다 (스크립트용)`);
  say(`    ${c.gray('.deel/mcp.json · .deelignore · DEEL.md 는 사람이 적은 것이라 어떤 길로도 안 건드립니다.')}`);
  say('');
  say(`  ${c.bold('사내 반입')}`);
  say('');
  say(`    ${c.cyan('deel audit')}                  의존성·네트워크 호출 자리 심사서 ${c.gray('(사람이 읽는 글)')}`);
  say(`    ${c.cyan('deel sbom')}                   SBOM·통신 목록·감사 사양 ${c.gray('(기계가 읽는 JSON)')}`);
  say(`    ${c.gray('--out <파일>')}       파일로 적기. 안 주면 표준출력 — ${c.cyan('deel sbom | jq')}`);
  say(`    ${c.gray('--only sbom|명세')}   한 장만`);
  say(`    ${c.cyan('deel pack')}                   위 셋 + 소스를 zip 하나로 묶기`);
  say(`    ${c.gray('--out <파일>')}       묶음 파일 이름. 기본은 deel-반입.zip`);
  say('');
  /*
   * 이 대목만 영어를 같이 적어 둔다.
   *
   * `--help` 는 아직 통째로 한국어다(langleak 검사가 그 줄 수를 못박고 있다).
   * 그 빚은 따로 갚을 것이고, **여기서 그 빚을 더 키우지는 않는다.** 영어로
   * 켠 사람이 이 대목을 못 읽으면 「내가 적은 설정이 왜 안 먹지」 를 영영
   * 모른 채로 남는데, 그건 못 읽어도 되는 줄이 아니다.
   */
  if (언어() === 'ko') {
    say(`  ${c.bold('프로젝트 설정 신뢰')}`);
    say('');
    say(`    ${c.cyan('deel trust')}                  이 폴더의 ${c.gray('.deel/config.json')} 을 읽게 합니다`);
    say(`    ${c.gray('--off')}              다시 안 읽게`);
    say(`    ${c.gray('--list')}             믿는 폴더와, 믿어도 프로젝트가 못 정하는 칸`);
    say(`    ${c.gray('설정 파일은 저장소에 딸려 옵니다. 남의 것을 그냥 읽으면 주소도 열쇠 받는 명령도 그쪽이 정합니다.')}`);
    say('');
    say(`    ${c.cyan('deel rules')}                  적어 둔 승인 규칙을 늘어놓습니다`);
    say(`    ${c.cyan('deel rules check "<명령>"')}   그 명령을 어느 규칙이 어떻게 정하는지`);
    say(`    ${c.cyan('deel rules check')}            설정에 적어 둔 보기를 다 돌립니다 ${c.gray('(CI 에 겁니다)')}`);
    say(`    ${c.gray('Bash(rm -rf*) 는 sudo rm -rf 를 안 막습니다. 적은 사람은 막힌 줄 알고 지냅니다.')}`);
    say('');
    say(`    ${c.cyan('deel stats')}                  이 폴더에서 무엇을 했는지 ${c.gray('(.deel/audit.jsonl 요약)')}`);
    say(`    ${c.gray('--days N · --all · --json')}  기간을 바꾸거나, 전부, 또는 기계가 읽을 모양으로`);
    say('');
    say(`    ${c.cyan('deel doctor')}                 붙기 전에 무엇이 막고 있는지 ${c.gray('(프록시·인증서·열쇠·모델 목록)')}`);
    say(`    ${c.cyan('deel config explain <칸>')}    그 값이 어느 층에서 온 것인지 ${c.gray('(정책 · 환경변수 · 프로젝트 · 이 PC)')}`);
  } else {
    say(`  ${c.bold('Project config trust')}`);
    say('');
    say(`    ${c.cyan('deel trust')}                  Read this folder's ${c.gray('.deel/config.json')}`);
    say(`    ${c.gray('--off')}              Stop reading it again`);
    say(`    ${c.gray('--list')}             Trusted folders, and the keys a project may never set`);
    say(`    ${c.gray('A config file ships with the repository. Read a stranger’s and it picks the endpoint, and the command that fetches your key.')}`);
    say('');
    say(`    ${c.cyan('deel rules')}                  List the approval rules in force`);
    say(`    ${c.cyan('deel rules check "<cmd>"')}    Which rule decides that command, and how`);
    say(`    ${c.cyan('deel rules check')}            Run the examples from your config ${c.gray('(for CI)')}`);
    say(`    ${c.gray('Bash(rm -rf*) does not stop sudo rm -rf. The person who wrote it believes it does.')}`);
    say('');
    say(`    ${c.cyan('deel stats')}                  What happened in this folder ${c.gray('(summarises .deel/audit.jsonl)')}`);
    say(`    ${c.gray('--days N · --all · --json')}  Change the window, read everything, or emit JSON`);
    say('');
    say(`    ${c.cyan('deel doctor')}                 What is blocking the connection ${c.gray('(proxy · certs · key · model list)')}`);
    say(`    ${c.cyan('deel config explain <key>')}   Which layer that value came from ${c.gray('(policy · env · project · this PC)')}`);
  }
  say('');
  say(`  ${c.bold('대화 시작 옵션')}`);
  say('');
  say(`    ${c.gray('--root <폴더>')}      작업 범위. 기본은 지금 폴더`);
  say(`    ${c.gray('--mode <모드>')}      auto(기본) / confirm / strict`);
  say(`    ${c.gray('--work <모드>')}      auto(기본·종합) / code / plan / architect / debug / inspect / ask / orchestrator`);
  say(`    ${c.gray('--level <수준>')}     쉬움(기본) / 개발자`);
  say(`    ${c.gray('--ctx <길이>')}       컨텍스트 길이 직접 지정 (655360 · 640k · 128k). 없으면 서버에 맞춤`);
  say(`    ${c.gray('--max-tokens <길이>')} 한 번에 받을 답 길이 상한 (32k). 큰 파일이 잘리면 올린다 — /out 과 같은 값`);
  say(`    ${c.gray('--think <수준>')}     off / low / medium(기본) / high / xhigh / max`);
  say(`    ${c.gray('--effort <배분>')}    even(균일) / save(절약, 기본) / deep(깊게)`);
  say(`    ${c.gray('--no-tui')}           입력 상자 없이 줄 화면으로 (파이프·기록·좁은 터미널)`);
  say(`    ${c.gray('--no-hooks')}         이번 판만 훅을 끄고 돕니다 (.deel/hooks.json · /hooks)`);
  // 실행 모드 셋. 기본이 잠겨 있다는 것을 여기서 분명히 말한다 —
  // 「--online 이 있다」 보다 「기본은 안 나간다」 가 사람이 알아야 할 쪽이다.
  say(`    ${c.gray('(기본)')}             ⌂ 이 안 — 바깥 주소면 한 번 물어보고 기억합니다`);
  say(`    ${c.gray('--online')}           ↗ 바깥 — 묻지 않고 나갑니다 ${c.gray('(스크립트·CI 처럼 물어볼 사람이 없을 때)')}`);
  say(`    ${c.gray('--offline')}          ⛊ 봉인 — 기억해 둔 허가까지 무시하고 막습니다 ${c.gray('(사내망은 그대로 갑니다)')}`);
  say(`    ${c.gray('--continue')}         이 폴더에서 가장 최근 대화 이어하기`);
  say(`    ${c.gray('--resume <id>')}      골라서 이어하기 (deel sessions 로 id 확인)`);
  say('');
  say(`  ${c.bold('한 번만 돌리기')} ${c.gray('— 스크립트·배치에서 부를 때')}`);
  say('');
  say(`    ${c.cyan('deel run "검사 돌리고 실패한 것만 알려줘"')}`);
  say(`    ${c.cyan('echo "..." | deel run')}      ${c.gray('시킬 말을 표준입력으로 넣어도 됩니다')}`);
  // 대화 화면에서 손으로 치던 슬래시 명령을 그대로 배치에 옮기는 자리 (src/oneshot.js).
  say(`    ${c.cyan('deel run /배포점검 서버3')}     ${c.gray('.claude/commands 에 적어 둔 슬래시 명령도 그대로')}`);
  say(`    ${c.cyan('deel run --output-schema out.schema.json "..." | jq -r .term')}`);
  say(`    ${c.gray('deel -p "..." 도 같습니다.')} ${c.gray('위 대화 시작 옵션을 그대로 씁니다.')}`);
  say('');
  say(`    ${c.gray('--json')}             결과를 JSON 한 덩이로 (답·도구 횟수·토큰·끝난 까닭)`);
  say(`    ${c.gray('--quiet')}            도구가 무엇을 했는지 안 적음 (오류는 그래도 적음)`);
  say(`    ${c.gray('--yes')}              승인이 필요한 것도 그냥 실행. ${c.yellow('기본은 거부입니다')}`);
  /*
   * 답의 모양을 못 박는 자리 (src/agent/outschema.js).
   *
   * 이걸 주면 표준출력은 **그 JSON 하나**다 — 울타리도 인사말도 안 섞인다.
   * 안 맞으면 한 번 더 시키고, 그래도 안 맞으면 7 로 끝낸다. 파이프 뒤에
   * `jq` 를 붙일 수 있게 하는 것이 이 깃발의 전부다.
   */
  say(`    ${c.gray('--output-schema <파일>')}  답을 JSON Schema 모양으로 받음 ${c.gray('(안 맞으면 7)')}`);
  say(`    ${c.gray('답은 표준출력, 도구 기록은 표준오류로 나갑니다 — 파이프로 넘겨도 답만 넘어갑니다.')}`);
  // 이 줄은 src/oneshot.js 의 EXIT 와 짝이다. test/exitcode.test.js 가 둘이
  // 어긋나면 빨개진다 — 한 판 동안 refusal(6) 이 여기서 빠져 있었고, 그
  // 사실을 말해 주는 자리가 아무 데도 없었다.
  say(`    ${c.gray('끝난 까닭이 종료코드에 담깁니다:')} ${c.gray('0 끝냄 · 1 오류 · 2 걸음수상한 · 3 헛돎 · 4 중단 · 5 말없이끊김 · 6 거절 · 7 모양안맞음')}`);
  say('');
  say(`  ${c.bold('진단 직접 지정')} ${c.gray('— 설정을 남기지 않고 확인만 할 때')}`);
  say('');
  say(`    deel diagnose --url <주소> --key <키> --model <모델> --out report.txt`);
  say('');
  say(`  ${c.bold('환경변수')}`);
  say('');
  say(`    ${c.gray('DEEL_API_KEY')}          키를 파일에 안 남기고 싶을 때 (파일보다 우선)`);
  say(`    ${c.gray('NODE_EXTRA_CA_CERTS')}   사내 인증서를 쓰는 게이트웨이일 때`);
  say(`    ${c.gray('HTTPS_PROXY')}           프록시를 거쳐야 할 때`);
  say('');
}

async function main() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE) {
    say(`  Node ${MIN_NODE} 이상이 필요합니다. 지금은 ${process.versions.node} 입니다.`);
    process.exit(1);
  }

  const { cmd: 친명령, args, flags } = parse(process.argv.slice(2));

  // 서류를 뽑는 명령(audit·sbom·pack)이 어느 말로 나갈지를 여기서 정한다.
  말정하기();

  /*
   * `deel online` · `deel offline` 은 깃발의 별칭이다.
   *
   * 사람은 이것을 「모드로 켠다」 고 생각한다 — `deel --online` 보다
   * `deel online` 이 먼저 손에서 나온다. 둘 다 받는다. 안 받으면 "모르는
   * 명령입니다" 가 뜨는데, 그 화면에서는 무엇을 잘못 쳤는지 알 길이 없다.
   */
  const cmd = (친명령 === 'online' || 친명령 === 'offline')
    ? (flags[친명령] = true, '')
    : 친명령;

  /*
   * 판 번호.
   *
   * 연결이 없어도 답해야 한다. `deel --version` 은 "이게 깔려 있나, 무슨 판인가"
   * 를 묻는 것이지 일을 시키는 것이 아닌데, 전에는 설정이 없다는 말이 먼저 나와서
   * 깔린 것 자체가 아닌 줄 알았다. 사내에 반입한 판을 확인할 때 제일 먼저 치는
   * 명령이기도 하다.
   */
  if (flags.version || cmd === 'version') { say(판번호()); return 0; }

  if (flags.help || cmd === 'help') { help(); return 0; }

  switch (cmd) {
    // 한 번만 돌고 끝난다. 스크립트·배치에서 부르는 자리다.
    //
    // -p 는 다른 도구들이 쓰는 이름에 맞춘 것이다. 깃발처럼 생겼지만 명령이라,
    // deel -p "..." 처럼 치면 그대로 여기로 온다.
    case 'run':
    case '-p':
      return runOnce({
        prompt: args.join(' '),
        root: flags.root ? String(flags.root) : undefined,
        mode: flags.mode ? String(flags.mode) : undefined,
        work: flags.work ? String(flags.work) : undefined,
        ctx: flags.ctx ? parseSize(String(flags.ctx)) : undefined,
        maxTokens: flags['max-tokens'] ? parseSize(String(flags['max-tokens'])) : undefined,
        think: flags.think ? String(flags.think) : undefined,
        effort: flags.effort ? String(flags.effort) : undefined,
        offline: flags.offline === true || flags.offline === 'true',
        online: flags.online === true || flags.online === 'true',
        yes: flags.yes === true || flags.yes === 'true',
        hooks: flags['no-hooks'] === true ? false : undefined,
        json: flags.json === true || flags.json === 'true',
        quiet: flags.quiet === true || flags.quiet === 'true',
        // 답의 모양을 못 박는다. 이게 있으면 표준출력은 그 JSON 하나다.
        outputSchema: flags['output-schema'] ? String(flags['output-schema']) : undefined,
      });
    case '':
    case 'chat':
      return chatLoop({
        root: flags.root ? String(flags.root) : undefined,
        mode: flags.mode ? String(flags.mode) : undefined,
        work: flags.work ? String(flags.work) : undefined,
        level: flags.level ? String(flags.level) : undefined,
        ctx: flags.ctx ? parseSize(String(flags.ctx)) : undefined,
        maxTokens: flags['max-tokens'] ? parseSize(String(flags['max-tokens'])) : undefined,
        think: flags.think ? String(flags.think) : undefined,
        effort: flags.effort ? String(flags.effort) : undefined,
        // 입력 상자를 쓸지. 안 주면 null — 그러면 화면 쪽이 상황을 보고 정한다.
        //   --no-tui  입력 상자 없이 줄 화면으로 (파이프·기록·좁은 터미널)
        //   --tui     터미널이면 무조건 입력 상자를 켠다
        tui: flags['no-tui'] === true ? false : (flags.tui === true ? true : null),
        // 훅을 이번 판만 끈다 (safety/hooks.js). 훅이 망가졌을 때 고칠 길이
        // 훅 파일을 지우는 것뿐이면 안 된다.
        hooks: flags['no-hooks'] === true ? false : undefined,
        offline: flags.offline === true || flags.offline === 'true',
        online: flags.online === true || flags.online === 'true',
        continue: flags.continue === true || flags.c === true,
        sessionId: typeof flags.resume === 'string' ? flags.resume : (flags.resume === true ? null : undefined),
      });
    /*
     * 에디터가 자식 프로세스로 띄우는 자리 (ACP).
     *
     * 사람이 직접 칠 명령이 아니다. 쳐도 안 죽고 그냥 기다리는데, 그건 규격이
     * 그렇게 정한 것이라 맞다 — 에디터가 표준입력으로 말을 걸어 주기를 기다린다.
     * 왜 아무 반응이 없는지는 표준오류에 적어 둔다.
     */
    case 'acp':
      return acp({
        root: flags.root ? String(flags.root) : undefined,
        mode: flags.mode ? String(flags.mode) : undefined,
        work: flags.work ? String(flags.work) : undefined,
        ctx: flags.ctx ? parseSize(String(flags.ctx)) : undefined,
        maxTokens: flags['max-tokens'] ? parseSize(String(flags['max-tokens'])) : undefined,
        think: flags.think ? String(flags.think) : undefined,
        effort: flags.effort ? String(flags.effort) : undefined,
        hooks: flags['no-hooks'] === true ? false : undefined,
        offline: flags.offline === true || flags.offline === 'true',
        online: flags.online === true || flags.online === 'true',
      });
    case 'status':
      return showStatus();
    case 'setup':
      return runSetup();
    case 'diagnose':
      return runDiagnose(flags);
    /*
     * doctor 는 diagnose 의 **앞자락**이다.
     *
     * diagnose 는 「모델이 일을 할 수 있나」 를 잰다. 그건 붙은 다음 이야기고,
     * 사내에서 막히는 자리는 대부분 그 앞이다 — 프록시·사내 루트·열쇠·인증서.
     * 그래서 자리 조건을 먼저 하나씩 보고, 닿으면 이어서 모델까지 본다.
     */
    case 'doctor':
      return runDoctor(flags);
    case 'pack':
      return runPack(flags);
    case 'audit':
      return runAudit();
    case 'stats':
      return runStats(flags);
    case 'config':
      return runConfig(args, flags);
    case 'trust':
      return runTrust(flags);
    case 'rules':
      return runRules(args, flags);
    case 'doc2md':
      return runDoc2md(args, flags);
    case 'sbom':
      return runSbom(flags);
    case 'scan':
      return runScan(flags);
    case 'sessions':
    case 'ls':
      return runSessions(flags);
    /*
     * 초기화.
     *
     * setup 과 달리 **설정을 안 읽는다.** 초기화를 찾는 까닭이 대개 설정이
     * 깨져서인데, 읽고 시작하면 그 자리에서 못 넘어간다.
     */
    case 'reset':
      return runReset(args, flags);
    /*
     * 탭 완성 스크립트를 낸다 (src/completion.js).
     *
     * 표준출력으로만 낸다 — `deel completion bash > ~/.deel-completion.bash`
     * 처럼 바로 파이프에 물릴 수 있어야 한다. 그래서 여기서는 say() 를 안 쓴다.
     */
    case 'completion':
      return runCompletion(args);
    default:
      say('');
      say(`  ${c.red('모르는 명령')} ${c.bold(cmd)}`);
      help();
      return 1;
  }
}

/**
 * 끝낸다.
 *
 * process.exit() 을 바로 부르면 안 된다. fetch 가 살려 둔 소켓이 닫히는 중일 때
 * 끊으면 윈도우에서 libuv 가 abort 한다 — 화면에는 정상으로 보이는데 종료코드가
 * 3221226505 로 나온다. `deel scan` 이 실제로 그랬다.
 *
 * 그래서 연결을 먼저 닫고, 종료코드만 정해 두고 이벤트 루프가 저절로 비기를
 * 기다린다. 그래도 안 비면(무언가 물고 있으면) 잠깐 뒤에 확실히 끝낸다.
 * 그 타이머는 unref 라서, 정상적으로 끝나는 길을 막지 않는다.
 */
async function 끝내기(code) {
  process.exitCode = code;
  await closeConnections();
  const 마지막수단 = setTimeout(() => process.exit(code), 400);
  마지막수단.unref();
}

main()
  .then((code) => 끝내기(code ?? 0))
  .catch(async (err) => {
    say('');
    say(`  ${c.red('오류')} ${err?.message ?? err}`);
    if (process.env.DEEL_DEBUG) say(c.gray(err?.stack ?? ''));
    say('');
    await 끝내기(1);
  });
