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
    await user.type(screen.getByLabelText('정산 마감일'), '2027-07-30');
    await user.type(screen.getByLabelText('대표자 이름'), '김대표');
    await user.type(screen.getByLabelText('알림 이메일'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /다음 — 적용 규정 정하기/ }));
    // 2단계: 규정 선택
    await user.click(screen.getByRole('radio', { name: /예비창업패키지/ }));
    await user.click(screen.getByRole('button', { name: /예산 초안 만들기/ }));
    expect(screen.getAllByText('100,000,000원').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('회의록').length).toBeGreaterThan(0);
    expect(screen.getByText('0/4 증빙 완료')).toBeInTheDocument();
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
    expect(screen.getByText('100,000원')).toBeInTheDocument();
    expect(screen.getByText(/부가세 10,000원 별도/)).toBeInTheDocument();
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
    expect(screen.getByLabelText('비목')).toBeDisabled();
    expect(screen.getByLabelText('결제수단')).toBeDisabled();
    const amount = screen.getByLabelText(/공급가액/);
    await user.clear(amount); await user.type(amount, '90000');
    await user.click(screen.getByRole('button', { name: '수정 저장' }));
    expect(screen.getByText('90,000원')).toBeInTheDocument();
    expect(screen.queryByText('80,000원')).toBeNull();
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
    expect(screen.getAllByText('200,000,000원').length).toBeGreaterThan(0);
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

  it('비목 간 이동을 저장하면 변경 전후 비교표와 문서 버튼을 표시한다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    const amount = screen.getByPlaceholderText('0');
    fireEvent.change(amount, { target: { value: '1000000' } });
    await user.click(screen.getByRole('button', { name: /변경 비교표 생성/ }));
    // 비교표 증감 2곳 + 변경 이력 1곳
    expect(screen.getAllByText('1,000,000원')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /비교표 Word/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /중기부 공문 Word/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /변경 이력 1건/ })).toBeInTheDocument();
  });

  it('변경을 두 번 저장하면 이력이 누적되고 이전 기록이 남는다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    const amount = screen.getByPlaceholderText('0');
    fireEvent.change(amount, { target: { value: '1000000' } });
    await user.click(screen.getByRole('button', { name: /변경 비교표 생성/ }));
    fireEvent.change(amount, { target: { value: '2000000' } });
    await user.click(screen.getByRole('button', { name: /변경 비교표 생성/ }));
    expect(screen.getByRole('heading', { name: /변경 이력 2건/ })).toBeInTheDocument();
    // 첫 번째 변경(100만 원)이 이력에 그대로 남아 있다
    expect(screen.getAllByText('1,000,000원').length).toBeGreaterThan(0);
  });

  it('받는 비목이 변경 후 허용 상한을 초과하면 저장을 차단한다', async () => {
    localStorage.setItem('gwajeon.project.v1', JSON.stringify(fixture()));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: '변경 관리' }));
    // 인건비 초안 4,500만 원 + 1,000만 원 이동 = 5,500만 원 > 상한 5,000만 원(총 사업비의 50%)
    const amount = screen.getByPlaceholderText('0');
    fireEvent.change(amount, { target: { value: '10000000' } });
    expect(screen.getByText(/허용 상한 .*초과합니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /변경 비교표 생성/ })).toBeDisabled();
  });
});
