from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class LimitResult:
    limit_code: str
    cap_amount: float | None
    status: str
    message: str


def calculate_limit(limit_rule: dict[str, Any], values: dict[str, float]) -> LimitResult:
    code = limit_rule["limit_code"]

    if code == "EXTERNAL_TECH_40":
        cap = values["direct_cost"] * 0.40
    elif code == "INCENTIVE_20":
        cap = values["modified_labor_cost"] * 0.20
    elif code == "SUBCONTRACT_40":
        base = (
            values["direct_cost"]
            - values.get("subcontract_cost", 0)
            - values.get("international_cost", 0)
            - values.get("rnd_contribution_cost", 0)
        )
        cap = base * 0.40
    elif code == "INDIRECT_FOR_PROFIT_10":
        modified = (
            values["direct_cost"]
            - values.get("in_kind_direct_cost", 0)
            - values.get("subcontract_cost", 0)
            - values.get("international_cost", 0)
            - values.get("rnd_contribution_cost", 0)
        )
        cap = modified * 0.10
    elif limit_rule["limit_type"] in {"FIXED_AMOUNT", "ANNUAL_AVERAGE", "PROCEDURE_THRESHOLD"}:
        cap = float(limit_rule["limit_value"])
    else:
        cap = None

    return LimitResult(
        limit_code=code,
        cap_amount=cap,
        status="CALCULATED" if cap is not None else "CONDITION_CHECK_REQUIRED",
        message=limit_rule.get("ui_summary") or limit_rule["limit_name"],
    )


def apply_override(base_rule: dict[str, Any], overrides: list[dict[str, Any]]) -> dict[str, Any]:
    result = dict(base_rule)
    applicable = sorted(
        (
            item for item in overrides
            if item.get("is_active")
            and item["target_code"] == base_rule.get("limit_code")
        ),
        key=lambda item: item.get("priority", 0),
    )
    for override in applicable:
        if override["override_type"] == "REPLACE":
            result.update(override["override_payload"])
    return result
