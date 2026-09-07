/**
 * Kiwi — 스키마를 파일이 제 안에 지고 다니는 이진 형식.
 *
 * ── 왜 이걸 우리가 갖고 있나 ────────────────────────────────────────────
 *
 * Figma 의 `.fig` 알맹이가 이 형식이다. 보통 이런 이진 형식을 읽으려면
 * **스키마를 따로 구해 와야** 한다 — protobuf 의 `.proto` 처럼. 그러면 판이
 * 올라갈 때마다 우리가 들고 있는 스키마가 낡고, 낡은 스키마로 읽으면 조용히
 * 어긋난 값을 내놓는다. 그게 제일 나쁜 실패다.
 *
 * Kiwi 는 다르다. **파일 첫 덩이가 그 파일을 읽는 법 자체**다. 정의 이름,
 * 칸 이름, 칸 번호가 다 들어 있다. 그래서 우리가 아무 표도 안 들고 있어도
 * 되고, Figma 가 내일 칸을 하나 더 늘려도 그 파일이 제 손으로 알려 준다.
 * 우리가 굳혀 둘 것이 없으니 낡을 것도 없다.
 *
 * ── 어떻게 생겼나 ──────────────────────────────────────────────────────
 *
 *   스키마 := 정의개수:varuint  정의*
 *   정의   := 이름:string  갈래:byte  칸개수:varuint  칸*
 *   칸     := 이름:string  형:varint  배열인가:byte  값:varuint
 *
 * 갈래는 0=ENUM · 1=STRUCT · 2=MESSAGE 이고, 셋이 서로 다르게 읽힌다.
 *
 *   ENUM     값 하나(varuint). 그 숫자에 붙은 이름으로 돌려준다.
 *   STRUCT   칸을 **순서대로 전부**. 번호도 끝 표시도 없다.
 *   MESSAGE  `번호:varuint 값` 을 되풀이하다 번호 0 을 만나면 끝. 칸이 빠져
 *            있어도 되고 순서가 뒤바뀌어도 된다.
 *
 * 형이 음수면 기본형(`~형` 번째), 0 이상이면 정의 목록의 그 번째다.
 *
 * ── 남이 준 바이트다 ───────────────────────────────────────────────────
 *
 * `.fig` 는 사람이 받아 오는 파일이고, 우리는 모델이 시키는 대로 그것을 연다.
 * 즉 **남이 정한 숫자로 우리 메모리를 정하게 두는 자리**다. 배열 개수 한 칸이
 * 40억이면 그대로 40억 칸을 잡으려 든다. 그래서 개수를 볼 때마다 남은
 * 바이트와 견준다 — 어떤 값이든 최소 한 바이트는 먹으므로, 남은 바이트보다
 * 많은 개수는 그 자리에서 거짓이다.
 */

const 기본형 = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'];
const 갈래이름 = ['ENUM', 'STRUCT', 'MESSAGE'];

/* 스키마가 이보다 크면 Kiwi 스키마가 아니다. 읽다 지쳐 죽는 대신 여기서 끊는다. */
const 정의최대 = 20000;
const 칸최대 = 20000;
/* 되돌이 깊이. Figma 의 노드 구조는 열 겹을 안 넘는다 — 백 겹이면 고리다. */
const 깊이최대 = 100;

/** 실수 네 바이트를 뒤집어 볼 때 쓰는 창. 새로 만들지 않고 하나를 돌려 쓴다. */
const 실수판 = new DataView(new ArrayBuffer(4));

/**
 * 바이트를 앞에서부터 읽는 자.
 *
 * 끝을 넘으면 **바로 던진다.** 넘긴 채로 0 을 돌려주면 깨진 파일이 「내용이
 * 빈 파일」 로 보이고, 그건 읽는 쪽에서 구분할 길이 없다.
 */
export class 읽개 {
  constructor(buf) {
    this.b = buf;
    this.i = 0;
  }

  get 남은() { return this.b.length - this.i; }

  바이트() {
    if (this.i >= this.b.length) throw new Error('바이트가 모자랍니다');
    return this.b[this.i++];
  }

  /** LEB128. 32비트를 넘기면 위쪽이 잘린다 — Kiwi 의 uint 가 32비트다. */
  varuint() {
    let 값 = 0;
    let 자리 = 0;
    for (;;) {
      const b = this.바이트();
      값 |= (b & 0x7f) << 자리;
      자리 += 7;
      if (!(b & 0x80)) break;
      if (자리 >= 35) throw new Error('varuint 가 너무 깁니다');
    }
    return 값 >>> 0;
  }

