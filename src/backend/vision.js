// 그림을 모델에게 보여 준다.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 사람이 버그를 설명하는 가장 흔한 방법은 화면 사진이다. "여기 이 화면
// 좀 봐" 는 글로 옮기기 어렵고, 옮기다 보면 정작 중요한 것(빨간 줄이
// 어디에 떴는지, 글자가 어디서 깨졌는지)이 빠진다.
//
// 그런데 지금까지 `Read shot.png` 는 그 파일을 **글로 읽으려고** 했다.
// PNG 를 글로 읽으면 깨진 글자 수천 자가 나온다. 그게 통째로 대화에
// 실려서 자리를 먹고, 모델은 그걸 코드로 착각하고 뭔가 말하려 든다.
// 사람은 왜 이상한 답이 오는지 모른다.
//
// ── 무엇을 하나 ────────────────────────────────────────────────────────
//
// 그림이면 그림으로 싣는다. 규격이 셋이라 모양도 셋이다.
//
//   OpenAI 호환   content 배열에 { type:'image_url', image_url:{ url:'data:…' } }
//   Ollama        메시지에 images: ['<base64>'] (data: 머리말 없이)
//   Anthropic     content 배열에 { type:'image', source:{ type:'base64', media_type, data } }
//
// 못 보는 모델에게는 **바이트를 아예 안 보낸다.** 보내 봐야 400 이 오거나,
// 더 나쁘게는 서버가 조용히 무시하고 답을 지어낸다. 대신 한 줄로 말한다.
import { readFileSync, statSync } from 'node:fs';

// 다룰 확장자. 이 목록에 없는 것은 예전처럼 글로 읽는다.
const 확장자 = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** 한 장 최대 크기. 창 크기와 상관없이 이 위로는 안 싣는다. */
export const 기본한도 = 4 * 1024 * 1024;

/**
 * 한 변의 최대 픽셀. 이 위로는 서버가 400 을 준다.
 *
 * ── 왜 바이트만으로는 안 되나 ───────────────────────────────────────────
 *
 * 여태 크기만 보고 있었다. 그런데 **바이트와 픽셀은 따로 논다** — 화면을 길게
 * 찍은 스크린샷은 잘 압축돼서 12000×3000 이어도 4MB 를 한참 밑돈다. 그래서
 * 크기 검사를 멀쩡히 통과하고, 게이트웨이에서 이렇게 튕겼다.
 *
 *   messages.8.content.1.image.source.bytes:
 *   At least one of the image dimensions exceed max allowed size: 8000 pixels
 *
 * ── 그리고 이건 그 턴 하나로 안 끝난다 ──────────────────────────────────
 *
 * 튕긴 뒤에도 그 그림은 **대화에 남는다.** 다음에 무슨 말을 걸어도 같은
 * 메시지가 같이 나가서 같은 400 을 받는다. 「대시보드 실행해줘」 처럼 그림과
 * 아무 상관 없는 말까지 안 된다 — 세션이 통째로 죽는다. 사람이 보기에는
 * 프로그램이 갑자기 고장 난 것이고, 원인은 아홉 번째 메시지에 있다.
 *
 * 그러니 **들어오기 전에 막아야 한다.** 한 번 실려 들어가면 그 뒤는 늦다.
 *
 * 8000 은 Bedrock 이 거절한 값이고 Anthropic 규격이 적어 둔 값과 같다.
 */
export const 픽셀한도 = 8000;

/** 경로만 보고 그림인지. 실제로 그림인지는 그림읽기() 가 속을 보고 정한다. */
export function 그림인가(경로) {
  const s = String(경로 ?? '').toLowerCase();
  const i = s.lastIndexOf('.');
  return i > 0 && 확장자.has(s.slice(i));
}

