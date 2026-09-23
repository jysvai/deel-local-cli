#!/usr/bin/env node
// deel 진입점. 외부 의존성 없음 — Node 표준 기능만 씁니다.
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { c, say, mark, rule, clip, width } from '../src/ui/ansi.js';
import { runSetup, runDiagnose, showStatus, banner } from '../src/setup.js';
import { chatLoop } from '../src/repl.js';
import { runOnce, EXIT, 실패덩이 } from '../src/oneshot.js';
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
import { 믿기, 안믿기, 믿는목록, 프로젝트금지칸, 너무넓은자리 as 넓은자리 } from '../src/safety/trust.js';
import { load as 설정읽기, homeDir, 이PC설정값 } from '../src/config.js';
import { 규칙모으기, 어떻게할까, 확인목록, 확인인자, 확인돌리기 } from '../src/safety/policy.js';
import { 기록자리, 세기, 도구차례, 막힘차례, 셈JSON } from '../src/stats.js';
import { 진찰 } from '../src/doctor.js';
import { 설명, 설명줄들 } from '../src/configexplain.js';
import { runEval } from '../src/eval/run.js';

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
  /*
   * 찾았나 못 찾았나를 **끝값으로도** 말한다.
   *
   * 여기가 `return r.이긴층 ? 0 : 0` 이었다 — 두 갈래를 적어 놓고 같은 수를 냈다.
   * 그래서 칸 이름에 오타를 쳐도, 아무 데도 안 적힌 칸을 물어도 성공으로 끝났다.
   * 이 명령은 스크립트에서 값의 출처를 캐묻는 길이고, 그 길에서 끝값은 유일한
   * 계약이다 — 화면 글자를 grep 하게 만들면 계약이 아니다.
   *
   * 금지·허락처럼 **합쳐지는** 칸은 이긴 층이 없어도 찾은 것이다 (configexplain
   * 의 합치는칸). 이긴 층만 보면 분명히 걸려 있는 규칙이 「못 찾았다」 가 된다.
   */
  const 찾음 = !!(r.이긴층 || r.합침?.length);
  if (flags.json === true) { process.stdout.write(JSON.stringify(r) + '\n'); return 찾음 ? 0 : 1; }

  const 표 = { 값: c.bold('='), 없음: c.gray('·'), 이김: mark.ok, 아래: c.gray('·'), 안읽음: c.yellow('⚠'), 참고: c.gray('i') };
  say('');
  say(`  ${c.bold(칸)}`);
  say('');
  for (const 줄 of 설명줄들(r)) {
    const 글 = 줄.갈래 === '값' ? c.white(줄.글) : 줄.글;
    say(`  ${표[줄.갈래] ?? ' '} ${글}${줄.곁 ? `  ${c.gray(줄.곁)}` : ''}`);
  }
  say('');
  return 찾음 ? 0 : 1;
}

/*
 * `deel doctor` — 붙기 전에 이 자리의 조건을 하나씩 본다 (src/doctor.js).
 *
 * 화면 한 장이 그대로 담당자에게 보낼 질문이 되게 하는 것이 목표다. 그래서
 * 값마다 **어디서 온 값인지**를 같이 적는다 — 환경변수가 파일을 이기고 있는
 * 것을 모르면 사람은 파일만 백 번 고친다.
 */
