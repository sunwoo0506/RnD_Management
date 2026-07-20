export interface ReceiptFields {
  date: string | null;
  vendor: string | null;
  supplyAmount: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
}

// OCR 숫자 오인(O→0, l·I→1)과 구분 기호를 정리하고, 상식 범위(1원~100억)를 벗어난 값은 버린다.
const cleanAmount = (raw: string): number | null => {
  const digits = raw.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return value >= 1 && value < 10_000_000_000 ? value : null;
};

// 키워드와 같은 줄에서 먼저 숫자를 찾는다 — 영수증은 라벨과 값이 넓은 공백으로 벌어진 경우가 많다.
// 같은 줄에 숫자가 없으면(값이 다음 줄로 밀린 레이아웃) 키워드 뒤 80자까지 넓혀 본다.
const amountNear = (text: string, keyword: RegExp): number | null => {
  const match = keyword.exec(text);
  if (!match) return null;
  const start = match.index + match[0].length;
  const newline = text.indexOf('\n', start);
  const sameLine = text.slice(start, newline === -1 ? text.length : newline);
  const searchIn = /\d/.test(sameLine) ? sameLine : text.slice(start, start + 80);
  const num = /[\dOolI][\dOolI,.]*/.exec(searchIn);
  return num ? cleanAmount(num[0]) : null;
};

const validDate = (year: number, month: number, day: number): string | null =>
  month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : null;

const parseDate = (text: string): string | null => {
  // 구분자 있는 날짜(2026-06-22, 2026.6.22, 2026년 6월 22일)를 먼저 찾고,
  // 실패하면 OCR이 구분자를 잃은 8자리(YYYYMMDD)를 찾는다. 월·일 범위가 어긋난 후보는 건너뛴다.
  const separated = /(20\d{2})[.\-–—/년\s]{1,3}(\d{1,2})[.\-–—/월\s]{1,3}(\d{1,2})/g;
  for (let m = separated.exec(text); m; m = separated.exec(text)) {
    const found = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (found) return found;
  }
  const compact = /(20\d{2})(\d{2})(\d{2})/g;
  for (let m = compact.exec(text); m; m = compact.exec(text)) {
    const found = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (found) return found;
  }
  return null;
};

const parseVendor = (text: string): string | null => {
  const keyword = /(?:상\s*호명?|가맹점명?|매장명|상점명)\s*[:：]?\s*([^\n]{1,30})/.exec(text);
  if (keyword && keyword[1].trim()) return keyword[1].trim();
  // 키워드가 없으면 문서 맨 위의 상호 표기(첫 줄)를 사용한다.
  const firstLine = text.split('\n').map((line) => line.trim()).find((line) => line.length >= 2 && !/영수증|receipt/i.test(line));
  return firstLine ?? null;
};

export const parseReceipt = (text: string): ReceiptFields => ({
  date: parseDate(text),
  vendor: parseVendor(text),
  supplyAmount: amountNear(text, /공\s*급\s*가\s*액|과세물품가액|과세금액/),
  vatAmount: amountNear(text, /부\s*가\s*세액?|부가가치세|V\.?A\.?T/i),
  totalAmount: amountNear(text, /합\s*계|총\s*액|결제금액|받을금액|승인금액/),
});

// 저해상도 영수증은 인식률이 급락하므로 폭 1600px을 목표로 최대 3배까지 확대한다.
const upscale = async (file: File): Promise<Blob | File> => {
  if (typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(3, 1600 / bitmap.width);
    if (scale <= 1.01) { bitmap.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ?? file;
  } catch {
    return file;
  }
};

// tesseract.js는 무겁고 언어 데이터(kor)를 CDN에서 내려받으므로 호출 시점에만 로드한다.
export const recognizeReceipt = async (file: File): Promise<string> => {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['kor', 'eng']);
  try {
    const image = await upscale(file);
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
};
