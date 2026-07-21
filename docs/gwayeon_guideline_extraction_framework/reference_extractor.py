from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Iterable


class RuleType(StrEnum):
    CATEGORY_DEFINE = "CATEGORY_DEFINE"
    ALLOWED_ITEM = "ALLOWED_ITEM"
    PROHIBITED_ITEM = "PROHIBITED_ITEM"
    LIMIT = "LIMIT"
    FORMULA = "FORMULA"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    RECOGNITION_REQUIRED = "RECOGNITION_REQUIRED"
    EVIDENCE_REQUIRED = "EVIDENCE_REQUIRED"
    DEADLINE = "DEADLINE"
    PROCEDURE = "PROCEDURE"
    ELIGIBILITY = "ELIGIBILITY"
    EXCEPTION = "EXCEPTION"


CANDIDATE_PATTERNS: dict[RuleType, list[re.Pattern[str]]] = {
    RuleType.ALLOWED_ITEM: [
        re.compile(r"사용할 수 있다"),
        re.compile(r"계상할 수 있다"),
        re.compile(r"사용용도는"),
    ],
    RuleType.PROHIBITED_ITEM: [
        re.compile(r"계상하여서는 아니 된다"),
        re.compile(r"사용하여서는 아니 된다"),
        re.compile(r"사용할 수 없다"),
        re.compile(r"제외한다"),
    ],
    RuleType.LIMIT: [
        re.compile(r"\d+(?:\.\d+)?\s*퍼센트"),
        re.compile(r"\d[\d,]*\s*원"),
        re.compile(r"이내|이하|미만|이상|초과|한도"),
    ],
    RuleType.APPROVAL_REQUIRED: [
        re.compile(r"사전\s*승인"),
        re.compile(r"승인을\s*받"),
        re.compile(r"협약을\s*변경한\s*후"),
    ],
    RuleType.RECOGNITION_REQUIRED: [
        re.compile(r"인정을\s*받"),
        re.compile(r"인정하는\s*경우"),
    ],
    RuleType.EVIDENCE_REQUIRED: [
        re.compile(r"증명자료"),
        re.compile(r"영수증|회의록|계약서|계획서|결과보고서"),
    ],
    RuleType.DEADLINE: [
        re.compile(r"종료일"),
        re.compile(r"\d+\s*일\s*이내"),
        re.compile(r"\d+\s*개월\s*전"),
        re.compile(r"회계연도\s*종료일까지"),
    ],
    RuleType.EXCEPTION: [
        re.compile(r"다만"),
        re.compile(r"그럼에도\s*불구하고"),
        re.compile(r"제외한다"),
    ],
}


@dataclass
class DocumentNode:
    node_id: str
    node_type: str
    original_text: str
    parent_node_id: str | None = None
    heading: str | None = None
    page_number: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RuleCandidate:
    candidate_id: str
    source_node_ids: list[str]
    candidate_text: str
    detected_types: list[str]
    contains_exception: bool
    cross_references: list[str]
    confidence: float


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def detect_rule_types(text: str) -> list[str]:
    detected: list[str] = []
    for rule_type, patterns in CANDIDATE_PATTERNS.items():
        if any(pattern.search(text) for pattern in patterns):
            detected.append(rule_type.value)
    return detected


def detect_cross_references(text: str) -> list[str]:
    refs = re.findall(
        r"제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?",
        text,
    )
    return list(dict.fromkeys(refs))


def build_candidate(nodes: Iterable[DocumentNode]) -> RuleCandidate | None:
    node_list = list(nodes)
    combined = "\n".join(node.original_text for node in node_list).strip()
    if not combined:
        return None

    detected_types = detect_rule_types(combined)
    if not detected_types:
        return None

    contains_exception = "EXCEPTION" in detected_types
    confidence = 0.75
    if len(node_list) == 1:
        confidence += 0.05
    if detect_cross_references(combined):
        confidence += 0.03
    if contains_exception:
        confidence -= 0.08
    if "FORMULA" in detected_types or re.search(r"계산식", combined):
        confidence -= 0.05

    confidence = max(0.0, min(confidence, 0.99))
    candidate_id = f"CAND-{sha256_text(combined)[:16]}"

    return RuleCandidate(
        candidate_id=candidate_id,
        source_node_ids=[node.node_id for node in node_list],
        candidate_text=combined,
        detected_types=detected_types,
        contains_exception=contains_exception,
        cross_references=detect_cross_references(combined),
        confidence=confidence,
    )


