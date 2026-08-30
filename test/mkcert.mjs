// 검사용 자체 서명 인증서를 **손으로** 만든다 — 프록시 검사(test/proxy.test.js)가 쓴다.
//
// 왜 손으로 만드나:
//   HTTPS 게이트웨이를 CONNECT 터널로 지나가는 길을 재려면 TLS 서버가 하나 있어야
//   하고, 그 서버에는 인증서가 있어야 한다. 그런데
//     · 개인 키를 저장소에 박아 두면 비밀 검색기(GitHub·CodeQL·우리 secrets.js)가
//       전부 잡는다. 검사용이라고 적어 놔도 심사에서 한 번은 설명해야 한다.
//     · openssl 은 리눅스·맥·Git for Windows 에는 있지만 PATH 에 없는 PC 가 있다.
//       "openssl 이 없어서 건너뜀" 이 CI 판마다 다르게 나오면 그 검사는 없는 것과 같다.
//   그래서 Node 의 crypto 로 키를 만들고, X.509 를 DER 로 직접 짠다. 필요한 것은
//   SEQUENCE·INTEGER·OID·시간·확장 몇 가지뿐이라 백 줄이 안 된다. 의존성은 0 그대로다.
//
// 만드는 것: RSA-2048, sha256WithRSAEncryption, CN=<이름>, SAN(DNS:<이름>, IP:<ip>),
//            basicConstraints CA:TRUE — 제 자신을 신뢰 뿌리로 쓰기 위해서다.
//            NODE_EXTRA_CA_CERTS 에 이 인증서를 주면 그 프로세스가 이 서버를 믿는다.
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';

// ── DER 조각들 ──────────────────────────────────────────────────────────
function 길이(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n >>>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), 길이(body.length), body]);
const seq = (...안) => tlv(0x30, Buffer.concat(안));
const set = (...안) => tlv(0x31, Buffer.concat(안));
const 널 = Buffer.from([0x05, 0x00]);
const 참 = Buffer.from([0x01, 0x01, 0xff]);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const octet = (b) => tlv(0x04, b);
const bits = (b) => tlv(0x03, Buffer.concat([Buffer.from([0x00]), b]));   // 남는 비트 0

// INTEGER — 양수만 쓴다. 맨 앞 비트가 1이면 0x00 을 붙여 음수로 읽히지 않게 한다.
function 정수(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from([buf]);
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  b = b.subarray(i);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

// OBJECT IDENTIFIER — 앞 두 마디는 40*a+b, 나머지는 base-128 (이어짐 비트).
function oid(글) {
  const 마디 = 글.split('.').map(Number);
  const out = [40 * 마디[0] + 마디[1]];
  for (const n of 마디.slice(2)) {
    const 조각 = [];
    let v = n;
    do { 조각.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
    for (let i = 0; i < 조각.length - 1; i++) 조각[i] |= 0x80;
    out.push(...조각);
  }
  return tlv(0x06, Buffer.from(out));
}

// UTCTime (YYMMDDHHMMSSZ) — 2049년까지는 이 꼴이다. 그 뒤는 안 쓴다.
function 시각(d) {
  const p = (n) => String(n).padStart(2, '0');
  return tlv(0x17, Buffer.from(
    `${String(d.getUTCFullYear()).slice(-2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, 'ascii'));
}

const 이름 = (cn) => seq(set(seq(oid('2.5.4.3'), utf8(cn))));
const 확장 = (id, critical, der) => seq(oid(id), ...(critical ? [참] : []), octet(der));
const sha256RSA = seq(oid('1.2.840.113549.1.1.11'), 널);

/**
 * 자체 서명 인증서 한 벌.
 * @returns {{ key: string, cert: string }} PEM 둘. key 는 PKCS#8, cert 는 X.509.
 */
export function 증명서만들기({ 이름: cn = 'localhost', ip = '127.0.0.1' } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const 일련 = randomBytes(8);
  일련[0] &= 0x7f;   // 양수

  const 어제 = new Date(Date.now() - 24 * 3600 * 1000);
  const 먼뒤 = new Date(Date.UTC(2040, 0, 1));

  const san = seq(
    tlv(0x82, Buffer.from(cn, 'ascii')),                       // [2] dNSName
    tlv(0x87, Buffer.from(ip.split('.').map(Number))),          // [7] iPAddress (IPv4)
  );
  const 확장들 = tlv(0xa3, seq(
    확장('2.5.29.19', true, seq(참)),                            // basicConstraints CA:TRUE
    확장('2.5.29.17', false, san),                               // subjectAltName
  ));

  const tbs = seq(
    tlv(0xa0, 정수(2)),                                          // [0] version v3
    정수(일련),
    sha256RSA,
    이름(cn),                                                    // issuer = subject (자체 서명)
    seq(시각(어제), 시각(먼뒤)),
    이름(cn),
    spki,
    확장들,
  );
  const 서명 = sign('sha256', tbs, privateKey);                 // RSA PKCS#1 v1.5
  const cert = seq(tbs, sha256RSA, bits(서명));

  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: pem('CERTIFICATE', cert),
  };
}

function pem(제목, der) {
  const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${제목}-----\n${b64}\n-----END ${제목}-----\n`;
}
