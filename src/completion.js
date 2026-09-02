/**
 * `deel completion <셸>` — 탭 눌러 완성하기.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 이 프로그램에는 명령이 열댓 개, 깃발이 스무 개쯤 있는데 화면 어디에도 다
 * 안 나온다(`--help` 는 자주 쓰는 것만 보여 준다). 그래서 `deel sbom` 이나
 * `--effort` 가 있다는 것을 아는 사람만 쓴다. 탭 완성은 도움말을 안 읽어도
 * **있다는 사실**을 알려 준다.
 *
 * ── 무엇을 조심하나 ────────────────────────────────────────────────────
 *
 * **거짓말하지 않는 목록.** 완성이 알려 주는 명령이 실제로 없으면, 사람은
 * 그것을 치고 「모르는 명령」을 본다. 도움말보다 나쁘다 — 도움말은 안 읽으면
 * 그만이지만, 완성은 없는 것을 있다고 우긴다.
 *
 * 그래서 목록은 **여기 한 벌만** 두고, bin/deel.js 가 실제로 받는 명령과
 * 어긋나지 않는지 검사가 지킨다(test/completion.test.js). 새 명령을 넣고
 * 여기 안 적으면 검사가 빨개진다.
 *
 * 값이 정해진 깃발(`--mode` · `--think`)은 그 값도 실제 코드에서 가져온다.
 * 손으로 베껴 적으면 언젠가 갈린다.
 */
import { MODES } from './agent/modes.js';
import { LEVELS, PROFILES } from './agent/effort.js';
// 승인 모드(auto·confirm·strict). agent/modes.js 의 MODES 와 헷갈리기 쉬운데,
// 저쪽은 `--work` 가 받는 '무슨 일을 하는 중인가' 다. 실제로 한 번 뒤바뀌어
// 있었다 — `--mode` 를 누르면 code·plan 이 나오고 `--work` 는 폴더를 냈다.
import { 차례 as 승인모드 } from './ui/approve.js';

/** deel 이 받는 명령. bin/deel.js 의 switch 와 같아야 한다(검사가 지킨다). */
export const 명령들 = [
  { 이름: 'chat', 뜻: '대화 시작 (그냥 deel 만 쳐도 같다)', en: 'start a conversation (bare deel does this too)' },
  { 이름: 'run', 뜻: '한 번만 돌고 끝낸다 (스크립트·배치)', en: 'run once and exit (scripts, batch jobs)' },
  { 이름: 'acp', 뜻: '에디터가 자식으로 띄우는 자리 — 사람이 칠 명령이 아니다', en: 'editor integration (ACP); not meant to be typed by hand' },
  { 이름: 'status', 뜻: '지금 무엇에 붙어 있나', en: 'what it is connected to right now' },
  { 이름: 'setup', 뜻: '처음 설정', en: 'first-time setup' },
  { 이름: 'diagnose', 뜻: '왜 안 되는지 짚어 본다', en: 'figure out why it is not working' },
  { 이름: 'doctor', 뜻: 'diagnose 와 같다', en: 'same as diagnose' },
  { 이름: 'pack', 뜻: '오프라인 반입용으로 묶는다', en: 'bundle for offline transfer' },
  { 이름: 'audit', 뜻: '무엇을 했는지 기록을 본다', en: 'show the record of what it did' },
  { 이름: 'sbom', 뜻: '무엇이 들었는지 목록을 낸다', en: 'list what is inside (SBOM)' },
  { 이름: 'scan', 뜻: '게이트웨이에 어떤 모델이 있나 훑는다', en: 'scan the gateway for available models' },
  { 이름: 'sessions', 뜻: '지난 대화 목록', en: 'list past conversations' },
  { 이름: 'ls', 뜻: 'sessions 와 같다', en: 'same as sessions' },
  { 이름: 'reset', 뜻: '설정·기억·기록을 지운다 (그냥 치면 보여만 준다)', en: 'wipe settings, memory and records (bare: just shows)' },
  { 이름: 'completion', 뜻: '탭 완성 스크립트를 낸다', en: 'print a tab-completion script' },
  { 이름: 'version', 뜻: '판 번호', en: 'version number' },
  { 이름: 'help', 뜻: '도움말', en: 'help' },
];

