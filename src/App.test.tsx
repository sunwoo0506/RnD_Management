import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getPack, makeDraftBudgets } from './rules';
import type { Project } from './types';

const fixture = (packId = 'legacy-rnd'): Project => ({
  id: 'p1', name: '테스트 과제', totalBudget: 100_000_000, startDate: '2026-07-01', endDate: '2027-06-30',
  settlementDeadline: '2027-07-30', agency: '중소벤처기업부', companyName: '테스트랩', packId,
  members: [{ id: 'm1', name: '김대표', email: 'owner@example.com', role: '대표' }],
  participants: [{ id: 'u1', name: '박연구', projectRate: 50, externalRate: 30 }],
  budgets: makeDraftBudgets(getPack(packId), 100_000_000), expenses: [], changes: [], emailLogs: [], createdAt: new Date().toISOString(),
});

// 변경 신청은 협약서·사업계획서가 등록돼 있어야 할 수 있다 — 그 전제를 갖춘 과제.
const withAgreement = (packId = 'legacy-rnd'): Project => ({
  ...fixture(packId),
  documents: (['AGREEMENT', 'PLAN'] as const).map((type) => ({
    id: `doc-${type}`, kind: 'upload' as const, fileId: `f-${type}`, fileName: `${type}.pdf`,
    documentType: type, title: type, applicationType: 'AGREEMENT' as const,
    isConfirmed: true, createdAt: '2026-07-01T00:00:00.000Z',
  })),
});