/*
 * 속을 보고 종류를 정한다 — 확장자를 믿지 않는다.
 *
 * 사내에서 화면을 캡처해 붙이는 길이 여럿이라, 이름만 .png 이고 속은 JPEG 인
 * 파일이 흔하다. 그런 것을 `image/png` 라고 적어 보내면 게이트웨이가 400 을
 * 준다 — 그러면 화면에는 "그림을 못 보냈습니다" 만 남고, 파일은 멀쩡해서
 * 사람은 원인을 못 찾는다. 여기서 속을 보고 맞는 이름을 붙이면 그냥 된다.
 *
 * 또 하나. 사내망에서 그림 주소를 받아 저장하면 로그인 페이지 HTML 이
 * shot.png 라는 이름으로 저장돼 있는 일이 있다. 그건 그림이 아니다.
 */
export function 그림종류(buf) {
  const b = buf;
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** 사람에게 보여 줄 크기. */
export function 크기말(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 그림 파일 하나를 실을 수 있는 모양으로 읽는다.
 *
 * 못 실을 이유가 있으면 **왜 그런지를 돌려준다.** 부르는 쪽이 그 말을 그대로
 * 화면과 모델에게 보여 준다 — "그림을 못 읽었습니다" 로 뭉뚱그리면 사람이
 * 파일을 줄여야 하는지 형식을 바꿔야 하는지 알 수 없다.
 *
 * @returns {{ok:true, b64:string, mime:string, bytes:number} | {ok:false, 왜:string, bytes:number}}
 */
export function 그림읽기(abs, { 한도 = 기본한도 } = {}) {
  let bytes = 0;
  try { bytes = statSync(abs).size; }
  catch (err) { return { ok: false, 왜: `못 읽었습니다: ${err.message}`, bytes: 0 }; }

  // 크기부터 본다. 4MB 를 통째로 읽어 base64 로 부풀린 다음 버리면
  // 그만큼의 메모리와 시간이 헛간다.
  if (bytes > 한도) {
    return {
      ok: false,
      bytes,
      왜: `그림이 큽니다 (${크기말(bytes)} · 한 장 한도 ${크기말(한도)}) — 줄여서 저장한 뒤 다시 주세요.`
        + ' 여기서는 크기를 줄이지 않습니다. 줄이려면 다른 프로그램이 필요한데,'
        + ' 이 도구는 아무것도 안 깔고 도는 것이 규칙입니다.',
    };
  }
  if (bytes === 0) return { ok: false, 왜: '빈 파일입니다.', bytes: 0 };

  let buf;
  try { buf = readFileSync(abs); }
  catch (err) { return { ok: false, 왜: `못 읽었습니다: ${err.message}`, bytes }; }

  const mime = 그림종류(buf);
  if (!mime) {
    return {
      ok: false,
      bytes,
      왜: '이름은 그림인데 속은 그림이 아닙니다 (PNG·JPEG·GIF·WebP 중 무엇도 아님).'
        + ' 내려받다 만 파일이거나, 로그인 화면 HTML 이 그림 이름으로 저장된 것일 수 있습니다.',
    };
  }

  /*
   * 치수를 본다. 못 읽으면 **막지 않는다** — 우리가 못 읽는 모양이라고 서버도
   * 못 읽는다는 뜻은 아니다. 모르는 것을 이유로 막으면 멀쩡한 그림이 안 실린다.
   */
  const 잰것 = 치수읽기(buf, mime);
  if (잰것 && (잰것.가로 > 픽셀한도 || 잰것.세로 > 픽셀한도)) {
    return {
      ok: false,
      bytes,
      가로: 잰것.가로,
      세로: 잰것.세로,
      왜: `그림의 한 변이 깁니다 (${잰것.가로}×${잰것.세로} · 한 변 한도 ${픽셀한도}px) —`
        + ' 잘라서 저장한 뒤 다시 주세요. 화면 전체를 길게 찍은 사진이 흔히 여기 걸립니다.'
        + ' 여기서는 크기를 줄이지 않습니다. 줄이려면 다른 프로그램이 필요한데,'
        + ' 이 도구는 아무것도 안 깔고 도는 것이 규칙입니다.',
    };
  }
  return { ok: true, b64: buf.toString('base64'), mime, bytes, ...(잰것 ?? {}) };
}

/**
 * 그림의 가로·세로를 **머리말만 읽어서** 잰다. 못 알아보면 null.
 *
 * 파일을 통째로 해석하지 않는다. 각 형식이 앞쪽에 치수를 적어 두므로 그 자리만
 * 본다 — 의존성 0개를 지키면서 픽셀을 아는 유일한 길이다.
 */
export function 치수읽기(buf, mime = null) {
  // 10 은 형식들 가운데 제일 짧은 머리말(GIF)이다. 그보다 크게 잡으면 GIF 가
  // 형식별 검사에 닿기도 전에 잘린다 — 실제로 그랬다.
  if (!buf || buf.length < 10) return null;
  const 꼴 = mime ?? 그림종류(buf);
  try {
    // PNG: 서명 8바이트 + 길이 4 + 'IHDR' 4 뒤에 가로·세로가 빅엔디안 4바이트씩.
    if (꼴 === 'image/png') {
      if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
      return { 가로: buf.readUInt32BE(16), 세로: buf.readUInt32BE(20) };
    }
    // GIF: 머리말 6바이트 뒤에 가로·세로가 리틀엔디안 2바이트씩.
    if (꼴 === 'image/gif') {
      if (buf.length < 10) return null;
      return { 가로: buf.readUInt16LE(6), 세로: buf.readUInt16LE(8) };
    }
    if (꼴 === 'image/webp') return webp치수(buf);
    if (꼴 === 'image/jpeg') return jpeg치수(buf);
  } catch { /* 잘린 파일이면 그냥 모르는 것으로 둔다 */ }
  return null;
}

/*
 * JPEG 는 치수가 고정된 자리에 없다. SOF 표시를 찾아 그 안에서 읽는다.
 *
 * SOF 는 0xFFC0~0xFFCF 인데 C4(허프만표)·C8·CC 는 SOF 가 아니다. 그 셋을 빼야
 * 엉뚱한 토막에서 숫자를 읽고 「3×1 그림」 같은 답을 내지 않는다.
 */
function jpeg치수(buf) {
  let i = 2;                                   // 0xFFD8 다음부터
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; } // 채움 바이트를 건너뛴다
    const 표시 = buf[i + 1];
    if (표시 === 0xd8 || 표시 === 0x01 || (표시 >= 0xd0 && 표시 <= 0xd7)) { i += 2; continue; }
    const 길이 = buf.readUInt16BE(i + 2);
    if (길이 < 2) return null;
    const SOF = 표시 >= 0xc0 && 표시 <= 0xcf && 표시 !== 0xc4 && 표시 !== 0xc8 && 표시 !== 0xcc;
    if (SOF) return { 가로: buf.readUInt16BE(i + 7), 세로: buf.readUInt16BE(i + 5) };
    i += 2 + 길이;
  }
  return null;
}

