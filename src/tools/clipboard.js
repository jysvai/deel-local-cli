/**
 * 클립보드에 든 그림 꺼내기 — 화면 캡처 → 바로 붙이기.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 눈이 달린 모델에게 화면을 보여 줄 수 있게 됐는데(backend/vision.js),
 * 보여 주려면 먼저 **파일로 저장해야** 했다. 오류 화면 하나를 물어보려고
 * 캡처 → 그림판 → 저장 → 경로 찾기를 거친다. 그 네 걸음이 「그냥 말로
 * 설명하자」로 사람을 되돌린다.
 *
 * 캡처는 이미 클립보드에 있다. 꺼내 오기만 하면 된다.
 *
 * ── 왜 의존성 없이 되나 ─────────────────────────────────────────────────
 *
 * 세 운영체제 모두 **이미 깔려 있는 것**으로 꺼낸다. 새로 깔라고 하지 않는다.
 *
 *   윈도우   파워셸의 .NET Clipboard (윈도우에 늘 있다)
 *   맥       osascript (맥에 늘 있다)
 *   리눅스   wl-paste 나 xclip — 배포판에 따라 없을 수 있다
 *
 * ── 없으면 없다고 한다 ──────────────────────────────────────────────────
 *
 * 리눅스에서 둘 다 없으면 **어떻게 하면 되는지**를 같이 준다. 「안 됩니다」
 * 로 끝내면 사람은 이 기능이 고장 난 줄 알지, 도구 하나 깔면 되는 줄 모른다.
 * 클립보드에 글만 있을 때도 「그림이 없다」와 「못 꺼냈다」를 갈라 말한다 —
 * 앞의 것은 사람이 캡처를 다시 하면 되고, 뒤의 것은 우리 탓이다.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 이보다 큰 그림은 안 받는다. 화면 캡처 한 장은 보통 1MB 안쪽이다. */
export const 그림한도 = 12 * 1024 * 1024;

const 있나 = (이름, 인자) => {
  const r = spawnSync(이름, 인자, { encoding: 'utf8', timeout: 5000, windowsHide: true });
  return !r.error && r.status === 0;
};

/*
 * 윈도우.
 *
 * 파워셸을 **파일로 적어 두고** 부른다. `-Command` 뒤에 길게 붙이면 따옴표가
 * 셸을 두 번 거치면서 깨지고, 그 깨짐이 PC 마다 다르게 나타난다. 스크립트는
 * ASCII 로만 쓴다 — Windows PowerShell 5.1 은 BOM 없는 .ps1 을 그 PC 의 옛
 * 코드페이지로 읽어서, 한글이 섞이면 문법이 무너진다(src/completion.js 참고).
 */
