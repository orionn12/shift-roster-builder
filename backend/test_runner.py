#!/usr/bin/env python3
"""
Shift roster test runner.
Usage:  python test_runner.py [fixture_path]
Default fixture: fixtures/default.json
"""
from __future__ import annotations

import calendar
import io
import itertools
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))
from app import SolveRequest, solve_roster

OFF_CODES = {"OFF", "PAID", "特休"}


# ── assertion helpers ────────────────────────────────────────────────────────

def check(name: str, passed: bool, detail: str = "") -> dict:
    tag = "PASS" if passed else "FAIL"
    line = f"[{tag}] {name}"
    if detail:
        line += f"  →  {detail}"
    print(line)
    return {"name": name, "passed": passed, "detail": detail}


# ── per-schedule checks ──────────────────────────────────────────────────────

def assert_solver_ok(response) -> list[dict]:
    ok = response.status in ("optimal", "feasible")
    return [check("ソルバー成功", ok, response.message)]


def assert_fixed_date_shifts(request: SolveRequest, schedule) -> list[dict]:
    results = []
    conditions = request.conditions
    for person, day_map in conditions.fixedDateShifts.items():
        violations = []
        for day_str, expected in day_map.items():
            actual = schedule.get(person, {}).get(day_str, "OFF")
            if actual != expected:
                violations.append(f"day {day_str}: expected {expected}, got {actual}")
        results.append(check(
            f"{person} 固定シフト",
            not violations,
            "; ".join(violations[:3]) if violations else f"{len(day_map)}日すべて正常",
        ))
    return results


def assert_max_consecutive(request: SolveRequest, schedule) -> list[dict]:
    results = []
    year, month = map(int, request.month.split("-"))
    _, last_day = calendar.monthrange(year, month)
    days = list(range(1, last_day + 1))
    limit = request.conditions.maxConsecutive

    for person in request.staff:
        psched = schedule.get(person, {})
        work_streaks = [
            sum(1 for _ in g)
            for is_work, g in itertools.groupby(days, key=lambda d: psched.get(str(d), "OFF") not in OFF_CODES)
            if is_work
        ]
        max_run = max(work_streaks, default=0)
        results.append(check(
            f"{person} 最大連勤≤{limit}",
            max_run <= limit,
            f"最大{max_run}日",
        ))
    return results


def assert_min_consecutive_holidays(request: SolveRequest, schedule) -> list[dict]:
    results = []
    min_hol = request.conditions.minConsecutiveHolidays
    if min_hol < 2:
        return results
    year, month = map(int, request.month.split("-"))
    _, last_day = calendar.monthrange(year, month)
    days = list(range(1, last_day + 1))

    for person in request.staff:
        psched = schedule.get(person, {})
        violations: list[str] = []
        off_run = 0
        for i, day in enumerate(days):
            is_off = psched.get(str(day), "OFF") in OFF_CODES
            if is_off:
                off_run += 1
            else:
                if 0 < off_run < min_hol:
                    start = days[i - off_run]
                    end = days[i - 1]
                    violations.append(f"day {start}〜{end}({off_run}日 < {min_hol})")
                off_run = 0
        if 0 < off_run < min_hol:
            violations.append(f"day {days[-off_run]}〜末({off_run}日 < {min_hol})")
        results.append(check(
            f"{person} 最小連休≥{min_hol}",
            not violations,
            "; ".join(violations[:2]) if violations else "OK",
        ))
    return results