  /** 지그재그. 부호를 맨 아래 비트로 접어 넣는 방식이다. */
  varint() {
    const v = this.varuint();
    return (v & 1) ? ~(v >>> 1) : (v >>> 1);
  }

  varuint64() {
    let 값 = 0n;
    let 자리 = 0n;
    for (let n = 0; n < 10; n += 1) {
      const b = this.바이트();
      값 |= BigInt(b & 0x7f) << 자리;
      if (!(b & 0x80)) return 값;
      자리 += 7n;
    }
    throw new Error('varuint64 가 너무 깁니다');
  }

  varint64() {
    const v = this.varuint64();
    return (v & 1n) ? -(v >> 1n) - 1n : (v >> 1n);
  }

  /**
   * 실수 하나.
   *
   * Kiwi 는 지수부를 맨 앞 바이트로 **돌려 놓고** 쓴다. 그래야 0 과
   * 0 에 가까운 값이 첫 바이트 하나로 끝난다 — 도형 좌표에는 0 이 아주
   * 흔해서, 이 한 가지로 파일이 눈에 띄게 줄어든다.
   */
  varfloat() {
    const 첫 = this.바이트();
    if (첫 === 0) return 0;
    if (this.남은 < 3) throw new Error('실수 바이트가 모자랍니다');
    const bits = (첫 | (this.바이트() << 8) | (this.바이트() << 16) | (this.바이트() << 24)) >>> 0;
    실수판.setUint32(0, ((bits << 23) | (bits >>> 9)) >>> 0, true);
    return 실수판.getFloat32(0, true);
  }

  /** UTF-8 이고 0 바이트에서 끝난다. 길이를 앞에 안 적는다. */
  문자열() {
    const 시작 = this.i;
    while (this.i < this.b.length && this.b[this.i] !== 0) this.i += 1;
    if (this.i >= this.b.length) throw new Error('문자열이 끝나지 않았습니다');
    const s = this.b.toString('utf8', 시작, this.i);
    this.i += 1;
    return s;
  }

  /** 값을 안 쓸 때. 만들지 않고 지나가기만 한다. */
  문자열건너뛰기() {
    while (this.i < this.b.length && this.b[this.i] !== 0) this.i += 1;
    if (this.i >= this.b.length) throw new Error('문자열이 끝나지 않았습니다');
    this.i += 1;
  }

  /**
   * 개수 한 칸.
   *
   * 남은 바이트보다 큰 개수는 읽어 볼 것도 없이 거짓이다. 어떤 값이든
   * 최소 한 바이트는 먹기 때문이다. 다 읽어 보고 나서 아는 것과 여기서
   * 아는 것의 차이가 **메모리를 쓰느냐 마느냐** 다.
   */
  개수() {
    const n = this.varuint();
    if (n > this.남은) throw new Error(`개수가 남은 바이트보다 큽니다 (${n} > ${this.남은})`);
    return n;
  }
}

/**
 * 스키마 덩이를 푼다.
 *
 * @returns {{정의들:[{이름,갈래,칸들:[{이름,형,배열,값}]}], 이름표:Map}}
 */
export function 스키마읽기(buf) {
  const r = new 읽개(buf);
  const 개수 = r.varuint();
  if (개수 > 정의최대) throw new Error(`정의가 ${개수}개 — Kiwi 스키마가 아닌 것 같습니다`);

  const 정의들 = [];
  for (let i = 0; i < 개수; i += 1) {
    const 이름 = r.문자열();
    const 갈래 = 갈래이름[r.바이트()] ?? 'ENUM';
    const 칸수 = r.varuint();
    if (칸수 > 칸최대) throw new Error(`${이름} 의 칸이 ${칸수}개 — 스키마가 깨졌습니다`);
    const 칸들 = [];
    for (let j = 0; j < 칸수; j += 1) {
      칸들.push({
        이름: r.문자열(),
        형: r.varint(),
        배열: !!(r.바이트() & 1),
        값: r.varuint(),
      });
    }
    정의들.push({ 이름, 갈래, 칸들 });
  }

  const 이름표 = new Map(정의들.map((d, i) => [d.이름, i]));
  return { 정의들, 이름표 };
}

/**
 * 스키마대로 알맹이 덩이를 푼다.
 *
 * @param {object} 스키마 `스키마읽기` 가 준 것
 * @param {Buffer} buf 알맹이
 * @param {string} 뿌리 시작할 정의 이름 (Figma 는 `Message`)
 * @param {(정의이름:string, 칸이름:string) => boolean} [남길까]
 *   `false` 면 **읽되 안 담는다.** 바이트는 그대로 지나가야 다음 칸 자리가
 *   맞으므로 안 읽을 수는 없다. 안 담기만 한다.
 *
 *   왜 필요한가 — Figma 파일 하나에 도형 좌표가 수백만 개다. 우리가 쓰는
 *   것은 이름·글·크기뿐인데 전부 객체로 만들면 몇백 MB 가 된다. 걸러내는
 *   자리를 부르는 쪽에 주면, 이 읽개는 그대로 두고 쓰는 쪽만 정하면 된다.
 */