describe('과제온 핵심 사용자 흐름', () => {
  beforeEach(() => localStorage.clear());

  it('위저드로 예비창업패키지 과제를 등록하면 비목 9종 초안과 비율 제한 없음 안내를 보여준다', async () => {
    const user = userEvent.setup();
    render(<App />);
    // 1단계: 기본 정보
    await user.type(screen.getByLabelText('과제명'), '스마트 물류 창업');
    await user.type(screen.getByLabelText('기업명'), '테스트랩');
    await user.type(screen.getByLabelText(/지원비율/), '100');
    await user.type(screen.getByLabelText('종료일'), '2027-06-30');
    // 정산 마감일은 입력받지 않고 종료일에서 셈한다 (종료 후 1개월)
    expect(screen.queryByLabelText('정산 마감일')).toBeNull();
    expect(screen.getByText('2027-07-30')).toBeInTheDocument();
    await user.type(screen.getByLabelText('대표자 이름'), '김대표');
    await user.type(screen.getByLabelText('알림 이메일'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /다음 — 적용 규정 정하기/ }));
    // 2단계: 규정 선택
    await user.click(screen.getByRole('radio', { name: /예비창업패키지/ }));
    await user.click(screen.getByRole('button', { name: /예산 초안 만들기/ }));
    expect(document.querySelector('.portfolio-panel')).toHaveTextContent('100,000천원');   // 총괄은 천원 단위
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    expect(screen.getByText('편성 합계 100,000,000원')).toBeInTheDocument();
    expect(screen.getByText('이 사업은 비목 간 비율 제한이 없습니다')).toBeInTheDocument();
    expect(screen.getByLabelText('재료비 편성 금액')).toBeInTheDocument();
    expect(screen.getByLabelText('광고선전비 편성 금액')).toBeInTheDocument();
  });

  it('R&D(레거시) 과제는 인건비 60% 편성 시 상한 초과를 경고한다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    const personnel = screen.getByLabelText('인건비 편성 금액');
    await user.clear(personnel);
    await user.type(personnel, '60000000');
    const row = personnel.closest('.table-row')!;
    expect(within(row as HTMLElement).getByText('상한 초과')).toBeInTheDocument();
  });

  it('막대바를 끝까지 끌어도 상한이 있는 비목은 상한까지만 편성된다', async () => {
    // 간접비 상한 = 직접비(총사업비 − 간접비 − 위탁)의 10%. 기준이 자기 편성액에 따라 줄어들어서,
    // 화면에 보이는 상한까지 그대로 끌면 그 순간 상한 초과가 된다.
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('nrd2026-forprofit')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    const indirect = screen.getByLabelText('간접비 편성 금액');
    await user.clear(indirect); // 잔액 1,000만 원 확보
    fireEvent.change(screen.getByLabelText('간접비 편성 금액 조절'), { target: { value: '100000000' } });
    // 잔액(1,000만)이 아니라 상한에서 멈춘다 — 수정직접비(1억 − 간접비 − 위탁 1천만 − 국제공동 1천만)의 10%
    expect(indirect).toHaveValue('7,272,727');
    const row = indirect.closest('.table-row')!;
    expect(within(row as HTMLElement).getByText('정상')).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText('상한 초과')).toBeNull();
  });

  it('연구시설·장비비의 구입가 20% 상한은 현물로 계상할 때만 걸린다고 안내한다', async () => {
    // 민간부담금 3,000만 원(현금 50%) — 현물 칸이 있는 과제
    localStorage.setItem('gwajeon.project.v1', JSON.stringify({ ...fixture('nrd2026-forprofit'), subsidyAmount: 70_000_000, matchingCashRate: 50 }));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    const row = screen.getByLabelText('연구시설·장비비 편성 금액').closest('.table-row')! as HTMLElement;
    expect(within(row).getByText(/현물이 0원이면 해당하지 않습니다/)).toBeInTheDocument();
    // 현물을 잡으면 그 금액을 구입가 기준과 직접 대조하라는 안내로 바뀐다
    await user.type(within(row).getByLabelText('연구시설·장비비 현물 계상액'), '3000000');
    expect(within(row).getByText(/현물 3,000,000원이 이 상한 안인지/)).toBeInTheDocument();
  });

  it('세목 나누기에서 계상 가능 세목을 골라 추가한다 — 공고에 없는 세목은 상위 규정에서 온다', async () => {
    // 디딤돌 공고의 연구활동비 세목은 2개뿐이고, 나머지는 국가연구개발사업 연구개발비 사용 기준을 따른다
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('didimdol2026')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    const row = screen.getByLabelText('연구활동비 편성 금액').closest('.table-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: '+ 세목 나누기' }));
    const group = row.parentElement as HTMLElement;
    expect(within(group).getByRole('button', { name: '외부 전문기술 활용비' })).toBeEnabled(); // 공고 기준
    expect(within(group).getByText(/국가연구개발사업 연구개발비 사용 기준/)).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: '회의비' })); // 상위 규정 기준
    expect(within(group).getByDisplayValue('회의비')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: '회의비' })).toBeDisabled(); // 이미 넣은 세목은 다시 못 고른다
  });

  it('공고가 주의·절차를 안 적은 비목은 상위 규정 것을 이어받아 보여준다', async () => {
    // 디딤돌 공고에는 연구재료비의 approvals·evidenceRules가 아예 없어서 주의·절차 블록이 통째로 비어 있었다
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('didimdol2026')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    await user.click(screen.getByRole('button', { name: '연구재료비 기준 보기' }));
    const panel = within(screen.getByRole('dialog', { name: '연구재료비 기준' }));
    const inherited = panel.getByRole('heading', { name: /국가연구개발사업 연구개발비 사용 기준.*주의 · 절차/ });
    // 어디서 온 기준인지 그 블록 안에서 밝힌다 (인정 항목 블록에도 같은 문구가 있어 블록 안에서 찾는다)
    expect(within(inherited.parentElement!).getByText(/따로 정하지 않은 부분은 이 기준을 따릅니다/)).toBeInTheDocument();
  });

  it('공고가 직접 적은 주의·절차는 상위 규정에서 다시 넣지 않는다', async () => {
    // 디딤돌 연구활동비는 자기 approvals 1건·evidenceRules 1건을 갖고 있다
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('didimdol2026')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    await user.click(screen.getByRole('button', { name: '연구활동비 기준 보기' }));
    const panel = within(screen.getByRole('dialog', { name: '연구활동비 기준' }));
    // 이 사업 것과 상위 규정 것이 각각 제 블록에 나뉘어 나온다
    expect(panel.getByRole('heading', { name: /^주의 · 절차/ })).toBeInTheDocument();
    expect(panel.getByRole('heading', { name: /국가연구개발사업 연구개발비 사용 기준.*주의 · 절차/ })).toBeInTheDocument();
  });

  it('비목 칸은 이름만 두고, 필수 계상은 비목 아래에 강조해 세운다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('didimdol2026')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    // 용도 설명은 편성표에서 빠지고, 마우스를 올렸을 때 뜨는 카드와 기준 버튼 툴팁으로 옮겨졌다
    const row = screen.getByLabelText('연구활동비 편성 금액').closest('.table-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: '연구활동비 기준 보기' }))
      .toHaveAttribute('title', expect.stringContaining('출장비, 외부 전문기술 활용비'));
    // 빠뜨리면 협약이 해약될 수 있는 필수 계상은 비목 바로 아래에 나온다
    expect(screen.getByText(/업무지원기관을 통한 사업화 지원 비용 200만원/)).toBeInTheDocument();
    expect(screen.getByText(/협약이 해약될 수 있습니다/)).toBeInTheDocument();
    // 같은 200만원 필수 계상이 공고·지침에 두 번 실려 있어도 한 번만 보여준다
    expect(screen.queryByText(/특화 프로그램 수행을 위해/)).toBeNull();
  });

  it('편성 확정 시 0원 비목이 집행 화면 비목 선택에서 사라진다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    const meeting = screen.getByLabelText('회의비 편성 금액');
    await user.clear(meeting);
    await user.type(meeting, '0');
    await user.click(screen.getByRole('button', { name: /편성 확정/ }));
    expect(screen.queryByLabelText('회의비 편성 금액')).toBeNull();
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    const select = screen.getByLabelText('비목');
    expect(within(select).queryByRole('option', { name: '회의비' })).toBeNull();
    expect(within(select).getByRole('option', { name: '인건비' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('회의비 8만 원 등록 시 잔액을 차감하고 증빙 목록을 만든다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'meeting');
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    expect(screen.getByText('정기 회의')).toBeInTheDocument();
    // 이 팩은 자기 증빙이 없어 상위 규정(2순위)을 따른다 — 앱 기본 예시(3순위)는 쓰지 않는다.
    // 규정 증빙은 조건이 갈려 골라 담는 것이라, 아무것도 안 고르면 항상 들어가는 두 건만 남는다.
    // 규정이 요구하는 증빙을 서류 단위로 쪼개 모두 담는다 (지출결의서 + 회의비 조건별 증빙 4건)
    expect(screen.getByRole('button', { name: /0\/5 증빙/ })).toBeInTheDocument();
    expect(screen.getAllByText('지출결의서').length).toBeGreaterThan(0);
  });

  it('집행 화면이 규정DB 증빙을 근거와 함께 보여주고, 고른 것을 체크리스트에 넣는다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('nrd2026-forprofit')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_ACTIVITY');
    // 규정 증빙은 조건이 갈리므로(10만원 초과/이하) 자동으로 넣지 않고 근거와 함께 보여준다
    expect(screen.getByText(/10만원 초과 회의비 기본 증빙/)).toBeInTheDocument();
    expect(screen.getAllByText(/제25조제5항 단서/).length).toBeGreaterThan(0);
    // 인정 항목별 증빙도 여기서 볼 수 있다 (예전에는 팩에 실려 있어도 화면에 없었다)
    // 근거 조문은 유의사항과 같은 방식으로 토글에 담긴다
    expect(screen.getAllByText(/근거 조문 보기/).length).toBeGreaterThan(0);
    expect(screen.getByText(/연구활동비 기준/)).toBeInTheDocument();
    // 규정이 요구하는 증빙은 모두 켠 채로 시작하고, 해당 없는 조건만 끈다
    expect(screen.getByRole('checkbox', { name: '국외출장계획서' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: '간소화 회의 기록' }));   // 해당 없음 → 끈다
    await user.type(screen.getByLabelText(/공급가액/), '300000');
    await user.type(screen.getByLabelText('용도'), '국외 학회 출장');
    await user.type(screen.getByLabelText('거래처'), '항공사');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    expect(screen.getByRole('button', { name: /0\/8 증빙/ })).toBeInTheDocument();
    // 등록 뒤 체크리스트는 접혀 있다 — 펼쳐야 항목이 보인다
    await user.click(screen.getByRole('button', { name: /0\/8 증빙 펼치기/ }));
    expect(screen.getByText('국외출장계획서')).toBeInTheDocument();
  });

  it('공급가액·부가세액 입력 시 집행금액은 부가세를 제외한 공급가액으로 잡힌다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '100000');
    await user.type(screen.getByLabelText(/부가세액/), '10000');
    expect(screen.getByLabelText(/합계 금액/)).toHaveValue('110,000');
    await user.type(screen.getByLabelText('용도'), '재료 구매');
    await user.type(screen.getByLabelText('거래처'), '자재상사');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    // 대시보드에도 같은 금액이 뜨므로 집행 내역 카드 안에서 확인한다
    const card = within(screen.getAllByRole('article')[0]);
    expect(card.getByText('100,000원')).toBeInTheDocument();
    expect(card.getByText(/부가세 10,000원 별도/)).toBeInTheDocument();
  });

  it('집행건을 수정하면 금액과 용도가 갱신된다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    await user.click(screen.getByRole('button', { name: '정기 회의 수정' }));
    // 등록 폼으로 올라가지 않고 카드 안에서 바로 고친다
    const card0 = within(screen.getAllByRole('article')[0]);
    expect(card0.getByText(/비목·세목의 변경은 여기서 바꿀 수 없어요/)).toBeInTheDocument();
    const amount = card0.getByLabelText(/공급가액/);
    await user.clear(amount); await user.type(amount, '90000');
    await user.click(card0.getByRole('button', { name: '수정 저장' }));
    const card = within(screen.getAllByRole('article')[0]);
    expect(card.getByText('90,000원')).toBeInTheDocument();
    expect(card.queryByText('80,000원')).toBeNull();
  });

  it('집행건을 삭제하면 목록에서 사라진다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    await user.click(screen.getByRole('button', { name: '정기 회의 삭제' }));
    expect(await screen.findByText('아직 등록된 집행이 없어요')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('과제 설정에서 과제명과 지원금을 수정한다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '과제 설정' }));
    const name = screen.getByLabelText('과제명');
    await user.clear(name); await user.type(name, '차세대 배터리 개발');
    const total = screen.getByLabelText('지원금(정부지원금)');
    await user.clear(total); await user.type(total, '200000000');
    await user.click(screen.getByRole('button', { name: '과제 정보 저장' }));
    expect(screen.getByText('저장됐어요')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '차세대 배터리 개발' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '한눈에 보기' }));
    expect(document.querySelector('.portfolio-panel')).toHaveTextContent('200,000천원');   // 총괄은 천원 단위
  });

  it('과제를 삭제해도 다른 과제가 남아 있으면 한눈에 보기로 돌아간다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const a = { ...fixture('nrd2026-forprofit'), id: 'pa', name: '지울과제' };
    const b = { ...fixture('prestartup2026'), id: 'pb', name: '남은과제' };
    localStorage.setItem('gwajeon.projects.v1', JSON.stringify([a, b]));
    localStorage.setItem('gwajeon.active-project', 'pa');
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '과제 설정' }));
    await user.click(screen.getByRole('button', { name: '과제 삭제' }));   // 과제 설정 화면의 삭제
    // 등록 화면이 아니라 총괄 대시보드로 — 남은 과제가 목록에 있다
    expect(document.querySelector('.portfolio-table')).not.toBeNull();
    expect(document.querySelector('.portfolio-table')).toHaveTextContent('남은과제');
    expect(document.querySelector('.portfolio-table')).not.toHaveTextContent('지울과제');
    vi.restoreAllMocks();
  });

  it('집행 내역 초기화는 집행만 비우고 예산 편성은 유지한다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    await user.click(screen.getByRole('button', { name: '과제 설정' }));
    await user.click(screen.getByRole('button', { name: '집행 내역 초기화' }));
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    expect(await screen.findByText('아직 등록된 집행이 없어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    expect(screen.getByText('편성 합계 100,000,000원')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('참여율 합산 110%이면 예산 편성 화면에서 빨간 경고와 조정 안내를 표시한다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '예산 편성' }));
    const external = screen.getByLabelText('박연구 타 과제 참여율');
    await user.clear(external); await user.type(external, '60');
    expect(screen.getByText(/참여율 합산이 100%를 초과했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/100% 이하로 조정해주세요/)).toBeInTheDocument();
  });

  it('협약 문서를 안 올려도 변경을 신청할 수 있다 — 보관은 선택이다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    expect(screen.getByText(/등록하지 않아도 변경 신청은 가능합니다/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1000000' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /변경 신청하기/ }));
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.changes).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('변경을 신청해도 예산은 그대로고, 승인해야 반영된다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(withAgreement()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    const before: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1000000' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /변경 신청하기/ }));

    // 신청 상태 — 예산은 아직 그대로다
    const requested: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(requested.changes).toHaveLength(1);
    expect(requested.changes[0].status).toBe('submitted');
    expect(requested.budgets).toEqual(before.budgets);
    expect(screen.getByRole('heading', { name: /진행 중인 변경 1건/ })).toBeInTheDocument();

    // 승인하면 그때 예산이 움직인다
    vi.spyOn(window, 'prompt').mockReturnValue('');
    await user.click(screen.getByRole('button', { name: /승인 — 예산 반영/ }));
    const approved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(approved.changes[0].status).toBe('approved');
    expect(approved.budgets).not.toEqual(before.budgets);
    expect(approved.budgetConfirmed).toBe(true);   // 변경관리 승인을 마친 값은 집행에 바로 쓴다
    expect(screen.getByRole('button', { name: /비교표 Word/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /공문 Word/ }).length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it('반려하면 예산은 그대로 두고 사유를 이력에 남긴다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(withAgreement()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    const before: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1000000' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /변경 신청하기/ }));
    vi.spyOn(window, 'prompt').mockReturnValue('사업계획서 미비');
    await user.click(screen.getByRole('button', { name: '반려됨' }));
    const rejected: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(rejected.changes[0].status).toBe('rejected');
    expect(rejected.changes[0].decisionNote).toBe('사업계획서 미비');
    expect(rejected.budgets).toEqual(before.budgets);
    expect(screen.getByText(/사업계획서 미비/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('변경을 두 번 신청·승인하면 이력이 누적된다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(withAgreement()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('');
    for (const value of ['1000000', '500000']) {
      fireEvent.change(screen.getByPlaceholderText('0'), { target: { value } });
      await user.click(screen.getByRole('button', { name: /변경 신청하기/ }));
      await user.click(screen.getAllByRole('button', { name: /승인 — 예산 반영/ })[0]);
    }
    expect(screen.getByRole('heading', { name: /변경 이력 2건/ })).toBeInTheDocument();
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.changes.map((change) => change.amount)).toEqual([500_000, 1_000_000]);
    vi.restoreAllMocks();
  });

  it('받는 비목이 변경 후 허용 상한을 초과하면 신청을 차단한다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(withAgreement('nrd2026-forprofit')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    await user.selectOptions(screen.getByLabelText(/보내는 비목/), 'DIRECT_LABOR');
    await user.selectOptions(screen.getByLabelText('받는 비목'), 'INDIRECT');
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '30000000' } });
    expect(screen.getByText(/신청할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /변경 신청하기/ })).toBeDisabled();
  });
});

