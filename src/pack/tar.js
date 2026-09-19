// tar 읽기. GitHub 가 주는 tarball 을 풀기 위한 최소 구현.
// git 이 없는 기기에서도 플러그인을 받을 수 있어야 해서 필요하다.
import { gunzipSync } from 'node:zlib';
import { resolve, sep } from 'node:path';

const BLOCK = 512;

function str(buf, off, len) {
  const end = buf.indexOf(0, off);
  const stop = end >= 0 && end < off + len ? end : off + len;
  // 깎지 않는다 — 이름 앞뒤 빈칸도 이름이다 (6회차 Gemini 묶음6). 수 칸의 빈칸은 octal 이 걸러 낸다.
  return buf.toString('utf8', off, stop);
}

function octal(buf, off, len) {
  const s = str(buf, off, len).replace(/[^0-7]/g, '');
  return s ? parseInt(s, 8) : 0;
}

/*
 * ── 작게 받아서 크게 푸는 묶음(압축 폭탄) ───────────────────────────────
 *
 * 받는 쪽(plugins/manage.js)은 **압축된** 크기를 64MB 로 막는다. 그런데
 * 0 으로만 채운 파일은 천 배 넘게 줄어든다 — 64MB 짜리 하나가 풀면 수십 GB 다.
 * gunzipSync 는 그걸 통째로 메모리에 올리므로, 화면에는 아무 말도 안 남고
 * 프로세스가 그대로 죽는다. 사용자가 보는 것은 「플러그인을 깔아 줘」 라고
 * 시킨 뒤 deel 이 사라진 것뿐이다 — 하던 대화까지 같이.
 *
 * 그래서 **푼 크기**에도 상한을 둔다. 256MB 로 잡은 까닭은 받는 상한의 네 배라서다.
 * 플러그인은 글과 스크립트 묶음이라 서너 배까지는 부푼다. 그보다 더 부푸는 것은
 * 플러그인이 아니라 폭탄으로 본다.
 */
export const 푼것상한 = 256 * 1024 * 1024;

/**
 * gzip 된 tar 를 풀어 파일 목록을 돌려준다.
 * @param {Buffer} gz
 * @param {object} o
 * @param {number} o.상한 푼 크기 상한. 검사가 작은 값으로 부르려고 열어 뒀다 —
 *   256MB 를 진짜로 만들어 재면 그 검사 하나가 기계를 잡아먹는다.
 * @returns {Array<{name:string, data:Buffer, mode:number}>}
 */
