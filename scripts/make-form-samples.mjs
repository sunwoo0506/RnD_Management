// 행정문서 템플릿 샘플 생성 — docs/템플릿/*.docx 의 {{항목}}을 예시 값으로 채운다.
//
//   node scripts/make-form-samples.mjs
//
// 결과: docs/samples/<문서명>_샘플.docx
//
// 원본 레이아웃(표·결재란·글꼴)을 그대로 두고 글자만 바꾸므로, 샘플을 보면 실제 출력이
// 어떻게 나올지 그대로 확인할 수 있다. 치환자가 XML에서 쪼개져 있지 않아 문자열 치환으로 안전하다.
//
// 값은 "하나의 과제에서 실제로 일어난 일"로 엮었다 — 문서마다 딴 회사·딴 금액이면
// 앱이 과제 데이터를 흘려 넣었을 때의 모습을 가늠할 수 없다.
//   과제: 스마트 물류 자동화 시스템 개발 / 테스트랩 / 계측장비 구매 → 검수 → 지출
//   출장: 부산 물류센터 현장 실증 / 회의: 2차 기술 점검 회의

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const 과제 = {
  project_name: '스마트 물류 자동화 시스템 개발',
  program_name: '창업성장기술개발사업(디딤돌) 도약',
  company_name: '주식회사 테스트랩',
  department: '기업부설연구소',
  writer_name: '박연구',
  created_date: '2026. 7. 24.',
};

// 문서마다 번호를 따로 받는다 — 실제 채번도 문서 종류별로 이뤄진다.
const 번호 = {
  검수: '테스트랩-2026-021', 공문: '테스트랩-2026-014', 구매: '테스트랩-2026-018',
  지출: '테스트랩-2026-022', 출장보고: '테스트랩-2026-020', 출장신청: '테스트랩-2026-019',
  품의: '테스트랩-2026-017', 회의: '테스트랩-2026-016',
};

// 공통 값 — 여러 문서에 같은 이름으로 들어가는 항목들
const 공통 = {
  ...과제,
  budget_category: '연구재료비',
  budget_subcategory: '시제품 제작비',
  allocated_budget: '21,000,000',
  prior_spent: '8,400,000',
  remaining_budget: '9,300,000',
  vendor_name: '한국계측기기(주)',
  payment_method: '계좌이체',
  remarks: '해당 없음',
  attachment_names: '견적서 1부, 거래명세서 1부',
  reviewer_name: '이팀장',
  approver_name: '김대표',
  drafter_name: '박연구',
};