describe('R&D 총괄 대시보드 (한눈에 보기)', () => {
  beforeEach(() => localStorage.clear());

  const twoProjects = () => {
    const a = { ...fixture('nrd2026-forprofit'), id: 'pa', name: '과제A', agency: '중소벤처기업부', summary: '온디바이스 AI 경량화 모델 개발', totalBudget: 200_000_000, subsidyAmount: 150_000_000 };
    const b = { ...fixture('prestartup2026'), id: 'pb', name: '과제B', agency: '산업통상자원부', totalBudget: 100_000_000 };
    localStorage.setItem('gwajeon.projects.v1', JSON.stringify([a, b]));
    localStorage.setItem('gwajeon.active-project', 'pa');
  };

  it('과제 전체의 합계·부처별 수·목록을 보여주고, 행을 누르면 그 과제로 전환된다', async () => {
    twoProjects();
    const user = userEvent.setup(); render(<App />);
    // 합계: 총사업비 3억 · 지원금 2.5억 (과제B는 지원금 미입력 = 전액 지원)
    // ② 재원 표에도 같은 합계가 나오므로 ① 총괄 패널 안에서만 찾는다
    const portfolio = document.querySelector('.portfolio-panel')!;
    expect(portfolio).toHaveTextContent('300,000천원');   // 총괄 화면 금액은 천원 단위
    expect(portfolio).toHaveTextContent('250,000천원');
    // 간략요약과 민간부담 열
    expect(screen.getByText('온디바이스 AI 경량화 모델 개발')).toBeInTheDocument();
    expect(screen.getByText(/요약 미입력/)).toBeInTheDocument();   // 과제B는 아직 요약이 없다
    // 행 클릭 → 그 과제의 화면(예산 편성)으로 이동한다. 대시보드는 과제와 무관한 메인 페이지다.
    // 편성 그래프의 "과제B 세목 보기" 버튼과 겹치지 않게 목록 행에서 찾는다
    const rowB = [...document.querySelectorAll('.portfolio-table .portfolio-row')].find((row) => row.textContent?.includes('과제B')) as HTMLElement;
    await user.click(rowB);
    expect(screen.getByRole('heading', { name: '집행 · 증빙 관리' })).toBeInTheDocument();   // 과제B의 집행·증빙 화면
    expect(document.querySelector('.topbar h1')).toHaveTextContent('과제B');                 // 상단도 그 과제로
    expect(document.querySelector('.portfolio-table')).toBeNull();                           // 대시보드를 떠났다
  });

  it('증빙은 파일을 올리지 않고 체크로 준비 여부만 표시한다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    await user.click(screen.getByRole('button', { name: /증빙 .*펼치기/ }));
    const check = screen.getByLabelText('품의서 준비 완료');
    expect(check).not.toBeChecked();
    await user.click(check);
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses[0].evidence.find((item) => item.label === '품의서')?.completed).toBe(true);
  });

  it('등록한 뒤에도 증빙 항목을 더 넣고 뺄 수 있다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    await user.click(screen.getByRole('button', { name: /증빙 .*펼치기/ }));
    await user.type(screen.getByLabelText('증빙 항목 추가'), '4대보험 완납증명서');
    await user.click(screen.getByRole('button', { name: '항목 추가' }));
    let saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses[0].evidence.map((item) => item.label)).toContain('4대보험 완납증명서');
    await user.click(screen.getByLabelText('4대보험 완납증명서 목록에서 빼기'));
    saved = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses[0].evidence.map((item) => item.label)).not.toContain('4대보험 완납증명서');
  });

  it('집행건을 복사하면 카드 안에서 값을 고쳐 새로 등록한다 — 증빙도 함께 온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '월 임차료');
    await user.type(screen.getByLabelText('거래처'), '임대인');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    await user.click(screen.getByLabelText('월 임차료 복사'));
    // 등록 폼으로 올라가지 않고 카드 안에서 처리한다
    const card = within(screen.getAllByRole('article')[0]);
    expect(card.getByText(/증빙 .*건도 함께 복사됩니다/)).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: '복사해서 등록' }));
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses).toHaveLength(2);
    expect(saved.expenses.map((expense) => expense.purpose)).toEqual(['월 임차료', '월 임차료']);
    // 증빙 목록도 그대로 따라온다 — 준비 여부는 새로 챙겨야 하므로 체크는 풀린 채로
    const [copy, origin] = saved.expenses;
    expect(copy.evidence.map((item) => item.label)).toEqual(origin.evidence.map((item) => item.label));
    expect(copy.evidence.every((item) => !item.completed)).toBe(true);
    expect(copy.id).not.toBe(origin.id);
  });

  it('직접 넣은 증빙 항목까지 복사된다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.type(screen.getByLabelText(/공급가액/), '50000');
    await user.type(screen.getByLabelText('용도'), '월 구독료');
    await user.type(screen.getByLabelText('거래처'), '서비스사');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    await user.click(screen.getByRole('button', { name: /증빙 .*펼치기/ }));
    await user.type(screen.getByLabelText('증빙 항목 추가'), '이용약관 사본');
    await user.click(screen.getByRole('button', { name: '항목 추가' }));
    await user.click(screen.getByLabelText('월 구독료 복사'));
    await user.click(within(screen.getAllByRole('article')[0]).getByRole('button', { name: '복사해서 등록' }));
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses[0].evidence.map((item) => item.label)).toContain('이용약관 사본');
  });

  it('집행 등록에 재원을 고르면 저장되고, 기본값은 현금이다', async () => {
    // 재원은 현금·현물 둘로만 묻는다 — 정산이 그 두 갈래로 맞춰지기 때문이다.
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('prestartup2026')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'PRE_MATERIAL');
    expect(screen.getByLabelText('재원')).toHaveValue('cash');   // 기본값
    await user.selectOptions(screen.getByLabelText('재원'), 'inkind');
    await user.type(screen.getByLabelText(/공급가액/), '50000');
    await user.type(screen.getByLabelText('용도'), '재료 구입');
    await user.type(screen.getByLabelText('거래처'), '테스트상사');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses[0].fundingSource).toBe('inkind');
  });

  it('편성 구성 파이 — 상단 칩으로 전체와 사업 하나를 오간다 (파이만, 세목 막대 없음)', async () => {
    twoProjects();
    const user = userEvent.setup(); render(<App />);
    const panel = document.querySelector('.portfolio-charts')!;
    expect(panel.querySelector('.chart-legend')).toHaveTextContent('인건비');
    // 도넛은 총사업비가 아니라 편성표 합계다 — 두 과제 모두 1억 초안이라 전체 2억
    expect(panel.querySelector('.donut-center')).toHaveTextContent('200,000천원');
    // 과제A 칩을 누르면 도넛이 그 사업 기준으로 바뀐다 (세목 막대는 없다 — 사용자 결정)
    await user.click(screen.getByRole('button', { name: '과제A 기준으로 보기' }));
    expect(panel.querySelector('.donut-center')).toHaveTextContent('100,000천원');
    expect(panel.querySelector('.drill-panel')).toBeNull();
    // 전체로 되돌리기
    await user.click(screen.getByRole('button', { name: '전체 사업' }));
    expect(panel.querySelector('.donut-center')).toHaveTextContent('200,000천원');
    // 사업별 사업비 구성 표는 없앴다 (사용자 결정)
    expect(document.querySelector('.portfolio-funding')).toBeNull();
  });

  it('지금 확인할 일 — 사업별 미집행·증빙 요약과 14일 경과 알림만 낸다', async () => {
    // 1~12월 과제, 인건비 1,200만 → 월 100만. 집행은 옛 집행건 하나(증빙 2건 미완료).
    const a = { ...fixture('nrd2026-forprofit'), id: 'pa', name: '과제A',
      budgets: [{ categoryId: 'DIRECT_LABOR', amount: 12_000_000 }], startDate: '2026-01-01', endDate: '2026-12-31',
      expenses: [{
        id: 'e1', date: '2026-05-01', categoryId: 'DIRECT_LABOR', amount: 600_000, purpose: '5월 급여', vendor: '', createdAt: '',
        evidence: [{ id: 'v1', label: '급여명세서', completed: false }, { id: 'v2', label: '이체증', completed: false }],
      }] };
    localStorage.setItem('gwajeon.projects.v1', JSON.stringify([a]));
    localStorage.setItem('gwajeon.active-project', 'pa');
    const user = userEvent.setup(); render(<App />);
    const block = document.querySelector('.portfolio-todos')!;
    // 사업별 요약 한 줄 — 상세 목록·미루기 버튼은 없다 (집행·증빙 화면이 담당)
    expect(block.querySelector('.action-row')).toHaveTextContent('과제A');
    expect(block.querySelector('.action-row')).toHaveTextContent('증빙 미완료 2건');
    expect(block).not.toHaveTextContent('다음달로 미루기');
    // 14일 넘게 밀린 것은 텍스트로 알린다 (지난달 계획 미집행 · 5월 집행 증빙)
    expect(block.querySelector('.overdue-alerts')).toHaveTextContent('계획 미집행');
    expect(block.querySelector('.overdue-alerts')).toHaveTextContent('"5월 급여" 증빙 미완료 2건');
    expect(block.querySelector('.overdue-alerts')).toHaveTextContent('일 경과');
    // 요약 행을 누르면 그 과제의 집행·증빙 화면으로 간다
    await user.click(block.querySelector('.action-row') as HTMLElement);
    expect(screen.getByRole('heading', { name: '집행 · 증빙 관리' })).toBeInTheDocument();
  });

  it('지금 확인할 일 — 참여율 현황표가 이름으로 합치고 100% 초과·3책5공을 경고한다', async () => {
    const a = { ...fixture('nrd2026-forprofit'), id: 'pa', name: '과제A',
      participants: [{ id: '1', name: '박연구', projectRate: 60, externalRate: 20, isLead: true }] };
    const b = { ...fixture('prestartup2026'), id: 'pb', name: '과제B',
      participants: [{ id: '2', name: '박연구', projectRate: 50, externalRate: 0 }] };
    localStorage.setItem('gwajeon.projects.v1', JSON.stringify([a, b]));
    localStorage.setItem('gwajeon.active-project', 'pa');
    render(<App />);
    const table = document.querySelector('.people-table')!;
    expect(table).toHaveTextContent('박연구');
    expect(table).toHaveTextContent('110%');           // 60 + 50 — 외부(타 과제) 참여율은 세지 않는다
    expect(table).toHaveTextContent('책임 1 / 전체 2');
    expect(table.querySelector('.person-total.over')).not.toBeNull();   // 100% 초과 경고
  });
});

