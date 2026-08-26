/**
 * LSP 말틀 — Content-Length 로 감싼 JSON-RPC 를 만들고 푼다.
 *
 * ── 왜 직접 쓰나 ────────────────────────────────────────────────────────
 *
 * 이 프로그램은 의존성이 0개다. 사내에 미승인 SW 를 못 들이기 때문이고,
 * 그건 못 바꾼다. vscode-jsonrpc 를 받아 오면 그 규칙이 깨진다.
 *
 * 다행히 이 틀은 작다. 머리말 한 줄과 빈 줄, 그 다음이 JSON 이다.
 * 실제로 어려운 것은 **틀 자체가 아니라 경계**다. 아래 두 가지 때문에 —
 *
 *   1) Content-Length 는 글자 수가 아니라 **바이트 수**다. 한글이 든 파일
 *      이름 하나만 섞여도 두 값이 갈린다. 글자로 세면 그 순간부터 한 칸씩
 *      밀린 채로 읽는데, 그러면 바로 안 죽고 **몇 통 뒤에** 죽는다.
 *   2) 파이프는 통 단위로 안 온다. 머리말 한가운데서 끊기기도 하고, 세 통이
 *      한 덩어리로 붙어 오기도 한다. 그래서 받는 쪽은 통 하나가 다 찰 때까지
 *      들고 있다가, 찬 것만 내주고 나머지를 남겨야 한다.
 *
 * 그래서 이 파일은 순수 함수로만 두고 따로 시험한다. 프로세스를 안 띄우고도
 * 위 두 가지를 다 재 볼 수 있어야 하기 때문이다 — 언어 서버가 안 깔린
 * 자리(사내망이 대개 그렇다)에서도 이 부분은 그대로 시험이 돈다.
 */

/**
 * 보낼 통 하나를 만든다.
 * @returns {Buffer} 머리말까지 붙은 통. 그대로 stdin 에 쓰면 된다.
 */
export function 틀(obj) {
  const 몸 = Buffer.from(JSON.stringify(obj), 'utf8');
  // 길이는 바이트다. 여기서 몸.length 를 쓰는 것이 핵심 — 문자열의 .length 를
  // 쓰면 한글 한 자마다 두 바이트씩 모자라게 적히고, 받는 쪽이 밀린다.
  return Buffer.concat([Buffer.from(`Content-Length: ${몸.length}\r\n\r\n`, 'ascii'), 몸]);
}

/**
 * 받는 쪽. 오는 대로 넣으면 다 찬 통만 골라 내준다.
 *
 * 깨진 JSON 하나 때문에 대화 전체를 버리지 않는다. 그 통만 버리고 다음으로
 * 넘어간다 — 언어 서버는 제 나름의 확장 알림을 보내기도 하는데, 그중 하나를
 * 못 읽는다고 나머지 답까지 못 받게 되면 도구가 통째로 멎는다.
 */
export function 받개() {
  let 남은 = Buffer.alloc(0);
  const 버린것 = [];

  return {
    /** @returns {object[]} 이번에 다 찬 통들 */
    넣기(덩어리) {
      남은 = Buffer.concat([남은, Buffer.isBuffer(덩어리) ? 덩어리 : Buffer.from(덩어리)]);
      const 나온것 = [];

      for (;;) {
        const 끝 = 남은.indexOf('\r\n\r\n');
        if (끝 < 0) break;                      // 머리말이 아직 안 끝났다
        const 머리 = 남은.subarray(0, 끝).toString('ascii');
        const 잰것 = /content-length:\s*(\d+)/i.exec(머리);
        if (!잰것) {
          // 길이를 안 적어 보냈다. 어디까지가 한 통인지 알 길이 없으므로
          // 여기까지 버리고 다음 경계부터 다시 맞춘다.
          버린것.push('길이 없는 머리말');
          남은 = 남은.subarray(끝 + 4);
          continue;
        }
        const 길이 = Number(잰것[1]);
        const 몸시작 = 끝 + 4;
        if (남은.length < 몸시작 + 길이) break;  // 몸이 아직 다 안 왔다

        const 몸 = 남은.subarray(몸시작, 몸시작 + 길이).toString('utf8');
        남은 = 남은.subarray(몸시작 + 길이);
        try {
          나온것.push(JSON.parse(몸));
        } catch {
          // 이 통만 버린다. 경계는 길이로 이미 맞춰 놨으니 다음 통은 멀쩡하다.
          버린것.push(몸.slice(0, 80));
        }
      }
      return 나온것;
    },

    /** 아직 통이 안 찬 채로 들고 있는 바이트 수. 시험과 진단용. */
    get 들고있는것() { return 남은.length; },
    get 버린수() { return 버린것.length; },
  };
}