/** `-p` 는 명령이지만 깃발처럼 생겨서 완성 목록에는 안 올린다(쳐도 된다). */
export const 숨은명령 = ['-p'];

/**
 * 깃발.
 *
 * `값` 이 있으면 그 다음 낱말을 그 목록에서 고른다. `파일`·`폴더` 는 셸에게
 * 맡긴다 — 우리가 흉내내는 것보다 셸이 훨씬 잘한다.
 */
export const 깃발들 = [
  { 이름: '--root', 뜻: '작업 폴더', en: 'working folder', 값: '폴더' },
  /*
   * 이 둘은 한 번 뒤바뀌어 있었다.
   *
   * `--mode` 는 **승인 모드**(auto·confirm·strict)인데 작업 모드 목록이
   * 붙어 있었고, `--work` 는 **작업 모드**인데 「살림 폴더」 라고 적혀 폴더를
   * 완성해 주고 있었다. 그래서 `deel --mode <탭>` 을 누르면 받지도 않는
   * code·plan 이 나왔다.
   *
   * 검사도 이걸 못 잡았다 — 완성 목록이 agent/modes.js 에서 온 것이 맞나만
   * 봤기 때문이다. 베낀 자리가 맞는지는 봤는데, 베껴 온 곳이 맞는지는 안 봤다.
   * 지금은 도움말에 적힌 값과 맞춰 본다 (test/completion.test.js).
   */
  { 이름: '--work', 뜻: '무슨 일을 하는 중인가', en: 'what kind of work this is', 값: Object.keys(MODES) },
  { 이름: '--mode', 뜻: '무엇까지 물어보지 않고 할까', en: 'how much it may do without asking', 값: 승인모드 },
  { 이름: '--level', 뜻: '화면을 얼마나 자세히', en: 'how much detail on screen', 값: null },
  { 이름: '--ctx', 뜻: '창 크기 (예: 32k)', en: 'context window size (e.g. 32k)', 값: null },
  { 이름: '--max-tokens', 뜻: '한 번에 뱉을 최대 토큰', en: 'max tokens per reply', 값: null },
  { 이름: '--think', 뜻: '생각의 양', en: 'how much thinking', 값: LEVELS },
  { 이름: '--effort', 뜻: '생각을 어디에 몰아줄까', en: 'where to spend the thinking budget', 값: Object.keys(PROFILES) },
  { 이름: '--online', 뜻: '묻지 않고 바깥으로 나간다', en: 'go outside without asking', 값: false },
  { 이름: '--offline', 뜻: '바깥으로 아예 안 나간다', en: 'never reach the network', 값: false },
  { 이름: '--yes', 뜻: '물어보지 않고 진행', en: 'do not ask, just proceed', 값: false },
  { 이름: '--hard', 뜻: 'reset all 에서 되돌리기·감사기록까지', en: 'with reset all: undo snapshots and the audit log too', 값: false },
  { 이름: '--json', 뜻: '결과를 JSON 으로', en: 'output JSON', 값: false },
  { 이름: '--quiet', 뜻: '군말 없이', en: 'no chatter', 값: false },
  { 이름: '--tui', 뜻: '입력 상자를 켠다', en: 'force the input box on', 값: false },
  { 이름: '--no-tui', 뜻: '입력 상자 없이 줄 화면으로', en: 'plain line output, no input box', 값: false },
  { 이름: '--continue', 뜻: '지난 대화 이어서', en: 'continue the last conversation', 값: null },
  { 이름: '--resume', 뜻: '고른 대화 이어서', en: 'resume a chosen conversation', 값: null },
  { 이름: '--version', 뜻: '판 번호', en: 'version number', 값: false },
  { 이름: '--help', 뜻: '도움말', en: 'help', 값: false },
];

export const 셸들 = ['bash', 'zsh', 'powershell', 'pwsh'];

const 이름만 = () => 명령들.map((x) => x.이름);
const 깃발이름만 = () => 깃발들.map((x) => x.이름);