describe('집행 화면 예산 대시보드', () => {
  beforeEach(() => localStorage.clear());

  // 세목까지 나눠 편성한 과제 — 대시보드가 비목 행과 세목 하위 행을 모두 보여준다.
  const withSubItems = (): Project => {
    const base = fixture('nrd2026-forprofit');
    return {
      ...base,
      budgets: base.budgets.map((b) => b.categoryId !== 'DIRECT_ACTIVITY' ? b : {
        ...b, amount: 20_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 8_000_000 }, { id: 's2', name: '출장비', amount: 12_000_000 }],
      }),
      expenses: [{
        id: 'x1', date: '2026-08-10', categoryId: 'DIRECT_ACTIVITY', subItemId: 's1', subItemName: '회의비',
        amount: 3_500_000, purpose: '정기 회의', vendor: '회의공간', evidence: [], createdAt: '2026-08-10T00:00:00.000Z',
      }],
    };
  };

  it('상단에 비목별 예산·집행·잔액이 나온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(withSubItems()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    expect(screen.getByText('예산 집행 현황')).toBeInTheDocument();
    // 연구활동비 2,000만 편성 · 350만 집행 → 잔액 1,650만
    expect(screen.getByText('16,500,000원')).toBeInTheDocument();
  });

  it('세목이 편성된 비목은 펼쳐서 세목별 집행을 볼 수 있다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(withSubItems()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    expect(screen.queryByText(/└ 회의비/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /세목 2개 보기/ }));
    expect(screen.getByText(/└ 회의비/)).toBeInTheDocument();
    expect(screen.getByText(/└ 출장비/)).toBeInTheDocument();
    expect(screen.getByText('4,500,000원')).toBeInTheDocument(); // 회의비 잔액
  });

  it('대시보드에서 비목을 누르면 등록 폼이 그 비목으로 맞춰진다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(withSubItems()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.click(screen.getByRole('button', { name: '연구시설·장비비' }));
    expect(screen.getByLabelText('비목')).toHaveValue('DIRECT_EQUIPMENT');
  });
});