/* WebP 는 속이 셋(VP8 · VP8L · VP8X)이고 치수가 저마다 다른 자리에 다르게 담긴다. */
function webp치수(buf) {
  if (buf.length < 30) return null;
  const 갈래 = buf.toString('ascii', 12, 16);
  if (갈래 === 'VP8 ') return { 가로: buf.readUInt16LE(26) & 0x3fff, 세로: buf.readUInt16LE(28) & 0x3fff };
  if (갈래 === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { 가로: (b & 0x3fff) + 1, 세로: ((b >> 14) & 0x3fff) + 1 };
  }
  if (갈래 === 'VP8X') {
    // 24비트 리틀엔디안으로 '한 변 - 1' 이 적혀 있다.
    const 셋 = (at) => (buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16)) + 1;
    return { 가로: 셋(24), 세로: 셋(27) };
  }
  return null;
}

/*
 * 그림 한 장을 몇 토큰으로 셀 것인가.
 *
 * 정직하게 말하면 **모른다.** 서버는 그림을 잘게 나눠 세는데, 몇 조각이 되는지는
 * 서버와 모델이 정한다. 우리가 아는 것은 바이트 수뿐이고, 바이트 수와 토큰 수는
 * 관계가 거의 없다 (같은 화면을 PNG 로 저장하면 2MB, JPEG 로 저장하면 200KB 인데
 * 모델이 보는 그림은 같다).
 *
 * 그래서 한 장에 이만큼이라고 **딱 정해 두고**, 대신 서버가 실제 값을 알려주면
 * 그쪽으로 고쳐 잡는다 (session.js 의 배운다()). 1,000 은 1024×1024 한 장이
 * OpenAI 셈법으로 1,105 인 데서 왔다.
 *
 * 여기서 중요한 것은 정확한 값이 아니라 **base64 글자 수로 세지 않는 것**이다.
 * 그렇게 세면 4MB 그림 한 장이 150만 토큰으로 잡혀서, 창이 다 찬 줄 알고
 * 대화를 통째로 접어 버린다. 그림을 한 장 보여 준 죄로 하던 일을 잃는다.
 */
