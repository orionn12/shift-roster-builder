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


class RandomLeaveRule(BaseModel):
    people: list[str] = Field(default_factory=list)
    leaveType: str = "PAID"
    days: int = 0


class Conditions(BaseModel):
    shifts: dict[str, ShiftDefinition] = Field(default_factory=dict)
    weekdayNeed: dict[str, int] = Field(default_factory=dict)
    saturdayNeed: dict[str, int] = Field(default_factory=dict)
    sundayNeed: dict[str, int] = Field(default_factory=dict)
    holidayNeed: dict[str, int] = Field(default_factory=dict)
    maxConsecutive: int = 5
    minConsecutiveHolidays: int = 0
    solveTimeLimitSeconds: int = 30
    solveTimeLimitMinutes: int | None = None
    targetWorkDays: int | None = None
    fixedDateShifts: dict[str, dict[str, str]] = Field(default_factory=dict)
    forbiddenAlwaysShifts: dict[str, list[str]] = Field(default_factory=dict)
    forcedOffDates: dict[str, list[str]] = Field(default_factory=dict)
    unavailableWeekdayShifts: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    requiredTransitionBreaks: list[list[str]] = Field(default_factory=list)
    autoShiftCodes: list[str] = Field(default_factory=list)
    holidayDates: list[str] = Field(default_factory=list)
    dateNeed: dict[str, dict[str, int]] = Field(default_factory=dict)
    preferSameShiftStreaks: bool = False
    preferAttributeMemberBalance: bool = False
    preferShiftOverstaffBalance: bool = False
    preferConcentratedHolidays: bool = False
    coverageRules: list[dict[str, Any]] = Field(default_factory=list)
    staffAttributes: dict[str, str] = Field(default_factory=dict)
    excludedAttributes: list[str] = Field(default_factory=list)
    randomLeaveRules: list[RandomLeaveRule] = Field(default_factory=list)


class SolveRequest(BaseModel):
    staff: list[str]
    month: str
    conditions: Conditions
    fixedAssignments: dict[str, dict[str, str]] = Field(default_factory=dict)
    previousMonthTail: dict[str, dict[str, Any]] = Field(default_factory=dict)


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


def previous_tail_int(previous_month_tail: dict[str, dict[str, Any]], person: str, key: str) -> int:
    return int(previous_month_tail.get(person, {}).get(key) or 0)


def previous_tail_text(previous_month_tail: dict[str, dict[str, Any]], person: str, key: str) -> str:
    return str(previous_month_tail.get(person, {}).get(key, "") or "")


