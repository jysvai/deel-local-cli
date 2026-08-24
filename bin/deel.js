#!/usr/bin/env node
// deel 진입점. 외부 의존성 없음 — Node 표준 기능만 씁니다.
import { c, say } from '../src/ui/ansi.js';
import { runSetup, runDiagnose, showStatus, banner } from '../src/setup.js';
import { chatLoop } from '../src/repl.js';

const MIN_NODE = 20;

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
  say(`    ${c.cyan('deel setup')}                  연결 설정 (주소·키·모델)`);
  say(`    ${c.cyan('deel status')}                 연결 상태 보기`);
  say(`    ${c.cyan('deel diagnose')}               저장된 연결로 진단 다시 돌리기`);
  say('');
  say(`  ${c.bold('대화 시작 옵션')}`);
  say('');
  say(`    ${c.gray('--root <폴더>')}      작업 범위. 기본은 지금 폴더`);
  say(`    ${c.gray('--mode <모드>')}      auto(기본) / confirm / strict`);
  say(`    ${c.gray('--think <수준>')}     off / low / medium(기본) / high / max`);
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
      });
    case 'status':
      return showStatus();
    case 'setup':
      return runSetup();
    case 'diagnose':
    case 'doctor':
      return runDiagnose(flags);
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
