#!/usr/bin/env node
// deel 진입점. 외부 의존성 없음 — Node 표준 기능만 씁니다.
import { join } from 'node:path';
import { c, say, mark, rule } from '../src/ui/ansi.js';
import { runSetup, runDiagnose, showStatus, banner } from '../src/setup.js';
import { chatLoop } from '../src/repl.js';
import { packSelf, audit, reviewSheet } from '../src/pack/selfpack.js';
import { runScan } from '../src/backend/scanui.js';

const MIN_NODE = 20;

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
  say(`  ${c.gray('안에 반입심사서.txt 가 같이 들어 있습니다 — 그대로 제출하시면 됩니다.')}`);
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

function parse(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('-')) flags[k] = argv[++i];
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
  say(`    ${c.cyan('deel scan')}                   이 PC 에 떠 있는 로컬 서버 전부 찾기`);
  say(`    ${c.cyan('deel setup')}                  연결 설정 (주소·키·모델)`);
  say(`    ${c.cyan('deel status')}                 연결 상태 보기`);
  say(`    ${c.cyan('deel diagnose')}               저장된 연결로 진단 다시 돌리기`);
  say('');
  say(`  ${c.bold('여러 로컬을 같이 쓸 때')}`);
  say('');
  say(`    ${c.cyan('deel scan --save')}            찾은 서버·모델을 전부 등록`);
  say(`    ${c.gray('--ports 9000,9100')}   기본 자리 말고 더 볼 포트`);
  say(`    ${c.gray('--host <주소>')}       기본은 127.0.0.1`);
  say(`    ${c.gray('--key <키>')}          키가 필요한 로컬 서버일 때`);
  say(`    ${c.gray('대화 중')} ${c.cyan('/model')} ${c.gray('로 서버·모델을 골라 바꿉니다.')}`);
  say('');
  say(`  ${c.bold('사내 반입')}`);
  say('');
  say(`    ${c.cyan('deel audit')}                  의존성·네트워크 호출 자리 심사서 보기`);
  say(`    ${c.cyan('deel pack')}                   심사서 + 소스를 zip 하나로 묶기`);
  say(`    ${c.gray('--out <파일>')}       묶음 파일 이름. 기본은 deel-반입.zip`);
  say('');
  say(`  ${c.bold('대화 시작 옵션')}`);
  say('');
  say(`    ${c.gray('--root <폴더>')}      작업 범위. 기본은 지금 폴더`);
  say(`    ${c.gray('--mode <모드>')}      auto(기본) / confirm / strict`);
  say(`    ${c.gray('--think <수준>')}     off / low / medium(기본) / high / max`);
  say(`    ${c.gray('--effort <배분>')}    even(균일) / save(절약, 기본) / deep(깊게)`);
  say(`    ${c.gray('--offline')}          이 컴퓨터 밖으로는 아무것도 안 보냄 (자물쇠)`);
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

  const { cmd, flags } = parse(process.argv.slice(2));
  if (flags.help || cmd === 'help') { help(); return 0; }

  switch (cmd) {
    case '':
    case 'chat':
      return chatLoop({
        root: flags.root ? String(flags.root) : undefined,
        mode: flags.mode ? String(flags.mode) : undefined,
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
    case 'scan':
      return runScan(flags);
    default:
      say('');
      say(`  ${c.red('모르는 명령')} ${c.bold(cmd)}`);
      help();
      return 1;
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    say('');
    say(`  ${c.red('오류')} ${err?.message ?? err}`);
    if (process.env.DEEL_DEBUG) say(c.gray(err?.stack ?? ''));
    say('');
    process.exit(1);
  });