def group_article_context(
    article: DocumentNode,
    children: list[DocumentNode],
) -> list[list[DocumentNode]]:
    """
    실제 구현에서는 항·호·목과 단서를 묶는다.
    단순 문장 분리가 아니라 다음 단위로 후보를 만든다.

    - 본문 항 + 소속 호
    - 본문 규칙 + '다만' 단서
    - 표 제목 + 행 제목 + 열 제목 + 셀 + 각주
    """
    groups: list[list[DocumentNode]] = []
    for child in children:
        groups.append([article, child])
    if not children:
        groups.append([article])
    return groups


def validate_normalized_rule(rule: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    if not rule.get("source_nodes") or not rule.get("source_text"):
        issues.append({
            "code": "VAL_SOURCE_REQUIRED",
            "severity": "BLOCKER",
            "message": "근거 노드와 원문이 필요합니다.",
        })

    limit = rule.get("limit") or {}
    if limit.get("limit_type") == "PERCENT" and not limit.get("basis_code"):
        issues.append({
            "code": "VAL_PERCENT_BASIS_REQUIRED",
            "severity": "BLOCKER",
            "message": "비율 한도에는 기준금액이 필요합니다.",
        })

    result = rule.get("result") or {}
    if (
        rule.get("rule_type") == "RECOGNITION_REQUIRED"
        and result.get("status") == "NOT_ALLOWED"
    ):
        issues.append({
            "code": "VAL_RECOGNITION_NOT_DENY",
            "severity": "BLOCKER",
            "message": "인정 후 가능한 규칙을 단순 불가로 저장할 수 없습니다.",
        })

    if rule.get("rule_type") == "EXCEPTION" and not rule.get("overrides_rule_id"):
        issues.append({
            "code": "VAL_EXCEPTION_LINK",
            "severity": "BLOCKER",
            "message": "예외 규칙은 본문 규칙과 연결되어야 합니다.",
        })

    return issues


def choose_review_status(
    confidence: float,
    issues: list[dict[str, str]],
) -> str:
    if any(issue["severity"] == "BLOCKER" for issue in issues):
        return "EXPERT_REVIEW_REQUIRED"
    if confidence >= 0.92:
        return "AUTO_VALIDATED"
    if confidence >= 0.75:
        return "ADMIN_REVIEW_REQUIRED"
    return "EXPERT_REVIEW_REQUIRED"


class LLMClientProtocol:
    """
    실제 프로젝트의 OpenAI/Anthropic 클라이언트 어댑터가 구현할 인터페이스.
    """

    def extract_json(
        self,
        system_prompt: str,
        input_payload: dict[str, Any],
        output_schema: dict[str, Any],
    ) -> dict[str, Any]:
        raise NotImplementedError


def normalize_candidate_with_llm(
    client: LLMClientProtocol,
    candidate: RuleCandidate,
    standard_categories: list[dict[str, Any]],
    output_schema: dict[str, Any],
    prompt: str,
) -> list[dict[str, Any]]:
    payload = {
        "candidate": {
            "candidate_id": candidate.candidate_id,
            "source_node_ids": candidate.source_node_ids,
            "candidate_text": candidate.candidate_text,
            "detected_types": candidate.detected_types,
            "contains_exception": candidate.contains_exception,
            "cross_references": candidate.cross_references,
        },
        "standard_categories": standard_categories,
    }

    result = client.extract_json(
        system_prompt=prompt,
        input_payload=payload,
        output_schema=output_schema,
    )
    return result.get("rules", [])