export function untargz(gz, { 상한 = 푼것상한 } = {}) {
  let buf;
  try {
    buf = gunzipSync(gz, { maxOutputLength: 상한 });
  } catch (err) {
    // 조용히 죽는 대신 왜 안 되는지 말한다. 이 말은 install 이 그대로 화면에 올린다.
    if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
      // MB 로만 적으면 작은 상한이 「0MB」 가 된다 — 사람에게 아무 말도 안 하는 숫자다.
      // KB 도 같다: 1KB 밑을 KB 로 반올림하면 「0KB」 다. 그 밑은 바이트로 적는다 (6회차 Gemini 타르6bg).
      const 상한말 = 상한 >= 1024 * 1024 ? `${Math.round(상한 / 1024 / 1024)}MB`
        : 상한 >= 1024 ? `${Math.round(상한 / 1024)}KB` : `${상한}바이트`;
      throw new Error(`푼 크기가 상한(${상한말})을 넘습니다`
        + ' — 압축만 작고 풀면 몇 GB 가 되는 묶음입니다. 저장소가 맞는지 확인하세요.');
    }
    throw err;
  }
  const out = [];
  let pos = 0;
  let longName = null;

  while (pos + BLOCK <= buf.length) {
    const head = buf.subarray(pos, pos + BLOCK);
    // 빈 머리 블록이면 끝. 규격은 끝에 빈 블록 **두 개**를 두지만 첫 개에서 멈춘다 — 참 머리는
    // 체크섬 칸이 있어 모두 0일 수 없고 알맹이는 크기만큼 건너뛰므로, 머리 자리의 빈 블록은
    // 끝에서만 나온다. GNU tar 도 `-i` 없이는 여기서 멈춘다 (6회차 Gemini 타르6bg).
    if (head.every((b) => b === 0)) break;

    const size = octal(head, 124, 12);
    /*
     * 갈래(typeflag)는 **여기 한 자리에서만** 정한다.
     *
     * 규격은 정규 파일을 `'0'` 과 NUL 둘 다로 적게 허락한다(옛 tar 가 NUL 로
     * 적는다). 전에는 `String.fromCharCode(head[156]) || '0'` 이었는데,
     * `String.fromCharCode(0)` 은 빈 글자가 아니라 NUL 한 글자라 언제나 참이다 —
     * 그 `|| '0'` 은 어떤 묶음에도 안 걸리는 죽은 폴백이었고, 실제로 NUL 을
     * 살린 것은 아래 「type === '\0'」 한 마디였다. 한 가지를 두 자리에서
     * 따지면 한쪽만 고치는 날이 오고, 그날 NUL 로 지은 묶음은 파일 0개로
     * 조용히 풀린다. 그래서 읽는 즉시 '0' 으로 맞춰 두고 아래는 '0' 만 본다.
     */
    const type = head[156] === 0 ? '0' : String.fromCharCode(head[156]);
    const mode = octal(head, 100, 8);
    // 345 자리가 이름 앞머리인 것은 POSIX ustar(매직 「ustar」 + NUL)뿐이다. GNU 머리(「ustar」 + 빈칸 둘)는
    // 거기에 atime 을 적어, 증분 묶음이면 `14325671234/file.txt` 로 풀렸다 (6회차 Gemini 묶음6).
    const posix = head[262] === 0 && head.toString('latin1', 257, 262) === 'ustar';
    const prefix = posix ? str(head, 345, 155) : '';
    let name = str(head, 0, 100);
    if (prefix) name = `${prefix}/${name}`;

    pos += BLOCK;
    /*
     * ── 머리가 적은 크기만큼 알맹이가 있나 ──────────────────────────────
     *
     * `subarray` 는 끝을 넘으면 **있는 데까지만** 준다. 그래서 머리에 100000
     * 바이트라고 적힌 파일이 몇 바이트짜리로 조용히 풀렸다 (2.0.0 4회차 사냥).
     * 스크립트가 반만 깔린 플러그인은 멀쩡해 보이다가 엉뚱한 자리에서 선다.
     * 반쪽을 깔아 두느니 안 까는 편이 낫다 — 던지면 install 이 이 말을 화면에 올린다.
     *
     * 알맹이 뒤의 자투리(512 바이트 맞춤)나 끝의 빈 블록이 없는 것은 봐준다.
     * 그런 묶음은 흔하고, 파일 내용은 다 있다.
     */
    if (pos + size > buf.length) {
      const 보일이름 = longName && !'Lxg'.includes(type) ? longName : name;
      throw new Error(`묶음이 중간에 잘렸습니다 — '${보일이름}' 은 머리에 ${size}바이트라고 적혀 있는데 `
        + `${Math.max(0, buf.length - pos)}바이트뿐입니다. 받다가 끊겼거나 망가진 묶음입니다.`);
    }
    const data = buf.subarray(pos, pos + size);
    pos += Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {                    // GNU 긴 이름
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'x' || type === 'g') {    // pax 확장 머리 — path 만 본다
      // 기록의 머리(맨 앞이나 줄바꿈 뒤)에서만 본다. 다른 값 안의 「20 path=…」 를 이름으로 읽었다 (6회차 Gemini 묶음6).
      const m = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(data.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (longName) { name = longName; longName = null; }

    if (type === '0') {
      out.push({ name: name.replace(/\\/g, '/'), data: Buffer.from(data), mode: mode || 0o644 });
    }
    // 위에서 '0' 으로 맞춰 둔 정규 파일만 담는다. 폴더('5')·링크 등은 건너뛴다 —
    // 파일만 있으면 폴더는 만들면서 채운다.
  }
  return out;
}

// GitHub tarball 은 최상위에 <repo>-<커밋> 폴더 한 겹이 더 있다. 그걸 벗긴다.
export function stripTop(files) {
  if (!files.length) return files;
  const first = files[0].name.split('/')[0];
  if (!files.every((f) => f.name.startsWith(first + '/'))) return files;
  return files.map((f) => ({ ...f, name: f.name.slice(first.length + 1) }));
}

/**
 * 이 이름이 풀 폴더 **안쪽**을 가리키나.
 *
 * ── 왜 있어야 하나 ──────────────────────────────────────────────────────
 *
 * tar 안의 이름은 **남이 적은 글자**다. 우리가 만든 것이 아니다. 그걸 그대로
 * join(dest, name) 에 넣으면 `../../../..` 하나로 폴더 밖에 파일을 쓴다.
 * 받는 쪽이 mkdirSync(recursive) 까지 해 주므로 없는 폴더도 만들어 가며 나간다.
 *
 *   name: '../../../../윗동네에쓰기.txt'
 *   dest: C:\Users\누군가\.deel\plugins\x
 *   →    C:\Users\윗동네에쓰기.txt
 *
 * 이 프로그램이 파는 문장이 「작업 폴더 밖은 안 만진다」 인데, 플러그인을
 * 받는 길에는 그 문장을 지키는 코드가 한 줄도 없었다. 여기서 막는다 —
 * 푸는 자리마다 따로 적으면 언젠가 한 곳이 빠진다.
 *
 * 절대경로·드라이브 문자도 같이 걸린다. resolve 는 절대경로를 만나면 뿌리를
 * 통째로 갈아 치우므로, 그 결과가 뿌리로 시작하지 않는다.
 */
export function 안쪽인가(뿌리, 이름) {
  const 원래 = String(이름 ?? '');
  /*
   * ── 판마다 다르게 막으면 막은 게 아니다 ───────────────────────────────
   *
   * `resolve()` 는 윈도우에서만 역슬래시를 칸막이로 본다. 그래서
   * `..\\..\\밖으로.txt` 는 윈도우에서는 밖으로 잡히고 리눅스·맥에서는
   * **그냥 파일 이름 하나**로 통과한다. 같은 묶음이 판에 따라 다르게 처리되는
   * 셈이다.
   *
   * 플러그인 묶음은 기계를 옮겨 다닌다. 리눅스에서 받아 둔 것을 윈도우로
   * 옮기거나, 리눅스에서 푼 것을 그대로 다시 묶어 나눠 주는 일이 흔하다.
   * 한쪽에서만 막으면 다른 쪽으로 새어 나갈 길이 남는다.
   *
   * 그래서 역슬래시를 **어느 판에서든** 칸막이로 본다. 이 방향으로만 틀리면
   * 손해는 「이름에 역슬래시가 든 파일을 못 푼다」 뿐이고, 그런 이름이 정직한
   * 플러그인에 있을 까닭이 없다. 반대 방향으로 틀리면 남의 글자 한 줄로
   * 폴더 밖에 파일이 써진다.
   */
  const 이름꼴 = 원래.replace(/\\/g, '/');
  // 드라이브 글자(`C:`)도 마찬가지다. 리눅스에서는 그냥 이름이라 통과하는데,
  // 그 묶음을 윈도우에서 풀면 그 자리로 곧장 나간다.
  if (/^[a-zA-Z]:/.test(이름꼴)) return false;
  const 뿌리절대 = resolve(String(뿌리 ?? ''));
  const 갈곳 = resolve(뿌리절대, 이름꼴);
  return 갈곳 === 뿌리절대 || 갈곳.startsWith(뿌리절대 + sep);
}

/** 풀 폴더 밖을 가리키는 것만 골라 준다. 하나라도 있으면 그 묶음은 안 푼다. */
export function 밖을가리키는것(뿌리, files) {
  return (files ?? []).filter((f) => !안쪽인가(뿌리, f?.name));
}