describe('집행건 등록 — 비목·세목 먼저', () => {
  beforeEach(() => localStorage.clear());

  // 연구활동비를 회의비·출장비로 나눠 편성해둔 과제
  const divided = (): Project => {
    const base = fixture('nrd2026-forprofit');
    return {
      ...base,
      budgets: base.budgets.map((b) => b.categoryId !== 'DIRECT_ACTIVITY' ? b : {
        ...b, amount: 20_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 8_000_000 }, { id: 's2', name: '출장비', amount: 12_000_000 }],
      }),
    };
  };

  const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_ACTIVITY');
  };

  it('유의사항과 필요한 증빙이 금액 입력보다 먼저 나온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    await user.selectOptions(screen.getByLabelText('세목'), 's1');
    // ② 안내 묶음에 증빙이, ③ 집행 내용 묶음에 금액이 들어간다
    const guideStep = within(screen.getByRole('group', { name: /② 회의비 집행 시 유의사항/ }));
    expect(guideStep.getByText(/이 집행건에 들어갈 증빙/)).toBeInTheDocument();
    const inputStep = within(screen.getByRole('group', { name: '③ 집행 내용' }));
    expect(inputStep.getByLabelText(/공급가액/)).toBeInTheDocument();
  });

  it('세목이 편성된 비목은 세목을 골라야 등록할 수 있다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    expect(screen.getByText(/세목을 선택해야 집행을 등록할 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '집행 등록' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('세목'), 's1');
    expect(screen.getByRole('button', { name: '집행 등록' })).toBeEnabled();
  });

  it('세목을 나누지 않은 비목은 세목 칸이 아예 안 나온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_LABOR');
    expect(screen.queryByLabelText('세목')).toBeNull();
    expect(screen.getByRole('button', { name: '집행 등록' })).toBeEnabled();
  });

  it('등록 폼은 늘 펼쳐져 있고 따로 여는 버튼이 없다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify({
      ...divided(),
      expenses: [{
        id: 'x1', date: '2026-08-10', categoryId: 'DIRECT_LABOR', amount: 80_000,
        purpose: '기존 집행', vendor: '거래처', evidence: [], createdAt: '2026-08-10T00:00:00.000Z',
      }],
    }));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    // 집행 이력이 있어도 폼이 바로 보인다
    expect(screen.getByText('새 집행건')).toBeInTheDocument();
    expect(screen.getByLabelText('비목')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /집행건 등록/ })).toBeNull();
  });

  it('세목을 고르면 그 세목의 유의사항만 나온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    // 유의사항 본문만 본다 — 접혀 있는 근거 조문 원문에는 다른 세목 내용도 함께 실려 있다
    const bodyText = () => [...screen.getByRole('group', { name: /집행 시 유의사항/ })
      .querySelectorAll('.caution-head')].map((node) => node.textContent).join('\n');
    // 세목을 고르기 전에는 연구활동비 전체 주의사항이 나온다
    expect(bodyText()).toContain('회의의 식비는 계상할 수 없습니다');
    await user.selectOptions(screen.getByLabelText('세목'), 's2');   // 출장비
    expect(bodyText()).toContain('공무원 출장비는 공무원 여비 규정');
    // 다른 세목(회의비·연구인력 지원비) 규칙은 빠진다
    expect(bodyText()).not.toContain('회의의 식비는 계상할 수 없습니다');
    expect(bodyText()).not.toContain('종신 학회비');
  });

  it('집행 시 유의사항에 사전승인 절차와 상위 규정 주의사항이 함께 나온다', async () => {
    // 디딤돌은 "나머지는 국가연구개발비 사용 기준을 따른다"는 공고라, 자기 주의사항만 보면 대부분이 빠진다
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('didimdol2026')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_ACTIVITY');
    const step = within(screen.getByRole('group', { name: /집행 시 유의사항/ }));
    // 사전승인은 집행 후에 알면 되돌릴 수 없어 반드시 보여야 한다
    expect(step.getAllByText(/사전승인|승인/).length).toBeGreaterThan(0);
    // 상위 규정 것은 출처를 밝혀 접어둔다
    const inherited = step.getByText(/상위 규정도 지켜야 합니다/);
    expect(inherited).toBeInTheDocument();
    expect(inherited.textContent).toContain('국가연구개발사업 연구개발비 사용 기준');
  });

  it('규정에 없는 증빙을 직접 추가해 체크리스트에 넣는다', async () => {
    // 4대보험 완납증명서처럼 규정에 안 적혀 있어도 실무에서 요구받는 서류가 있다
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    await user.selectOptions(screen.getByLabelText('세목'), 's1');
    await user.type(screen.getByLabelText('증빙 직접 추가'), '4대보험 완납증명서');
    await user.click(screen.getByRole('button', { name: /추가/ }));
    expect(screen.getByRole('checkbox', { name: /4대보험 완납증명서/ })).toBeChecked();

    await user.type(screen.getByLabelText('회의 목적'), '개발 범위 확정');
    fireEvent.change(screen.getByLabelText('회의 일시'), { target: { value: '2026-08-10' } });
    await user.type(screen.getByLabelText('회의 장소'), '본사');
    await user.type(screen.getByLabelText('참석자'), '김대표');
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses[0].evidence.map((item) => item.label)).toContain('4대보험 완납증명서');
  });

  it('직접 추가한 증빙은 지울 수 있고, 비목을 바꾸면 사라진다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    await user.selectOptions(screen.getByLabelText('세목'), 's1');
    await user.type(screen.getByLabelText('증빙 직접 추가'), '월별 4대보험가입자 명부');
    await user.click(screen.getByRole('button', { name: /추가/ }));
    await user.click(screen.getByRole('button', { name: '월별 4대보험가입자 명부 삭제' }));
    expect(screen.queryByRole('checkbox', { name: /월별 4대보험가입자 명부/ })).toBeNull();

    await user.type(screen.getByLabelText('증빙 직접 추가'), '4대보험 완납증명서');
    await user.click(screen.getByRole('button', { name: /추가/ }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_LABOR');
    expect(screen.queryByRole('checkbox', { name: /4대보험 완납증명서/ })).toBeNull();
  });

  it('비목별 증빙서류의 추출 원문을 증빙 섹션에서 토글로 보여준다', async () => {
    // 증빙표 전체를 별도 article로 보관한다. 같은 11.다.1) 아래의 연구활동비 조문을
    // 잘못 고르지 않고, 비목별 증빙서류 표 자체를 정확히 펼쳐야 한다.
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('tips2026-general')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'INDIRECT');
    const step = screen.getByRole('group', { name: /집행 시 유의사항/ });
    const toggle = [...step.querySelectorAll<HTMLDetailsElement>('.caution-article')]
      .find((node) => node.querySelector('summary')?.textContent?.includes('비목별 증빙서류')) ?? null;
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveTextContent('지침 11.다.1) 비목별 증빙서류');
    expect(toggle).toHaveTextContent('간접비 간접비 <영리기관>');
    expect(toggle).toHaveTextContent('산학연협력 코디네이터 교육 이수 및 자격시험 합격 증명서류');
    const shown = [...step.querySelectorAll('.caution-article b')].map((node) => node.textContent).join('\n');
    expect(shown).not.toContain('연구활동비');
  });

  it('예비창업패키지 증빙 근거로 통합관리지침 표-10 원문을 보여준다', async () => {
    // 표-10이 조문으로 없던 동안에는 근거 번호에서 '제36조'만 뽑혀, 상위 참조 팩인
    // 국가연구개발사업의 제36조(정부출연기관 연구개발비 이관)가 엉뚱하게 붙었다.
    // 다른 규정 조문이 근거로 딸려오지 않는 것까지 함께 지킨다.
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture('prestartup2026')));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'PRE_MATERIAL');
    const step = screen.getByRole('group', { name: /집행 시 유의사항/ });
    const toggle = [...step.querySelectorAll<HTMLDetailsElement>('.caution-article')]
      .find((node) => node.querySelector('summary')?.textContent?.includes('표-10')) ?? null;
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveTextContent('제36조 <표-10> 창업기업등 사업비 비목');
    expect(toggle).toHaveTextContent('세금계산서(신용카드 영수증), 견적서, 검수조서(증빙사진 포함), 거래처');
    const shown = [...step.querySelectorAll('.caution-article b')].map((node) => node.textContent).join('\n');
    expect(shown).not.toContain('정부출연기관 연구개발비 이관');
  });

  it('인건비는 내부·외부 세목이 각자의 증빙만 요구한다', async () => {
    // 증빙표는 내부/외부 인건비를 다른 줄로 나눠 적는데, 규정DB가 둘을 한 문구로 묶어 두어
    // 어느 세목을 골라도 두 줄이 함께 짚히고 서류도 뒤섞였다.
    const base = fixture('tips2026-general');
    localStorage.setItem('gwajeon.project.v1', JSON.stringify({
      ...base,
      budgets: base.budgets.map((b) => b.categoryId !== 'DIRECT_LABOR' ? b : {
        ...b, amount: 30_000_000, subItems: [{ id: 'ext', name: '외부 인건비', amount: 30_000_000 }],
      }),
    }));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_LABOR');
    await user.selectOptions(screen.getByLabelText('세목'), 'ext');
    // 외부 인건비 전용 서류는 나오고, 내부 인건비 전용 서류는 나오지 않는다
    expect(screen.getByRole('checkbox', { name: /외부참여연구자 소속 기관장 확인서/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /참여연구자 현황표/ })).toBeNull();
    const step = screen.getByRole('group', { name: /집행 시 유의사항/ });
    const marked = [...step.querySelectorAll('.caution-article .hit')].map((node) => node.textContent ?? '');
    expect(marked.some((line) => line.startsWith('외부 인건비'))).toBe(true);
    expect(marked.some((line) => line.startsWith('인건비 내부 인건비'))).toBe(false);
  });

  it('세목 안의 인정 항목마다 증빙표에서 제 줄을 짚는다', async () => {
    // 한 조문(증빙표)을 여러 항목이 근거로 쓰면 근거 문구가 마지막 항목 것만 남아,
    // 외부 전문기술 활용비를 골랐는데 그 안의 연구개발서비스활용비 줄만 짚히던 문제.
    const base = fixture('tips2026-general');
    localStorage.setItem('gwajeon.project.v1', JSON.stringify({
      ...base,
      budgets: base.budgets.map((b) => b.categoryId !== 'DIRECT_ACTIVITY' ? b : {
        ...b, amount: 20_000_000, subItems: [{ id: 'ext', name: '외부 전문기술 활용비', amount: 20_000_000 }],
      }),
    }));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_ACTIVITY');
    await user.selectOptions(screen.getByLabelText('세목'), 'ext');
    const step = screen.getByRole('group', { name: /집행 시 유의사항/ });
    const toggle = [...step.querySelectorAll<HTMLDetailsElement>('.caution-article')]
      .find((node) => node.querySelector('summary')?.textContent?.includes('비목별 증빙서류'));
    const marked = [...(toggle?.querySelectorAll('.hit') ?? [])].map((node) => node.textContent ?? '');
    // 세 인정 항목(기술도입비·전문가활용비·연구개발서비스활용비)이 각각 제 줄을 짚어야 한다
    expect(marked.some((line) => line.includes('<기술도입비>'))).toBe(true);
    expect(marked.some((line) => line.includes('<전문가활용비>'))).toBe(true);
    expect(marked.some((line) => line.includes('<연구개발서비스활용비>'))).toBe(true);
  });

  it('세목을 고르면 그 세목의 증빙 규칙이 나온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    await user.selectOptions(screen.getByLabelText('세목'), 's2');   // 출장비
    expect(screen.getByText(/국외출장 집행 전 출장계획서 구비/)).toBeInTheDocument();
    expect(screen.getByText(/기관 여비규정 기준/)).toBeInTheDocument();
    // 회의비 전용 규칙은 나오지 않는다
    expect(screen.queryByText(/10만원 이하 회의비 간소화 증빙/)).toBeNull();
  });

  it('세목을 바꾸면 골라둔 증빙 선택이 초기화된다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    await user.selectOptions(screen.getByLabelText('세목'), 's2');
    const travelDoc = screen.getByRole('checkbox', { name: '국외출장계획서' });
    await user.click(travelDoc);                      // 해당 없는 조건을 끈다
    expect(travelDoc).not.toBeChecked();
    await user.selectOptions(screen.getByLabelText('세목'), 's1');   // 회의비로 변경
    // 끈 기록은 세목을 바꾸면 지워지고, 출장비 서류도 사라진다
    expect(screen.queryByRole('checkbox', { name: '국외출장계획서' })).toBeNull();
  });

  it('등록하면 집행건에 비목과 세목이 함께 저장된다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await openForm(user);
    await user.selectOptions(screen.getByLabelText('세목'), 's1');
    await user.type(screen.getByLabelText('회의 목적'), '개발 범위 확정');
    fireEvent.change(screen.getByLabelText('회의 일시'), { target: { value: '2026-08-10' } });
    await user.type(screen.getByLabelText('회의 장소'), '본사 회의실');
    await user.type(screen.getByLabelText('참석자'), '김대표, 박연구');
    await user.type(screen.getByLabelText(/공급가액/), '80000');
    await user.type(screen.getByLabelText('용도'), '정기 회의');
    await user.type(screen.getByLabelText('거래처'), '회의공간');
    await user.click(screen.getByRole('button', { name: '집행 등록' }));
    // 저장은 다중 과제 배열(gwajeon.projects.v1)로 옮겨 간다
    const saved: Project = JSON.parse(localStorage.getItem('gwajeon.projects.v1')!)[0];
    expect(saved.expenses[0]).toMatchObject({
      categoryId: 'DIRECT_ACTIVITY', subItemId: 's1', subItemName: '회의비',
      details: { meetingPurpose: '개발 범위 확정', meetingPlace: '본사 회의실', attendees: '김대표, 박연구' },
    });
    // 세목까지 나뉜 대시보드에서 회의비 행에 잡힌다
    await user.click(screen.getByRole('button', { name: /세목 2개 보기/ }));
    expect(screen.getByText(/└ 회의비/)).toBeInTheDocument();
  });
});