/** 셸 문자열 안에 그대로 넣어도 되게. 우리 목록은 다 ASCII 라 넉넉하다. */
const 홑따옴표 = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function bash판({ zsh = false } = {}) {
  const 값깃발 = 깃발들.filter((x) => Array.isArray(x.값));
  const 폴더깃발 = 깃발들.filter((x) => x.값 === '폴더').map((x) => x.이름);
  const 값갈래 = 값깃발.map((x) => `    ${x.이름}) COMPREPLY=( $(compgen -W ${홑따옴표(x.값.join(' '))} -- "$cur") ); return 0 ;;`).join('\n');
  const 폴더갈래 = 폴더깃발.length
    ? `    ${폴더깃발.join('|')}) COMPREPLY=( $(compgen -d -- "$cur") ); return 0 ;;`
    : '';

  return `# deel 탭 완성 (${zsh ? 'zsh' : 'bash'})
#
# 넣는 법:
#   deel completion ${zsh ? 'zsh' : 'bash'} > ~/.deel-completion.${zsh ? 'zsh' : 'bash'}
#   echo 'source ~/.deel-completion.${zsh ? 'zsh' : 'bash'}' >> ~/.${zsh ? 'zshrc' : 'bashrc'}
${zsh ? '\nautoload -U +X bashcompinit && bashcompinit\n' : ''}
_deel() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # 값이 정해진 깃발 다음이면 그 값들만.
  case "$prev" in
${값갈래}
${폴더갈래}
    completion) COMPREPLY=( $(compgen -W ${홑따옴표(셸들.join(' '))} -- "$cur") ); return 0 ;;
  esac

  # 깃발을 치는 중이면 깃발만.
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W ${홑따옴표(깃발이름만().join(' '))} -- "$cur") )
    return 0
  fi

  # 첫 낱말이면 명령. 그 뒤는 파일·폴더를 셸에게 맡긴다.
  local i cmd=""
  for (( i=1; i < COMP_CWORD; i++ )); do
    case "\${COMP_WORDS[i]}" in
      -*) ;;
      *) cmd="\${COMP_WORDS[i]}"; break ;;
    esac
  done
  if [[ -z "$cmd" ]]; then
    COMPREPLY=( $(compgen -W ${홑따옴표(이름만().join(' '))} -- "$cur") )
  else
    COMPREPLY=( $(compgen -f -- "$cur") )
  fi
}
complete -F _deel deel
`;
}

/*
 * 파워셸 판.
 *
 * ── 왜 이 스크립트만 영어인가 ──────────────────────────────────────────
 *
 * 이 집의 규칙은 한글 이름·한글 주석이지만, **여기서 만들어 내는 글은
 * 우리 코드가 아니라 파워셸이 읽을 글**이다. 그리고 윈도우에 기본으로 깔린
 * Windows PowerShell 5.1 은 BOM 없는 .ps1 파일을 UTF-8 이 아니라 그 PC 의
 * 옛 코드페이지(한국이면 CP949)로 읽는다.
 *
 * 그래서 `$명령` 같은 한글 변수 이름을 쓰면, 파이프로 바로 먹일 때는 되는데
 * `deel completion powershell > profile.ps1` 로 저장한 순간 글자가 깨져
 * **문법 오류**가 난다. 사람은 셸이 켜질 때마다 빨간 글을 보게 되고, 그게
 * deel 때문인 줄도 모른다.
 *
 * 설명(툴팁)까지 영어인 것도 같은 까닭이다. 처음엔 따옴표 안이니 깨져도
 * 문법은 안 무너지겠거니 했는데, 진짜 파워셸에 넣어 보니 **무너졌다.**
 * CP949 는 두 바이트 인코딩이라, 한글의 UTF-8 바이트를 짝지어 먹다가
 * **닫는 따옴표까지 뒷바이트로 삼켜 버린다.** 그러면 문자열이 안 닫혀서
 * 그 줄이 통째로 문법 오류가 된다. 실제로 `'지금 무엇에 붙어 있나'` 가
 * 그렇게 터졌다.
 *
 * 그래서 이 스크립트는 **처음부터 끝까지 ASCII** 다. 한글 화면을 쓰는
 * 사람에게도 여기 툴팁만 영어인데, 안 뜨는 것보다는 낫다.
 * (bash·zsh 완성은 설명을 아예 안 보여 주므로 잃는 것이 없다.)
 */