def assert_staffing(request: SolveRequest, schedule) -> list[dict]:
    results = []
    year, month_num = map(int, request.month.split("-"))
    _, last_day = calendar.monthrange(year, month_num)
    days = list(range(1, last_day + 1))
    conditions = request.conditions
    holiday_set = set(conditions.holidayDates)

    shortfalls: list[str] = []
    for day in days:
        wd = calendar.weekday(year, month_num, day)
        is_hol = day in holiday_set
        if is_hol:
            need_map = conditions.holidayNeed
        elif wd == 5:
            need_map = conditions.saturdayNeed or conditions.weekendNeed
        elif wd == 6:
            need_map = conditions.sundayNeed or conditions.weekendNeed
        else:
            need_map = conditions.weekdayNeed
        override = conditions.dateNeed.get(day, {})
        for shift_code, need in need_map.items():
            actual_need = override.get(shift_code, need)
            if actual_need == 0:
                continue
            count = sum(
                1 for p in request.staff
                if schedule.get(p, {}).get(str(day)) == shift_code
            )
            if count < actual_need:
                shortfalls.append(f"{day}日 {shift_code}: {count}<{actual_need}")

    results.append(check(
        "人員配置 全日程",
        not shortfalls,
        "; ".join(shortfalls[:5]) if shortfalls else "全勤務区分・全日程で充足",
    ))
    return results


def assert_forbidden_weekday_shifts(request: SolveRequest, schedule) -> list[dict]:
    results = []
    year, month_num = map(int, request.month.split("-"))
    _, last_day = calendar.monthrange(year, month_num)
    days = list(range(1, last_day + 1))
    weekday_names = ["月", "火", "水", "木", "金", "土", "日"]
    conditions = request.conditions

    for person, wd_map in conditions.unavailableWeekdayShifts.items():
        for wd_key, shifts in wd_map.items():
            for shift in shifts:
                violations = [
                    f"day {d}"
                    for d in days
                    if str(calendar.weekday(year, month_num, d)) == wd_key
                    and schedule.get(person, {}).get(str(d)) == shift
                ]
                wd_name = weekday_names[int(wd_key)]
                results.append(check(
                    f"{person} 禁止({wd_name}曜・{shift})",
                    not violations,
                    "; ".join(violations[:3]) if violations else "OK",
                ))
    return results


def assert_transition_breaks(request: SolveRequest, schedule) -> list[dict]:
    results = []
    year, month_num = map(int, request.month.split("-"))
    _, last_day = calendar.monthrange(year, month_num)
    days = list(range(1, last_day + 1))

    pairs = [(p[0], p[1]) for p in request.conditions.requiredTransitionBreaks if len(p) == 2]
    if not pairs:
        return results

    for from_shift, to_shift in pairs:
        violations = []
        for person in request.staff:
            psched = schedule.get(person, {})
            for i in range(len(days) - 1):
                if psched.get(str(days[i])) == from_shift and psched.get(str(days[i + 1])) == to_shift:
                    violations.append(f"{person} day {days[i]}→{days[i+1]}")
        results.append(check(
            f"シフト移行禁止 {from_shift}→{to_shift}",
            not violations,
            "; ".join(violations[:3]) if violations else "OK",
        ))
    return results


def assert_no_non_auto_leakage(request: SolveRequest, schedule) -> list[dict]:
    """非autoシフトが固定外のスタッフに割り当てられていないことを確認する"""
    auto_codes = set(request.conditions.autoShiftCodes)
    violations: list[str] = []
    for person in request.staff:
        # このスタッフに許可された非autoシフト（fixedDateShifts / fixedWeekdayShifts / fixedAssignments）
        allowed_non_auto: set[str] = set()
        for v in request.conditions.fixedDateShifts.get(person, {}).values():
            if v not in auto_codes:
                allowed_non_auto.add(v)
        fw = request.conditions.fixedWeekdayShifts.get(person)
        if fw and fw not in auto_codes:
            allowed_non_auto.add(fw)
        for v in request.fixedAssignments.get(person, {}).values():
            if v not in auto_codes:
                allowed_non_auto.add(v)
        for day_str, code in schedule.get(person, {}).items():
            if code in auto_codes or code in ("OFF", "PAID", "特休"):
                continue
            if code not in allowed_non_auto:
                violations.append(f"{person} day {day_str}: {code}")
    return [check(
        "非autoシフト漏洩なし",
        not violations,
        "; ".join(violations[:5]) if violations else "OK",
    )]


