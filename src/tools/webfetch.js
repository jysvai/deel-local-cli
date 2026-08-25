// 웹 읽기. 읽기 전용이고, 나가는 것은 주소뿐이다.
//
// 이 도구가 다른 길로 다니는 이유:
//   모델 게이트웨이로는 소스 코드가 통째로 나간다. 그래서 그 길은 딱 한 자리로 묶어 뒀다.
//   웹 읽기는 성격이 다르다 — 받아 오기만 하고 보내지 않는다. 두 길을 한 목록에
//   같이 두면 "코드가 어디로 갈 수 있나" 를 더 이상 한 줄로 답할 수 없게 된다.
//   그래서 여기서만 잠깐 열고, 끝나면 바로 닫고, 다녀온 곳은 전부 기록에 남긴다.
//
// 지키는 것:
//   · GET 만. 본문을 실어 보내지 않는다.
//   · 사설·로컬 주소는 거절. 사내 서버를 모델이 긁어 오게 두지 않는다.
//   · 오프라인이면 아예 거절.
//   · 받은 것은 글자만 뽑고 길이를 자른다.
import { allowTemporarily, isOffline, isLocalHost } from '../safety/network.js';
import { decode as decodeBytes } from './encoding.js';

/**
 * 받아 온 바이트를 글로. 머리글에 적힌 인코딩이 있으면 그것부터 믿는다.
 *
 * 파일을 읽을 때 쓰는 것과 같은 판단기(encoding.js)를 쓴다. 두 자리에 서로 다른
 * 잣대를 두면, 같은 CP949 글이 파일로는 읽히고 웹으로는 깨지는 상태가 된다.
 */
function 웹글읽기(buf, 머리글) {
  if (머리글 && !/^utf-?8$/.test(머리글)) {
    try { return new TextDecoder(머리글, { fatal: false }).decode(buf); }
    catch { /* 이 Node 가 모르는 이름이면 아래에서 알아서 본다 */ }
  }
  // euc-kr 인 페이지를 위해 힌트를 준다. 내용이 분명하면 내용이 이긴다.
  return decodeBytes(buf, { fallback: 'euc-kr' }).text;
}

export const 방문기록 = [];

const MAX_BYTES = 2 * 1024 * 1024;   // 2MB 넘게 받지 않는다

function 태그벗기기(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * @param {object} args  모델이 주는 값 — url, max_chars
 * @param {object} opts  프로그램 내부에서만 주는 값.
 *   allowPrivate 는 검사용이다. 도구 스키마에 없으므로 모델은 이 값을 줄 수 없다.
 *   (환경변수로 열어 두면 실제 사용 중에도 열려 버린다 — 그래서 인자로만 둔다)
 */
export async function webFetch(args, { allowPrivate = false } = {}) {
  const raw = String(args?.url ?? '').trim();
  const max = Math.min(Math.max(parseInt(args?.max_chars, 10) || 20000, 1000), 100000);

  if (isOffline()) return { error: '오프라인 모드입니다 — 웹을 읽지 않습니다.' };

  let u;
  try { u = new URL(raw); } catch { return { error: `주소 형식이 아닙니다: ${raw}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { error: `${u.protocol} 는 읽지 않습니다. http/https 만 됩니다.` };
  }
  // 사내망·로컬을 모델이 훑게 두지 않는다. 웹을 읽는 도구지 내부 정찰 도구가 아니다.
  if (isLocalHost(u.hostname) && !allowPrivate) {
    return { error: `이 컴퓨터·사내망 주소는 이 도구로 읽지 않습니다: ${u.hostname}\n  파일은 Read, 사내 서버는 사람이 직접 확인하세요.` };
  }

  const close = allowTemporarily(u.origin);
  try {
    const res = await fetch(u.href, {
      method: 'GET',                              // 보내는 건 없다
      redirect: 'follow',
      headers: { 'User-Agent': 'deel/cli', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(30000),
    });
    방문기록.push({ url: u.href, status: res.status, at: new Date().toISOString() });

    if (!res.ok) return { error: `HTTP ${res.status} — ${u.href}` };

    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!/text|json|xml|javascript/.test(type)) {
      return { error: `글이 아닌 내용입니다 (${type || '알 수 없음'}). 이 도구는 글만 읽습니다.` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { error: `너무 큽니다 (${(buf.length / 1024 / 1024).toFixed(1)}MB).` };

    /*
     * 무엇으로 쓰여 있는지 알아보고 읽는다.
     *
     * 전에는 무조건 UTF-8 이었다. 사내 위키·공공기관 페이지는 아직 EUC-KR 이
     * 흔한데, 그걸 UTF-8 로 읽으면 한글이 통째로 깨진다. 그 깨진 글이 그대로
     * 모델에게 가고, 모델은 깨진 채로 요약한다 — 사용자는 왜 엉뚱한 답이
     * 나오는지 알 수 없다. 파일을 읽을 때는 이미 알아보고 읽는데(encoding.js)
     * 웹만 안 하고 있었다.
     *
     * 머리글(charset)이 있으면 그게 답이다. 없으면 내용을 보고 짐작한다.
     */
    const 머리글 = /charset=["']?([\w-]+)/i.exec(type)?.[1]?.toLowerCase() ?? null;
    let text = 웹글읽기(buf, 머리글);
    if (/html/.test(type)) text = 태그벗기기(text);
    // <meta charset> 이 머리글과 다르게 적혀 있는 페이지가 있다. 깨졌으면 그걸 믿고 다시 읽는다.
    if (!머리글 && text.includes('�')) {
      const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString('latin1').slice(0, 2000))?.[1]?.toLowerCase();
      if (meta) {
        text = 웹글읽기(buf, meta);
        if (/html/.test(type)) text = 태그벗기기(text);
      }
    }
    const cut = text.length > max;
    if (cut) text = text.slice(0, max);

    return {
      content: `${u.href}\n${'─'.repeat(60)}\n${text}${cut ? `\n\n(뒤쪽 ${'약 ' + (buf.length - max).toLocaleString()}자는 잘렸습니다)` : ''}`,
      summary: `${text.length.toLocaleString()}자${cut ? ' (잘림)' : ''}`,
    };
  } catch (err) {
    const m = String(err?.message ?? err);
    if (err?.name === 'TimeoutError') return { error: '시간 초과 — 응답이 없습니다.' };
    if (/ENOTFOUND|getaddrinfo/i.test(m)) return { error: '주소를 찾을 수 없습니다 (DNS).' };
    return { error: m };
  } finally {
    close();   // 반드시 닫는다. 열어 둔 채로 두면 자물쇠가 아니게 된다.
  }
}

export const WEB_FETCH_TOOL = {
  schema: {
    name: 'WebFetch',
    description: '웹 페이지를 읽는다. 읽기만 하고 아무것도 보내지 않는다. 문서·오류 메시지·라이브러리 사용법을 확인할 때 쓴다. 이 컴퓨터·사내망 주소는 읽지 않는다.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '읽을 주소 (http/https)' },
        max_chars: { type: 'number', description: '가져올 최대 글자 수. 기본 20000' },
      },
      required: ['url'],
    },
  },
  run: (args) => webFetch(args),
};
