// 엑셀을 시켜서 파일을 표로 뽑아낸다. 암호가 걸린 파일과 옛 .xls 용이다.
//
// 왜 엑셀을 시키나:
//   암호가 걸린 엑셀 파일은 zip 이 아니라 통째로 암호화된 덩어리다. 푸는 데
//   AES 와 해시 반복이 필요하고, 그걸 직접 구현하는 건 이 도구가 할 일이 아니다.
//   옛 .xls 도 형식이 완전히 다르다. 두 경우 다 엑셀이 이미 할 줄 안다.
//
// 암호를 어디에도 안 남긴다 — 이게 이 파일의 첫 번째 규칙이다:
//   - 명령줄 인자로 안 넘긴다. 작업 관리자에서 남의 명령줄이 보인다.
//   - 파일에 안 쓴다. 임시 스크립트에도 안 넣는다.
//   - 설정·세션·감사기록에 안 남긴다.
//   오직 자식 프로세스의 표준입력으로만 건넨다. 메모리에서만 산다.
//
// 한국어 윈도우에서 알아낸 것 두 가지 (실제로 여기서 막혔던 것들):
//   1) 스레드 문화권을 en-US 로 맞춰야 한다. 안 그러면 Open() 이 조용히 null 을
//      돌려주거나 엉뚱한 형변환 오류가 난다.
//   2) 엑셀은 바쁘면 호출을 거절한다(0x80010001, 0x800AC472). 잘못된 호출이
//      아니라 '지금은 말고' 라는 뜻이라, 쉬었다 다시 부르면 된다.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode } from './encoding.js';

// 엑셀에게 시킬 일. 암호는 여기 없다 — 표준입력으로 들어온다.
// 경로도 명령줄이 아니라 환경변수로 준다. 따옴표 문제도 없고 남의 눈에도 안 띈다.
//
// 내보내는 까닭은 **검사 때문**이다(tools/clipboard.js 와 같은 규칙). 암호를 읽는
// 자리가 틀리면 맞는 암호를 넣은 사람이 제 파일에서 막히는데, 그걸 재려면 엑셀이
// 깔린 PC 와 암호 걸린 파일이 있어야 한다 — 그러면 그 자리는 영영 안 재진다.
// 스크립트를 내주면 앞부분(암호 읽기)만 떼어 파워셸로 돌려 볼 수 있다.
export const SCRIPT = `
$ErrorActionPreference = 'Stop'
[System.Threading.Thread]::CurrentThread.CurrentCulture = New-Object System.Globalization.CultureInfo 'en-US'

function Try-Com([scriptblock]$fn, [int]$tries = 12) {
  for ($i = 1; $i -le $tries; $i++) {
    try { return & $fn }
    catch {
      if ($_.Exception.Message -match '0x80010001|0x800AC472|rejected by callee') {
        Start-Sleep -Milliseconds (150 * $i); continue
      }
      throw
    }
  }
  throw 'BUSY'
}

$src = $env:DEEL_XL_IN
$dst = $env:DEEL_XL_OUT
# 들어오는 쪽도 UTF-8 로 맞춘다. 안 맞추면 [Console]::In 이 **이 PC 의 콘솔 코드페이지**로
# 읽어서, 우리가 UTF-8 로 써 보낸 한글 암호가 딴 글자가 된다 — 다섯 글자가 일곱 글자로.
# 그러면 맞는 암호를 넣은 사람이 「암호가 맞지 않습니다」 를 세 번 받고 끝난다. 나가는 쪽은
# 이미 decode() 로 콘솔 인코딩을 풀고 있는데(아래 받은글), 들어오는 쪽만 빠져 있었다.
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
$pw  = [Console]::In.ReadLine()
if ($null -eq $pw) { $pw = '' }

$xl = $null
$wb = $null
try {
  $xl = New-Object -ComObject Excel.Application
  Try-Com { $xl.Visible = $false }
  Try-Com { $xl.DisplayAlerts = $false }
  # 매크로가 저절로 돌지 않게 막는다. 남의 파일을 여는 일이다.
  Try-Com { $xl.EnableEvents = $false }
  Try-Com { $xl.AutomationSecurity = 3 }

  $pwArg = if ([string]::IsNullOrEmpty($pw)) { [Type]::Missing } else { $pw }
  # ReadOnly = true. 사용자의 원본은 어떤 경우에도 안 건드린다.
  $wb = Try-Com { $xl.Workbooks.Open($src, 0, $true, [Type]::Missing, $pwArg, $pwArg, $true) }
  if ($null -eq $wb) { throw 'OPENFAIL' }

  $i = 0
  foreach ($ws in $wb.Worksheets) {
    $i++
    $name = $ws.Name
    # 시트 하나만 든 새 통합문서로 복사해서 내보낸다.
    Try-Com { $ws.Copy() }
    $tmp = $xl.ActiveWorkbook
    $path = Join-Path $dst ("$i.txt")
    # 42 = xlUnicodeText. UTF-16 에 탭 구분이라 한글이 어디서도 안 깨진다.
    Try-Com { $tmp.SaveAs($path, 42) }
    Try-Com { $tmp.Close($false) }
    Write-Output ("SHEET\`t$i\`t$name")
  }
  Write-Output 'OK'
}
catch {
  $m = $_.Exception.Message
  # 작은따옴표는 PowerShell 에서 이스케이프를 안 푼다. 탭을 넣으려면 큰따옴표여야 한다.
  if ($m -match 'password|암호|protected') { Write-Output "ERR\`tPASSWORD" }
  elseif ($m -eq 'BUSY') { Write-Output "ERR\`tBUSY" }
  elseif ($m -eq 'OPENFAIL') { Write-Output "ERR\`tPASSWORD" }
  else { Write-Output ("ERR\`tOTHER\`t" + $m) }
}
finally {
  if ($null -ne $wb) { try { Try-Com { $wb.Close($false) } } catch {} }
  if ($null -ne $xl) { try { Try-Com { $xl.Quit() } } catch {} }
}
`;