describe('세목별 추가 입력', () => {
  beforeEach(() => localStorage.clear());

  const divided = (): Project => {
    const base = fixture('nrd2026-forprofit');
    return {
      ...base,
      budgets: base.budgets.map((b) => b.categoryId !== 'DIRECT_ACTIVITY' ? b : {
        ...b, amount: 20_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 8_000_000 }, { id: 's2', name: '출장비', amount: 12_000_000 }],
      }),
    };
  };

  const pickSub = async (user: ReturnType<typeof userEvent.setup>, subId: string) => {
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.selectOptions(screen.getByLabelText('비목'), 'DIRECT_ACTIVITY');
    await user.selectOptions(screen.getByLabelText('세목'), subId);
  };

  it('세목이 회의비면 회의 목적·장소·참석자 칸이 나온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await pickSub(user, 's1');
    expect(screen.getByLabelText('회의 목적')).toBeInTheDocument();
    expect(screen.getByLabelText('회의 장소')).toBeInTheDocument();
    expect(screen.getByLabelText('참석자')).toBeInTheDocument();
    expect(screen.queryByLabelText('출장자')).toBeNull();
  });

  it('세목이 출장비면 출장자·출장지·출장 기간 칸이 나온다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await pickSub(user, 's2');
    expect(screen.getByLabelText('출장자')).toBeInTheDocument();
    expect(screen.getByLabelText('출장지')).toBeInTheDocument();
    expect(screen.getByLabelText('출장 시작')).toBeInTheDocument();
    expect(screen.getByLabelText('출장 종료')).toBeInTheDocument();
    expect(screen.queryByLabelText('회의 목적')).toBeNull();
  });

  it('추가 입력 항목이 없는 세목은 아무 칸도 나오지 않는다', async () => {
    const base = fixture('nrd2026-forprofit');
    localStorage.setItem('gwajeon.project.v1', JSON.stringify({
      ...base,
      budgets: base.budgets.map((b) => b.categoryId !== 'DIRECT_ACTIVITY' ? b : {
        ...b, subItems: [{ id: 's9', name: '연구실운영비', amount: 5_000_000 }],
      }),
    }));
    const user = userEvent.setup(); render(<App />);
    await pickSub(user, 's9');
    expect(screen.queryByText(/집행에 필요한 항목/)).toBeNull();
  });

  it('세목을 바꾸면 이전 세목의 추가 입력이 남지 않는다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(divided()));
    const user = userEvent.setup(); render(<App />);
    await pickSub(user, 's1');
    await user.type(screen.getByLabelText('회의 장소'), '본사 회의실');
    await user.selectOptions(screen.getByLabelText('세목'), 's2');
    await user.selectOptions(screen.getByLabelText('세목'), 's1');
    expect(screen.getByLabelText('회의 장소')).toHaveValue('');
  });

  it('저장한 추가 입력은 수정 화면에서 다시 보인다', async () => {
    const base = divided();
    localStorage.setItem('gwajeon.project.v1', JSON.stringify({
      ...base,
      expenses: [{
        id: 'x1', date: '2026-08-10', categoryId: 'DIRECT_ACTIVITY', subItemId: 's1', subItemName: '회의비',
        amount: 80_000, purpose: '정기 회의', vendor: '회의공간', evidence: [], createdAt: '2026-08-10T00:00:00.000Z',
        details: { meetingPurpose: '개발 범위 확정', meetingPlace: '본사 회의실', attendees: '김대표' },
      }],
    }));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    await user.click(screen.getByRole('button', { name: '정기 회의 수정' }));
    const editCard = within(screen.getAllByRole('article')[0]);
    expect(editCard.getByLabelText('회의 목적')).toHaveValue('개발 범위 확정');
    expect(editCard.getByLabelText('참석자')).toHaveValue('김대표');
  });
});

