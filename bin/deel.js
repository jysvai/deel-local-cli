#!/usr/bin/env node
// deel 진입점. 외부 의존성 없음 — Node 표준 기능만 씁니다.
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { c, say, mark, rule } from '../src/ui/ansi.js';
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

// 사내 반입용 묶음 만들기.
function runPack(flags) {
  const out = flags.out ? String(flags.out) : join(process.cwd(), 'deel-반입.zip');
  const r = packSelf(out);
  const a = r.audit;
  say('');
  rule('반입 묶음', 70);
  say(`  ${mark.ok} ${c.bold(r.out)}`);
  say(`     ${c.gray(`${r.files}개 파일 · ${(r.bytes / 1024).toFixed(1)}KB`)}`);
  say('');
  say(`  ${c.gray('의존성')}          ${a.deps.length === 0 ? c.green('0개') : c.red(a.deps.length + '개')}`);
  say(`  ${c.gray('설치 스크립트')}   ${a.lifecycle.length === 0 ? c.green('없음') : c.red(a.lifecycle.join(', '))}`);
  say(`  ${c.gray('외부 import')}     ${a.외부모듈.length === 0 ? c.green('0건') : c.red(a.외부모듈.length + '건')}`);
  say(`  ${c.gray('네트워크 호출')}   ${a.calls.net.length}곳 ${c.gray('(설정한 주소로만)')}`);
  say(`  ${c.gray('포트 열기')}       ${a.calls.listen.length === 0 ? c.green('없음') : c.red(a.calls.listen.length + '곳')}`);
  say('');
  say(`  ${c.gray('안에 반입심사서.txt · sbom.cdx.json · 심사명세.json 이 같이 들어 있습니다.')}`);
  say(`  ${c.gray('사람이 읽을 것 한 장, 스캐너에 넣을 것 두 장입니다 — 그대로 제출하시면 됩니다.')}`);
  say(`  ${c.gray('내용만 먼저 보시려면')} ${c.cyan('deel audit')}`);
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
const BOOL = new Set(['help', 'version', 'offline', 'continue', 'json', 'quiet', 'yes', 'no-tui', 'tui']);

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
  say(`  ${c.bold('사내 반입')}`);
  say('');
  say(`    ${c.cyan('deel audit')}                  의존성·네트워크 호출 자리 심사서 ${c.gray('(사람이 읽는 글)')}`);
  say(`    ${c.cyan('deel sbom')}                   SBOM·통신 목록·감사 사양 ${c.gray('(기계가 읽는 JSON)')}`);
  say(`    ${c.gray('--out <파일>')}       파일로 적기. 안 주면 표준출력 — ${c.cyan('deel sbom | jq')}`);
  say(`    ${c.gray('--only sbom|명세')}   한 장만`);
  say(`    ${c.cyan('deel pack')}                   위 셋 + 소스를 zip 하나로 묶기`);
  say(`    ${c.gray('--out <파일>')}       묶음 파일 이름. 기본은 deel-반입.zip`);
  say('');
  say(`  ${c.bold('대화 시작 옵션')}`);
  say('');
  say(`    ${c.gray('--root <폴더>')}      작업 범위. 기본은 지금 폴더`);
  say(`    ${c.gray('--mode <모드>')}      auto(기본) / confirm / strict`);
  say(`    ${c.gray('--work <모드>')}      auto(기본·종합) / code / plan / architect / debug / ask / orchestrator`);
  say(`    ${c.gray('--level <수준>')}     쉬움(기본) / 개발자`);
  say(`    ${c.gray('--ctx <길이>')}       컨텍스트 길이 직접 지정 (655360 · 640k · 128k). 없으면 서버에 맞춤`);
  say(`    ${c.gray('--max-tokens <길이>')} 한 번에 받을 답 길이 상한 (32k). 큰 파일이 잘리면 올린다 — /out 과 같은 값`);
  say(`    ${c.gray('--think <수준>')}     off / low / medium(기본) / high / max`);
  say(`    ${c.gray('--effort <배분>')}    even(균일) / save(절약, 기본) / deep(깊게)`);
  say(`    ${c.gray('--no-tui')}           입력 상자 없이 줄 화면으로 (파이프·기록·좁은 터미널)`);
  say(`    ${c.gray('--offline')}          이 컴퓨터 밖으로는 아무것도 안 보냄 (자물쇠)`);
  say(`    ${c.gray('--continue')}         이 폴더에서 가장 최근 대화 이어하기`);
  say(`    ${c.gray('--resume <id>')}      골라서 이어하기 (deel sessions 로 id 확인)`);
  say('');
  say(`  ${c.bold('한 번만 돌리기')} ${c.gray('— 스크립트·배치에서 부를 때')}`);
  say('');
  say(`    ${c.cyan('deel run "검사 돌리고 실패한 것만 알려줘"')}`);
  say(`    ${c.cyan('echo "..." | deel run')}      ${c.gray('시킬 말을 표준입력으로 넣어도 됩니다')}`);
  say(`    ${c.gray('deel -p "..." 도 같습니다.')} ${c.gray('위 대화 시작 옵션을 그대로 씁니다.')}`);
  say('');
  say(`    ${c.gray('--json')}             결과를 JSON 한 덩이로 (답·도구 횟수·토큰·끝난 까닭)`);
  say(`    ${c.gray('--quiet')}            도구가 무엇을 했는지 안 적음 (오류는 그래도 적음)`);
  say(`    ${c.gray('--yes')}              승인이 필요한 것도 그냥 실행. ${c.yellow('기본은 거부입니다')}`);
  say(`    ${c.gray('답은 표준출력, 도구 기록은 표준오류로 나갑니다 — 파이프로 넘겨도 답만 넘어갑니다.')}`);
  say(`    ${c.gray('끝난 까닭이 종료코드에 담깁니다:')} ${c.gray('0 끝냄 · 1 오류 · 2 걸음수상한 · 3 헛돎 · 4 중단')}`);
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

  const { cmd, args, flags } = parse(process.argv.slice(2));

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
        yes: flags.yes === true || flags.yes === 'true',
        json: flags.json === true || flags.json === 'true',
        quiet: flags.quiet === true || flags.quiet === 'true',
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
        offline: flags.offline === true || flags.offline === 'true',
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
        offline: flags.offline === true || flags.offline === 'true',
      });
    case 'status':
      return showStatus();
    case 'setup':
      return runSetup();
    case 'diagnose':
    case 'doctor':
      return runDiagnose(flags);
    case 'pack':
      return runPack(flags);
    case 'audit':
      return runAudit();
    case 'sbom':
      return runSbom(flags);
    case 'scan':
      return runScan(flags);
    case 'sessions':
    case 'ls':
      return runSessions(flags);
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