@app.post("/api/solve", response_model=SolveResponse)
def solve_roster(request: SolveRequest) -> SolveResponse:
    month_info = parse_month(request.month)
    staff = request.staff
    conditions = request.conditions
    holiday_set = set(conditions.holidayDates)
    excluded_attributes = {attribute for attribute in conditions.excludedAttributes if attribute}

    auto_shifts = sorted(
        shift.code
        for shift in conditions.shifts.values()
        if shift.auto or shift.code in conditions.autoShiftCodes
    )
    staffing_count_indexes = [
        index
        for index, person in enumerate(staff)
        if conditions.staffAttributes.get(person, "") not in excluded_attributes
    ]
    random_leave_requirements: dict[tuple[str, str], int] = {}
    for rule in conditions.randomLeaveRules:
        leave_type = "\u7279\u4f11" if rule.leaveType == "\u7279\u4f11" else "PAID"
        days_count = max(0, int(rule.days or 0))
        if days_count <= 0:
            continue
        for person in rule.people:
            if person in staff:
                key = (person, leave_type)
                random_leave_requirements[key] = random_leave_requirements.get(key, 0) + days_count
    random_leave_codes_by_person: dict[str, set[str]] = {}
    for person, leave_type in random_leave_requirements:
        random_leave_codes_by_person.setdefault(person, set()).add(leave_type)

    if not staff:
        return SolveResponse(
            status="error",
            message="スタッフが登録されていません。",
            report=failure_report("スタッフが登録されていないため、勤務表を作成できませんでした。"),
        )
    if not auto_shifts:
        return SolveResponse(
            status="error",
            message="自動割り当てする勤務区分がありません。",
            report=failure_report("自動割り当てする勤務区分を読み取れませんでした。"),
        )

    model = cp_model.CpModel()
    x: dict[tuple[int, int, str], cp_model.IntVar] = {}
    random_leave: dict[tuple[int, int, str], cp_model.IntVar] = {}
    work_day: dict[tuple[int, int], cp_model.IntVar] = {}

    for person_index, person in enumerate(staff):
        for day in month_info.days:
            work_day[(person_index, day)] = model.NewBoolVar(f"work_{person_index}_{day}")
            for shift_code in auto_shifts:
                x[(person_index, day, shift_code)] = model.NewBoolVar(
                    f"x_{person_index}_{day}_{shift_code}",
                )
            for leave_type in random_leave_codes_by_person.get(person, set()):
                random_leave[(person_index, day, leave_type)] = model.NewBoolVar(
                    f"leave_{person_index}_{day}_{leave_type}",
                )

    for person_index, person in enumerate(staff):
        fixed_date_shifts = conditions.fixedDateShifts.get(person, {})
        person_fixed_assignments = request.fixedAssignments.get(person, {})
        forbidden_always = set(conditions.forbiddenAlwaysShifts.get(person, []))
        forced_off_dates = set(conditions.forcedOffDates.get(person, []))
        unavailable_by_weekday = conditions.unavailableWeekdayShifts.get(person, {})

        for day in month_info.days:
            key = date_key(month_info, day)
            work_vars = [x[(person_index, day, shift_code)] for shift_code in auto_shifts]
            leave_vars = [
                random_leave[(person_index, day, leave_type)]
                for leave_type in random_leave_codes_by_person.get(person, set())
            ]
            model.Add(sum(work_vars) + sum(leave_vars) <= 1)

            if key in forced_off_dates:
                model.Add(sum(work_vars) == 0)
                model.Add(sum(leave_vars) == 0)
                model.Add(work_day[(person_index, day)] == 0)
                continue

            if key in person_fixed_assignments:
                assigned = person_fixed_assignments[key]
                model.Add(sum(leave_vars) == 0)
                if assigned in auto_shifts:
                    model.Add(x[(person_index, day, assigned)] == 1)
                    model.Add(work_day[(person_index, day)] == 1)
                else:
                    model.Add(sum(work_vars) == 0)
                    model.Add(work_day[(person_index, day)] == int(is_work_code(assigned)))
                continue

            if key in fixed_date_shifts:
                target_shift = fixed_date_shifts[key]
                model.Add(sum(leave_vars) == 0)
                if target_shift in auto_shifts:
                    model.Add(x[(person_index, day, target_shift)] == 1)
                    model.Add(work_day[(person_index, day)] == 1)
                else:
                    model.Add(sum(work_vars) == 0)
                    model.Add(work_day[(person_index, day)] == int(is_work_code(target_shift)))
                continue

            weekday_key = str(calendar.weekday(month_info.year, month_info.month, day))
            for shift_code in auto_shifts:
                if shift_code in forbidden_always:
                    model.Add(x[(person_index, day, shift_code)] == 0)
                if shift_code in unavailable_by_weekday.get(weekday_key, []):
                    model.Add(x[(person_index, day, shift_code)] == 0)
            model.Add(work_day[(person_index, day)] == sum(work_vars))

        if conditions.targetWorkDays is not None:
            leave_count = sum(1 for code in person_fixed_assignments.values() if code in OFF_CODES and code != "OFF")
            leave_count += sum(
                days_count
                for (leave_person, _leave_type), days_count in random_leave_requirements.items()
                if leave_person == person
            )
            target = target_work_days_for_person(month_info, conditions, person, leave_count)
            model.Add(sum(work_day[(person_index, day)] for day in month_info.days) == target)

    for (person, leave_type), required_days in random_leave_requirements.items():
        person_index = staff.index(person)
        if conditions.preferConcentratedHolidays and required_days >= 2 and required_days <= len(month_info.days):
            starts = [
                model.NewBoolVar(f"leave_block_start_{person_index}_{leave_type}_{start_day}")
                for start_day in month_info.days[: len(month_info.days) - required_days + 1]
            ]
            model.Add(sum(starts) == 1)
            for day in month_info.days:
                covering_starts = [
                    starts[start_index]
                    for start_index, start_day in enumerate(month_info.days[: len(month_info.days) - required_days + 1])
                    if start_day <= day < start_day + required_days
                ]
                model.Add(random_leave[(person_index, day, leave_type)] == sum(covering_starts))
        else:
            model.Add(
                sum(random_leave[(person_index, day, leave_type)] for day in month_info.days)
                == required_days
            )

    for day in month_info.days:
        key = date_key(month_info, day)
        weekday = calendar.weekday(month_info.year, month_info.month, day)
        is_holiday = key in holiday_set
        for shift_code in auto_shifts:
            needed = needed_staff_count(month_info, day, shift_code, conditions, weekday, is_holiday)
            needed = conditions.dateNeed.get(key, {}).get(shift_code, needed)
            model.Add(sum(x[(person_index, day, shift_code)] for person_index in staffing_count_indexes) >= needed)

    # Coverage rules (attribute-based)
    if conditions.coverageRules:
        generic_groups: dict[str, list[int]] = {}
        for index, person in enumerate(staff):
            attribute = conditions.staffAttributes.get(person, "")
            if attribute:
                generic_groups.setdefault(attribute, []).append(index)

        parsed_rules: list[tuple[str, str, str, list[tuple[list[int], int]]]] = []
        for rule in conditions.coverageRules:
            cond_list = rule.get("conditions", [])
            day_type = str(rule.get("dayType", "all") or "all")
            shift = str(rule.get("shift", "") or "").strip().upper()
            target_date = str(rule.get("date", "") or "").strip()
            groups_and_counts: list[tuple[list[int], int]] = []
            for cond in cond_list:
                attr = str(cond.get("attribute", "")).strip()
                count = int(cond.get("count") or 0)
                if attr and count > 0:
                    groups_and_counts.append((generic_groups.get(attr, []), count))
            if groups_and_counts:
                parsed_rules.append((day_type, shift, target_date, groups_and_counts))

        for day in month_info.days:
            key = date_key(month_info, day)
            weekday = calendar.weekday(month_info.year, month_info.month, day)
            is_holiday = key in holiday_set
            applicable_by_shift: dict[str, list[list[tuple[list[int], int]]]] = {}
            for day_type, shift, target_date, groups_and_counts in parsed_rules:
                if target_date and target_date != key:
                    continue
                if day_type == "weekday" and (weekday >= 5 or is_holiday):
                    continue
                if day_type == "saturday" and (weekday != 5 or is_holiday):
                    continue
                if day_type == "sunday" and (weekday != 6 or is_holiday):
                    continue
                if day_type == "holiday" and not is_holiday:
                    continue
                if day_type == "weekendHoliday" and weekday < 5 and not is_holiday:
                    continue
                applicable_by_shift.setdefault(shift, []).append(groups_and_counts)

            for shift, applicable in applicable_by_shift.items():
                target_shifts = [shift] if shift in auto_shifts else auto_shifts
                if len(applicable) == 1:
                    for group_indexes, min_count in applicable[0]:
                        group_work = sum(
                            x[(person_index, day, shift_code)]
                            for person_index in group_indexes
                            for shift_code in target_shifts
                        )
                        model.Add(group_work >= min_count)
                else:
                    rule_bools = []
                    for ridx, rule_conditions in enumerate(applicable):
                        rb = model.NewBoolVar(f"rule_ok_{day}_{shift or 'all'}_{ridx}")
                        rule_bools.append(rb)
                        for group_indexes, min_count in rule_conditions:
                            group_work = sum(
                                x[(person_index, day, shift_code)]
                                for person_index in group_indexes
                                for shift_code in target_shifts
                            )
                            model.Add(group_work >= min_count).OnlyEnforceIf(rb)
                    model.AddBoolOr(rule_bools)

    # Max consecutive work days
    max_consecutive = max(1, conditions.maxConsecutive)
    for person_index, person in enumerate(staff):
        previous_work_run = previous_tail_int(request.previousMonthTail, person, "consecutiveWorkDays")
        if previous_work_run > 0 and month_info.days:
            first_break_window_size = max_consecutive - previous_work_run + 1
            if first_break_window_size <= 0:
                model.Add(work_day[(person_index, month_info.days[0])] == 0)
            elif first_break_window_size <= len(month_info.days):
                first_window = month_info.days[:first_break_window_size]
                model.Add(sum(work_day[(person_index, day)] for day in first_window) <= first_break_window_size - 1)
        for start_idx in range(len(month_info.days) - max_consecutive):
            window = month_info.days[start_idx:start_idx + max_consecutive + 1]
            model.Add(
                sum(work_day[(person_index, day)] for day in window)
                <= max_consecutive,
            )

    # Min consecutive holidays (no isolated OFF days)
    min_holidays = conditions.minConsecutiveHolidays
    if min_holidays >= 2:
        for person_index, person in enumerate(staff):
            previous_off_run = previous_tail_int(request.previousMonthTail, person, "consecutiveOffDays")
            previous_work_run = previous_tail_int(request.previousMonthTail, person, "consecutiveWorkDays")
            previous_last_shift = previous_tail_text(request.previousMonthTail, person, "lastShift")
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
            if 0 < previous_off_run < min_holidays:
                required_additional_off = min(min_holidays - previous_off_run, len(month_info.days))
                for day in month_info.days[:required_additional_off]:
                    model.Add(work_day[(person_index, day)] == 0)
            elif previous_work_run > 0 or not previous_last_shift:
                for j in range(1, min_holidays):
                    if j < len(month_info.days):
                        model.Add(
                            work_day[(person_index, month_info.days[j])]
                            <= sum(work_day[(person_index, month_info.days[k])] for k in range(j))
                        )
    # Required shift transition breaks (e.g., no C竊但 on consecutive days)
    break_pairs = {(pair[0], pair[1]) for pair in conditions.requiredTransitionBreaks if len(pair) == 2}
    for from_shift, to_shift in break_pairs:
        if from_shift not in auto_shifts or to_shift not in auto_shifts:
            continue
        for person_index in range(len(staff)):
            previous_last_shift = previous_tail_text(request.previousMonthTail, staff[person_index], "lastShift")
            if previous_last_shift == from_shift and month_info.days:
                model.Add(x[(person_index, month_info.days[0], to_shift)] == 0)
            for i in range(len(month_info.days) - 1):
                day = month_info.days[i]
                next_day = month_info.days[i + 1]
                model.Add(x[(person_index, day, from_shift)] + x[(person_index, next_day, to_shift)] <= 1)

    # Objective: minimize work-day imbalance + shift distribution imbalance
    total_work_vars: list[cp_model.IntVar] = []
    shift_range_vars: list[cp_model.IntVar] = []
    transition_vars: list[cp_model.IntVar] = []
    random_paid_leave_transition_vars: list[cp_model.IntVar] = []
    random_special_leave_transition_vars: list[cp_model.IntVar] = []
    random_paid_leave_adjacent_work_vars: list[cp_model.IntVar] = []
    random_special_leave_adjacent_work_vars: list[cp_model.IntVar] = []
    shift_change_vars: list[cp_model.IntVar] = []
    consecutive_shift_switch_vars: list[cp_model.IntVar] = []
    previous_month_shift_switch_vars: list[cp_model.IntVar] = []
    attribute_member_range_vars: list[cp_model.IntVar] = []
    shift_overstaff_range_vars: list[cp_model.IntVar] = []
    person_shift_mix_range_vars: list[cp_model.IntVar] = []

    for person_index, _person in enumerate(staff):
        person = staff[person_index]
        person_fixed_assignments = request.fixedAssignments.get(person, {})
        fixed_date_shifts = conditions.fixedDateShifts.get(person, {})

        def fixed_leave_type(day: int) -> str | None:
            key = date_key(month_info, day)
            code = person_fixed_assignments.get(key, fixed_date_shifts.get(key, ""))
            if code == "PAID" or code == "\u7279\u4f11":
                return code
            return None

        total = model.NewIntVar(0, len(month_info.days), f"total_{person_index}")
        model.Add(total == sum(work_day[(person_index, day)] for day in month_info.days))
        total_work_vars.append(total)

        previous_last_shift = previous_tail_text(request.previousMonthTail, person, "lastShift")
        previous_work_run = previous_tail_int(request.previousMonthTail, person, "consecutiveWorkDays")
        if previous_work_run > 0 and previous_last_shift in auto_shifts and month_info.days:
            first_day = month_info.days[0]
            for shift_code in auto_shifts:
                if shift_code == previous_last_shift:
                    continue
                previous_switch = model.NewBoolVar(f"previous_shift_switch_{person_index}_{shift_code}")
                model.Add(previous_switch == x[(person_index, first_day, shift_code)])
                previous_month_shift_switch_vars.append(previous_switch)

        for day in month_info.days[:-1]:
            transition = model.NewBoolVar(f"transition_{person_index}_{day}")
            model.AddAbsEquality(transition, work_day[(person_index, day)] - work_day[(person_index, day + 1)])
            transition_vars.append(transition)
            for leave_type in random_leave_codes_by_person.get(staff[person_index], set()):
                leave_transition = model.NewBoolVar(f"leave_transition_{person_index}_{day}_{leave_type}")
                model.AddAbsEquality(
                    leave_transition,
                    random_leave[(person_index, day, leave_type)] - random_leave[(person_index, day + 1, leave_type)],
                )
                if leave_type == "PAID":
                    random_paid_leave_transition_vars.append(leave_transition)
                else:
                    random_special_leave_transition_vars.append(leave_transition)
                leave_then_work = model.NewBoolVar(f"leave_then_work_{person_index}_{day}_{leave_type}")
                model.Add(leave_then_work <= random_leave[(person_index, day, leave_type)])
                model.Add(leave_then_work <= work_day[(person_index, day + 1)])
                model.Add(
                    leave_then_work
                    >= random_leave[(person_index, day, leave_type)] + work_day[(person_index, day + 1)] - 1
                )
                work_then_leave = model.NewBoolVar(f"work_then_leave_{person_index}_{day}_{leave_type}")
                model.Add(work_then_leave <= work_day[(person_index, day)])
                model.Add(work_then_leave <= random_leave[(person_index, day + 1, leave_type)])
                model.Add(
                    work_then_leave
                    >= work_day[(person_index, day)] + random_leave[(person_index, day + 1, leave_type)] - 1
                )
                if leave_type == "PAID":
                    random_paid_leave_adjacent_work_vars.extend([leave_then_work, work_then_leave])
                else:
                    random_special_leave_adjacent_work_vars.extend([leave_then_work, work_then_leave])
            current_fixed_leave = fixed_leave_type(day)
            next_fixed_leave = fixed_leave_type(day + 1)
            if current_fixed_leave == "PAID":
                random_paid_leave_adjacent_work_vars.append(work_day[(person_index, day + 1)])
            elif current_fixed_leave == "\u7279\u4f11":
                random_special_leave_adjacent_work_vars.append(work_day[(person_index, day + 1)])
            if next_fixed_leave == "PAID":
                random_paid_leave_adjacent_work_vars.append(work_day[(person_index, day)])
            elif next_fixed_leave == "\u7279\u4f11":
                random_special_leave_adjacent_work_vars.append(work_day[(person_index, day)])
            for shift_code in auto_shifts:
                change = model.NewBoolVar(f"shift_change_{person_index}_{day}_{shift_code}")
                model.AddAbsEquality(change, x[(person_index, day, shift_code)] - x[(person_index, day + 1, shift_code)])
                shift_change_vars.append(change)
            for from_shift in auto_shifts:
                for to_shift in auto_shifts:
                    if from_shift == to_shift:
                        continue
                    switch = model.NewBoolVar(f"consecutive_shift_switch_{person_index}_{day}_{from_shift}_{to_shift}")
                    model.Add(switch <= x[(person_index, day, from_shift)])
                    model.Add(switch <= x[(person_index, day + 1, to_shift)])
                    model.Add(switch >= x[(person_index, day, from_shift)] + x[(person_index, day + 1, to_shift)] - 1)
                    consecutive_shift_switch_vars.append(switch)

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

    if conditions.preferAttributeMemberBalance:
        attribute_groups: dict[str, list[int]] = {}
        for person_index, person in enumerate(staff):
            attribute = conditions.staffAttributes.get(person, "")
            if attribute:
                attribute_groups.setdefault(attribute, []).append(person_index)
        for group_index, member_indexes in enumerate(attribute_groups.values()):
            if len(member_indexes) < 2:
                continue
            group_totals = [total_work_vars[index] for index in member_indexes]
            group_max = model.NewIntVar(0, len(month_info.days), f"max_attr_{group_index}")
            group_min = model.NewIntVar(0, len(month_info.days), f"min_attr_{group_index}")
            model.AddMaxEquality(group_max, group_totals)
            model.AddMinEquality(group_min, group_totals)
            diff = model.NewIntVar(0, len(month_info.days), f"range_attr_{group_index}")
            model.Add(diff == group_max - group_min)
            attribute_member_range_vars.append(diff)

    if conditions.preferShiftOverstaffBalance and len(auto_shifts) >= 2:
        for person_index, person in enumerate(staff):
            person_shift_totals: list[cp_model.IntVar] = []
            for shift_code in auto_shifts:
                if not is_shift_balance_eligible(person, shift_code, conditions):
                    continue
                total = model.NewIntVar(0, len(month_info.days), f"person_mix_{person_index}_{shift_code}")
                model.Add(total == sum(x[(person_index, day, shift_code)] for day in month_info.days))
                person_shift_totals.append(total)
            if len(person_shift_totals) < 2:
                continue
            person_shift_max = model.NewIntVar(0, len(month_info.days), f"max_person_mix_{person_index}")
            person_shift_min = model.NewIntVar(0, len(month_info.days), f"min_person_mix_{person_index}")
            model.AddMaxEquality(person_shift_max, person_shift_totals)
            model.AddMinEquality(person_shift_min, person_shift_totals)
            diff = model.NewIntVar(0, len(month_info.days), f"range_person_mix_{person_index}")
            model.Add(diff == person_shift_max - person_shift_min)
            person_shift_mix_range_vars.append(diff)

        overstaff_vars: list[cp_model.IntVar] = []
        for shift_code in auto_shifts:
            needed_total = 0
            for day in month_info.days:
                key = date_key(month_info, day)
                weekday = calendar.weekday(month_info.year, month_info.month, day)
                is_holiday = key in holiday_set
                needed_total += conditions.dateNeed.get(key, {}).get(
                    shift_code,
                    needed_staff_count(month_info, day, shift_code, conditions, weekday, is_holiday),
                )
            shift_total = model.NewIntVar(0, len(month_info.days) * len(staffing_count_indexes), f"counted_total_{shift_code}")
            model.Add(
                shift_total == sum(
                    x[(person_index, day, shift_code)]
                    for person_index in staffing_count_indexes
                    for day in month_info.days
                )
            )
            overstaff = model.NewIntVar(0, len(month_info.days) * len(staffing_count_indexes), f"overstaff_{shift_code}")
            model.Add(overstaff == shift_total - needed_total)
            overstaff_vars.append(overstaff)
        overstaff_max = model.NewIntVar(0, len(month_info.days) * len(staffing_count_indexes), "max_overstaff")
        overstaff_min = model.NewIntVar(0, len(month_info.days) * len(staffing_count_indexes), "min_overstaff")
        model.AddMaxEquality(overstaff_max, overstaff_vars)
        model.AddMinEquality(overstaff_min, overstaff_vars)
        overstaff_diff = model.NewIntVar(0, len(month_info.days) * len(staffing_count_indexes), "range_overstaff")
        model.Add(overstaff_diff == overstaff_max - overstaff_min)
        shift_overstaff_range_vars.append(overstaff_diff)

    shift_change_weight = 200 if conditions.preferSameShiftStreaks else 0
    consecutive_shift_switch_weight = 250000 if conditions.preferSameShiftStreaks else 0
    previous_month_shift_switch_weight = 300000 if conditions.preferSameShiftStreaks else 0
    attribute_member_balance_weight = 140 if conditions.preferAttributeMemberBalance else 0
    shift_overstaff_balance_weight = 220 if conditions.preferShiftOverstaffBalance else 0
    person_shift_mix_balance_weight = 320 if conditions.preferShiftOverstaffBalance else 0
    should_concentrate_holidays = conditions.preferConcentratedHolidays
    concentrated_holiday_weight = 420 if should_concentrate_holidays else 0
    random_paid_leave_concentration_weight = 2500 if should_concentrate_holidays else 0
    random_special_leave_concentration_weight = 12000 if should_concentrate_holidays else 0
    random_paid_leave_adjacent_work_weight = 15000 if should_concentrate_holidays else 0
    random_special_leave_adjacent_work_weight = 90000 if should_concentrate_holidays else 0
    model.Minimize(
        (max_total - min_total) * 100
        + sum(shift_range_vars) * 80
        + sum(transition_vars) * concentrated_holiday_weight
        + sum(random_paid_leave_transition_vars) * random_paid_leave_concentration_weight
        + sum(random_special_leave_transition_vars) * random_special_leave_concentration_weight
        + sum(random_paid_leave_adjacent_work_vars) * random_paid_leave_adjacent_work_weight
        + sum(random_special_leave_adjacent_work_vars) * random_special_leave_adjacent_work_weight
        + sum(shift_change_vars) * shift_change_weight
        + sum(consecutive_shift_switch_vars) * consecutive_shift_switch_weight
        + sum(previous_month_shift_switch_vars) * previous_month_shift_switch_weight
        + sum(attribute_member_range_vars) * attribute_member_balance_weight
        + sum(shift_overstaff_range_vars) * shift_overstaff_balance_weight
        + sum(person_shift_mix_range_vars) * person_shift_mix_balance_weight
    )

    solver = cp_model.CpSolver()
    if conditions.solveTimeLimitMinutes is not None and conditions.solveTimeLimitSeconds == 30:
        time_limit_seconds = max(1, int(conditions.solveTimeLimitMinutes or 1) * 60)
    else:
        time_limit_seconds = max(1, int(conditions.solveTimeLimitSeconds or 30))
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = 1
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResponse(
            status="infeasible",
            message="条件をすべて満たす勤務表が見つかりませんでした。レポートの見直し候補を確認してください。",
            report=build_infeasible_report(
                staff,
                month_info,
                conditions,
                auto_shifts,
                request.fixedAssignments,
            ),
        )

    schedule: dict[str, dict[str, str]] = {}
    for person_index, person in enumerate(staff):
        fixed_date_shifts = conditions.fixedDateShifts.get(person, {})
        person_fixed_assignments = request.fixedAssignments.get(person, {})
        forced_off_dates = set(conditions.forcedOffDates.get(person, []))
        schedule[person] = {}
        for day in month_info.days:
            key = date_key(month_info, day)
            if key in forced_off_dates:
                assigned = "OFF"
            elif key in person_fixed_assignments:
                assigned = person_fixed_assignments[key]
            elif key in fixed_date_shifts and fixed_date_shifts[key] not in auto_shifts:
                assigned = fixed_date_shifts[key]
            else:
                assigned = "OFF"
                for leave_type in random_leave_codes_by_person.get(person, set()):
                    if solver.Value(random_leave[(person_index, day, leave_type)]) == 1:
                        assigned = leave_type
                        break
                for shift_code in auto_shifts:
                    if assigned != "OFF":
                        break
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
            conditions,
            request.previousMonthTail,
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