describe('월별 집행계획 (매트릭스 열)', () => {
  beforeEach(() => localStorage.clear());

  const divided = (): Project => {
    const base = fixture('nrd2026-forprofit');
    return {
      ...base,
      budgets: base.budgets.map((b) => b.categoryId !== 'DIRECT_ACTIVITY' ? b : {
        ...b, amount: 12_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 6_000_000 }, { id: 's2', name: '출장비', amount: 6_000_000 }],
      }),
    };
  };
  // 월 칸은 기본으로 모두 접혀 있다 — 월별 동작을 보려면 "전체"로 켜고 시작한다.
  const openSpending = async (user: ReturnType<typeof userEvent.setup>, project: Project, showMonths = true) => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(project));
    render(<App />);
    await user.click(screen.getByRole('button', { name: '집행 · 증빙' }));
    if (showMonths) await user.click(screen.getByRole('button', { name: '전체' }));
  };

  it('월마다 계획·집행 열이 나란히 붙는다', async () => {
    const user = userEvent.setup();
    await openSpending(user, fixture('nrd2026-forprofit'));
    // 2026-07-01 ~ 2027-06-30 = 12개월이 열 머리글로 깔린다
    expect(screen.getByRole('columnheader', { name: '2026-07' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '2027-06' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: '계획' })).toHaveLength(12);
    expect(screen.getAllByRole('columnheader', { name: '집행' })).toHaveLength(12);
  });

  it('월별 숨기기를 누르면 월 열만 사라지고 예산·집행·잔액은 남는다', async () => {
    const user = userEvent.setup();
    await openSpending(user, fixture('nrd2026-forprofit'));
    await user.click(screen.getByRole('button', { name: '월별 숨기기' }));
    expect(screen.queryByRole('columnheader', { name: '2026-07' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '계획' })).toBeNull();
    // 고정 열은 그대로다
    expect(screen.getByRole('columnheader', { name: '변경예산' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '집행금액' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '잔액' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '월별 보기' }));
    expect(screen.getByRole('columnheader', { name: '2026-07' })).toBeInTheDocument();
  });

  it('월 체크를 해제하면 그 달만 빠진다', async () => {
    const user = userEvent.setup();
    await openSpending(user, fixture('nrd2026-forprofit'));
    await user.click(screen.getByRole('checkbox', { name: '26-07' }));
    expect(screen.queryByRole('columnheader', { name: '2026-07' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: '2026-08' })).toBeInTheDocument();
    // 해제 후 전체를 누르면 다시 돌아온다
    await user.click(screen.getByRole('button', { name: '해제' }));
    expect(screen.queryByRole('columnheader', { name: '2026-08' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '전체' }));
    expect(screen.getAllByRole('columnheader', { name: '계획' })).toHaveLength(12);
  });

  it('세목을 나누지 않은 비목은 계획 칸을 바로 고칠 수 있다', async () => {
    const user = userEvent.setup();
    await openSpending(user, divided());
    const cell = screen.getByLabelText('인건비 2026-07 계획');
    fireEvent.change(cell, { target: { value: '5000000' } });
    expect(screen.getByLabelText('인건비 2026-07 계획')).toHaveValue('5,000,000');
    // 고치지 않은 달은 자동 계산값 그대로다
    expect(screen.getByLabelText('인건비 2026-08 계획')).not.toHaveValue('5,000,000');
  });

  it('세목이 나뉜 비목은 비목 행 계획을 못 고치고 세목 행에서 고친다', async () => {
    const user = userEvent.setup();
    await openSpending(user, divided());
    expect(screen.queryByLabelText('연구활동비 2026-07 계획')).toBeNull();
    await user.click(screen.getByRole('button', { name: /세목 2개 보기/ }));
    const cell = screen.getByLabelText('회의비 2026-07 계획');
    expect(cell).toHaveValue('500,000');           // 600만 ÷ 12개월
    fireEvent.change(cell, { target: { value: '2000000' } });
    // 비목 행 계획은 세목 합계로 따라 올라간다 (200만 + 자동 50만)
    expect(screen.getByText('2,500,000원')).toBeInTheDocument();
  });

  it('사업기간과 개월 수를 월 표시 옆에 밝힌다', async () => {
    const user = userEvent.setup();
    await openSpending(user, fixture('nrd2026-forprofit'));
    expect(screen.getByText('사업기간 2026-07-01 ~ 2027-06-30 · 12개월')).toBeInTheDocument();
  });

  it('사업기간이 한 달뿐이면 월이 하나만 나오는 이유를 알려준다', async () => {
    const user = userEvent.setup();
    await openSpending(user, { ...fixture('nrd2026-forprofit'), startDate: '2026-07-01', endDate: '2026-07-31' });
    expect(screen.getByRole('checkbox', { name: '26-07' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '26-08' })).toBeNull();
    expect(screen.getByText(/1개월로 잡혀 있어 월이 하나만 나옵니다/)).toBeInTheDocument();
    expect(screen.getByText(/설정 → 과제 정보에서 시작일·종료일을 확인/)).toBeInTheDocument();
  });

  it('사업기간이 비어 있으면 월 열 없이 이유를 알려준다', async () => {
    const user = userEvent.setup();
    await openSpending(user, { ...fixture('nrd2026-forprofit'), endDate: '' }, false);
    expect(screen.queryByRole('columnheader', { name: '계획' })).toBeNull();
    expect(screen.getByText(/사업기간이 설정되어 있지 않아/)).toBeInTheDocument();
    // 예산·집행·잔액은 그대로 보인다
    expect(screen.getByRole('columnheader', { name: '변경예산' })).toBeInTheDocument();
  });

  it('사업기간 밖 집행은 기간 외 행으로 드러난다', async () => {
    const base = fixture('nrd2026-forprofit');
    const user = userEvent.setup();
    await openSpending(user, {
      ...base,
      expenses: [{
        id: 'x1', date: '2028-01-05', categoryId: 'DIRECT_ACTIVITY', amount: 300_000,
        purpose: '기간 밖 집행', vendor: '거래처', evidence: [], createdAt: '2028-01-05T00:00:00.000Z',
      }],
    });
    expect(screen.getByText(/기간 외 집행/)).toBeInTheDocument();
    expect(screen.getByText(/사업기간 밖 집행이 1건 있습니다/)).toBeInTheDocument();
  });
});