export const 그림한장토큰 = 1000;

/** 메시지 하나에 그림이 몇 장 실려 있나. 규격 세 가지를 다 본다. */
export function 그림장수(m) {
  if (!m) return 0;
  if (Array.isArray(m.images)) return m.images.length;           // Ollama
  // image_url 은 OpenAI 호환, image 는 Anthropic. 한쪽만 세면 그림을 실어
  // 놓고도 안 실은 줄 알고 창 크기를 잘못 잡는다.
  if (Array.isArray(m.content)) {
    return m.content.filter((p) => p?.type === 'image_url' || p?.type === 'image').length;
  }
  return 0;
}

/** 토큰 셈에서 쓸, 그림을 뺀 글만. */
export function 글만(m) {
  if (typeof m?.content === 'string') return m.content;
  if (Array.isArray(m?.content)) {
    return m.content.filter((p) => p?.type === 'text').map((p) => p?.text ?? '').join('\n');
  }
  return '';
}

/**
 * 그림을 실은 사람 메시지를 만든다.
 *
 * 그림은 **사람 말 자리로 간다.** 도구 결과(role:'tool')에 넣을 수 없어서다 —
 * OpenAI 규격에서 도구 결과의 content 는 글 한 덩어리여야 하고, 배열을 넣으면
 * 게이트웨이가 400 을 준다. 그래서 도구 결과에는 "그림을 열었다" 는 말만 남기고,
 * 그림 자체는 바로 뒤에 사람 말로 붙인다. 규격상 도구 결과 다음에 사람 말이
 * 오는 것은 정상이다.
 */
export function 그림메시지(shape, { 글 = '', 그림들 = [] } = {}) {
  const 것들 = 그림들.filter((g) => g?.b64);
  /*
   * Anthropic 은 그림을 data: 주소로 안 받는다. 종류와 알맹이를 따로 준다.
   * image_url 로 보내면 「모르는 블록」 이라고 통째로 거절당한다 — 글까지
   * 같이 안 간다는 뜻이라, 눈이 없는 것과 달리 대화가 아예 안 이어진다.
   */
  if (shape === 'anthropic') {
    return {
      role: 'user',
      content: [
        { type: 'text', text: 글 },
        ...것들.map((g) => ({
          type: 'image',
          source: { type: 'base64', media_type: g.mime, data: g.b64 },
        })),
      ],
    };
  }
  if (shape === 'ollama') {
    // Ollama 는 data: 머리말을 안 받는다. base64 알맹이만 준다.
    return { role: 'user', content: 글, images: 것들.map((g) => g.b64) };
  }
  return {
    role: 'user',
    content: [
      { type: 'text', text: 글 },
      ...것들.map((g) => ({ type: 'image_url', image_url: { url: `data:${g.mime};base64,${g.b64}` } })),
    ],
  };
}

/*
 * 눈이 있는지 물어보는 데 쓸 1×1 짜리 PNG.
 *
 * 진짜 그림을 쓰면 안 된다. 어떤 화면이든 그 안에 무엇이 찍혀 있을지 모르고,
 * 확인하자고 사내 화면을 바깥으로 내보낼 수는 없다. 이건 흰 점 하나다.
 */
export const 한점PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 눈 검사에 쓸 메시지. 규격 세 가지 다. */
export function 눈검사메시지(shape) {
  return 그림메시지(shape, {
    글: '이 그림에 무엇이 있습니까? 한 단어로 답하세요.',
    그림들: [{ b64: 한점PNG, mime: 'image/png' }],
  });
}