/**
 * 이 **판**에서 엑셀을 시킬 길이 있나. 윈도우가 아니면 아예 없다.
 *
 * 「엑셀이 깔렸나」 를 여기서 답하지 않는다 — 그건 실제로 불러 봐야 안다.
 * 등록만 되어 있고 실행이 안 되는 자리가 흔해서, 레지스트리를 읽어 봐야
 * 「있다」 는 말이 거짓이 될 수 있다. 없다는 답은 아래 없는엑셀() 이 COM
 * 번호(80040154·80080005)로 가려서 사람 말로 돌려준다.
 */
export function canUseExcel() {
  return process.platform === 'win32';
}

/**
 * '엑셀이 없다' 는 뜻의 오류인가.
 *
 * 오류 글은 이 컴퓨터 언어로 오므로 말로 알아보려 하면 안 된다. 숫자로 본다.
 *   80040154 REGDB_E_CLASSNOTREG  — 그런 COM 클래스가 등록돼 있지 않다
 *   80080005 CO_E_SERVER_EXEC_FAILURE — 서버를 띄우지 못했다
 * 이걸 그대로 사용자에게 내보내면 알아볼 수 없는 글자만 남는다.
 */
export function 없는엑셀(s) {
  return /80040154|80080005|REGDB_E_CLASSNOTREG|CO_E_SERVER_EXEC_FAILURE/i.test(String(s ?? ''));
}

/**
 * 엑셀로 파일을 열어 시트별 표를 뽑는다.
 *
 * @param {string} 경로   읽을 엑셀 파일 (읽기 전용으로 연다)
 * @param {{ password?: string, timeout?: number }} opt
 *        password 는 메모리에만 있어야 한다. 어디에도 적지 말 것.
 * @returns {Promise<{ ok: boolean, reason?: string, sheets?: Array<{name:string, rows:string[][]}> }>}
 */
/**
 * 엑셀이 뽑아 둔 시트 파일들을 읽어 표로 만든다.
 *
 * 못 읽은 것을 **조용히 버리지 않는다.** 여기가 `catch { continue; }` 한 줄이라,
 * 시트 하나가 통째로 빠진 표가 「다 읽었습니다」 로 올라갔다 — 사람에게도 모델에게도
 * 「그런 시트 없다」 와 구별이 안 되는 고장이다. 이름을 남겨 부르는 쪽이 말하게 한다.
 */