const 값 = {
  '검수확인서_과제정보포함_템플릿': {
    ...공통, document_no: 번호.검수,
    inspection_date: '2026. 7. 23.', inspection_location: '본사 기업부설연구소',
    inspector_name: '박연구', inspector_position: '선임연구원',
    delivery_date: '2026. 7. 22.', order_no: 'PO-2026-0043', order_amount: '3,300,000',
    item_name1: '레이저 거리 측정기', item_spec1: 'LDM-500 / 측정범위 0.05~150m',
    ordered_qty1: '2', inspected_qty1: '2', inspection_result1: '적합', item_note1: '-',
    item_name2: '3축 진동 센서', item_spec2: 'VS-3A / ±16g',
    ordered_qty2: '4', inspected_qty2: '4', inspection_result2: '적합', item_note2: '-',
    item_name3: '데이터 로거', item_spec3: 'DL-8 / 8채널',
    ordered_qty3: '1', inspected_qty3: '1', inspection_result3: '조건부 적합', item_note3: '전원 어댑터 미포함',
    item_name4: '-', item_spec4: '-', ordered_qty4: '-', inspected_qty4: '-', inspection_result4: '-', item_note4: '-',
    inspection_summary: '발주 사양과 대조하여 수량 및 규격을 확인하였으며, 3개 품목 모두 정상 작동을 확인함.',
    corrective_actions: '데이터 로거 전원 어댑터는 공급업체가 2026. 7. 30.까지 추가 납품하기로 함.',
    attachment_names: '거래명세서 1부, 검수 사진 3매',
  },
  '공문_표준시행문_이미지참고_최종템플릿': {
    ...공통, document_number: 번호.공문, issue_date: '2026. 7. 24.',
    recipient: '중소기업기술정보진흥원장', reference: '사업비관리팀',
    subject: '「스마트 물류 자동화 시스템 개발」 사업비 비목 간 변경 승인 요청',
    business_name: 과제.program_name,
    background_and_purpose:
      '당사가 수행 중인 「스마트 물류 자동화 시스템 개발」(협약번호: S2026-1234) 과제와 관련하여, '
      + '연구 수행 과정에서 발생한 사정으로 사업비 비목 간 변경이 필요하여 승인을 요청드립니다.',
    request_details:
      '가. 변경 금액: 인건비 → 연구재료비  금 1,000,000원(금일백만원정)\n'
      + '나. 총사업비 변동 여부: 변동 없음\n'
      + '다. 변경 사유: 제어 알고리즘 검증을 내부 인력으로 수행하게 되어 인건비 소요가 감소한 반면, '
      + '시제품 성능 검증에 추가 계측 자재가 필요해져 연구재료비 소요가 증가하였음.\n'
      + '라. 변경 후 사용계획: 조정된 연구재료비는 시제품 성능 검증용 계측 자재 구입에 사용할 예정임.',
    due_date: '2026. 8. 7.',
    closing_sentence: '상기 변경사항에 대하여 검토 후 승인하여 주시기 바랍니다.',
    // 템플릿이 "1부."·"끝."을 이미 붙여두므로 값에는 서류 이름만 넣는다 (넣으면 "1부. 1부."가 된다)
    attachment_1: '사업비 변경 전·후 대비표',
    attachment_2: '변경 반영 사업계획서',
    signature_text: '주식회사 테스트랩 대표 김 대 표',
    receipt_information: '접수  2026. 7. 24.  제2026-0731호',
    postal_code: '06236', address: '서울특별시 강남구 테헤란로 123, 5층',
    website: 'www.testlab.co.kr', phone: '02-1234-5678', fax: '02-1234-5679',
    email: 'research@testlab.co.kr', disclosure_status: '부분공개(제9조제1항제7호)',
  },
  '구매요청서_과제예산포함_템플릿': {
    ...공통, document_no: 번호.구매,
    request_date: '2026. 7. 20.', request_department: '기업부설연구소', requester_name: '박연구',
    desired_purchase_date: '2026. 7. 22.',
    purchase_purpose: '시제품 성능 검증에 필요한 계측 자재를 확보하기 위함.',
    purchase_conditions: '납기 2일 이내, 부가세 포함가, 세금계산서 발행 가능 업체',
    request_total: '3,300,000',
    item_name1: '레이저 거리 측정기', item_spec1: 'LDM-500 / 0.05~150m', quantity1: '2', unit_price1: '850,000', item_amount1: '1,700,000', item_note1: '-',
    item_name2: '3축 진동 센서', item_spec2: 'VS-3A / ±16g', quantity2: '4', unit_price2: '180,000', item_amount2: '720,000', item_note2: '-',
    item_name3: '데이터 로거', item_spec3: 'DL-8 / 8채널', quantity3: '1', unit_price3: '580,000', item_amount3: '580,000', item_note3: '-',
    item_name4: '-', item_spec4: '-', quantity4: '-', unit_price4: '-', item_amount4: '-', item_note4: '-',
    request_reason: '기존 보유 계측기로는 고속 이송 구간의 진동 데이터를 확보할 수 없어 추가 구매가 필요함.',
    attachment_names: '견적서 3부(비교견적)',
  },
  '지출결의서_수정본_증빙삭제_지급정보통합': {
    ...공통, document_no: 번호.지출,
    expense_date: '2026. 7. 24.', payee_name: '한국계측기기(주)',
    total_amount: '3,300,000', expense_purpose: '시제품 성능 검증용 계측 자재 구입',
    account_title: '연구재료비',
    payment_details: '국민은행 123456-04-567890 / 예금주 한국계측기기(주)',
    item1: '레이저 거리 측정기', qty1: '2', unit1: 'EA', supply1: '1,545,455', vat1: '154,545', total1: '1,700,000',
    item2: '3축 진동 센서', qty2: '4', unit2: 'EA', supply2: '654,545', vat2: '65,455', total2: '720,000',
    item3: '데이터 로거', qty3: '1', unit3: 'EA', supply3: '527,273', vat3: '52,727', total3: '580,000',
    supply_total: '2,727,273', vat_total: '272,727',
    attachment_names: '세금계산서 1부, 거래명세서 1부, 검수확인서 1부',
  },
  '출장보고서_정산내역_과제정보포함_템플릿': {
    ...공통, document_no: 번호.출장보고,
    traveler_name: '박연구', traveler_position: '선임연구원',
    travel_period: '2026. 7. 15. ~ 2026. 7. 16. (1박 2일)',
    travel_location: '부산광역시 강서구', visited_organization: '부산신항 물류센터',
    transportation: 'KTX, 현지 택시', companions: '이팀장',
    travel_purpose: '실증 대상 물류센터의 이송 설비 현황 조사 및 실증 조건 협의',
    report_date1: '2026. 7. 15.', report_place1: '부산신항 물류센터 A동', report_detail1: '이송 설비 배치 및 운영 시간대 확인, 계측 지점 3개소 선정',
    report_date2: '2026. 7. 15.', report_place2: '물류센터 회의실', report_detail2: '실증 일정 및 안전관리 절차 협의 — 야간 시간대 실증으로 합의',
    report_date3: '2026. 7. 16.', report_place3: '부산신항 물류센터 B동', report_detail3: '진동 계측 예비 측정 수행, 데이터 수집 조건 확정',
    travel_results: '실증 대상 설비 3개소를 선정하고 야간 시간대 실증 일정에 합의함. 예비 측정으로 계측 조건을 확정하여 본 실증 준비를 마침.',
    follow_up_actions: '2026. 8. 5. 본 실증 착수 예정. 안전관리 계획서를 물류센터에 사전 제출하기로 함.',
    expense_type1: '교통비', expense_date1: '2026. 7. 15.', expense_detail1: 'KTX 서울-부산 왕복 2인', pay_method1: '법인카드', amount1: '212,000', note1: '-',
    expense_type2: '숙박비', expense_date2: '2026. 7. 15.', expense_detail2: '부산 강서구 호텔 1박 2실', pay_method2: '법인카드', amount2: '160,000', note2: '-',
    expense_type3: '식비', expense_date3: '2026. 7. 15.~16.', expense_detail3: '출장 중 식대 2인 4식', pay_method3: '법인카드', amount3: '96,000', note3: '-',
    trip_total: '468,000', advance: '500,000', additional: '0', refund: '32,000',
    attachment_names: '교통비 영수증 2매, 숙박비 영수증 1매, 현장 사진 5매',
  },
  '출장신청서_과제정보포함_템플릿': {
    ...공통, document_no: 번호.출장신청,
    traveler_name: '박연구', traveler_position: '선임연구원',
    travel_period: '2026. 7. 15. ~ 2026. 7. 16. (1박 2일)',
    travel_location: '부산광역시 강서구', visited_organization: '부산신항 물류센터',
    transportation: 'KTX, 현지 택시', companions: '이팀장',
    travel_purpose: '실증 대상 물류센터의 이송 설비 현황 조사 및 실증 조건 협의',
    schedule_date1: '2026. 7. 15.', schedule_time1: '14:00~16:00', schedule_place1: '부산신항 물류센터 A동', schedule_detail1: '이송 설비 현황 조사 및 계측 지점 선정',
    schedule_date2: '2026. 7. 15.', schedule_time2: '16:30~18:00', schedule_place2: '물류센터 회의실', schedule_detail2: '실증 일정·안전관리 절차 협의',
    schedule_date3: '2026. 7. 16.', schedule_time3: '09:00~12:00', schedule_place3: '부산신항 물류센터 B동', schedule_detail3: '진동 계측 예비 측정',
    transport: '212,000', lodging: '160,000', meal: '96,000', daily: '40,000', other: '0', est_total: '508,000',
    attachment_names: '방문 협조 공문 사본 1부',
  },
  '품의서_과제예산포함_템플릿': {
    ...공통, document_no: 번호.품의,
    request_date: '2026. 7. 20.', request_department: '기업부설연구소',
    request_title: '시제품 성능 검증용 계측 자재 구매의 건',
    request_purpose: '시제품 성능 검증에 필요한 계측 자재를 확보하여 실증 일정을 준수하고자 함.',
    planned_date: '2026. 7. 22.', request_amount: '3,300,000',
    request_details:
      '가. 구매품목: 레이저 거리 측정기 2대, 3축 진동 센서 4개, 데이터 로거 1대\n'
      + '나. 구매금액: 금 3,300,000원(금삼백삼십만원정, 부가세 포함)\n'
      + '다. 업체선정: 3개사 비교견적 결과 최저가 및 납기 조건 충족 업체 선정\n'
      + '라. 사용계획: 부산신항 물류센터 현장 실증(2026. 8. 5. 착수)에 사용',
    attachment_names: '비교견적서 3부, 구매요청서 1부',
  },
  '회의록_과제정보포함_템플릿': {
    ...공통, document_no: 번호.회의,
    meeting_title: '2차 기술 점검 회의', meeting_type: '정기',
    meeting_datetime: '2026. 7. 18. (금) 10:00~11:30',
    meeting_location: '본사 3층 회의실', host_department: '기업부설연구소', minutes_writer: '박연구',
    participants: '김대표(대표), 이팀장(연구소장), 박연구(선임연구원), 최개발(연구원)',
    meeting_agenda: '1. 시제품 성능 검증 계획 점검\n2. 계측 자재 구매 필요성 검토\n3. 현장 실증 일정 협의',
    discussion_details:
      '1. 시제품 성능 검증 계획\n'
      + '   - 제어 알고리즘 검증은 외주 없이 내부 인력으로 수행 가능한 것으로 확인됨.\n'
      + '   - 이에 따라 인건비 소요가 당초 계획 대비 감소할 것으로 예상됨.\n'
      + '2. 계측 자재 구매\n'
      + '   - 기존 보유 계측기로는 고속 이송 구간의 진동 데이터 확보가 어렵다는 의견이 제시됨.\n'
      + '   - 추가 계측 자재 구매가 필요하며, 소요 예산은 연구재료비에서 충당하기로 함.\n'
      + '3. 현장 실증 일정\n'
      + '   - 부산신항 물류센터와 협의 후 8월 첫째 주 착수를 목표로 함.',
    action_item1: '사업비 비목 간 변경(인건비 → 연구재료비) 신청', action_owner1: '박연구', action_due1: '2026. 7. 24.', action_status1: '진행 중',
    action_item2: '계측 자재 비교견적 확보 및 구매 품의', action_owner2: '최개발', action_due2: '2026. 7. 20.', action_status2: '완료',
    action_item3: '부산신항 물류센터 방문 일정 확정', action_owner3: '이팀장', action_due3: '2026. 7. 16.', action_status3: '완료',
    attachment_names: '회의 자료 1부',
  },
};