export function 알맹이읽기(스키마, buf, 뿌리, 남길까 = null) {
  const 번호 = 스키마.이름표.get(뿌리);
  if (번호 === undefined) throw new Error(`스키마에 ${뿌리} 정의가 없습니다`);
  const r = new 읽개(buf);
  return 정의읽기(스키마, r, 번호, 0, true, 남길까);
}

/** 기본형 하나. 담을 것이 아니면 만들지 않고 지나간다. */
function 기본읽기(r, 형, 담나) {
  switch (기본형[~형]) {
    case 'bool': return r.바이트() !== 0;
    case 'byte': return r.바이트();
    case 'int': return r.varint();
    case 'uint': return r.varuint();
    case 'float': return r.varfloat();
    case 'int64': return r.varint64();
    case 'uint64': return r.varuint64();
    case 'string':
      if (!담나) { r.문자열건너뛰기(); return null; }
      return r.문자열();
    default:
      throw new Error(`모르는 기본형 ${형}`);
  }
}

function 값읽기(스키마, r, 형, 깊이, 담나, 남길까) {
  if (형 < 0) return 기본읽기(r, 형, 담나);
  return 정의읽기(스키마, r, 형, 깊이, 담나, 남길까);
}

function 정의읽기(스키마, r, 번호, 깊이, 담나, 남길까) {
  if (깊이 > 깊이최대) throw new Error('구조가 너무 깊습니다 — 고리가 있는 것 같습니다');
  const d = 스키마.정의들[번호];
  if (!d) throw new Error(`정의 ${번호} 가 없습니다`);

  if (d.갈래 === 'ENUM') {
    const v = r.varuint();
    if (!담나) return null;
    // 이름으로 돌려준다. 숫자 7 보다 'TEXT' 가 읽는 쪽에서 훨씬 쓸모 있고,
    // 모르는 숫자는 숫자대로 남긴다 — 새 판이 늘린 값일 수 있다.
    return d.칸들.find((f) => f.값 === v)?.이름 ?? v;
  }

  const 것 = 담나 ? {} : null;

  const 한칸 = (f) => {
    const 이칸담나 = 담나 && (!남길까 || 남길까(d.이름, f.이름));
    let v;
    if (f.배열) {
      const n = r.개수();
      /*
       * 안 담을 바이트 배열은 **세면서 지나가지 않는다.**
       *
       * Figma 파일 하나에 이미지·도형 덩어리가 수십 MB 씩 들어 있고, 그게
       * 전부 `byte[]` 다. 한 바이트씩 도는 것과 자리만 옮기는 것의 차이가
       * 여기서는 수천만 번이다. 값을 안 쓸 때만 쓰는 길이라, 담는 쪽 결과는
       * 한 글자도 안 달라진다.
       */
      if (!이칸담나 && f.형 === -2) {
        if (n > r.남은) throw new Error(`바이트 배열이 남은 것보다 깁니다 (${n} > ${r.남은})`);
        r.i += n;
        return;
      }
      const 모음 = 이칸담나 ? new Array(n) : null;
      for (let i = 0; i < n; i += 1) {
        const x = 값읽기(스키마, r, f.형, 깊이 + 1, 이칸담나, 남길까);
        if (모음) 모음[i] = x;
      }
      v = 모음;
    } else {
      v = 값읽기(스키마, r, f.형, 깊이 + 1, 이칸담나, 남길까);
    }
    if (것 && 이칸담나) 것[f.이름] = v;
  };

  if (d.갈래 === 'STRUCT') {
    for (const f of d.칸들) 한칸(f);
    return 것;
  }

  // MESSAGE — 번호 0 이 끝이다. 스키마에 없는 번호를 만나면 **거기서 멈춘다.**
  // 길이가 안 적혀 있어서 건너뛸 수가 없다. 짐작으로 계속 읽으면 그 뒤가
  // 전부 헛것이 되므로, 아는 데까지만 읽었다고 말하는 편이 낫다.
  const 칸표 = new Map(d.칸들.map((f) => [f.값, f]));
  for (;;) {
    const id = r.varuint();
    if (id === 0) break;
    const f = 칸표.get(id);
    if (!f) throw new Error(`${d.이름} 에 모르는 칸 번호 ${id} — 여기서 더 못 읽습니다`);
    한칸(f);
  }
  return 것;
}