def date_key(month_info: MonthInfo, day: int) -> str:
    return f"{month_info.year:04d}-{month_info.month:02d}-{day:02d}"


OFF_CODES = {"OFF", "PAID", "\u7279\u4f11"}


def is_work_code(code: str) -> bool:
    return bool(code) and code not in OFF_CODES


def weekday_holiday_count(month_info: MonthInfo, conditions: Conditions, person: str | None = None) -> int:
    holiday_set = set(conditions.holidayDates)
    forced_off_dates = set(conditions.forcedOffDates.get(person, [])) if person else set()
    return sum(
        1
        for day in month_info.days
        if (key := date_key(month_info, day)) in holiday_set
        and key not in forced_off_dates
        and calendar.weekday(month_info.year, month_info.month, day) < 5
    )


def target_work_days_for_person(
    month_info: MonthInfo,
    conditions: Conditions,
    person: str,
    paid_leave_count: int = 0,
) -> int:
    if conditions.targetWorkDays is None:
        return 0
    return max(0, conditions.targetWorkDays - paid_leave_count)


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
        return conditions.holidayNeed.get(shift_code, 0)
    if weekday == 5:  # Saturday
        return conditions.saturdayNeed.get(shift_code, 0)
    if weekday == 6:  # Sunday
        return conditions.sundayNeed.get(shift_code, 0)
    return conditions.weekdayNeed.get(shift_code, 0)