const dir = 'docs/템플릿';
const outDir = 'docs/samples';
mkdirSync(outDir, { recursive: true });

let 남은치환자 = 0;
for (const file of readdirSync(dir).filter((name) => name.endsWith('.docx'))) {
  const key = file.replace(/\.docx$/, '');
  const values = 값[key];
  if (!values) { console.log(`건너뜀(값 없음): ${file}`); continue; }

  const zip = unzipSync(new Uint8Array(readFileSync(`${dir}/${file}`)));
  let xml = strFromU8(zip['word/document.xml']);
  xml = xml.replace(/\{\{([a-z0-9_]+)\}\}/g, (whole, name) => {
    const value = values[name];
    if (value === undefined) { 남은치환자 += 1; console.log(`  값 없음: ${key} → ${name}`); return whole; }
    // 줄바꿈은 Word 문단 내 줄바꿈 태그로 바꾼다 (그냥 \n을 넣으면 한 줄로 붙는다)
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  });
  zip['word/document.xml'] = strToU8(xml);

  const outName = `${key.replace(/_템플릿$/, '').replace(/_수정본_증빙삭제_지급정보통합$/, '').replace(/_이미지참고_최종템플릿$/, '')}_샘플.docx`;
  writeFileSync(`${outDir}/${outName}`, Buffer.from(zipSync(zip)));
  console.log(`만듦: ${outDir}/${outName}`);
}
console.log(남은치환자 === 0 ? '\n모든 치환자를 채웠습니다.' : `\n채우지 못한 치환자 ${남은치환자}개 — 위 목록을 확인하세요.`);