function 윈도우에서(방) {
  const 낼곳 = join(방, 'clip.png');
  const 스크립트 = join(방, 'grab.ps1');
  const 글 = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$img = [System.Windows.Forms.Clipboard]::GetImage()',
    'if ($img -eq $null) { Write-Output "NOIMAGE"; exit 0 }',
    `$img.Save(${JSON.stringify(낼곳)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    'Write-Output "OK"',
  ].join('\n');
  // Buffer 로 적어서 인코딩이 끼어들 자리를 없앤다.
  writeFileSync(스크립트, Buffer.from(글, 'latin1'));

  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', 스크립트,
  ], { encoding: 'utf8', timeout: 20000, windowsHide: true });

  if (r.error) return { ok: false, 왜: `파워셸을 못 불렀습니다: ${r.error.message}` };
  const 낸말 = String(r.stdout ?? '').trim();
  if (/NOIMAGE/.test(낸말)) return { ok: false, 없음: true };
  if (!existsSync(낼곳)) {
    const 탈 = String(r.stderr ?? '').split('\n').find((l) => l.trim()) ?? '';
    return { ok: false, 왜: 탈 ? `클립보드를 못 읽었습니다: ${탈.trim()}` : '클립보드를 못 읽었습니다' };
  }
  return { ok: true, buf: readFileSync(낼곳), mime: 'image/png' };
}

/*
 * 맥.
 *
 * osascript 로 PNG 를 꺼내면 «data PNGf89504e47…» 꼴의 16진수 글이 나온다.
 * 그림이 없으면 오류를 내므로, 그것으로 「없음」을 가른다.
 */
function 맥에서() {
  const r = spawnSync('osascript', ['-e', 'the clipboard as «class PNGf»'], {
    encoding: 'utf8', timeout: 20000,
  });
  if (r.error) return { ok: false, 왜: `osascript 를 못 불렀습니다: ${r.error.message}` };
  const 낸말 = String(r.stdout ?? '');
  const m = /«data PNGf([0-9A-Fa-f]+)»/.exec(낸말);
  if (!m) {
    // 그림이 아니면 osascript 가 오류를 낸다. 그건 「없음」이지 고장이 아니다.
    if (r.status !== 0) return { ok: false, 없음: true };
    return { ok: false, 없음: true };
  }
  return { ok: true, buf: Buffer.from(m[1], 'hex'), mime: 'image/png' };
}

/*
 * 리눅스.
 *
 * 웨이랜드면 wl-paste, X11 이면 xclip. 배포판이 기본으로 안 깔아 주는 것이라
 * 없을 수 있고, 그때는 **무엇을 깔면 되는지** 알려 준다.
 */
function 리눅스에서() {
  const 후보 = [
    { 이름: 'wl-paste', 볼것: ['--list-types'], 꺼내기: ['--type', 'image/png'] },
    { 이름: 'xclip', 볼것: ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], 꺼내기: ['-selection', 'clipboard', '-t', 'image/png', '-o'] },
  ];
  const 있는것 = 후보.filter((x) => 있나(x.이름, ['--version']) || 있나(x.이름, ['-version']));
  if (!있는것.length) {
    return {
      ok: false,
      왜: '클립보드에서 그림을 꺼낼 도구가 없습니다.\n'
        + '  웨이랜드면  sudo apt install wl-clipboard\n'
        + '  X11 이면    sudo apt install xclip\n'
        + '  둘 다 안 되면 캡처를 파일로 저장한 뒤 @경로 로 붙이세요.',
    };
  }
  for (const x of 있는것) {
    const 종류 = spawnSync(x.이름, x.볼것, { encoding: 'utf8', timeout: 10000 });
    if (!/image\/png/i.test(String(종류.stdout ?? ''))) continue;
    const r = spawnSync(x.이름, x.꺼내기, { timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
    if (r.error || !r.stdout?.length) continue;
    return { ok: true, buf: Buffer.from(r.stdout), mime: 'image/png' };
  }
  return { ok: false, 없음: true };
}

/**
 * 클립보드에 그림이 있으면 꺼낸다.
 *
 * @returns {{ok:true, buf:Buffer, mime:string}
 *          | {ok:false, 없음:true}          그림이 없다 (사람이 다시 캡처하면 된다)
 *          | {ok:false, 왜:string}}         못 꺼냈다 (까닭과 길을 같이 준다)
 */
export function 클립보드그림({ platform = process.platform } = {}) {
  let 방 = null;
  try {
    if (platform === 'win32') {
      방 = mkdtempSync(join(tmpdir(), 'deel-clip-'));
      const r = 윈도우에서(방);
      return 잰다(r);
    }
    if (platform === 'darwin') return 잰다(맥에서());
    if (platform === 'linux') return 잰다(리눅스에서());
    return { ok: false, 왜: `${platform} 에서는 아직 클립보드 그림을 못 꺼냅니다 — 파일로 저장한 뒤 @경로 로 붙이세요.` };
  } catch (err) {
    return { ok: false, 왜: `클립보드를 읽다 막혔습니다: ${err.message}` };
  } finally {
    if (방) { try { rmSync(방, { recursive: true, force: true }); } catch { /* 치우다 실패는 넘어간다 */ } }
  }
}

/** 크기를 여기서 한 번만 잰다 — 운영체제마다 따로 재면 한 군데를 빠뜨린다. */
function 잰다(r) {
  if (!r?.ok) return r;
  if (!r.buf?.length) return { ok: false, 없음: true };
  if (r.buf.length > 그림한도) {
    return { ok: false, 왜: `그림이 너무 큽니다 (${(r.buf.length / 1048576).toFixed(1)}MB · 한도 ${그림한도 / 1048576}MB)` };
  }
  return r;
}

/**
 * 꺼낸 그림을 파일로 앉힌다.
 *
 * 살림 폴더(.deel/붙인그림/) 안에 둔다. 작업 폴더에 흩뿌리면 사람이 지우기
 * 전에 커밋에 딸려 들어가고, 임시 폴더에 두면 대화를 다시 열었을 때 사라진다.
 */
export function 그림앉히기(buf, 살림, { 이제 = new Date() } = {}) {
  const 방 = join(살림, '붙인그림');
  mkdirSync(방, { recursive: true });
  const 이름 = `${이제.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)}.png`;
  const 자리 = join(방, 이름);
  writeFileSync(자리, buf);
  return { 자리, 이름, 바이트: statSync(자리).size };
}
