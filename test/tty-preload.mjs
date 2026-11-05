// 터미널인 척한다.
//
// 입력 상자는 stdout·stdin 이 둘 다 터미널일 때만 켜진다. 그런데 검사는
// 자식 프로세스를 파이프로 띄워서 화면을 받아 읽는다 — 그래서 상자 코드는
// 검사에서 **한 번도 안 밟힌다.**
//
// 실제로 그 틈으로 결함이 하나 나갔다. 전체화면이던 시절, 슬래시 명령이
// 전부 화면에서 지워졌는데 검사 1,745개가 전부 초록이었다. 파이프로 도는
// 검사는 줄 화면만 보고 있었기 때문이다.
//
// 그래서 여기서 isTTY 만 거짓말한다. stdout 은 여전히 파이프라서 검사가
// 제어문자까지 그대로 받아 읽을 수 있다 — 사람 눈으로만 보이는 것이 없어진다.
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 30, configurable: true });
// readline 이 터미널이라 믿고 부른다. 파이프에는 없는 함수라 없으면 터진다.
process.stdin.setRawMode = () => process.stdin;
/*
 * 미리 읽기(2.2.0 · agent/warm.js)는 끄고 띄운다. 터미널인 척하면 그것도 켜지는데, 이 앞선불러오기를
 * 쓰는 검사들은 가짜 서버가 **받은 요청을 센다** — 사람이 안 보낸 빈 말이 끼면 「한 번만 갔다」 가
 * 깨진다. 미리 읽기는 test/warm.test.js 와 test/pty.test.js 가 따로 켜서 잰다. 사람이 이미 정했으면 그대로.
 */
process.env.DEEL_WARMUP ??= '0';