/**
 * 시트를 **하나도** 못 모았을 때의 답.
 *
 * 여기가 언제나 「엑셀이 열긴 했는데 뽑아낼 시트가 없습니다」 였다. 그 말은 통합문서가
 * 원래 비었다는 뜻이라, 시트 셋을 하나도 **못 읽은** 판이 「빈 파일」 로 올라갔다 —
 * 시트모으기 가 이름을 남기게 고쳐 놓고, 정작 그 이름이 제일 필요한 자리에서 버렸다.
 * 위와 같은 규칙이다: 못 읽은 것을 조용히 버리지 않는다.
 */
export function 빈시트답(못읽은) {
  if (못읽은?.length) {
    return {
      ok: false,
      reason: 'unreadable',
      못읽은,
      message: `엑셀이 열긴 했는데 시트 ${못읽은.length}개를 하나도 못 읽었습니다: ${못읽은.join(' · ')}`,
    };
  }
  return { ok: false, reason: 'empty', message: '엑셀이 열긴 했는데 뽑아낼 시트가 없습니다' };
}

export function 시트모으기(밖, 시트들) {
  const sheets = [];
  const 못읽은 = [];
  for (const { i, name } of 시트들 ?? []) {
    let buf;
    // 엑셀이 UTF-16 으로 썼다. decode 가 앞머리 표식을 보고 알아서 푼다.
    try { buf = readFileSync(join(밖, `${i}.txt`)); }
    catch (탈) { 못읽은.push(`${name} (${탈?.code ?? 탈?.message ?? '못 읽음'})`); continue; }
    sheets.push({ name, rows: tsv(decode(buf).text) });
  }
  return { sheets, 못읽은 };
}

export async function excelToTables(경로, { password = '', timeout = 90000 } = {}) {
  if (!canUseExcel()) {
    return { ok: false, reason: 'no-excel', message: '이 파일은 엑셀이 있어야 읽을 수 있는데, 윈도우가 아닙니다' };
  }

  const 밖 = mkdtempSync(join(tmpdir(), 'deel-xl-'));
  try {
    const 결과 = await 돌리기(경로, 밖, password, timeout);
    if (!결과.ok) return 결과;

    const { sheets, 못읽은 } = 시트모으기(밖, 결과.시트들);
    if (!sheets.length) return 빈시트답(못읽은);
    return { ok: true, sheets, 못읽은 };
  } finally {
    // 여기 들어 있던 것은 암호를 푼 내용이다. 반드시 지운다.
    try { rmSync(밖, { recursive: true, force: true }); } catch { /* 임시 폴더다 */ }
  }
}

