-- 전체 법정 비목을 화면에 표시하는 조회 예시
select *
from expense_category_budget_guide
where effective_from <= current_date
  and (effective_to is null or effective_to >= current_date)
order by display_order;