async function runDoctor(flags) {
  const { load: 읽기, activeProfile: 고른것, resolveKey: 열쇠풀기, configPath: 설정경로, 소식줄들 } =
    await import('../src/config.js');
  const { 지금모드, 바깥인가, 나갈수있나, 봉인됐나 } = await import('../src/safety/runmode.js');
  const { allowEndpoint } = await import('../src/safety/network.js');

  banner();
  let cfg = null;
  /*
   * 설정이 망가져도 멈추지 않고 아래에서 말한다 — **망가진 까닭까지.**
   *
   * 여기가 `catch {}` 였다. 그러면 「아래에서 말한다」 가 거짓말이 된다: 진찰은
   * 파일이 있으니 ✓설정 파일, 프로필이 안 읽혔으니 ✗프로필 을 찍었고, 쉼표 하나
   * 틀린 몇째 줄이라는 진짜 까닭은 이 catch 에서 사라졌다.
   */
  let 설정탈 = null;
  try { cfg = 읽기(); }
  catch (err) { 설정탈 = { 자리: err?.설정자리 ?? null, 까닭: err?.까닭 ?? String(err?.message ?? err) }; }
  const prof = cfg ? 고른것(cfg) : null;

  /*
   * 두드려도 되는 자리인지 먼저 본다.
   *
   * 진단한다고 자물쇠를 넘어가면 안 된다 — 여기서 한 번 나가 버리면 「나가는
   * 주소는 사람이 정한 하나뿐」 이 진단 명령 하나로 깨진다.
   */
  const 모드 = 지금모드({ online: flags.online === true, offline: 봉인됐나({ 깃발: flags.offline, prof, cfg }) });
  const 나감 = prof ? 나갈수있나(모드, { 바깥: 바깥인가(prof.baseUrl), 허가: prof.online === true }) : { 물어볼까: false };
  const 두드려도되나 = !!prof && !나감.물어볼까 && !모드.허가무시;
  if (두드려도되나) allowEndpoint(prof.baseUrl);

  const { 줄들 } = await 진찰({
    cfg, prof,
    root: flags.root ? String(flags.root) : process.cwd(),
    설정자리: 설정경로(),
    설정탈,
    열쇠: prof ? 열쇠풀기(prof) : '',
    바깥가도되나: 두드려도되나,
  });

  const 표 = { ok: mark.ok, warn: mark.warn, no: c.red('✗'), unknown: c.gray('?') };
  say('');
  /*
   * 모아 둔 소식을 여기서 비운다. 안 비우면 「알릴 것이 없다」 와 똑같이
   * 생긴다 — 정책 파일이 깨져서 관리자가 건 금지가 통째로 안 걸리는
   * 상태조차 조용하다 (config.js 의 소식줄들 머리말).
   */
  for (const 줄 of 소식줄들(cfg)) say(줄);
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
  /*
   * 못 읽는 `--days` 는 멈춘다.
   *
   * 여기가 `parseInt(…) || 30` 이었다. `--days abc` 도 `--days 0` 도 조용히 30일이
   * 되고, 화면은 물어본 적 없는 「최근 30일」 을 찍고 0 으로 끝났다. 감사 기간을
   * 인자로 받는 배치는 엉뚱한 기간을 세어 놓고 초록불로 넘어간다.
   * 이 판이 `--ctx` · `--max-tokens` 를 같은 까닭으로 고쳤는데 이 줄만 남아 있었다.
   */
  if (flags.days !== undefined) {
    const 적은것 = String(flags.days).trim();
    if (!/^\d+$/.test(적은것) || Number(적은것) < 1) {
      process.stderr.write(`\n  --days 에는 1 이상 숫자를 주세요: ${String(flags.days)}\n`);
      process.stderr.write('  기간 없이 전부 보려면 --all 을 쓰세요.\n\n');
      return EXIT.usage;
    }
  }
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
  // 됐는지 모르는 줄이 있으면 **있다고** 말한다. 안 말하면 위 실패율이
  // 「다 됐다」 로 읽힌다 — 모르는 것을 좋은 쪽으로 세는 것과 같아진다.
  const 모름말 = 셈.도구모름 ? c.yellow(`  · ${말('stats.unknown', { n: 셈.도구모름 })}`) : '';
  say(`${칸(말('stats.tools'))} ${셈.도구.toLocaleString()}${실패말}${모름말}`);

  const 표 = 도구차례(셈);
  if (표.length) {
    say('');
    for (const x of 표) {
      const 실패 = x.실패 ? c.yellow(`  ${말('stats.failed', { n: x.실패 })}`) : '';
      const 모름 = x.모름 ? c.yellow(`  ${말('stats.unknown', { n: x.모름 })}`) : '';
      say(`    ${c.white(x.이름.padEnd(12))} ${String(x.수).padStart(6)}${실패}${모름}`);
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
/*
 * ── 믿으면 너무 많은 것이 같이 믿기는 자리 ─────────────────────────────
 *
 * 믿기는 **하위 폴더까지** 간다(safety/trust.js 의 믿나). 저장소마다 스무 번 답하지
 * 않게 하려는 것인데, 그 규칙이 집 폴더에서는 거꾸로 돈다. `~` 에서 `deel trust` 를
 * 치면 `~/src` 아래 받아 둔 남의 저장소가 **전부** 믿긴다 — 도구 승인보다 앞에서
 * 명령을 돌리는 설정(열쇠받기는 걷히지만 deny·mode·hooks 는 읽힌다)까지.
 *
 * 한동안은 deel 이 집 폴더에서 켤 때마다 「deel trust 를 치라」 고 권하기까지 했다
 * (config.js 의 집설정파일인가 머리말). 그 권유는 걷었고, 여기서는 치더라도 안 적는다.
 *
 * 막는 자리는 셋이다. 사용자 집 폴더와 그 위, deel 설정 폴더를 품은 폴더와 그 위,
 * 드라이브·파일시스템 뿌리. 뺄 때(--off)는 안 막는다 — 좁히는 쪽은 언제나 된다.
 */
/*
 * 자는 safety/trust.js 에 하나만 둔다. 여기 따로 있을 때는 **적을 때만** 돌아서, 목록 파일에
 * 이미 적힌 `"C:\\"` 는 믿나() 가 그대로 믿었다. 그리고 resolve 만 써서 집 폴더를 가리키는
 * 정션 안에서 치면 지나갔다 — 그쪽 자가 링크를 따라가서 잰다.
 */
function 너무넓은자리(폴더) {
  return 넓은자리(폴더);
}

function runTrust(flags) {
  /*
   * `--root` 를 받는다. 안 주면 켠 자리.
   *
   * 여기가 `process.cwd()` 로 박혀 있었다. `--root` 는 아는 깃발이라 「모르는 깃발」
   * 문에서도 안 걸려, `deel trust --root <저장소>` 는 값을 삼키고 **켠 자리**를
   * 믿는 목록에 적었다. 믿을 자리를 잘못 고르는 것은 조용히 넘어가면 안 되는
   * 종류다 — 이 판이 깃발 읽기를 다시 짠 까닭이 「깃발이 조용히 아무 일도 안
   * 하는 것」 을 없애려는 것이었다. rules 도 같은 문에 남아 있었다.
   */
  const 여기 = flags.root ? resolve(String(flags.root)) : process.cwd();

  if (flags.list === true || flags.list === 'true') {
    const 것들 = 믿는목록();
    say('');
    say(`  ${c.bold(말('trust.listTitle'))}`);
    say('');
    if (!것들.length) say(`  ${c.gray(말('trust.listNone'))}`);
    // 적힌 넓은 자리는 믿나() 가 읽을 때 버린다. 목록도 그렇다고 말한다 — 안 그러면 믿긴다고 적힌 줄이 거짓이다.
    for (const x of 것들) say(`  ${c.gray('·')} ${x}${너무넓은자리(x) ? `  ${c.yellow(말('trust.listIgnoredWide'))}` : ''}`);
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
    else if (r.아직믿김) say(`  ${mark.warn} ${말('trust.stillTrustedEnv')}`);
    say('');
    return 0;
  }

  /*
   * 없는 폴더는 믿는 목록에 안 적는다. 적어 두면 그 이름으로 폴더가 생기는 날
   * 아무도 안 물어본 채로 믿긴다 — 오타 하나가 미래의 저장소를 미리 믿는 셈이다.
   * (뺄 때(--off)는 안 본다. 없는 줄을 지우는 것은 언제나 된다.)
   */
  let 폴더인가 = false;
  try { 폴더인가 = statSync(여기).isDirectory(); } catch { 폴더인가 = false; }
  if (!폴더인가) {
    say('');
    say(`  ${mark.warn} 그런 폴더가 없습니다: ${c.gray(여기)}`);
    say(`  ${c.gray('  없는 자리는 믿는 목록에 안 적습니다 — 나중에 그 이름으로 폴더가 생기면 바로 믿기게 됩니다')}`);
    say('');
    return EXIT.error;
  }

  if (너무넓은자리(여기)) {
    say('');
    say(`  ${mark.warn} ${말('trust.refuseWide')} ${c.gray(여기)}`);
    say(`  ${c.gray('  ' + 말('trust.refuseWideWhy'))}`);
    say(`  ${c.gray('  ' + 말('trust.refuseWideHow'))}`);
    say('');
    return 1;
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
  /*
   * 어느 폴더의 규칙을 재나. `--root` 를 안 봐서 CI 가 거짓 초록을 받았다 —
   * `deel rules check --root $REPO` 가 켠 자리의 규칙을 재고 「다 적어 둔 대로입니다」
   * 로 0 을 냈다. 이 판이 load({ root }) 를 만들면서 run · chat · acp 는 고쳤는데
   * 이 문만 옛 길에 남아 있었다 (trust 도 같았다).
   */
  const cfg = 설정읽기({ root: flags.root ? String(flags.root) : process.cwd() });
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
  const 어느것 = String(flags.only ?? '').toLowerCase();
  /*
   * 모르는 `--only` 는 멈춘다.
   *
   * 여기가 「sbom 도 명세도 아니면 둘 다」 였다. `--only sbon` 오타 하나에 두 장이
   * 한 덩이로 나가고 0 으로 끝나니, `deel sbom --only sbon > sbom.cdx.json` 은
   * CycloneDX 가 아닌 파일을 만들고 스캐너에서야 터진다. 표준출력은 비워 둔다.
   */
  if (flags.only !== undefined && !['sbom', '명세', 'spec'].includes(어느것)) {
    process.stderr.write(`\n  --only 에는 sbom · 명세(spec) 중 하나를 주세요: ${String(flags.only)}\n\n`);
    return EXIT.usage;
  }
  const a = audit();
  const at = new Date();
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
const BOOL = new Set([
  'help', 'version', 'offline', 'online', 'continue', 'json', 'quiet', 'yes',
  'no-tui', 'tui', 'all', 'no-hooks',
  /*
   * `hard` 가 여기 빠져 있었다. 그래서 `deel reset --hard all --yes` 는
   * `--hard` 가 뒤의 `all` 을 제 값으로 삼켰다 — 지울 갈래가 사라지니 화면은
   * 「무엇을 지울지 같이 주세요」 를 찍고 **종료코드 0** 으로 끝났다.
   * 스크립트는 전체 초기화가 된 줄 알고 다음 줄로 넘어간다.
   */
  'hard',
  // trust --off · --list, scan --save · --pick. 여태 목록에 없어 뒤의 낱말을 삼킬 수 있었다.
  'off', 'list', 'save', 'pick',
  // eval --init · --keep (src/eval/run.js).
  'init', 'keep',
]);

/*
 * ── 값을 받는 깃발 ─────────────────────────────────────────────────────
 *
 * 여태는 BOOL 에 없으면 **무엇이든** 값 깃발로 쳤다. 그래서 두 가지가 샜다.
 *
 *   · 모르는 깃발이 뒤의 낱말을 값으로 삼켰다. `deel run --jsn 안녕` 은 `jsn=안녕`
 *     이 되어 시킬 말이 사라졌고, 화면은 「무엇을 시킬지 적어 주세요」 였다 —
 *     표준입력이 열려 있으면 거기서 서 버렸다. 오타는 한마디도 안 나왔다.
 *   · 값 깃발이 맨 끝에 값 없이 오면 `true` 가 됐고, 그게 `String(true)` 로
 *     "true" 라는 값이 됐다. `deel run 안녕 --root` 는 ./true 폴더를 만들어 그
 *     안에서 일했고, `--work --json` 은 오타 막이를 통째로 건너뛰었다.
 *
 * 그래서 받는 이름을 다 적는다. 없는 이름은 멈추고 이름을 말한다. 명령이 깃발을
 * 하나 더 읽게 되면 여기에도 적어야 한다 — 안 적으면 첫 판에 「모르는 깃발」 로
 * 튕기므로 조용히 새지는 않는다.
 */
const 값깃발 = new Set([
  'root', 'mode', 'work', 'level', 'ctx', 'max-tokens', 'think', 'effort', 'output-schema',
  'out', 'only', 'days', 'tool', 'url', 'key', 'model', 'host', 'ports', 'timeout', 'rm', 'delete',
  // run --check <명령> (agent/donecheck.js) · eval --repeat <수> (src/eval/run.js).
  'check', 'repeat',
]);
// 값을 줘도 되고 안 줘도 되는 깃발. `--resume` 만 치면 이어 할 대화를 고른다.
const 값골라깃발 = new Set(['resume']);

/*
 * 모르는 깃발에 **가장 가까운 아는 이름**을 짚는다 (글자 편집 거리).
 *
 * 「모르는 깃발입니다: --jsn」 만 적으면 사람은 도움말을 열어 한 줄씩 훑는다. 거의
 * 언제나 한두 글자 오타다. 너무 먼 것까지 짚으면 엉뚱한 깃발을 권하게 되므로
 * 두 글자, 그리고 이름 길이의 절반까지만 본다.
 */
function 가까운깃발(이름) {
  const 거리 = (a, b) => {
    let 앞 = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const 지금 = [i];
      for (let j = 1; j <= b.length; j++) {
        지금[j] = Math.min(앞[j] + 1, 지금[j - 1] + 1, 앞[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      앞 = 지금;
    }
    return 앞[b.length];
  };
  let 고른 = null;
  let 최소 = Infinity;
  for (const k of [...BOOL, ...값깃발, ...값골라깃발]) {
    const n = 거리(String(이름), k);
    if (n < 최소) { 최소 = n; 고른 = k; }
  }
  return 고른 && 최소 <= Math.min(2, Math.floor(String(이름).length / 2)) ? `--${고른}` : null;
}

function parse(argv) {
  const flags = {};
  const args = [];
  const 탈 = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    /*
     * `--` 뒤는 전부 낱말이다 — 유닉스 도구들이 다 그렇게 읽는다.
     *
     * 여기가 없어서 `--` 가 이름이 빈 깃발이 되어 뒤의 말을 값으로 삼켰다.
     * `deel run -- "--json 이 뭐야"` 처럼 대시로 시작하는 말을 넘길 길이 없었다.
     */
    if (a === '--') { args.push(...argv.slice(i + 1)); break; }
    if (a === '-h') { flags.help = true; continue; }
    // -v 도 받는다. 판 번호를 묻는 방법이 도구마다 달라서 셋 다 되게 둔다.
    if (a === '-v' || a === '-V') { flags.version = true; continue; }
    /*
     * 대시 하나로 시작하는 낱말(`-x` · `-jq`)도 깃발이다 — 모르는 이름이라 멈춘다.
     *
     * 여태는 그대로 시킬 말에 섞였다. `deel run -n 5 고쳐` 를 치면 모델은 「-n 5 고쳐」 를
     * 받고 일을 시작했다 — 긴 깃발의 오타는 멈추게 해 놓고 짧은 쪽은 문이 열려 있었다.
     * `-p` 는 깃발처럼 생긴 **명령 이름**이라 명령 자리(맨 앞 낱말)에서만 받는다.
     * 대시 하나(`-`) · 음수(`-1`) · 빈칸 섞인 한 덩이(`"-x 는 뭐야"`)는 낱말이다.
     */
    if (/^-[A-Za-z][\w-]*$/.test(a) && !(a === '-p' && !args.length)) { 탈.push({ 갈래: '모름', 깃발: a, 가까운: null }); continue; }
    if (a.startsWith('--')) {
      /*
       * 첫 `=` 에서만 가른다.
       *
       * `split('=')` 은 둘째 `=` 뒤를 버렸다. 그래서
       * `--url=https://gw/openai?api-version=2024-10-21` 이 `…?api-version` 으로
       * 잘려 붙었다 — Azure 주소는 거의 다 이 모양이다.
       */
      const 몸 = a.slice(2);
      const 자리 = 몸.indexOf('=');
      const k = 자리 >= 0 ? 몸.slice(0, 자리) : 몸;
      const inline = 자리 >= 0 ? 몸.slice(자리 + 1) : undefined;
      if (!BOOL.has(k) && !값깃발.has(k) && !값골라깃발.has(k)) { 탈.push({ 갈래: '모름', 깃발: a, 가까운: 가까운깃발(k) }); continue; }
      if (inline !== undefined) {
        /*
         * 켜고 끄는 깃발에 붙은 값은 true · false 만 읽는다.
         *
         * 여태는 붙은 글자가 그대로 값이 됐다. 읽는 쪽은 `=== true` 나 `'true'` 로 보니
         * `--json=yes` · `--json=1` 은 **꺼진 것**으로 돌았다 — 스크립트는 JSON 을 기다리는데
         * 맨 글이 오고 종료코드는 0 이었다. 반대로 `--json=false` 는 글자 'false' 라 참으로
         * 읽는 자리가 있었다. 둘 다 여기서 가른다.
         */
        if (BOOL.has(k)) {
          const 뜻 = inline.toLowerCase();
          if (뜻 === 'true') flags[k] = true;
          else if (뜻 !== 'false') 탈.push({ 갈래: '켜끄기', 깃발: `--${k}`, 값: inline });
        } else if (inline === '' && 값깃발.has(k)) 탈.push({ 갈래: '값없음', 깃발: `--${k}` });
        else flags[k] = inline;
        continue;
      }
      const 다음 = argv[i + 1];
      if (BOOL.has(k)) flags[k] = true;
      // `--root ""` 는 `--root=` 와 같다. 빈 값을 받아 두면 읽는 쪽이 「안 줬다」 로 쳐서 조용히 지금 폴더에서 돈다.
      else if (다음 === '') { i++; if (값골라깃발.has(k)) flags[k] = true; else 탈.push({ 갈래: '값없음', 깃발: `--${k}` }); }
      else if (다음 !== undefined && !다음.startsWith('-')) flags[k] = argv[++i];
      else if (값골라깃발.has(k)) flags[k] = true;
      else 탈.push({ 갈래: '값없음', 깃발: `--${k}` });
    } else args.push(a);
  }
  // 명령은 플래그가 아닌 첫 낱말. 없으면 상태 보기.
  return { cmd: args[0] ?? '', args: args.slice(1), flags, 탈 };
}

/*
 * 인자를 잘못 줘서 **시작도 안 하고** 멈추는 자리. 종료코드는 64(EXIT.usage) 다 —
 * 2 는 걸음 수 상한이라, 오타 하나를 「일이 커서 멈췄다」 로 읽은 스크립트가 있었다.
 *
 * 글은 표준오류로 낸다. `deel run --json` 으로 부른 스크립트는 표준출력을 JSON 으로
 * 읽는데, 여기 맨 글이 섞이면 파싱에서 죽고 진짜 까닭은 그 파싱 오류에 묻힌다.
 * 그래서 run 에 --json 이면 표준출력에 실패 한 덩이를 같이 낸다 (oneshot.js 의 못함과 같은 모양).
 */
function 인자탈(줄들, { cmd, flags, 코드 = EXIT.usage }) {
  for (const 줄 of ['', ...줄들, '']) process.stderr.write(`${줄}\n`);
  const 배치 = cmd === 'run' || cmd === '-p';
  if (배치 && (flags.json === true || flags.json === 'true')) {
    // 모양은 한 방 실행의 실패덩이 하나로 짓는다 — 성공과 같은 칸이어야 한다 (사냥5 B5-10).
    process.stdout.write(JSON.stringify(실패덩이({
      reason: 코드 === EXIT.usage ? 'usage' : 'config', code: 코드,
      why: 줄들.map((s) => String(s).trim()).filter(Boolean).join(' '),
    })) + '\n');
  }
  return 코드;
}

// 마지막 catch 가 `--json` 인지 알려고 들고 있는다. 인자를 두 번 읽으면 두 벌이 된다.
let 읽은인자 = null;

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
  // all 에만 딸려 가는 갈래 (reset.js 의 숨은것). 따로 고를 수 없어서 이름이 보일 자리가
  // 여기밖에 없다. 안 적었더니 「위 전부」 를 읽은 사람이 .deel/tmp 가 지워진 것을 나중에 알았다.
  say(`    ${c.gray('(따로 못 고름)')}        증거·내보낸 것·임시 ${c.gray('(.deel/증거 · export · tmp · 붙인그림)')}`);
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
  // 새로 넣는 도움말 줄은 말() 로 적는다 — 영어로 켠 사람에게 한국어 줄을 더 새게 하지 않는다(test/langleak.test.js 의 래칫).
  say(`    ${c.gray('--check <cmd>')}       ${말('cli.checkFlag')}`);
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
  say(`    ${c.gray('끝난 까닭이 종료코드에 담깁니다:')} ${c.gray('0 끝냄 · 1 오류 · 2 걸음수상한 · 3 헛돎 · 4 중단 · 5 말없이끊김 · 6 거절 · 7 모양안맞음 · 8 검사실패 · 64 사용법틀림')}`);
  say('');
  say(`  ${c.bold(말('cli.evalTitle'))} ${c.gray(말('cli.evalWhy'))}`);
  say('');
  say(`    ${c.cyan('deel eval --init')}            ${말('cli.evalInit')}`);
  say(`    ${c.cyan('deel eval [dir]')}             ${말('cli.evalRun')}`);
  say(`    ${c.gray('--repeat <n> · --only <name> · --keep · --json')}`);
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

  const 읽음 = parse(process.argv.slice(2));
  읽은인자 = 읽음;
  const { cmd: 친명령, args, flags, 탈: 인자탈들 } = 읽음;

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

  /*
   * `--work` 에 오타가 났으면 **여기서 멈춘다.**
   *
   * 모르는 이름은 조용히 기본값(종합)으로 떨어진다. 그런데 종합은 Write·Edit·
   * Bash 를 다 가진 모드다 — `deel --work architcet` 한 번으로, 파일을 안
   * 건드리는 모드로 켠 줄 알고 **고칠 수 있는 상태**로 돌게 된다. 화면에
   * 남는 단서는 상태줄 글자 하나뿐이다.
   *
   * 대화 중에 치는 `/work` 는 관대하게 받아도 된다(틀리면 바로 화면에 뜨고
   * 다시 치면 된다). 깃발은 한 번 켜면 그 세션이 끝까지 그걸로 간다.
   *
   * 판 번호·도움말보다 뒤에 둔다 — 그 둘은 무엇을 잘못 쳤든 답해야 한다.
   */
  // 모르는 깃발·값 없는 깃발. 판 번호·도움말은 위에서 이미 답했다.
  if (인자탈들.length) {
    const 줄들 = 인자탈들.map((x) => (x.갈래 === '모름'
      ? `  모르는 깃발입니다: ${x.깃발}${x.가까운 ? ` — 혹시 ${x.가까운} 인가요?` : ''}`
      : x.갈래 === '켜끄기'
        ? `  ${x.깃발} 은 켜고 끄는 깃발입니다 — ${JSON.stringify(x.값)} 는 못 읽습니다 (${x.깃발} 또는 ${x.깃발}=false)`
        : `  ${x.깃발} 에 값이 없습니다 — ${x.깃발} <값> 또는 ${x.깃발}=<값>`));
    return 인자탈([...줄들, '  받는 깃발은 deel --help 에 있습니다. 대시로 시작하는 말은 -- 뒤에 두세요.'], { cmd, flags });
  }

  if (flags.work !== undefined) {
    const { normalize: 모드이름, MODES: 모드들, 보일이름: 모드보임 } = await import('../src/agent/modes.js');
    if (!모드이름(String(flags.work))) {
      const 있는것 = Object.keys(모드들).map((k) => `${모드보임(k)}(${k})`).join(' · ');
      return 인자탈([
        `  그런 작업 모드가 없습니다: ${String(flags.work)}`,
        `  있는 것: ${있는것}`,
        '',
        '  그냥 켜면 「종합」 으로 돕니다 — 그건 파일을 고칠 수 있는 모드입니다.',
      ], { cmd, flags });
    }
  }

  /*
   * `--mode` 도 `--work` 와 같은 문을 지난다 — 그리고 이쪽이 더 위험했다.
   *
   * 값을 안 보고 그대로 넘겼다. 승인을 묻는 자리는 `session.mode === 'strict'` 로
   * 보므로, `--mode Strict` · `STRICT` 는 strict 도 confirm 도 아닌 **아무것도 안
   * 묻는 상태**가 됐다. `deel run --mode Strict` 는 Write 를 묻지 않고 돌려 0 으로
   * 끝났고, 그 사이 모델에게는 「승인이 필요한 것은 거부된다」 고 거짓말을 했다.
   * 소문자로 치면 멀쩡하니, 적은 사람은 막힌 줄 안다.
   *
   * 대소문자는 안 가린다 — 그건 틀린 것이 아니라 적는 버릇이다. 이름 자체가 다르면
   * 멈춘다. 대화 중 `/mode` 도 한글 이름(엄격)은 안 받으므로 여기서도 안 받는다.
   */
  if (flags.mode !== undefined) {
    const { 차례: 승인모드들 } = await import('../src/ui/approve.js');
    const 고른것 = String(flags.mode).trim().toLowerCase();
    if (!승인모드들.includes(고른것)) {
      return 인자탈([
        `  그런 승인 모드가 없습니다: ${String(flags.mode)}`,
        `  있는 것: ${승인모드들.join(' · ')}`,
        '',
        '  모르는 이름으로 켜면 아무것도 안 묻는 상태가 됩니다 — 그래서 켜지 않습니다.',
      ], { cmd, flags });
    }
    flags.mode = 고른것;
  }

  /*
   * ── 이 PC 설정의 mode 를 아무 문도 안 읽었다 ──────────────────────────
   *
   * `"mode": "strict"` 를 설정에 적어 둔 사람의 `deel run` 이 Write 를 묻지 않고 돌렸다.
   * 대화 화면도 같았다 — 셋 다 `opts.mode ?? 'auto'` 였다. 적은 사람은 막힌 줄 안다.
   *
   * 차례는 깃발 > 이 PC 설정 > auto. **이 PC 설정만** 읽는다. 저장소 설정의 mode 를
   * 받으면 남의 저장소가 `"mode": "auto"` 한 줄로 이 PC 의 strict 를 푼다.
   * 모르는 이름이면 멈춘다. 가장 헐거운 auto 로 떨어지는 것이 제일 나쁜 실패다.
   * 인자를 틀린 것이 아니라 설정이 틀린 것이라 종료코드는 1 이다.
   */
  if (flags.mode === undefined && ['run', '-p', '', 'chat', 'acp'].includes(cmd)) {
    const 설정모드 = 이PC설정값('mode');
    if (설정모드 !== undefined && 설정모드 !== null) {
      const { 차례: 승인모드들 } = await import('../src/ui/approve.js');
      const 설정고른것 = String(설정모드).trim().toLowerCase();
      if (!승인모드들.includes(설정고른것)) {
        return 인자탈([
          `  이 PC 설정의 mode 를 모릅니다: ${String(설정모드)}  (${join(homeDir(), 'config.json')})`,
          `  있는 것: ${승인모드들.join(' · ')}`,
          '',
          '  고칠 때까지 켜지 않습니다 — 모르는 이름으로 켜면 아무것도 안 묻는 상태가 됩니다.',
        ], { cmd, flags, 코드: EXIT.error });
      }
      flags.mode = 설정고른것;
    }
  }

  /*
   * 없는 `--root` 는 대화·에디터 문에서도 거절한다 (run 은 oneshot.js 가 같은 일을 한다).
   *
   * 대화 화면은 뿌리를 안 봤다. 기록·되돌리기 자리를 짓는 쪽이 폴더를 통째로 만들어
   * 주니, 드라이브 글자 하나 틀린 `deel --root` 가 빈 폴더에서 대화를 시작했다 —
   * 「없는 파일은 만든다」 대로 일하면 진짜 저장소 옆에 가짜 저장소가 자란다.
   * 글은 표준오류로 낸다. `deel acp` 의 표준출력은 에디터가 읽는 JSON-RPC 관이다.
   */
  if (['', 'chat', 'acp'].includes(cmd) && flags.root !== undefined) {
    let 폴더인가 = false;
    try { 폴더인가 = statSync(String(flags.root)).isDirectory(); } catch { 폴더인가 = false; }
    if (!폴더인가) {
      process.stderr.write(`\n  작업 폴더가 없습니다 (--root): ${String(flags.root)} — 없는 폴더를 만들어 그 안에서 일하지 않습니다\n\n`);
      return EXIT.error;
    }
  }

  /*
   * `--ctx junk` 는 조용히 버려졌다 — parseSize 가 null 을 주면 「안 준 것」 과 같아져
   * 서버에 맞춘 길이로 돌았다. 대화 중 `/ctx junk` 는 「숫자를 못 읽었습니다」 로
   * 거절한다. 같은 값을 문에 따라 다르게 받으면, 깃발로 준 사람만 제 값이 먹는 줄 안다.
   * `auto` 는 「서버에 맞춤」 이라는 뜻이라 안 준 것으로 받는다.
   */
  for (const 이름 of ['ctx', 'max-tokens']) {
    if (flags[이름] === undefined) continue;
    if (String(flags[이름]).trim().toLowerCase() === 'auto') { delete flags[이름]; continue; }
    if (parseSize(String(flags[이름])) == null) {
      return 인자탈([
        `  --${이름} 숫자를 못 읽었습니다: ${String(flags[이름])}`,
        '  이렇게 쓰세요 — 655360 · 640k · 128k (k 는 1024 입니다)',
      ], { cmd, flags });
    }
  }

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
        // 끝내려는 자리에서 돌릴 검사 (agent/donecheck.js). 설정의 check 를 이긴다.
        check: flags.check !== undefined ? String(flags.check) : undefined,
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
      return runSetup(flags);
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
    // 과제 모음(골든셋)을 실제 모델로 돌려 성공률을 잰다 (src/eval/run.js).
    case 'eval':
      return runEval({
        폴더: args[0] ?? null,
        init: flags.init === true || flags.init === 'true',
        repeat: flags.repeat ?? 1,
        keep: flags.keep === true || flags.keep === 'true',
        json: flags.json === true || flags.json === 'true',
        only: flags.only !== undefined ? String(flags.only) : null,
        시간초: flags.timeout !== undefined ? Number(flags.timeout) : null,
        // 과제마다 띄우는 `deel run` 에 그대로 넘길 것 — 바깥 게이트웨이면 --online 이 있어야 돈다.
        깃발들: [
          ...(flags.online === true || flags.online === 'true' ? ['--online'] : []),
          ...(flags.offline === true || flags.offline === 'true' ? ['--offline'] : []),
          ...(flags.think ? ['--think', String(flags.think)] : []),
          ...(flags.effort ? ['--effort', String(flags.effort)] : []),
        ],
      });
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
      // 인자를 잘못 준 것이다 — 모르는 깃발과 같은 64. 1 이면 스크립트가 「돌다가 오류」 와 못 가른다.
      return EXIT.usage;
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
    /*
     * `deel run --json` 이면 표준출력은 JSON 한 덩이여야 한다(도움말의 약속).
     * 여기는 무엇이 터졌든 표준출력에 맨 글을 찍었고, JSON 을 읽던 스크립트는
     * 파싱에서 죽었다. 이 문에서는 글을 표준오류로, 실패 한 덩이를 표준출력으로 낸다.
     */
    const 배치JSON = !!읽은인자 && (읽은인자.cmd === 'run' || 읽은인자.cmd === '-p')
      && (읽은인자.flags.json === true || 읽은인자.flags.json === 'true');
    if (배치JSON) {
      process.stderr.write(`  ✗ ${err?.message ?? err}\n`);
      // 인자탈 과 같은 모양 — 성공한 --json 과 칸이 같아야 한다 (사냥5 B5-10).
      process.stdout.write(JSON.stringify(실패덩이({ reason: 'error', code: 1, why: String(err?.message ?? err) })) + '\n');
      await 끝내기(1);
      return;
    }
    say('');
    say(`  ${c.red('오류')} ${err?.message ?? err}`);
    if (process.env.DEEL_DEBUG) say(c.gray(err?.stack ?? ''));
    say('');
    await 끝내기(1);
  });