function 돌리기(경로, 밖, password, timeout) {
  return new Promise((done) => {
    // 스크립트는 -EncodedCommand 로 넘긴다. 임시 .ps1 파일을 안 만들려는 것이다 —
    // 파일로 남으면 사내 보안 도구가 막을 수도 있고, 지우기 전에 죽으면 남는다.
    const enc = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const kid = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DEEL_XL_IN: 경로, DEEL_XL_OUT: 밖 },
    });

    // PowerShell 은 UTF-8 이 아니라 이 컴퓨터 콘솔 인코딩으로 뱉는다.
    // utf8 이라고 하고 받으면 오류 메시지가 통째로 깨져서, 무엇이 잘못됐는지
    // 알아볼 수 없는 글자가 사용자에게 그대로 간다. 바이트로 모아 뒤에 푼다.
    const 밖조각 = [];
    const 오류조각 = [];
    let 끝남 = false;
    kid.stdout.on('data', (b) => 밖조각.push(b));
    kid.stderr.on('data', (b) => 오류조각.push(b));
    const 풀기 = (조각) => (조각.length ? decode(Buffer.concat(조각)).text : '');

    // 엑셀이 창을 띄우고 기다리는 경우가 있다. 그러면 영원히 안 끝난다.
    // 잘못된 암호를 넣었을 때가 특히 그렇다. 시간을 정해 두고 끊는다.
    const 시계 = setTimeout(() => {
      if (끝남) return;
      끝남 = true;
      try { kid.kill(); } catch {}
      done({ ok: false, reason: 'timeout', message: `엑셀이 ${Math.round(timeout / 1000)}초 안에 답하지 않았습니다 — 암호가 틀렸거나 엑셀이 무언가를 묻고 있을 수 있습니다` });
    }, timeout);

    kid.on('error', (e) => {
      if (끝남) return;
      끝남 = true;
      clearTimeout(시계);
      done({ ok: false, reason: 'no-excel', message: `엑셀을 실행하지 못했습니다: ${e.message}` });
    });

    kid.on('close', () => {
      if (끝남) return;
      끝남 = true;
      clearTimeout(시계);
      const out = 풀기(밖조각);
      const err = 풀기(오류조각);
      const 줄들 = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const 오류 = 줄들.find((l) => l.startsWith('ERR\t'));
      if (오류) {
        const [, 갈래, 말] = 오류.split('\t');
        if (갈래 === 'PASSWORD') return done({ ok: false, reason: 'password', message: '암호가 맞지 않거나, 이 파일에는 암호가 필요합니다' });
        if (갈래 === 'BUSY') return done({ ok: false, reason: 'busy', message: '엑셀이 계속 바쁘다고 합니다 — 열려 있는 엑셀 창을 닫고 다시 해보세요' });
        // COM 클래스를 못 찾는다 = 이 컴퓨터에 엑셀이 없다.
        // 이걸 그대로 내보내면 사용자는 알아볼 수 없는 오류 코드만 받는다.
        if (없는엑셀(말)) {
          return done({ ok: false, reason: 'no-excel', message: '이 컴퓨터에 엑셀이 설치되어 있지 않습니다 — 암호가 걸린 파일과 옛 .xls 는 엑셀이 있어야 읽을 수 있습니다' });
        }
        return done({ ok: false, reason: 'other', message: `엑셀이 열지 못했습니다: ${말 ?? ''}`.trim() });
      }
      if (!줄들.includes('OK')) {
        const 첫줄 = err.split('\n')[0] ?? '';
        if (없는엑셀(err)) {
          return done({ ok: false, reason: 'no-excel', message: '이 컴퓨터에 엑셀이 설치되어 있지 않습니다' });
        }
        return done({ ok: false, reason: 'other', message: `엑셀이 끝내지 못했습니다${첫줄 ? ` — ${첫줄}` : ''}` });
      }
      const 시트들 = 줄들.filter((l) => l.startsWith('SHEET\t')).map((l) => {
        const [, i, ...name] = l.split('\t');
        return { i: Number(i), name: name.join('\t') || `시트${i}` };
      });
      done({ ok: true, 시트들 });
    });

    // 암호는 여기로만 나간다. 줄바꿈까지 보내고 바로 닫는다.
    try {
      kid.stdin.write(`${password ?? ''}\n`, 'utf8');
      kid.stdin.end();
    } catch { /* 이미 죽었으면 close 쪽에서 처리된다 */ }
  });
}

/**
 * 엑셀이 내놓은 탭 구분 글을 표로.
 *
 * 엑셀은 탭·줄바꿈·따옴표가 든 칸만 따옴표로 감싸고, 안의 따옴표는 두 번 쓴다.
 * CSV 와 규칙이 같고 구분자만 탭이다.
 */
export function tsv(text) {
  const rows = [];
  let row = [];
  let 칸 = '';
  let 따옴표안 = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (따옴표안) {
      if (ch === '"') {
        if (s[i + 1] === '"') { 칸 += '"'; i++; }
        else 따옴표안 = false;
      } else 칸 += ch;
      continue;
    }
    if (ch === '"' && 칸 === '') { 따옴표안 = true; continue; }
    if (ch === '\t') { row.push(칸); 칸 = ''; continue; }
    if (ch === '\n') { row.push(칸); rows.push(row); row = []; 칸 = ''; continue; }
    칸 += ch;
  }
  if (칸 !== '' || row.length) { row.push(칸); rows.push(row); }
  // 엑셀은 마지막에 빈 줄을 하나 남긴다. 표에 넣을 것은 아니다.
  while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();
  return rows;
}