function 파워셸판() {
  const 명령목록 = 명령들.map((x) => `    @{ name = ${홑따옴표(x.이름)}; help = ${홑따옴표(x.en)} }`).join('\n');
  const 깃발목록 = 깃발들.map((x) => `    @{ name = ${홑따옴표(x.이름)}; help = ${홑따옴표(x.en)} }`).join('\n');
  const 값목록 = 깃발들
    .filter((x) => Array.isArray(x.값))
    .map((x) => `    ${홑따옴표(x.이름)} = @(${x.값.map(홑따옴표).join(', ')})`)
    .join('\n');

  // 파워셸은 완성 후보에 설명을 같이 실을 수 있다. 탭을 누르면 뜻이 같이 뜬다.
  return `# deel tab completion (PowerShell)
#
# Install (this session):
#   deel completion powershell | Out-String | Invoke-Expression
#
# Install (every session):
#   deel completion powershell | Out-File -Encoding utf8 -Append $PROFILE
#
# This whole script is ASCII on purpose. Windows PowerShell 5.1 reads a BOM-less
# .ps1 as the local ANSI codepage; there, a double-byte decode can swallow a
# closing quote and break the script outright.

Register-ArgumentCompleter -Native -CommandName deel -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $cmds = @(
${명령목록}
  )
  $flags = @(
${깃발목록}
  )
  $values = @{
${값목록}
    'completion' = @(${셸들.map(홑따옴표).join(', ')})
  }

  # Which word comes before the one being typed?
  #
  # This was wrong once: when the typed word is empty (the cursor sits after a
  # space), the LAST element is the previous word -- but the code always looked
  # one further back, so "--mode <TAB>" offered commands instead of modes.
  # Only pressing TAB in a real PowerShell showed it.
  $words = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
  $prev = ''
  if ($wordToComplete -eq '') {
    if ($words.Count -ge 1) { $prev = $words[$words.Count - 1] }
  } elseif ($words.Count -ge 2) {
    $prev = $words[$words.Count - 2]
  }

  # After a flag that takes fixed values, offer only those.
  if ($values.ContainsKey($prev)) {
    return $values[$prev] |
      Where-Object { $_ -like "$wordToComplete*" } |
      ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
  }

  # Typing a flag: offer flags only.
  if ($wordToComplete -like '-*') {
    return $flags |
      Where-Object { $_.name -like "$wordToComplete*" } |
      ForEach-Object { [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.help) }
  }

  # Otherwise: commands.
  $cmds |
    Where-Object { $_.name -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterValue', $_.help) }
}
`;
}

/**
 * 셸 하나짜리 완성 스크립트를 낸다.
 *
 * @returns {{ok:true, 글:string} | {ok:false, 왜:string}}
 */
export function 완성스크립트(셸) {
  const 이름 = String(셸 ?? '').trim().toLowerCase();
  if (!이름) {
    return { ok: false, 왜: `어느 셸인지 알려 주세요: ${셸들.join(' · ')}\n  예: deel completion bash` };
  }
  if (이름 === 'bash') return { ok: true, 글: bash판() };
  if (이름 === 'zsh') return { ok: true, 글: bash판({ zsh: true }) };
  if (이름 === 'powershell' || 이름 === 'pwsh') return { ok: true, 글: 파워셸판() };
  /*
   * 모르는 셸에 아무 스크립트나 주지 않는다.
   *
   * fish 에 bash 스크립트를 주면 셸이 켜질 때마다 오류가 나는데, 사람은
   * 그게 deel 때문인 줄 모른다. 안 되는 것은 안 된다고 하는 편이 낫다.
   */
  return { ok: false, 왜: `${셸} 은 아직 없습니다. 있는 것: ${셸들.join(' · ')}` };
}

/** `deel completion <셸>` 이 부르는 자리. */
export function runCompletion(args) {
  const r = 완성스크립트(args?.[0] ?? '');
  if (!r.ok) {
    process.stderr.write(`\n  ${r.왜}\n\n`);
    return 1;
  }
  // 스크립트는 **표준출력으로만** 낸다 — 파이프로 바로 먹일 수 있어야 한다.
  process.stdout.write(r.글);
  return 0;
}
