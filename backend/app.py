from __future__ import annotations

import calendar
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field


class ShiftDefinition(BaseModel):
    code: str
    time: str = ""
    auto: bool = True


class Conditions(BaseModel):
    shifts: dict[str, ShiftDefinition] = Field(default_factory=dict)
    weekdayNeed: dict[str, int] = Field(default_factory=dict)
    saturdayNeed: dict[str, int] = Field(default_factory=dict)
    sundayNeed: dict[str, int] = Field(default_factory=dict)
    holidayNeed: dict[str, int] = Field(default_factory=dict)
    weekendNeed: dict[str, int] = Field(default_factory=dict)
    dailyNeed: dict[str, int] = Field(default_factory=dict)
    maxConsecutive: int = 5
    minConsecutiveHolidays: int = 0
    mustOneGroups: list[list[str]] = Field(default_factory=list)
    sameShiftGroups: list[list[str]] = Field(default_factory=list)
    targetWorkDays: int | None = None
    targetWorkDaysByPerson: dict[str, int] = Field(default_factory=dict)
    fixedWeekdayShifts: dict[str, str] = Field(default_factory=dict)
    fixedDateShifts: dict[str, dict[str, str]] = Field(default_factory=dict)
    allowedShifts: dict[str, list[str]] = Field(default_factory=dict)
    forbiddenAlwaysShifts: dict[str, list[str]] = Field(default_factory=dict)
    forcedOffDates: dict[str, list[int]] = Field(default_factory=dict)
    unavailableWeekdayShifts: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    requiredTransitionBreaks: list[list[str]] = Field(default_factory=list)
    autoShiftCodes: list[str] = Field(default_factory=list)
    holidayDates: list[int] = Field(default_factory=list)
    dateNeed: dict[int, dict[str, int]] = Field(default_factory=dict)
    preferConsecutiveHolidays: bool = False
    preferSameShiftStreaks: bool = False
    leaderGroup: list[str] = Field(default_factory=list)
    subLeaderGroup: list[str] = Field(default_factory=list)
    newcomerGroup: list[str] = Field(default_factory=list)
    requireLeadershipCoverage: bool = False
    preferLeader: bool = False
    coverageRules: list[dict[str, Any]] = Field(default_factory=list)
    staffAttributes: dict[str, str] = Field(default_factory=dict)
    excludedAttributes: list[str] = Field(default_factory=list)


class PreviousTail(BaseModel):
    lastShift: str = "OFF"
    consecutiveWorkDays: int = 0


class SolveRequest(BaseModel):
    staff: list[str]
    month: str
    conditions: Conditions
    previousMonthTail: dict[str, PreviousTail] = Field(default_factory=dict)
    fixedAssignments: dict[str, dict[str, str]] = Field(default_factory=dict)


class SolveResponse(BaseModel):
    status: str
    message: str
    report: dict[str, Any] = Field(default_factory=dict)
    schedule: dict[str, dict[str, str]] = Field(default_factory=dict)


class ValidateRequest(SolveRequest):
    schedule: dict[str, dict[str, str]]


@dataclass(frozen=True)
class MonthInfo:
    year: int
    month: int
    days: list[int]


