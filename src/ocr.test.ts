import { describe, expect, it } from 'vitest';
import { parseReceipt } from './ocr';

const receipt = `(주)회의공간
사업자번호: 123-45-67890
2026-07-15 14:22
품목: 회의실 대여
공급가액        72,727
부가세           7,273
합계            80,000
카드 승인번호 98765432`;

describe('영수증 OCR 파싱', () => {
  it('표준 영수증에서 일자·거래처·공급가액·부가세액·합계를 추출한다', () => {
    const fields = parseReceipt(receipt);
    expect(fields.date).toBe('2026-07-15');
    expect(fields.vendor).toBe('(주)회의공간');
    expect(fields.supplyAmount).toBe(72_727);
    expect(fields.vatAmount).toBe(7_273);
    expect(fields.totalAmount).toBe(80_000);
  });

  it('상호 키워드와 한글 날짜 형식을 인식한다', () => {
    const fields = parseReceipt('영수증\n상호: 테스트마트\n2026년 7월 3일\n공급가액 10,000\n부가세 1,000');
    expect(fields.vendor).toBe('테스트마트');
    expect(fields.date).toBe('2026-07-03');
  });

  it('OCR 숫자 오인(O→0, l→1)을 보정한다', () => {
    const fields = parseReceipt('공급가액 7O,OOO\n부가세 l,000');
    expect(fields.supplyAmount).toBe(70_000);
    expect(fields.vatAmount).toBe(1_000);
  });

  it('없는 항목은 null을 반환하고 엉뚱한 숫자를 잡지 않는다', () => {
    const fields = parseReceipt('아무 내용 없는 텍스트');
    expect(fields.date).toBeNull();
    expect(fields.supplyAmount).toBeNull();
    expect(fields.vatAmount).toBeNull();
    expect(fields.totalAmount).toBeNull();
  });

  it('상식 범위(100억 이상)를 벗어난 금액은 버린다', () => {
    expect(parseReceipt('공급가액 99,999,999,999,999').supplyAmount).toBeNull();
  });

  // 실제 카드영수증을 tesseract로 읽은 원문 — 라벨 깨짐, 구분자 없는 날짜, 라벨-값 사이 넓은 공백이 섞여 있다.
  it('실제 카드영수증 OCR 원문을 파싱한다', () => {
    const raw = `카드사/승인번호                           신한 /48049906.
ana              20250622 084725
판매자상호                                주식회사 보보
사업자등록번호                             206-86-75156.
공급가액                                                               334,464
부가세액                                                                 33446
승인금액                   36710`;
    const fields = parseReceipt(raw);
    expect(fields.date).toBe('2025-06-22');
    expect(fields.vendor).toBe('주식회사 보보');
    expect(fields.supplyAmount).toBe(334_464);
    expect(fields.vatAmount).toBe(33_446);
    expect(fields.totalAmount).toBe(36_710);
  });
});
