// 총괄 화면의 금액 표기 — 천원 단위 숫자에, 단위 글자는 작고 진한 회색으로 낮춰 단다.
// 숫자가 주인공이고 단위는 배경이라, 같은 크기로 쓰면 칸이 단위 글자에 잡아먹힌다.
export default function ThousandWon({ value }: { value: number }) {
  return <>{Math.round(value / 1000).toLocaleString('ko-KR')}<em className="money-unit">천원</em></>;
}