def assert_fixed_assignments(request: SolveRequest, schedule) -> list[dict]:
    """fixedAssignments で指定した日のシフトが保持されているか確認する"""
    results = []
    for person, day_map in request.fixedAssignments.items():
        violations: list[str] = []
        for day_str, expected in day_map.items():
            actual = schedule.get(person, {}).get(day_str, "OFF")
            if actual != expected:
                violations.append(f"day {day_str}: expected {expected}, got {actual}")
        results.append(check(
            f"{person} fixedAssignments",
            not violations,
            "; ".join(violations[:3]) if violations else f"{len(day_map)}日すべて正常",
        ))
    return results


def assert_allowed_shifts(request: SolveRequest, schedule) -> list[dict]:
    """allowedShifts の制限が守られているか確認する。
    各人の自動割り当てシフトは allowedShifts で指定されたコードのみであること。
    OFF/PAID/特休 および fixedDateShifts・fixedAssignments 由来の非autoシフトは許可。
    """
    results = []
    conditions = request.conditions
    auto_codes = set(conditions.autoShiftCodes)
    for person, allowed in conditions.allowedShifts.items():
        allowed_set = set(allowed)
        # fixedDateShifts / fixedAssignments 由来のシフトは対象外
        override_shifts: set[str] = set()
        for v in conditions.fixedDateShifts.get(person, {}).values():
            override_shifts.add(v)
        for v in request.fixedAssignments.get(person, {}).values():
            override_shifts.add(v)
        violations: list[str] = []
        for day_str, code in schedule.get(person, {}).items():
            if code in OFF_CODES or code in override_shifts:
                continue
            # Only check codes that are supposed to be auto-assigned
            if code in auto_codes and code not in allowed_set:
                violations.append(f"day {day_str}: {code} (not in {sorted(allowed_set)})")
        results.append(check(
            f"{person} allowedShifts制限",
            not violations,
            "; ".join(violations[:3]) if violations else f"許可シフト {sorted(allowed_set)} のみ",
        ))
    return results


def assert_coverage_rules(request: SolveRequest, schedule) -> list[dict]:
    """coverageRules の充足を確認する。
    ルールが1つ: すべての条件が毎日満たされること（AND）。
    ルールが複数: 毎日いずれか1つのルールが満たされること（OR）。
    """
    results = []
    conditions = request.conditions
    if not conditions.coverageRules:
        return results

    year, month_num = map(int, request.month.split("-"))
    _, last_day = calendar.monthrange(year, month_num)
    days = list(range(1, last_day + 1))

    # Build attribute -> person index set
    attr_to_persons: dict[str, set[str]] = {}
    for person, attr in conditions.staffAttributes.items():
        if attr:
            attr_to_persons.setdefault(attr, set()).add(person)
    # Also include leaderGroup / subLeaderGroup / newcomerGroup
    for person in conditions.leaderGroup:
        attr_to_persons.setdefault("リーダー", set()).add(person)
    for person in conditions.subLeaderGroup:
        attr_to_persons.setdefault("サブリーダー", set()).add(person)
    for person in conditions.newcomerGroup:
        attr_to_persons.setdefault("新人", set()).add(person)

    def rule_satisfied(rule_conditions: list[dict], day: int) -> bool:
        """Returns True iff ALL conditions in a rule are met for the given day."""
        for cond in rule_conditions:
            attr = str(cond.get("attribute", "")).strip()
            needed = int(cond.get("count") or 0)
            if not attr or needed <= 0:
                continue
            members = attr_to_persons.get(attr, set())
            working = sum(
                1 for p in members
                if schedule.get(p, {}).get(str(day), "OFF") not in OFF_CODES
            )
            if working < needed:
                return False
        return True

    violations: list[str] = []
    for day in days:
        weekday = calendar.weekday(year, month_num, day)
        applicable = []
        for rule in conditions.coverageRules:
            day_type = str(rule.get("dayType", "all") or "all")
            if day_type == "weekday" and weekday >= 5:
                continue
            if day_type == "weekendHoliday" and weekday < 5:
                continue
            applicable.append(rule.get("conditions", []))
        if not applicable:
            continue
        if len(applicable) == 1:
            if not rule_satisfied(applicable[0], day):
                violations.append(f"day {day}: rule not satisfied")
        else:
            if not any(rule_satisfied(rc, day) for rc in applicable):
                violations.append(f"day {day}: no rule satisfied (OR)")

    results.append(check(
        "coverageRules 充足",
        not violations,
        "; ".join(violations[:5]) if violations else "全日程でルール充足",
    ))
    return results


