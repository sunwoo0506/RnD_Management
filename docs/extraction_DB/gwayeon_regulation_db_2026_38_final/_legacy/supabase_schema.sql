create extension if not exists pgcrypto;

create table if not exists regulation_documents (
    id uuid primary key default gen_random_uuid(),
    document_code text not null unique,
    title text not null,
    document_type text not null,
    scope text not null,
    issuer text,
    created_at timestamptz not null default now()
);

create table if not exists regulation_versions (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references regulation_documents(id),
    version_code text not null unique,
    version_label text not null,
    notice_number text,
    promulgated_at date,
    effective_from date not null,
    effective_to date,
    publication_status text not null,
    source_filename text,
    source_file_sha256 text,
    source_system text,
    special_effective_dates jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists regulation_articles (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    article_key text not null,
    article_number text not null,
    article_title text,
    section text not null default 'MAIN',
    original_text text not null,
    paragraph_start integer,
    paragraph_end integer,
    effective_from date not null,
    effective_to date,
    is_active boolean not null default true,
    unique(version_id, article_key)
);

create table if not exists expense_categories (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    parent_code text,
    cost_class text,
    category_type text not null,
    display_order integer not null default 0,
    is_active boolean not null default true
);

create table if not exists expense_allowed_items (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    item_code text not null,
    category_code text not null references expense_categories(code),
    item_name text not null,
    description text,
    institution_scope text not null default 'ALL',
    availability_status text not null default 'ALLOWED',
    condition_summary text,
    eligibility_condition jsonb not null default '{}'::jsonb,
    requires_approval boolean not null default false,
    requires_recognition boolean not null default false,
    restriction_summary text,
    evidence_summary text,
    source_article text,
    source_article_keys jsonb not null default '[]'::jsonb,
    effective_from date not null,
    effective_to date,
    display_order integer not null default 0,
    is_active boolean not null default true,
    unique(version_id, item_code)
);

create table if not exists expense_limit_rules (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    limit_code text not null,
    category_code text not null references expense_categories(code),
    limit_name text not null,
    limit_type text not null,
    limit_value numeric,
    limit_unit text,
    basis_code text,
    formula_expression text,
    ui_summary text,
    over_limit_action text not null,
    institution_scope text not null default 'ALL',
    applicability_condition jsonb not null default '{}'::jsonb,
    source_article text,
    source_article_keys jsonb not null default '[]'::jsonb,
    effective_from date not null,
    effective_to date,
    priority integer not null default 100,
    is_active boolean not null default true,
    unique(version_id, limit_code)
);

create table if not exists budget_screen_guides (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    profile_code text not null,
    category_code text not null references expense_categories(code),
    display_name text not null,
    usage_summary text,
    allowed_items_text text,
    allowed_item_count integer not null default 0,
    limit_display_type text not null,
    limit_text text,
    limit_detail_text text,
    formula_expression text,
    institution_scope text not null default 'ALL',
    over_limit_action text,
    source_articles jsonb not null default '[]'::jsonb,
    source_article_keys jsonb not null default '[]'::jsonb,
    effective_from date not null,
    effective_to date,
    display_order integer not null default 0,
    is_active boolean not null default true,
    unique(version_id, profile_code)
);

create table if not exists expense_applicability_rules (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    applicability_code text not null,
    category_code text not null references expense_categories(code),
    institution_scope text not null,
    condition_summary text not null,
    result text not null,
    source_article text,
    source_article_keys jsonb not null default '[]'::jsonb,
    effective_from date not null,
    effective_to date,
    is_active boolean not null default true,
    unique(version_id, applicability_code)
);

create table if not exists regulation_rules (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    rule_code text not null,
    rule_name text not null,
    domain text,
    category_code text references expense_categories(code),
    rule_type text not null,
    evaluation_stages jsonb not null default '[]'::jsonb,
    automation_level text not null,
    condition_json jsonb not null,
    result_json jsonb not null,
    required_inputs jsonb not null default '[]'::jsonb,
    source_article text,
    source_article_keys jsonb not null default '[]'::jsonb,
    source_text text,
    effective_from date not null,
    effective_to date,
    severity text,
    priority integer not null default 100,
    review_status text not null,
    is_active boolean not null default true,
    unique(version_id, rule_code)
);

create table if not exists program_rule_overrides (
    id uuid primary key default gen_random_uuid(),
    program_id uuid not null,
    override_code text not null,
    target_type text not null,
    target_code text not null,
    override_type text not null,
    override_payload jsonb not null,
    priority integer not null default 1000,
    effective_from date,
    effective_to date,
    status text not null default 'DRAFT',
    is_active boolean not null default false
);

create index if not exists idx_expense_categories_parent
    on expense_categories(parent_code, display_order);
create index if not exists idx_allowed_items_category_scope
    on expense_allowed_items(category_code, institution_scope, effective_from);
create index if not exists idx_limit_rules_category_scope
    on expense_limit_rules(category_code, institution_scope, effective_from, priority desc);
create index if not exists idx_budget_guides_order
    on budget_screen_guides(display_order, effective_from);
create index if not exists idx_applicability_category_scope
    on expense_applicability_rules(category_code, institution_scope, effective_from);
create index if not exists idx_rules_category
    on regulation_rules(category_code, effective_from, priority desc);

create or replace view expense_category_budget_guide as
select
    g.version_id,
    g.profile_code,
    g.category_code,
    g.display_name,
    g.usage_summary,
    g.allowed_items_text,
    g.allowed_item_count,
    g.limit_display_type,
    g.limit_text,
    g.limit_detail_text,
    g.formula_expression,
    g.institution_scope,
    g.over_limit_action,
    g.source_articles,
    g.effective_from,
    g.effective_to,
    g.display_order,
    coalesce((
        select jsonb_agg(
            jsonb_build_object(
                'item_code', i.item_code,
                'item_name', i.item_name,
                'description', i.description,
                'institution_scope', i.institution_scope,
                'availability_status', i.availability_status,
                'condition_summary', i.condition_summary,
                'requires_approval', i.requires_approval,
                'requires_recognition', i.requires_recognition,
                'restriction_summary', i.restriction_summary,
                'evidence_summary', i.evidence_summary,
                'source_article', i.source_article
            )
            order by i.display_order
        )
        from expense_allowed_items i
        where i.version_id = g.version_id
          and i.category_code = g.category_code
          and i.is_active
    ), '[]'::jsonb) as allowed_items,
    coalesce((
        select jsonb_agg(
            jsonb_build_object(
                'limit_code', l.limit_code,
                'limit_type', l.limit_type,
                'limit_value', l.limit_value,
                'limit_unit', l.limit_unit,
                'basis_code', l.basis_code,
                'formula_expression', l.formula_expression,
                'ui_summary', l.ui_summary,
                'over_limit_action', l.over_limit_action,
                'institution_scope', l.institution_scope,
                'source_article', l.source_article
            )
            order by l.priority desc
        )
        from expense_limit_rules l
        where l.version_id = g.version_id
          and l.category_code = g.category_code
          and l.is_active
    ), '[]'::jsonb) as limits,
    coalesce((
        select jsonb_agg(
            jsonb_build_object(
                'applicability_code', a.applicability_code,
                'institution_scope', a.institution_scope,
                'condition_summary', a.condition_summary,
                'result', a.result,
                'source_article', a.source_article
            )
        )
        from expense_applicability_rules a
        where a.version_id = g.version_id
          and a.category_code = g.category_code
          and a.is_active
    ), '[]'::jsonb) as applicability
from budget_screen_guides g
where g.is_active;