app = FastAPI(title="Shift Roster Builder Solver")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/solve", response_model=SolveResponse)
def solve_roster(request: SolveRequest) -> SolveResponse:
    month_info = parse_month(request.month)
    staff = request.staff
    conditions = request.conditions
    holiday_set = set(conditions.holidayDates)

    # auto=True のシフトのみを auto_shifts の基本セットとする
    auto_shift_set = {shift.code for shift in conditions.shifts.values() if shift.auto}
    if conditions.targetWorkDays is not None:
        for filler_shift in ("常勤", "日勤"):
            if filler_shift in conditions.shifts:
                auto_shift_set.add(filler_shift)
    auto_shift_set.update(conditions.fixedWeekdayShifts.values())
    for allowed in conditions.allowedShifts.values():
        auto_shift_set.update(allowed)
    # fixedDateShifts に含まれる非autoシフトも auto_shifts に追加する（そのスタッフのみで使用）
    for day_shifts in conditions.fixedDateShifts.values():
        auto_shift_set.update(day_shifts.values())
    # fixedAssignments に含まれる非autoシフトも auto_shifts に追加する（そのスタッフのみで使用）
    for day_shifts in request.fixedAssignments.values():
        auto_shift_set.update(day_shifts.values())
    auto_shifts = sorted(shift for shift in auto_shift_set if shift in conditions.shifts)
    # 非autoシフトのセット（per-personの allowed 計算に使用）
    non_auto_shifts = {code for code in auto_shifts if not conditions.shifts[code].auto}
    previous_tail = request.previousMonthTail

    if not staff:
        return SolveResponse(
            status="error",
            message="スタッフが登録されていません。",
            report=failure_report("スタッフが登録されていないため、勤務表を作成できませんでした。"),
        )
    if not auto_shifts:
        return SolveResponse(
            status="error",
            message="自動割当する勤務区分がありません。",
            report=failure_report("自由条件から自動割当する勤務区分を読み取れませんでした。"),
        )

    model = cp_model.CpModel()
    x: dict[tuple[int, int, str], cp_model.IntVar] = {}
    work_day: dict[tuple[int, int], cp_model.IntVar] = {}

    for person_index, _person in enumerate(staff):
        for day in month_info.days:
            work_day[(person_index, day)] = model.NewBoolVar(f"work_{person_index}_{day}")
            for shift_code in auto_shifts:
                x[(person_index, day, shift_code)] = model.NewBoolVar(
                    f"x_{person_index}_{day}_{shift_code}",
                )

    for person_index, person in enumerate(staff):
        # 非autoシフトはその人の fixedDateShifts / fixedWeekdayShifts にあるものだけ許可
        person_allowed_non_auto = set()
        for v in conditions.fixedDateShifts.get(person, {}).values():
            if v in non_auto_shifts:
                person_allowed_non_auto.add(v)
        fw = conditions.fixedWeekdayShifts.get(person)
        if fw and fw in non_auto_shifts:
            person_allowed_non_auto.add(fw)
        # fixedAssignments にある非autoシフトも許可
        for v in request.fixedAssignments.get(person, {}).values():
            if v in non_auto_shifts:
                person_allowed_non_auto.add(v)
        base_allowed = set(conditions.allowedShifts.get(person, auto_shifts))
        # 非autoシフトのうちこの人に許可されていないものを除外
        allowed = {s for s in base_allowed if s not in non_auto_shifts or s in person_allowed_non_auto}
        fixed_weekday_shift = conditions.fixedWeekdayShifts.get(person)
        fixed_date_shifts = {int(k): v for k, v in conditions.fixedDateShifts.get(person, {}).items()}
        person_fixed_assignments = {int(k): v for k, v in request.fixedAssignments.get(person, {}).items()}
        forbidden_always = set(conditions.forbiddenAlwaysShifts.get(person, []))
        forced_off_dates = set(conditions.forcedOffDates.get(person, []))
        unavailable_by_weekday = conditions.unavailableWeekdayShifts.get(person, {})

        for day in month_info.days:
            work_vars = [x[(person_index, day, shift_code)] for shift_code in auto_shifts]
            model.Add(sum(work_vars) <= 1)
            model.Add(work_day[(person_index, day)] == sum(work_vars))

            # fixedAssignments: PAID/特休/手動シフト → ソルバーは触らない (OFF扱い)
            if day in person_fixed_assignments:
                model.Add(sum(work_vars) == 0)
                continue

            # Forced off on specific dates
            if day in forced_off_dates:
                model.Add(sum(work_vars) == 0)
                continue

            for shift_code in auto_shifts:
                # Allowed shifts filter
                if shift_code not in allowed:
                    model.Add(x[(person_index, day, shift_code)] == 0)
                # Always forbidden shifts
                if shift_code in forbidden_always:
                    model.Add(x[(person_index, day, shift_code)] == 0)
                # Weekday-specific forbidden shifts
                weekday_key = str(calendar.weekday(month_info.year, month_info.month, day))
                if shift_code in unavailable_by_weekday.get(weekday_key, []):
                    model.Add(x[(person_index, day, shift_code)] == 0)

            # fixedDateShifts: explicit per-day assignment (highest priority)
            if day in fixed_date_shifts:
                target_shift = fixed_date_shifts[day]
                if target_shift in auto_shifts:
                    model.Add(x[(person_index, day, target_shift)] == 1)
            elif fixed_weekday_shift and fixed_weekday_shift in auto_shifts:
                # Fallback: fixedWeekdayShifts for weekdays not covered by fixedDateShifts
                weekday = calendar.weekday(month_info.year, month_info.month, day)
                if weekday < 5 and day not in holiday_set:
                    model.Add(x[(person_index, day, fixed_weekday_shift)] == 1)

        person_target_work_days = conditions.targetWorkDaysByPerson.get(person, conditions.targetWorkDays)
        if person_target_work_days is not None:
            target = max(0, person_target_work_days)
            model.Add(
                sum(
                    x[(person_index, day, shift_code)]
                    for day in month_info.days
                    for shift_code in auto_shifts
                )
                == target,
            )

    # Daily staffing needs
    staffing_count_indexes = [
        index
        for index, person in enumerate(staff)
        if conditions.staffAttributes.get(person, "") not in set(conditions.excludedAttributes)
    ]
    for day in month_info.days:
        weekday = calendar.weekday(month_info.year, month_info.month, day)
        is_holiday = day in holiday_set
        for shift_code in auto_shifts:
            needed = needed_staff_count(month_info, day, shift_code, conditions, weekday, is_holiday)
            needed = conditions.dateNeed.get(day, {}).get(shift_code, needed)
            model.Add(sum(x[(person_index, day, shift_code)] for person_index in staffing_count_indexes) >= needed)

    # Leadership coverage
    if conditions.requireLeadershipCoverage:
        staff_index = {person: index for index, person in enumerate(staff)}
        leader_indexes = [staff_index[person] for person in conditions.leaderGroup if person in staff_index]
        sub_indexes = [staff_index[person] for person in conditions.subLeaderGroup if person in staff_index]
        for day in month_info.days:
            leader_work = sum(
                x[(person_index, day, shift_code)]
                for person_index in leader_indexes
                for shift_code in auto_shifts
            )
            sub_work = sum(
                x[(person_index, day, shift_code)]
                for person_index in sub_indexes
                for shift_code in auto_shifts
            )
            if sub_indexes:
                model.Add(sub_work >= 1)
            if leader_indexes or sub_indexes:
                model.Add(leader_work + sub_work >= 2)

    # Coverage rules (attribute-based)
    if conditions.coverageRules:
        generic_groups: dict[str, list[int]] = {}
        for index, person in enumerate(staff):
            attribute = conditions.staffAttributes.get(person, "")
            if attribute:
                generic_groups.setdefault(attribute, []).append(index)
        generic_groups.setdefault("リーダー", [index for index, person in enumerate(staff) if person in conditions.leaderGroup])
        generic_groups.setdefault("サブリーダー", [index for index, person in enumerate(staff) if person in conditions.subLeaderGroup])
        generic_groups.setdefault("新人", [index for index, person in enumerate(staff) if person in conditions.newcomerGroup])

        # Pre-parse all rules into (day_type, groups_and_counts) tuples
        parsed_rules: list[tuple[str, list[tuple[list[int], int]]]] = []
        for rule in conditions.coverageRules:
            cond_list = rule.get("conditions", [])
            day_type = str(rule.get("dayType", "all") or "all")
            groups_and_counts: list[tuple[list[int], int]] = []
            for cond in cond_list:
                attr = str(cond.get("attribute", "")).strip()
                count = int(cond.get("count") or 0)
                if attr and count > 0:
                    groups_and_counts.append((generic_groups.get(attr, []), count))
            if groups_and_counts:
                parsed_rules.append((day_type, groups_and_counts))

        for day in month_info.days:
            weekday = calendar.weekday(month_info.year, month_info.month, day)
            # Collect applicable rules for this day
            applicable: list[list[tuple[list[int], int]]] = []
            for day_type, groups_and_counts in parsed_rules:
                if day_type == "weekday" and weekday >= 5:
                    continue
                if day_type == "weekendHoliday" and weekday < 5:
                    continue
                applicable.append(groups_and_counts)
            if not applicable:
                continue
            if len(applicable) == 1:
                # Single rule: apply as hard AND constraints
                for group_indexes, min_count in applicable[0]:
                    if not group_indexes:
                        continue
                    group_work = sum(
                        x[(person_index, day, shift_code)]
                        for person_index in group_indexes
                        for shift_code in auto_shifts
                    )
                    model.Add(group_work >= min_count)
            else:
                # Multiple rules: OR logic — at least one rule must be fully satisfied
                rule_bools = []
                for ridx, rule_conditions in enumerate(applicable):
                    rb = model.NewBoolVar(f"rule_ok_{day}_{ridx}")
                    rule_bools.append(rb)
                    for group_indexes, min_count in rule_conditions:
                        if not group_indexes:
                            # This rule can never be satisfied
                            model.Add(rb == 0)
                        else:
                            group_work = sum(
                                x[(person_index, day, shift_code)]
                                for person_index in group_indexes
                                for shift_code in auto_shifts
                            )
                            model.Add(group_work >= min_count).OnlyEnforceIf(rb)
                model.AddBoolOr(rule_bools)

    # Max consecutive work days
    max_consecutive = max(1, conditions.maxConsecutive)
    for person_index in range(len(staff)):
        for start_idx in range(len(month_info.days) - max_consecutive):
            window = month_info.days[start_idx:start_idx + max_consecutive + 1]
            model.Add(
                sum(
                    x[(person_index, day, shift_code)]
                    for day in window
                    for shift_code in auto_shifts
                )
                <= max_consecutive,
            )

    # Min consecutive holidays (no isolated OFF days)
    min_holidays = conditions.minConsecutiveHolidays
    if min_holidays >= 2:
        for person_index, person in enumerate(staff):
            # Mid-month: forbid OFF runs shorter than min_holidays
            for j in range(1, min_holidays):
                for i in range(len(month_info.days) - j - 1):
                    d_start = month_info.days[i]
                    d_end = month_info.days[i + j + 1]
                    mid_work = sum(
                        work_day[(person_index, month_info.days[i + l])]
                        for l in range(1, j + 1)
                    )
                    # Forbid: work[d_start]=1 AND all mid=OFF AND work[d_end]=1
                    model.Add(
                        work_day[(person_index, d_start)]
                        - mid_work
                        + work_day[(person_index, d_end)]
                        <= 1
                    )
            # Month-start boundary: if previous month ended with work (or unknown),
            # an OFF run starting at day 1 must extend at least min_holidays days.
            tail = previous_tail.get(person)
            prev_was_working = (
                tail is None
                or tail.consecutiveWorkDays > 0
                or tail.lastShift not in ("OFF", "PAID", "特休", "")
            )
            if prev_was_working:
                for j in range(1, min_holidays):
                    if j < len(month_info.days):
                        # If all of days[0..j-1] are OFF, day[j] must also be OFF
                        # work[day[j]] <= sum(work[day[0..j-1]])
                        model.Add(
                            work_day[(person_index, month_info.days[j])]
                            <= sum(work_day[(person_index, month_info.days[k])] for k in range(j))
                        )
            # Month-end boundary: assume next month starts with work (conservative),
            # so an OFF run ending at month-end must be >= min_holidays days.
            for j in range(1, min_holidays):
                if j + 1 <= len(month_info.days):
                    # If days[-(j+1)] is working, at least one of days[-j:] must be working
                    # (prevents isolated OFF run of length j at month end)
                    model.Add(
                        work_day[(person_index, month_info.days[-(j + 1)])]
                        <= sum(work_day[(person_index, month_info.days[-k])] for k in range(1, j + 1))
                    )

    # Previous month tail (max consecutive rollover)
    for person_index, person in enumerate(staff):
        tail = previous_tail.get(person)
        if not tail:
            continue
        previous_count = min(max_consecutive, max(0, tail.consecutiveWorkDays))
        if previous_count <= 0:
            continue
        limited_days = min(len(month_info.days), max_consecutive - previous_count + 1)
        if limited_days > 0:
            model.Add(
                sum(
                    x[(person_index, day, shift_code)]
                    for day in month_info.days[:limited_days]
                    for shift_code in auto_shifts
                )
                <= max_consecutive - previous_count,
            )

    # Required shift transition breaks (e.g., no C→A on consecutive days)
    break_pairs = {(pair[0], pair[1]) for pair in conditions.requiredTransitionBreaks if len(pair) == 2}
    for from_shift, to_shift in break_pairs:
        if from_shift not in auto_shifts or to_shift not in auto_shifts:
            continue
        for person_index in range(len(staff)):
            for i in range(len(month_info.days) - 1):
                day = month_info.days[i]
                next_day = month_info.days[i + 1]
                model.Add(x[(person_index, day, from_shift)] + x[(person_index, next_day, to_shift)] <= 1)

    staff_index = {person: index for index, person in enumerate(staff)}

    for group in conditions.mustOneGroups:
        group_indexes = [staff_index[person] for person in group if person in staff_index]
        if not group_indexes:
            continue
        for day in month_info.days:
            model.Add(
                sum(
                    x[(person_index, day, shift_code)]
                    for person_index in group_indexes
                    for shift_code in auto_shifts
                )
                >= 1,
            )

    for group in conditions.sameShiftGroups:
        group_indexes = [staff_index[person] for person in group if person in staff_index]
        if len(group_indexes) < 2:
            continue
        anchor = group_indexes[0]
        for person_index in group_indexes[1:]:
            for day in month_info.days:
                for shift_code in auto_shifts:
                    model.Add(x[(person_index, day, shift_code)] == x[(anchor, day, shift_code)])

    # Objective: minimize work-day imbalance + shift distribution imbalance
    total_work_vars: list[cp_model.IntVar] = []
    shift_range_vars: list[cp_model.IntVar] = []
    transition_vars: list[cp_model.IntVar] = []
    shift_change_vars: list[cp_model.IntVar] = []

    for person_index, _person in enumerate(staff):
        total = model.NewIntVar(0, len(month_info.days), f"total_{person_index}")
        model.Add(total == sum(work_day[(person_index, day)] for day in month_info.days))
        total_work_vars.append(total)

        for day in month_info.days[:-1]:
            transition = model.NewBoolVar(f"transition_{person_index}_{day}")
            model.AddAbsEquality(transition, work_day[(person_index, day)] - work_day[(person_index, day + 1)])
            transition_vars.append(transition)
            for shift_code in auto_shifts:
                change = model.NewBoolVar(f"shift_change_{person_index}_{day}_{shift_code}")
                model.AddAbsEquality(change, x[(person_index, day, shift_code)] - x[(person_index, day + 1, shift_code)])
                shift_change_vars.append(change)

    balance_total_vars = [
        total
        for person, total in zip(staff, total_work_vars, strict=True)
        if is_workload_balance_eligible(person, conditions)
    ] or total_work_vars
    max_total = model.NewIntVar(0, len(month_info.days), "max_total")
    min_total = model.NewIntVar(0, len(month_info.days), "min_total")
    model.AddMaxEquality(max_total, balance_total_vars)
    model.AddMinEquality(min_total, balance_total_vars)

    for shift_code in auto_shifts:
        shift_totals: list[cp_model.IntVar] = []
        for person_index in range(len(staff)):
            if not is_shift_balance_eligible(staff[person_index], shift_code, conditions):
                continue
            total = model.NewIntVar(0, len(month_info.days), f"total_{person_index}_{shift_code}")
            model.Add(total == sum(x[(person_index, day, shift_code)] for day in month_info.days))
            shift_totals.append(total)
        if len(shift_totals) < 2:
            continue
        shift_max = model.NewIntVar(0, len(month_info.days), f"max_{shift_code}")
        shift_min = model.NewIntVar(0, len(month_info.days), f"min_{shift_code}")
        model.AddMaxEquality(shift_max, shift_totals)
        model.AddMinEquality(shift_min, shift_totals)
        diff = model.NewIntVar(0, len(month_info.days), f"range_{shift_code}")
        model.Add(diff == shift_max - shift_min)
        shift_range_vars.append(diff)

    transition_weight = 2 if conditions.preferConsecutiveHolidays else 0
    shift_change_weight = 1 if conditions.preferSameShiftStreaks else 0
    model.Minimize(
        (max_total - min_total) * 100
        + sum(shift_range_vars) * 80
        + sum(transition_vars) * transition_weight
        + sum(shift_change_vars) * shift_change_weight
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 15
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = 1
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResponse(
            status="infeasible",
            message="条件をすべて満たす勤務表が見つかりませんでした。必要人数、有給、同一勤務、最大連勤を少し緩めてください。",
            report=build_infeasible_report(staff, month_info, conditions, auto_shifts),
        )

    schedule: dict[str, dict[str, str]] = {}
    for person_index, person in enumerate(staff):
        fixed_date_shifts = {int(k): v for k, v in conditions.fixedDateShifts.get(person, {}).items()}
        person_fixed_assignments = {int(k): v for k, v in request.fixedAssignments.get(person, {}).items()}
        schedule[person] = {}
        for day in month_info.days:
            if day in person_fixed_assignments:
                # fixedAssignments は絶対厳守（PAID・特休・手動シフト）
                assigned = person_fixed_assignments[day]
            elif day in fixed_date_shifts and fixed_date_shifts[day] not in auto_shifts:
                # Fixed shift not in solver domain: assign directly
                assigned = fixed_date_shifts[day]
            else:
                assigned = "OFF"
                for shift_code in auto_shifts:
                    if solver.Value(x[(person_index, day, shift_code)]) == 1:
                        assigned = shift_code
                        break
            schedule[person][str(day)] = assigned

    return SolveResponse(
        status="optimal" if status == cp_model.OPTIMAL else "feasible",
        message="CP-SATで勤務表を作成しました。",
        report=build_success_report(
            schedule,
            month_info,
            auto_shifts,
            status == cp_model.OPTIMAL,
            previous_tail,
            conditions,
        ),
        schedule=schedule,
    )


@app.post("/api/validate")
def validate_roster(request: ValidateRequest) -> dict[str, Any]:
    month_info = parse_month(request.month)
    auto_shifts = sorted(
        shift.code
        for shift in request.conditions.shifts.values()
        if shift.auto or shift.code in request.conditions.autoShiftCodes
    )
    diagnostics = assess_schedule_quality(
        request.schedule,
        request.staff,
        month_info,
        request.conditions,
        auto_shifts,
        request.previousMonthTail,
    )
    return {
        "status": "valid" if not diagnostics["hardViolations"] else "needs_review",
        "diagnostics": diagnostics,
    }


def parse_month(month_value: str) -> MonthInfo:
    year_text, month_text = month_value.split("-")
    year = int(year_text)
    month = int(month_text)
    _, last_day = calendar.monthrange(year, month)
    return MonthInfo(year=year, month=month, days=list(range(1, last_day + 1)))


def needed_staff_count(
    month_info: MonthInfo,
    day: int,
    shift_code: str,
    conditions: Conditions,
    weekday: int | None = None,
    is_holiday: bool = False,
) -> int:
    if weekday is None:
        weekday = calendar.weekday(month_info.year, month_info.month, day)
    if is_holiday:
        return conditions.holidayNeed.get(
            shift_code,
            conditions.weekendNeed.get(shift_code, conditions.dailyNeed.get(shift_code, 0)),
        )
    if weekday == 5:  # Saturday
        return conditions.saturdayNeed.get(
            shift_code,
            conditions.weekendNeed.get(shift_code, conditions.dailyNeed.get(shift_code, 0)),
        )
    if weekday == 6:  # Sunday
        return conditions.sundayNeed.get(
            shift_code,
            conditions.weekendNeed.get(shift_code, conditions.dailyNeed.get(shift_code, 0)),
        )
    return conditions.weekdayNeed.get(shift_code, conditions.dailyNeed.get(shift_code, 0))


def is_shift_balance_eligible(person: str, shift_code: str, conditions: Conditions) -> bool:
    if shift_code in set(conditions.forbiddenAlwaysShifts.get(person, [])):
        return False
    allowed = conditions.allowedShifts.get(person)
    if allowed is not None and shift_code not in set(allowed):
        return False
    fixed_weekday = conditions.fixedWeekdayShifts.get(person)
    if fixed_weekday:
        return False
    fixed_dates = set(conditions.fixedDateShifts.get(person, {}).values())
    if fixed_dates and fixed_dates != {shift_code}:
        return False
    return True


def is_workload_balance_eligible(person: str, conditions: Conditions) -> bool:
    return not conditions.fixedWeekdayShifts.get(person)


def failure_report(summary: str) -> dict[str, Any]:
    return {
        "title": "作成できませんでした",
        "summary": summary,
        "warnings": [],
        "suggestions": ["スタッフまたは勤務区分の条件を確認してください。"],
        "stats": {},
    }


def build_infeasible_report(
    staff: list[str],
    month_info: MonthInfo,
    conditions: Conditions,
    auto_shifts: list[str],
) -> dict[str, Any]:
    warnings: list[str] = []
    suggestions: list[str] = []

    for day in month_info.days:
        unavailable = {
            person
            for person in staff
            if day in set(conditions.forcedOffDates.get(person, []))
        }
        available_count = len(staff) - len(unavailable)
        weekday = calendar.weekday(month_info.year, month_info.month, day)
        is_holiday = day in set(conditions.holidayDates)
        needed_total = sum(
            needed_staff_count(month_info, day, shift, conditions, weekday, is_holiday)
            for shift in auto_shifts
        )
        if needed_total > available_count:
            warnings.append(f"{day}日は必要人数{needed_total}人に対して、配置可能人数が{available_count}人です。")

    if not warnings:
        warnings.append("必要人数、有給、最大連勤、同一勤務、必ず1人のいずれかが同時に満たせない可能性があります。")

    suggestions.extend(
        [
            "必要人数を一部減らす",
            "最大連勤を少し増やす",
            "同一勤務や必ず1人の条件を一部緩める",
            "同じ日に集中している有給指定を見直す",
        ],
    )

    return {
        "title": "作成できませんでした",
        "summary": "CP-SATで解を探索しましたが、すべての条件を満たす勤務表は見つかりませんでした。",
        "warnings": warnings[:8],
        "suggestions": suggestions,
        "stats": {
            "staffCount": len(staff),
            "autoShiftCount": len(auto_shifts),
        },
    }


def build_success_report(
    schedule: dict[str, dict[str, str]],
    month_info: MonthInfo,
    auto_shifts: list[str],
    is_optimal: bool,
    previous_tail: dict[str, PreviousTail],
    conditions: Conditions,
) -> dict[str, Any]:
    work_counts: dict[str, int] = {}
    shift_counts: dict[str, dict[str, int]] = {}
    paid_count = 0

    for person, assignments in schedule.items():
        work_counts[person] = 0
        shift_counts[person] = {shift: 0 for shift in auto_shifts}
        for code in assignments.values():
            if code == "PAID":
                paid_count += 1
            elif code not in ("OFF", "特休"):
                work_counts[person] += 1
                if code in shift_counts[person]:
                    shift_counts[person][code] += 1

    min_work = min(work_counts.values()) if work_counts else 0
    max_work = max(work_counts.values()) if work_counts else 0
    warnings: list[str] = []

    if max_work - min_work >= 3:
        warnings.append(f"勤務日数に最大{max_work - min_work}日の差があります。")

    for shift in auto_shifts:
        counts = {person: shifts[shift] for person, shifts in shift_counts.items()}
        if not counts:
            continue
        min_shift = min(counts.values())
        max_shift = max(counts.values())
        if max_shift - min_shift >= 3:
            heavy = [person for person, count in counts.items() if count == max_shift]
            warnings.append(f"{shift}勤務は{', '.join(heavy[:3])}にやや多めです。")

    if not warnings:
        warnings.append("大きな偏りは検出されませんでした。")

    inherited_count = sum(
        1
        for tail in previous_tail.values()
        if tail.lastShift not in ("", "OFF", "PAID") or tail.consecutiveWorkDays > 0
    )
    if inherited_count:
        warnings.append(f"前月末の勤務情報を{inherited_count}人分参照しました。")

    diagnostics = assess_schedule_quality(
        schedule,
        list(schedule.keys()),
        month_info,
        conditions,
        auto_shifts,
        previous_tail,
    )
    warnings.extend(diagnostics["warnings"])

    return {
        "title": "作成できました",
        "summary": "必要人数、有給、最大連勤などの条件を満たす勤務表を作成しました。",
        "warnings": warnings,
        "suggestions": diagnostics["suggestions"] if diagnostics["suggestions"] else ([] if is_optimal else ["最適解ではなく実行可能解です。条件を少し緩めるとより公平な表になる可能性があります。"]),
        "stats": {
            "solverStatus": "optimal" if is_optimal else "feasible",
            "staffCount": len(schedule),
            "days": len(month_info.days),
            "paidCount": paid_count,
            "minWorkDays": min_work,
            "maxWorkDays": max_work,
            "qualityScore": diagnostics["score"],
            "hardViolationCount": len(diagnostics["hardViolations"]),
            "softIssueCount": len(diagnostics["softIssues"]),
        },
        "quality": diagnostics,
        "agentContext": {
            "purpose": "Machine-readable roster diagnostics for iterative solver tuning.",
            "month": f"{month_info.year}-{month_info.month:02d}",
            "autoShifts": auto_shifts,
            "workloadByPerson": work_counts,
            "shiftCountsByPerson": shift_counts,
            "nextActions": diagnostics["suggestions"],
        },
    }


def assess_schedule_quality(
    schedule: dict[str, dict[str, str]],
    staff: list[str],
    month_info: MonthInfo,
    conditions: Conditions,
    auto_shifts: list[str],
    previous_tail: dict[str, PreviousTail] | None = None,
) -> dict[str, Any]:
    off_codes = {"OFF", "PAID", "特休", "迚ｹ莨・"}
    previous_tail = previous_tail or {}
    hard_violations: list[dict[str, Any]] = []
    soft_issues: list[dict[str, Any]] = []
    suggestions: list[str] = []
    warnings: list[str] = []
    day_summaries: dict[str, Any] = {}

    def code_for(person: str, day: int) -> str:
        return schedule.get(person, {}).get(str(day), "OFF")

    def is_work(code: str) -> bool:
        return code not in off_codes

    for person in staff:
        assignments = schedule.get(person, {})
        missing = [day for day in month_info.days if str(day) not in assignments]
        if missing:
            hard_violations.append({
                "type": "missing_assignment",
                "person": person,
                "days": missing,
                "message": f"{person} has missing assignments: {missing[:5]}",
            })

    holiday_set = set(conditions.holidayDates)
    excluded_attributes = set(conditions.excludedAttributes)
    staffing_count_staff = [
        person
        for person in staff
        if conditions.staffAttributes.get(person, "") not in excluded_attributes
    ]
    for day in month_info.days:
        weekday = calendar.weekday(month_info.year, month_info.month, day)
        is_holiday = day in holiday_set
        shift_counts = {
            shift: sum(1 for person in staffing_count_staff if code_for(person, day) == shift)
            for shift in auto_shifts
        }
        needed = {
            shift: conditions.dateNeed.get(day, {}).get(
                shift,
                needed_staff_count(month_info, day, shift, conditions, weekday, is_holiday),
            )
            for shift in auto_shifts
        }
        shortfalls = {
            shift: {"actual": shift_counts[shift], "needed": need}
            for shift, need in needed.items()
            if shift_counts[shift] < need
        }
        if shortfalls:
            hard_violations.append({
                "type": "staffing_shortfall",
                "day": day,
                "shortfalls": shortfalls,
                "message": f"day {day} staffing shortfall: {shortfalls}",
            })
        day_summaries[str(day)] = {
            "weekday": weekday,
            "isHoliday": is_holiday,
            "shiftCounts": shift_counts,
            "needed": needed,
            "workingTotal": sum(1 for person in staff if is_work(code_for(person, day))),
            "countedWorkingTotal": sum(1 for person in staffing_count_staff if is_work(code_for(person, day))),
        }

    work_counts: dict[str, int] = {}
    shift_counts_by_person: dict[str, dict[str, int]] = {}
    max_consecutive_by_person: dict[str, int] = {}
    isolated_off_by_person: dict[str, list[list[int]]] = {}
    for person in staff:
        work_counts[person] = 0
        shift_counts_by_person[person] = {shift: 0 for shift in auto_shifts}
        current_run = min(
            conditions.maxConsecutive,
            max(0, previous_tail.get(person, PreviousTail()).consecutiveWorkDays),
        )
        max_run = current_run
        off_run: list[int] = []
        isolated_runs: list[list[int]] = []

        for day in month_info.days:
            code = code_for(person, day)
            if is_work(code):
                work_counts[person] += 1
                if code in shift_counts_by_person[person]:
                    shift_counts_by_person[person][code] += 1
                current_run += 1
                if 0 < len(off_run) < conditions.minConsecutiveHolidays:
                    isolated_runs.append(off_run)
                off_run = []
            else:
                current_run = 0
                off_run.append(day)
            max_run = max(max_run, current_run)

        if 0 < len(off_run) < conditions.minConsecutiveHolidays:
            isolated_runs.append(off_run)
        max_consecutive_by_person[person] = max_run
        isolated_off_by_person[person] = isolated_runs
        if max_run > conditions.maxConsecutive:
            hard_violations.append({
                "type": "max_consecutive_exceeded",
                "person": person,
                "maxRun": max_run,
                "limit": conditions.maxConsecutive,
                "message": f"{person} exceeds max consecutive days: {max_run}>{conditions.maxConsecutive}",
            })
        if isolated_runs:
            hard_violations.append({
                "type": "isolated_holiday",
                "person": person,
                "runs": isolated_runs,
                "limit": conditions.minConsecutiveHolidays,
                "message": f"{person} has holiday runs shorter than {conditions.minConsecutiveHolidays}: {isolated_runs[:3]}",
            })

    balanced_work_counts = {
        person: count
        for person, count in work_counts.items()
        if is_workload_balance_eligible(person, conditions)
    } or work_counts
    min_work = min(balanced_work_counts.values()) if balanced_work_counts else 0
    max_work = max(balanced_work_counts.values()) if balanced_work_counts else 0
    workload_range = max_work - min_work
    if workload_range >= 4:
        soft_issues.append({
            "type": "workload_imbalance",
            "range": workload_range,
            "min": min_work,
            "max": max_work,
            "heaviest": [p for p, c in balanced_work_counts.items() if c == max_work],
            "lightest": [p for p, c in balanced_work_counts.items() if c == min_work],
        })
        suggestions.append("勤務日数の差が大きいため、targetWorkDaysByPerson で常勤・固定勤務者と交替勤務者の目標日数を分けてください。")

    shift_ranges: dict[str, dict[str, Any]] = {}
    for shift in auto_shifts:
        counts = {
            person: sum(
                1
                for day in month_info.days
                if code_for(person, day) == shift
                and conditions.fixedDateShifts.get(person, {}).get(str(day)) != shift
                and conditions.fixedDateShifts.get(person, {}).get(day) != shift
            )
            for person in shift_counts_by_person
            if is_shift_balance_eligible(person, shift, conditions)
        }
        if not counts:
            continue
        min_shift = min(counts.values())
        max_shift = max(counts.values())
        shift_ranges[shift] = {
            "min": min_shift,
            "max": max_shift,
            "range": max_shift - min_shift,
            "heaviest": [p for p, c in counts.items() if c == max_shift],
            "lightest": [p for p, c in counts.items() if c == min_shift],
        }
        if max_shift - min_shift >= 4:
            soft_issues.append({"type": "shift_imbalance", "shift": shift, **shift_ranges[shift]})
            suggestions.append(f"{shift}勤務の偏りが大きいため、{shift}の個人別回数差を目的関数でさらに重くしてください。")

    score = 100
    score -= 25 * len(hard_violations)
    score -= min(30, workload_range * 3)
    score -= min(20, sum(item["range"] for item in shift_ranges.values()))
    score = max(0, score)

    if not hard_violations and not soft_issues:
        warnings.append("機械診断では大きな問題は見つかりませんでした。")
    else:
        warnings.append(f"品質スコア {score}/100、重大違反 {len(hard_violations)} 件、改善候補 {len(soft_issues)} 件です。")

    return {
        "score": score,
        "hardViolations": hard_violations,
        "softIssues": soft_issues,
        "warnings": warnings,
        "suggestions": list(dict.fromkeys(suggestions)),
        "metrics": {
            "workCounts": work_counts,
            "balancedWorkCounts": balanced_work_counts,
            "workloadRange": workload_range,
            "shiftCountsByPerson": shift_counts_by_person,
            "shiftRanges": shift_ranges,
            "maxConsecutiveByPerson": max_consecutive_by_person,
            "isolatedOffByPerson": isolated_off_by_person,
            "daySummaries": day_summaries,
        },
    }