def assert_forced_off_dates(request: SolveRequest, schedule) -> list[dict]:
    """forcedOffDates で指定した日が OFF/PAID/特休 になっているか確認する"""
    results = []
    conditions = request.conditions
    if not conditions.forcedOffDates:
        results.append(check("forcedOffDates (空)", True, "設定なし・自明合格"))
        return results
    for person, off_days in conditions.forcedOffDates.items():
        violations: list[str] = []
        for day in off_days:
            actual = schedule.get(person, {}).get(str(day), "OFF")
            if actual not in OFF_CODES:
                violations.append(f"day {day}: {actual}")
        results.append(check(
            f"{person} forcedOffDates",
            not violations,
            "; ".join(violations[:3]) if violations else f"{len(off_days)}日すべてOFF/PAID/特休",
        ))
    return results


def assert_forbidden_always_shifts(request: SolveRequest, schedule) -> list[dict]:
    """forbiddenAlwaysShifts で禁止されたシフトが割り当てられていないか確認する"""
    results = []
    conditions = request.conditions
    if not conditions.forbiddenAlwaysShifts:
        results.append(check("forbiddenAlwaysShifts (空)", True, "設定なし・自明合格"))
        return results
    for person, forbidden in conditions.forbiddenAlwaysShifts.items():
        forbidden_set = set(forbidden)
        violations: list[str] = []
        for day_str, code in schedule.get(person, {}).items():
            if code in forbidden_set:
                violations.append(f"day {day_str}: {code}")
        results.append(check(
            f"{person} forbiddenAlwaysShifts",
            not violations,
            "; ".join(violations[:3]) if violations else f"禁止シフト {sorted(forbidden_set)} 未使用",
        ))
    return results


# ── main ─────────────────────────────────────────────────────────────────────

def run(fixture_path: str) -> bool:
    print(f"Fixture: {fixture_path}")
    with open(fixture_path, encoding="utf-8") as f:
        data = json.load(f)

    request = SolveRequest.model_validate(data)
    print(f"Staff {len(request.staff)}名  Month {request.month}  Solving...\n")

    response = solve_roster(request)
    print(f"Status: {response.status} - {response.message}\n")

    schedule = response.schedule

    results: list[dict] = []
    results += assert_solver_ok(response)

    if response.status in ("optimal", "feasible"):
        results += assert_fixed_date_shifts(request, schedule)
        results += assert_max_consecutive(request, schedule)
        results += assert_min_consecutive_holidays(request, schedule)
        results += assert_staffing(request, schedule)
        results += assert_forbidden_weekday_shifts(request, schedule)
        results += assert_transition_breaks(request, schedule)
        results += assert_no_non_auto_leakage(request, schedule)
        results += assert_fixed_assignments(request, schedule)
        results += assert_allowed_shifts(request, schedule)
        results += assert_coverage_rules(request, schedule)
        results += assert_forced_off_dates(request, schedule)
        results += assert_forbidden_always_shifts(request, schedule)

    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    failures = [r for r in results if not r["passed"]]

    print(f"\n{'='*60}")
    print(f"Results: {passed}/{total} passed")

    if failures:
        print(f"\nFailed ({len(failures)}):")
        for r in failures:
            print(f"  ✗ {r['name']}: {r['detail']}")
        return False

    print("All assertions passed!")
    return True


if __name__ == "__main__":
    fixture = sys.argv[1] if len(sys.argv) > 1 else "fixtures/default.json"
    ok = run(fixture)
    sys.exit(0 if ok else 1)