def is_shift_balance_eligible(person: str, shift_code: str, conditions: Conditions) -> bool:
    if shift_code in set(conditions.forbiddenAlwaysShifts.get(person, [])):
        return False
    fixed_dates = set(conditions.fixedDateShifts.get(person, {}).values())
    if fixed_dates and fixed_dates != {shift_code}:
        return False
    return True


def is_workload_balance_eligible(person: str, conditions: Conditions) -> bool:
    return not conditions.fixedDateShifts.get(person)


def failure_report(summary: str) -> dict[str, Any]:
    return {
        "title": "作成できませんでした",
        "summary": summary,
        "warnings": [],
        "suggestions": ["スタッフ、勤務区分、条件を確認してください。"],
        "stats": {},
    }


def build_infeasible_report(
    staff: list[str],
    month_info: MonthInfo,
    conditions: Conditions,
    auto_shifts: list[str],
    fixed_assignments: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    fixed_assignments = fixed_assignments or {}
    warnings: list[str] = []
    suggestions: list[str] = []
    stats: dict[str, Any] = {
        "staffCount": len(staff),
        "autoShiftCount": len(auto_shifts),
        "solveTimeLimitSeconds": conditions.solveTimeLimitSeconds,
    }

    excluded_attributes = {attribute for attribute in conditions.excludedAttributes if attribute}
    counted_staff = [
        person for person in staff
        if conditions.staffAttributes.get(person, "") not in excluded_attributes
    ]
    if excluded_attributes:
        stats["countedStaffCount"] = len(counted_staff)
        stats["excludedAttributes"] = sorted(excluded_attributes)

    total_needed = 0
    tight_days: list[str] = []
    impossible_shift_days: list[str] = []

    def is_non_work_manual(code: str) -> bool:
        return code in OFF_CODES

    def person_can_take_shift(person: str, day: int, key: str, shift: str) -> bool:
        if person not in counted_staff:
            return False
        if key in set(conditions.forcedOffDates.get(person, [])):
            return False
        manual = fixed_assignments.get(person, {}).get(key)
        if manual is not None:
            return manual == shift
        fixed = conditions.fixedDateShifts.get(person, {}).get(key)
        if fixed is not None:
            return fixed == shift
        if shift in set(conditions.forbiddenAlwaysShifts.get(person, [])):
            return False
        weekday_key = str(calendar.weekday(month_info.year, month_info.month, day))
        if shift in set(conditions.unavailableWeekdayShifts.get(person, {}).get(weekday_key, [])):
            return False
        return True

    for day in month_info.days:
        key = date_key(month_info, day)
        weekday = calendar.weekday(month_info.year, month_info.month, day)
        is_holiday = key in set(conditions.holidayDates)
        day_needed = 0
        for shift in auto_shifts:
            need = conditions.dateNeed.get(key, {}).get(
                shift,
                needed_staff_count(month_info, day, shift, conditions, weekday, is_holiday),
            )
            day_needed += need
            total_needed += need
            capacity = sum(1 for person in counted_staff if person_can_take_shift(person, day, key, shift))
            if need > capacity:
                impossible_shift_days.append(f"{key} {shift}: 必要{need}人 / 配置可能{capacity}人")
        day_capacity_any = sum(
            1 for person in counted_staff
            if any(person_can_take_shift(person, day, key, shift) for shift in auto_shifts)
        )
        if day_needed > day_capacity_any:
            tight_days.append(f"{key}: 必要合計{day_needed}人 / 配置可能{day_capacity_any}人")

    if impossible_shift_days:
        warnings.extend(impossible_shift_days[:8])
        suggestions.append("該当日の必要人数、禁止設定、手動指定、有休指定、除外設定を見直してください。")
    if tight_days:
        warnings.extend(tight_days[: max(0, 8 - len(warnings))])
        suggestions.append("同じ日に休み指定や禁止設定が集中していないか確認してください。")

    if conditions.targetWorkDays is not None:
        target_total = 0
        target_issues: list[str] = []
        stats["targetWorkDaysInput"] = conditions.targetWorkDays
        stats["weekdayHolidayCount"] = weekday_holiday_count(month_info, conditions)
        stats["effectiveTargetWorkDays"] = conditions.targetWorkDays
        for person in staff:
            person_fixed = fixed_assignments.get(person, {})
            paid_leave_count = sum(1 for code in person_fixed.values() if code in OFF_CODES and code != "OFF")
            for rule in conditions.randomLeaveRules:
                if person in rule.people:
                    paid_leave_count += max(0, int(rule.days or 0))
            target = target_work_days_for_person(month_info, conditions, person, paid_leave_count)
            target_total += target
            min_forced_work = 0
            max_possible_work = 0
            for day in month_info.days:
                key = date_key(month_info, day)
                if key in set(conditions.forcedOffDates.get(person, [])):
                    continue
                manual = person_fixed.get(key)
                fixed = conditions.fixedDateShifts.get(person, {}).get(key)
                if manual is not None:
                    if not is_non_work_manual(manual):
                        min_forced_work += 1
                        max_possible_work += 1
                    continue
                if fixed is not None:
                    if not is_non_work_manual(fixed):
                        min_forced_work += 1
                        max_possible_work += 1
                    continue
                max_possible_work += 1
            if target > max_possible_work:
                target_issues.append(f"{person}: 勤務日数目標{target}日に対して最大{max_possible_work}日まで")
            if target < min_forced_work:
                target_issues.append(f"{person}: 勤務日数目標{target}日に対して固定勤務が最低{min_forced_work}日")
        stats["totalNeededWorkSlots"] = total_needed
        stats["totalTargetWorkDays"] = target_total
        if target_total < total_needed:
            warnings.append(f"勤務日数目標の合計{target_total}日に対して、必要人数の合計が{total_needed}枠あります。")
            suggestions.append("基本条件の勤務日数を増やすか、必要人数を減らしてください。")
        if target_issues:
            warnings.extend(target_issues[: max(0, 8 - len(warnings))])
            suggestions.append("有給・特休がある人は、勤務日数が『勤務日数 - 有給特休日数』として扱われます。")

    coverage_issues: list[str] = []
    for rule in conditions.coverageRules:
        shift = str(rule.get("shift", "") or "").strip().upper()
        date = str(rule.get("date", "") or "").strip()
        label = f"{date} {shift}".strip() or "区分設定"
        for cond in rule.get("conditions", []):
            attr = str(cond.get("attribute", "") or "").strip()
            count = int(cond.get("count") or 0)
            if not attr or count <= 0:
                continue
            member_count = sum(1 for person in staff if conditions.staffAttributes.get(person, "") == attr)
            if count > member_count:
                coverage_issues.append(f"{label}: 属性『{attr}』は{member_count}人ですが{count}人必要です。")
    if coverage_issues:
        warnings.extend(coverage_issues[: max(0, 8 - len(warnings))])
        suggestions.append("区分設定の属性人数、またはスタッフの属性割り当てを見直してください。")

    if not warnings:
        warnings.append("単独では破綻している条件は見つかりませんでした。条件の組み合わせが厳しすぎる可能性があります。")
        suggestions.extend([
            "最大連勤を少し増やすか、最小連休を1日減らして試してください。",
            "必要人数が多い勤務区分を一部の日だけ減らして試してください。",
            "連勤中の勤務切替を避ける設定を一度外して試してください。",
        ])

    if not suggestions:
        suggestions.extend([
            "必要人数を一部減らす",
            "勤務日数または最大連勤を少し緩める",
            "同じ日に集中している有休・特休・禁止設定を見直す",
        ])

    return {
        "title": "作成できませんでした",
        "summary": "CP-SATで探索しましたが、現在の条件をすべて満たす勤務表は見つかりませんでした。",
        "warnings": warnings[:8],
        "suggestions": list(dict.fromkeys(suggestions)),
        "stats": stats,
    }
def build_success_report(
    schedule: dict[str, dict[str, str]],
    month_info: MonthInfo,
    auto_shifts: list[str],
    is_optimal: bool,
    conditions: Conditions,
    previous_month_tail: dict[str, dict[str, Any]] | None = None,
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
            elif code not in OFF_CODES:
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
            warnings.append(f"{shift}勤務が{', '.join(heavy[:3])}にやや多めです。")

    if not warnings:
        warnings.append("大きな偏りは検出されませんでした。")

    diagnostics = assess_schedule_quality(
        schedule,
        list(schedule.keys()),
        month_info,
        conditions,
        auto_shifts,
        previous_month_tail,
    )
    warnings.extend(diagnostics["warnings"])

    return {
        "title": "作成できました",
        "summary": "必要人数、有給・特休、最大連勤などの条件を満たす勤務表を作成しました。",
        "warnings": warnings,
        "suggestions": diagnostics["suggestions"] if diagnostics["suggestions"] else ([] if is_optimal else ["最適解ではない実行可能解です。時間を延ばすとより公平な表になる可能性があります。"]),
        "stats": {
            "solverStatus": "optimal" if is_optimal else "feasible",
            "staffCount": len(schedule),
            "days": len(month_info.days),
            "paidCount": paid_count,
            "minWorkDays": min_work,
            "maxWorkDays": max_work,
            "targetWorkDaysInput": conditions.targetWorkDays if conditions.targetWorkDays is not None else "",
            "weekdayHolidayCount": weekday_holiday_count(month_info, conditions),
            "effectiveTargetWorkDays": (
                conditions.targetWorkDays
                if conditions.targetWorkDays is not None
                else ""
            ),
            "solveTimeLimitSeconds": conditions.solveTimeLimitSeconds,
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
    previous_month_tail: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    off_codes = OFF_CODES
    previous_month_tail = previous_month_tail or {}
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
                "message": f"{person} の未割当日があります: {missing[:5]}",
            })

    holiday_set = set(conditions.holidayDates)
    excluded_attributes = {attribute for attribute in conditions.excludedAttributes if attribute}
    staffing_count_staff = [
        person for person in staff
        if conditions.staffAttributes.get(person, "") not in excluded_attributes
    ]
    for day in month_info.days:
        key = date_key(month_info, day)
        weekday = calendar.weekday(month_info.year, month_info.month, day)
        is_holiday = key in holiday_set
        shift_counts = {
            shift: sum(1 for person in staffing_count_staff if code_for(person, day) == shift)
            for shift in auto_shifts
        }
        needed = {
            shift: conditions.dateNeed.get(key, {}).get(
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
                "message": f"{day}日の必要人数が不足しています: {shortfalls}",
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
        previous_work_run = previous_tail_int(previous_month_tail, person, "consecutiveWorkDays")
        previous_off_run = previous_tail_int(previous_month_tail, person, "consecutiveOffDays")
        work_counts[person] = 0
        shift_counts_by_person[person] = {shift: 0 for shift in auto_shifts}
        current_run = previous_work_run
        max_run = 0
        off_run: list[int] = []
        isolated_runs: list[list[int]] = []

        for day in month_info.days:
            code = code_for(person, day)
            if is_work(code):
                work_counts[person] += 1
                if code in shift_counts_by_person[person]:
                    shift_counts_by_person[person][code] += 1
                current_run += 1
                off_run_length = len(off_run)
                if off_run and off_run[0] == month_info.days[0]:
                    off_run_length += previous_off_run
                if 0 < off_run_length < conditions.minConsecutiveHolidays:
                    isolated_runs.append(off_run)
                off_run = []
            else:
                current_run = 0
                off_run.append(day)
            max_run = max(max_run, current_run)

        max_consecutive_by_person[person] = max_run
        isolated_off_by_person[person] = isolated_runs
        if max_run > conditions.maxConsecutive:
            hard_violations.append({
                "type": "max_consecutive_exceeded",
                "person": person,
                "maxRun": max_run,
                "limit": conditions.maxConsecutive,
                "message": f"{person} の最大連勤が上限を超えています: {max_run}>{conditions.maxConsecutive}",
            })
        if isolated_runs:
            hard_violations.append({
                "type": "isolated_holiday",
                "person": person,
                "runs": isolated_runs,
                "limit": conditions.minConsecutiveHolidays,
                "message": f"{person} に最小連休未満の休みがあります: {isolated_runs[:3]}",
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
        suggestions.append("勤務日数の差が大きいため、基本条件の勤務日数や固定勤務・禁止設定を見直してください。")

    shift_ranges: dict[str, dict[str, Any]] = {}
    for shift in auto_shifts:
        counts = {
            person: sum(
                1
                for day in month_info.days
                if code_for(person, day) == shift
                and conditions.fixedDateShifts.get(person, {}).get(date_key(month_info, day)) != shift
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
            suggestions.append(f"{shift}勤務の偏りが大きいため、各勤務均等メンバー数配置を使うか条件を見直してください。")

    score = 100
    score -= 25 * len(hard_violations)
    score -= min(30, workload_range * 3)
    score -= min(20, sum(item["range"] for item in shift_ranges.values()))
    score = max(0, score)

    if not hard_violations and not soft_issues:
        warnings.append("機械診断では大きな問題は見つかりませんでした。")
    else:
        warnings.append(f"品質スコア {score}/100。重大違反 {len(hard_violations)} 件、確認事項 {len(soft_issues)} 件です。")

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
