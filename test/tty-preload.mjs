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
