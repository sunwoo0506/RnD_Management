create extension if not exists pgcrypto;

create table if not exists extraction_jobs (
    id uuid primary key default gen_random_uuid(),
    file_id uuid not null,
    pipeline_version text not null,
    status text not null,
    started_at timestamptz,
    completed_at timestamptz,
    metrics jsonb not null default '{}'::jsonb,
    errors jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists regulation_documents (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    document_type text not null,
    issuer text,
    source_filename text,
    source_file_hash text not null,
    source_url text,
    created_at timestamptz not null default now()
);

create unique index if not exists ux_regulation_documents_hash
    on regulation_documents(source_file_hash);

create table if not exists regulation_versions (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references regulation_documents(id),
    version_code text not null unique,
    notice_number text,
    publication_status text not null,
    promulgated_at date,
    effective_from date,
    effective_to date,
    date_basis text,
    scope_json jsonb not null default '{}'::jsonb,
    special_effective_dates jsonb not null default '[]'::jsonb,
    previous_version_id uuid references regulation_versions(id),
    created_at timestamptz not null default now()
);

create table if not exists document_nodes (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    parent_node_id uuid references document_nodes(id),
    node_key text not null,
    node_type text not null,
    sequence integer not null,
    heading text,
    original_text text not null,
    page_number integer,
    source_anchor text,
    text_hash text,
    status text not null default 'ACTIVE',
    metadata_json jsonb not null default '{}'::jsonb,
    unique(version_id, node_key)
);

create table if not exists rule_candidates (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    candidate_code text not null,
    source_node_ids jsonb not null,
    candidate_text text not null,
    detected_types jsonb not null,
    cross_references jsonb not null default '[]'::jsonb,
    contains_exception boolean not null default false,
    confidence numeric(5,4),
    extraction_model text,
    extraction_prompt_version text,
    created_at timestamptz not null default now()
);

create table if not exists expense_categories (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    parent_code text,
    category_type text not null,
    aliases jsonb not null default '[]'::jsonb,
    is_active boolean not null default true
);

create table if not exists normalized_rules (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references regulation_versions(id),
    candidate_id uuid references rule_candidates(id),
    rule_code text not null,
    rule_name text not null,
    rule_type text not null,
    category_code text references expense_categories(code),
    item_code text,
    original_term text,
    mapping_status text,
    scope_json jsonb not null default '{}'::jsonb,
    condition_json jsonb,
    limit_json jsonb,
    result_json jsonb not null,
    evidence_json jsonb not null default '[]'::jsonb,
    deadline_json jsonb,
    exceptions_json jsonb not null default '[]'::jsonb,
    overrides_rule_id uuid references normalized_rules(id),
    source_node_ids jsonb not null,
    source_article text,
    source_text text not null,
    cross_references jsonb not null default '[]'::jsonb,
    effective_from date,
    effective_to date,
    date_basis text,
    confidence numeric(5,4),
    review_status text not null,
    is_active boolean not null default false,
    priority integer not null default 300,
    created_at timestamptz not null default now(),
    unique(version_id, rule_code)
);

create table if not exists rule_validation_results (
    id uuid primary key default gen_random_uuid(),
    rule_id uuid not null references normalized_rules(id),
    validation_code text not null,
    severity text not null,
    passed boolean not null,
    message text not null,
    details_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists program_rule_overrides (
    id uuid primary key default gen_random_uuid(),
    program_id uuid not null,
    target_rule_id uuid references normalized_rules(id),
    target_rule_code text,
    override_type text not null,
    override_payload jsonb not null,
    priority integer not null default 900,
    effective_from date,
    effective_to date,
    review_status text not null default 'DRAFT',
    is_active boolean not null default false
);

create table if not exists rule_test_cases (
    id uuid primary key default gen_random_uuid(),
    rule_id uuid references normalized_rules(id),
    test_code text not null,
    input_json jsonb not null,
    expected_json jsonb not null,
    last_result_json jsonb,
    passed boolean,
    created_at timestamptz not null default now()
);

create index if not exists idx_document_nodes_version_type
    on document_nodes(version_id, node_type, sequence);

create index if not exists idx_rule_candidates_version
    on rule_candidates(version_id, confidence desc);

create index if not exists idx_normalized_rules_lookup
    on normalized_rules(
        version_id,
        category_code,
        rule_type,
        effective_from,
        priority desc
    );

create index if not exists idx_normalized_rules_review
    on normalized_rules(review_status, is_active);

create index if not exists idx_validation_rule
    on rule_validation_results(rule_id, severity, passed);
