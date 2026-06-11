import { useEffect, useMemo, useState } from 'react'
import HolidayJp from '@holiday-jp/holiday_jp'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Download,
  FileText,
  Menu,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'
import { exportRosterExcel } from './exportExcel'

type ShiftCode = string
type Schedule = Record<string, Record<number, ShiftCode>>
type ManualAssignments = Record<string, Record<string, ShiftCode>>
type PreviousMonthTail = Record<string, {
  lastShift: string
  consecutiveWorkDays: number
  consecutiveOffDays: number
}>

type ShiftDefinition = {
  code: string
  time: string
  auto: boolean
}

type StaffingEntry = {
  weekday: number
  saturday: number
  sunday: number
  holiday: number
  weekdayZones: string[]
  saturdayZones: string[]
  sundayZones: string[]
  holidayZones: string[]
}

type ParsedConditions = {
  shifts: Record<string, ShiftDefinition>
  weekdayNeed: Record<string, number>
  saturdayNeed: Record<string, number>
  sundayNeed: Record<string, number>
  holidayNeed: Record<string, number>
  maxConsecutive: number
  minConsecutiveHolidays: number
  solveTimeLimitSeconds: number
  targetWorkDays?: number
  fixedDateShifts: Record<string, Record<string, string>>
  coverageRules: CoverageRuleForm[]
  excludedAttributes: string[]
  staffAttributes: Record<string, string>
  unavailableWeekdayShifts: Record<string, Record<string, string[]>>
  forbiddenAlwaysShifts: Record<string, string[]>
  forcedOffWeekdays: Record<string, string[]>
  requiredTransitionBreaks: Array<[string, string]>
  autoShiftCodes: string[]
  forcedOffDates: Record<string, string[]>
  holidayDates: string[]
  dateNeed: Record<string, Record<string, number>>
  preferSameShiftStreaks: boolean
  preferAttributeMemberBalance: boolean
  preferShiftOverstaffBalance: boolean
  preferConcentratedHolidays: boolean
  randomLeaveRules: RandomLeaveRuleForSolve[]
}

type ShiftForm = {
  code: string
  time: string
  auto: boolean
}

type FixedRuleForm = {
  people: string
  shift: string
}

type ForbiddenRuleForm = {
  person: string
  weekday: string
  shift: string
}

type RandomLeaveRuleForm = {
  person: string
  leaveType: 'PAID' | '特休'
  days: number
}

type RandomLeaveRuleForSolve = {
  people: string[]
  leaveType: 'PAID' | '特休'
  days: number
}

type SpecialNeedForm = {
  day: number
  shift: string
  count: number
  zoneCodes: string[]
}

type AttributeForm = {
  name: string
}

type CoverageCondition = { attribute: string; count: number }
type CoverageRuleForm = {
  label: string
  conditions: CoverageCondition[]
  shift?: string
  date?: string
  dayType?: 'weekday' | 'saturday' | 'sunday' | 'holiday' | 'all'
}

type StructuredForm = {
  shifts: ShiftForm[]
  staffing: Record<string, StaffingEntry>
  targetWorkDays?: number
  maxConsecutive: number
  minConsecutiveHolidays: number
  solveTimeLimitSeconds: number
  preferSameShiftStreaks: boolean
  preferAttributeMemberBalance: boolean
  preferShiftOverstaffBalance: boolean
  preferConcentratedHolidays: boolean
  fixedRules: FixedRuleForm[]
  attributes: AttributeForm[]
  staffAttributes: Record<string, string>
  coverageRules: CoverageRuleForm[]
  excludedAttributes: string[]
  randomLeaveRules: RandomLeaveRuleForm[]
  forbiddenRules: ForbiddenRuleForm[]
  specialNeeds: SpecialNeedForm[]
}

type QualityIssue = {
  type?: string
  message?: string
  person?: string
  day?: number
  days?: number[]
  shortfalls?: Record<string, { actual: number; needed: number }>
  maxRun?: number
  limit?: number
  runs?: number[][]
  range?: number
  min?: number
  max?: number
  shift?: string
  heaviest?: string[]
  lightest?: string[]
}

type SolveReport = {
  title: string
  summary: string
  warnings: string[]
  suggestions: string[]
  stats: Record<string, string | number | string[]>
  quality?: {
    hardViolations?: QualityIssue[]
    softIssues?: QualityIssue[]
  }
}

type SavedRosterV2 = {
  version: 2
  month: string
  staff: string[]
  structuredForm: StructuredForm
  schedule: Schedule
  manualAssignments: ManualAssignments
}

type ResultNotice = {
  kind: 'success' | 'failure'
  title: string
  message: string
}

type SolveApiResult = {
  status: string
  message: string
  report?: SolveReport
  schedule?: Record<string, Record<string, string>>
}

const defaultStaff: string[] = []

const defaultStructuredForm: StructuredForm = {
  shifts: [
  ],
  staffing: {},
  targetWorkDays: undefined,
  maxConsecutive: 5,
  minConsecutiveHolidays: 2,
  solveTimeLimitSeconds: 30,
  preferSameShiftStreaks: false,
  preferAttributeMemberBalance: false,
  preferShiftOverstaffBalance: false,
  preferConcentratedHolidays: false,
  fixedRules: [],
  attributes: [],
  staffAttributes: {},
  coverageRules: [],
  excludedAttributes: [],
  randomLeaveRules: [],
  forbiddenRules: [],
  specialNeeds: [],
}

const recoveryStaff: string[] = [
  '小里', '松本', '小代', '川田', '楢崎', '浅山', '姫島', '田上', '竹井', '麻生',
  '三輪', '高松', '芦原', '古川', '杉山', '高田', '高橋', '田島', '岩田', '近藤',
  '今里', '原口', '古瀬',
]

const recoveryStructuredForm: StructuredForm = {
  shifts: [
    { code: 'A', time: '7:00-16:00', auto: true },
    { code: 'C', time: '15:00-0:00', auto: true },
    { code: 'E', time: '23:00-8:00', auto: true },
    { code: 'D', time: '20:00-5:00', auto: false },
    { code: '常勤', time: '9:00-18:00', auto: false },
  ],
  staffing: {
    A: { weekday: 4, saturday: 2, sunday: 2, holiday: 2, weekdayZones: ['1', '2', '3', '4'], saturdayZones: ['1', '2', '3', '4'], sundayZones: ['1', '2', '3', '4'], holidayZones: ['1', '2', '3', '4'] },
    C: { weekday: 3, saturday: 2, sunday: 2, holiday: 2, weekdayZones: ['1', '2', '3', '4'], saturdayZones: ['1', '2', '3', '4'], sundayZones: ['1', '2', '3', '4'], holidayZones: ['1', '2', '3', '4'] },
    E: { weekday: 4, saturday: 4, sunday: 4, holiday: 4, weekdayZones: ['1', '2', '3', '4'], saturdayZones: ['1', '2', '3', '4'], sundayZones: ['1', '2', '3', '4'], holidayZones: ['1', '2', '3', '4'] },
  },
  targetWorkDays: 18,
  maxConsecutive: 6,
  minConsecutiveHolidays: 2,
  solveTimeLimitSeconds: 30,
  preferSameShiftStreaks: true,
  preferAttributeMemberBalance: true,
  preferShiftOverstaffBalance: true,
  preferConcentratedHolidays: true,
  fixedRules: [
    { people: '小里', shift: '常勤' },
    { people: '古川', shift: 'A' },
    { people: '今里', shift: 'A' },
  ],
  attributes: [
    { name: 'リーダー' },
    { name: 'サブリーダー' },
    { name: '一般' },
    { name: '新人' },
    { name: '責任者' },
  ],
  staffAttributes: {
    小里: '責任者',
    松本: 'リーダー',
    小代: 'リーダー',
    川田: 'リーダー',
    楢崎: 'リーダー',
    浅山: 'リーダー',
    姫島: 'サブリーダー',
    田上: 'サブリーダー',
    竹井: 'サブリーダー',
    麻生: 'サブリーダー',
    三輪: 'サブリーダー',
    高松: 'サブリーダー',
    芦原: '一般',
    古川: '一般',
    杉山: '一般',
    高田: '一般',
    高橋: '一般',
    田島: '一般',
    岩田: '一般',
    近藤: '一般',
    今里: '新人',
    原口: '新人',
    古瀬: '新人',
  },
  coverageRules: [
    { label: '', conditions: [{ attribute: 'リーダー', count: 2 }] },
    { label: '', conditions: [{ attribute: 'リーダー', count: 1 }, { attribute: 'サブリーダー', count: 1 }] },
    { label: '', conditions: [{ attribute: 'サブリーダー', count: 2 }] },
    { label: '', conditions: [{ attribute: 'リーダー', count: 1 }, { attribute: '一般', count: 1 }] },
  ],
  excludedAttributes: ['新人'],
  randomLeaveRules: [],
  forbiddenRules: [
    { person: '小代', weekday: '日曜', shift: 'C' },
    { person: '小里', weekday: '土日祝', shift: '' },
    { person: '松本', weekday: '土日祝', shift: '' },
    { person: '古川', weekday: '土日祝', shift: '' },
    { person: '今里', weekday: '土日祝', shift: '' },
    { person: '原口', weekday: '土日祝', shift: '' },
    { person: '古瀬', weekday: '土日祝', shift: '' },
    { person: '松本', weekday: '', shift: 'E' },
  ],
  specialNeeds: [
    { day: 20, shift: 'E', count: 5, zoneCodes: ['1', '2', '3', '4'] },
    { day: 21, shift: 'A', count: 3, zoneCodes: ['1', '2', '3', '4'] },
  ],
}

const baseShiftClasses = ['shift-a', 'shift-c', 'shift-e', 'shift-d', 'shift-x']
const savedRostersKeyLegacy = 'shift-roster-builder-saved-rosters'
const savedRostersKeyV2 = 'shift-roster-builder-saved-rosters-v2'
const reportStatLabels: Record<string, string> = {
  solverStatus: '作成状態',
  staffCount: 'スタッフ数',
  autoShiftCount: '自動作成勤務数',
  countedStaffCount: '必要人数カウント対象人数',
  excludedAttributes: '除外属性',
  days: '日数',
  paidCount: '有休日数',
  minWorkDays: '最小勤務日数',
  maxWorkDays: '最大勤務日数',
  qualityScore: '品質スコア',
  hardViolationCount: '重大違反数',
  softIssueCount: '確認事項数',
  totalNeededWorkSlots: '必要勤務枠合計',
  totalTargetWorkDays: '勤務日数目標合計',
  solveTimeLimitSeconds: '最大実施時間(秒)',
  solveTimeLimitMinutes: '最大実施時間(分)',
}
const emptyStaffingEntry = (): StaffingEntry => ({
  weekday: 0, saturday: 0, sunday: 0, holiday: 0,
  weekdayZones: [], saturdayZones: [], sundayZones: [], holidayZones: [],
})

function reportStatLabel(key: string) {
  if (key === 'targetWorkDaysInput') return '勤務日数入力値'
  if (key === 'weekdayHolidayCount') return '平日祝日数'
  if (key === 'effectiveTargetWorkDays') return '有休差引前の勤務日数目標'
  return reportStatLabels[key] ?? key
}

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function reportStatValue(key: string, value: string | number | string[]) {
  if (Array.isArray(value)) return value.join(' / ')
  if (key === 'solverStatus') {
    if (value === 'optimal') return '最適解'
    if (value === 'feasible') return '作成可'
    if (value === 'infeasible') return '作成不可'
  }
  return value
}

function formatNames(names?: string[]) {
  return names && names.length > 0 ? names.join('、') : '該当者なし'
}

function formatDays(days?: number[]) {
  return days && days.length > 0 ? `${days.join('、')}日` : '日付不明'
}

function formatDayRuns(runs?: number[][]) {
  return runs && runs.length > 0
    ? runs.map((run) => `${run.join('、')}日`).join(' / ')
    : '日付不明'
}

function formatQualityIssue(issue: QualityIssue) {
  switch (issue.type) {
    case 'missing_assignment':
      return `${issue.person ?? 'スタッフ'}: ${formatDays(issue.days)} が未割当です。`
    case 'staffing_shortfall': {
      const details = Object.entries(issue.shortfalls ?? {})
        .map(([shift, value]) => `${shift}: 必要${value.needed}人 / 実際${value.actual}人`)
        .join('、')
      return `${issue.day ?? '?'}日: 必要人数が不足しています。${details}`
    }
    case 'max_consecutive_exceeded':
      return `${issue.person ?? 'スタッフ'}: 最大連勤が上限を超えています（実績${issue.maxRun ?? '?'}日 / 上限${issue.limit ?? '?'}日）。`
    case 'isolated_holiday':
      return `${issue.person ?? 'スタッフ'}: 最小連休${issue.limit ?? '?'}日を下回る休みがあります（${formatDayRuns(issue.runs)}）。`
    case 'workload_imbalance':
      return `勤務日数の差が大きいです（最小${issue.min ?? '?'}日 / 最大${issue.max ?? '?'}日 / 差${issue.range ?? '?'}日）。多い: ${formatNames(issue.heaviest)}、少ない: ${formatNames(issue.lightest)}。`
    case 'shift_imbalance':
      return `${issue.shift ?? '勤務'}勤務の偏りが大きいです（最小${issue.min ?? '?'}回 / 最大${issue.max ?? '?'}回 / 差${issue.range ?? '?'}回）。多い: ${formatNames(issue.heaviest)}、少ない: ${formatNames(issue.lightest)}。`
    default:
      return issue.message ?? issue.type ?? '詳細を取得できませんでした。'
  }
}


function parseShiftTimeMinutes(timeStr: string): { start: number; end: number } | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/)
  if (!match) return null
  const start = parseInt(match[1]) * 60 + parseInt(match[2])
  let end = parseInt(match[3]) * 60 + parseInt(match[4])
  if (end <= start) end += 24 * 60
  return { start, end }
}

function normalizeOptionalSelectValue(value: unknown) {
  const text = String(value ?? '').trim()
  return text === '-' || text === '－' ? '' : text
}

function weekdayValueToKey(weekday: string): string | null {
  const normalized = normalizeOptionalSelectValue(weekday)
  if (!normalized) return null
  const found = Object.entries(weekdayNameToIndex).find(([label]) => normalized === label)
  if (found) return String(found[1])
  if (['祝', '土日', '土日祝'].includes(normalized)) return normalized
  return null
}

function getMonthDays(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1)
}

function dateKey(monthValue: string, day: number) {
  return `${monthValue}-${String(day).padStart(2, '0')}`
}

function previousMonthValue(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  const previous = new Date(year, month - 2, 1)
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
}

function isNonWorkCode(code: string) {
  return code === 'OFF' || code === 'PAID' || code === '特休'
}

function isWeekend(monthValue: string, day: number) {
  const [year, month] = monthValue.split('-').map(Number)
  const weekday = new Date(year, month - 1, day).getDay()
  return weekday === 0 || weekday === 6
}

function isPublicHoliday(monthValue: string, day: number) {
  const [year, month] = monthValue.split('-').map(Number)
  return HolidayJp.isHoliday(new Date(year, month - 1, day))
}

function isDayOff(monthValue: string, day: number) {
  return isWeekend(monthValue, day) || isPublicHoliday(monthValue, day)
}

function weekdayLabel(monthValue: string, day: number) {
  return ['日', '月', '火', '水', '木', '金', '土'][
    new Date(`${monthValue}-${String(day).padStart(2, '0')}T00:00:00`).getDay()
  ]
}

function normalizeLine(line: string) {
  return line
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[。、，]/g, ' ')
    .replace(/[〜～]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function peopleInLine(line: string, staff: string[]) {
  return staff.filter((person) => line.includes(person))
}

function splitPeople(value: string, staff: string[]) {
  const tokens = normalizeLine(value).split(/[,\s、]+/).filter(Boolean)
  return tokens.filter((person) => staff.includes(person))
}

function splitShiftCodes(value: string) {
  return normalizeLine(value).split(/[,\s、/]+/).filter(Boolean).map((code) => code.toUpperCase())
}




const weekdayNameToIndex: Record<string, number> = {
  月曜: 0,
  月曜日: 0,
  火曜: 1,
  火曜日: 1,
  水曜: 2,
  水曜日: 2,
  木曜: 3,
  木曜日: 3,
  金曜: 4,
  金曜日: 4,
  土曜: 5,
  土曜日: 5,
  日曜: 6,
  日曜日: 6,
}



function buildConditionsFromForm(form: StructuredForm, staff: string[], monthValue: string): ParsedConditions {
  // 禁止設定を先に処理し forcedOffDates を確定させる（固定シフトの除外日に使用）
  const unavailableWeekdayShifts: Record<string, Record<string, string[]>> = {}
  const forbiddenAlwaysShifts: Record<string, string[]> = {}
  const forcedOffWeekdays: Record<string, string[]> = {}
  for (const rule of form.forbiddenRules) {
    const person = rule.person.trim()
    if (!person) continue
    const weekdayKey = weekdayValueToKey(rule.weekday)
    const shift = normalizeOptionalSelectValue(rule.shift).toUpperCase()
    if (weekdayKey && shift) {
      unavailableWeekdayShifts[person] = {
        ...(unavailableWeekdayShifts[person] ?? {}),
        [weekdayKey]: [...(unavailableWeekdayShifts[person]?.[weekdayKey] ?? []), shift],
      }
    } else if (weekdayKey && !shift) {
      forcedOffWeekdays[person] = [...(forcedOffWeekdays[person] ?? []), weekdayKey]
    } else if (!weekdayKey && shift) {
      forbiddenAlwaysShifts[person] = [...(forbiddenAlwaysShifts[person] ?? []), shift]
    }
  }

  // forcedOffDates を事前に計算（固定シフト割り当てから除外するため）
  const [_year, _month] = monthValue.split('-').map(Number)
  const forcedOffDates: Record<string, string[]> = {}
  const forcedOffDateSet: Record<string, Set<number>> = {}
  for (const [person, weekdayKeys] of Object.entries(forcedOffWeekdays)) {
    const dates: number[] = []
    for (const day of getMonthDays(monthValue)) {
      const date = new Date(_year, _month - 1, day)
      const jsDay = date.getDay()
      const mondayBased = (jsDay + 6) % 7
      const holiday = HolidayJp.isHoliday(date)
      const matched = weekdayKeys.some((key) =>
        (key === '祝' && holiday) ||
        (key === '土日' && (jsDay === 0 || jsDay === 6)) ||
        (key === '土日祝' && (jsDay === 0 || jsDay === 6 || holiday)) ||
        key === String(mondayBased),
      )
      if (matched) dates.push(day)
    }
    if (dates.length > 0) {
      forcedOffDates[person] = dates.map((day) => dateKey(monthValue, day))
      forcedOffDateSet[person] = new Set(dates)
    }
  }

  // 固定シフト: 土曜・日曜はスキップ（禁止設定で forcedOffDates が設定された平日も除外）
  const fixedDateShifts: Record<string, Record<string, string>> = {}
  for (const rule of form.fixedRules) {
    const shift = rule.shift.toUpperCase()
    if (!shift) continue
    for (const person of splitPeople(rule.people, staff)) {
      fixedDateShifts[person] = {}
      for (const day of getMonthDays(monthValue)) {
        if (isDayOff(monthValue, day)) continue
        if (forcedOffDateSet[person]?.has(day)) continue
        fixedDateShifts[person][dateKey(monthValue, day)] = shift
      }
    }
  }

  const MIN_REST_MINUTES = 8 * 60
  const requiredTransitionBreaks: Array<[string, string]> = []
  const shiftTimings = form.shifts
    .filter((s) => s.code.trim() && s.auto)
    .map((s) => ({ code: s.code.trim().toUpperCase(), time: parseShiftTimeMinutes(s.time) }))
    .filter((s): s is { code: string; time: { start: number; end: number } } => s.time !== null)
  for (const from of shiftTimings) {
    for (const to of shiftTimings) {
      if (from.code === to.code) continue
      if (to.time.start + 24 * 60 - from.time.end < MIN_REST_MINUTES) {
        requiredTransitionBreaks.push([from.code, to.code])
      }
    }
  }

  const dateNeed: Record<string, Record<string, number>> = {}
  for (const special of form.specialNeeds) {
    if (!special.day || !special.shift) continue
    const key = dateKey(monthValue, special.day)
    dateNeed[key] = { ...(dateNeed[key] ?? {}), [special.shift.toUpperCase()]: special.count }
  }

  const coverageRules: CoverageRuleForm[] = []
  const addLinkedCoverageRule = (
    zoneCode: string,
    patch: Pick<CoverageRuleForm, 'shift'> & Partial<Pick<CoverageRuleForm, 'date' | 'dayType'>>,
  ) => {
    const index = Number(zoneCode) - 1
    const source = form.coverageRules[index]
    if (!source || source.conditions.length === 0) return
    coverageRules.push({
      label: source.label,
      conditions: source.conditions,
      ...patch,
    })
  }

  for (const [code, entry] of Object.entries(form.staffing)) {
    const shift = code.toUpperCase()
    for (const zoneCode of entry.weekdayZones ?? []) addLinkedCoverageRule(zoneCode, { shift, dayType: 'weekday' })
    for (const zoneCode of entry.saturdayZones ?? []) addLinkedCoverageRule(zoneCode, { shift, dayType: 'saturday' })
    for (const zoneCode of entry.sundayZones ?? []) addLinkedCoverageRule(zoneCode, { shift, dayType: 'sunday' })
    for (const zoneCode of entry.holidayZones ?? []) addLinkedCoverageRule(zoneCode, { shift, dayType: 'holiday' })
  }
  for (const special of form.specialNeeds) {
    if (!special.day || !special.shift) continue
    const key = dateKey(monthValue, special.day)
    for (const zoneCode of special.zoneCodes ?? []) {
      addLinkedCoverageRule(zoneCode, { shift: special.shift.toUpperCase(), date: key })
    }
  }

  return {
    shifts: Object.fromEntries(
      form.shifts
        .filter((shift) => shift.code.trim())
        .map((shift) => [
          shift.code.toUpperCase(),
          { code: shift.code.toUpperCase(), time: shift.time, auto: shift.auto },
        ]),
    ),
    weekdayNeed: Object.fromEntries(
      Object.entries(form.staffing).map(([code, e]) => [code.toUpperCase(), e.weekday]),
    ),
    saturdayNeed: Object.fromEntries(
      Object.entries(form.staffing).map(([code, e]) => [code.toUpperCase(), e.saturday ?? 0]),
    ),
    sundayNeed: Object.fromEntries(
      Object.entries(form.staffing).map(([code, e]) => [code.toUpperCase(), e.sunday ?? 0]),
    ),
    holidayNeed: Object.fromEntries(
      Object.entries(form.staffing).map(([code, e]) => [code.toUpperCase(), e.holiday ?? 0]),
    ),
    maxConsecutive: form.maxConsecutive,
    minConsecutiveHolidays: form.minConsecutiveHolidays ?? 0,
    solveTimeLimitSeconds: Math.max(1, Math.floor(Number(form.solveTimeLimitSeconds) || Number((form as { solveTimeLimitMinutes?: number }).solveTimeLimitMinutes) * 60 || 30)),
    targetWorkDays: form.targetWorkDays && form.targetWorkDays > 0 ? form.targetWorkDays : undefined,
    fixedDateShifts,
    coverageRules,
    excludedAttributes: form.excludedAttributes.filter((attribute) => attribute.trim()),
    staffAttributes: form.staffAttributes,
    unavailableWeekdayShifts,
    forbiddenAlwaysShifts,
    forcedOffWeekdays,
    requiredTransitionBreaks,
    autoShiftCodes: form.shifts.filter((s) => s.code.trim() && s.auto).map((s) => s.code.trim().toUpperCase()),
    forcedOffDates,
    holidayDates: getMonthDays(monthValue).filter((day) => {
      const [year, month] = monthValue.split('-').map(Number)
      return HolidayJp.isHoliday(new Date(year, month - 1, day))
    }).map((day) => dateKey(monthValue, day)),
    dateNeed,
    preferSameShiftStreaks: form.preferSameShiftStreaks,
    preferAttributeMemberBalance: form.preferAttributeMemberBalance,
    preferShiftOverstaffBalance: form.preferShiftOverstaffBalance,
    preferConcentratedHolidays: form.preferConcentratedHolidays,
    randomLeaveRules: form.randomLeaveRules
      .map((rule) => ({
        people: rule.person && staff.includes(rule.person) ? [rule.person] : [],
        leaveType: rule.leaveType === '特休' ? '特休' as const : 'PAID' as const,
        days: Math.max(0, Math.floor(Number(rule.days) || 0)),
      }))
      .filter((rule) => rule.people.length > 0 && rule.days > 0),
  }
}



function getShiftClass(code: string) {
  if (code === 'OFF') return 'shift-off'
  if (code === 'PAID') return 'shift-paid'
  if (code === '特休') return 'shift-tokkyuu'
  const index = code.charCodeAt(0) % baseShiftClasses.length
  return baseShiftClasses[index]
}

function blankSchedule(staff: string[], days: number[]): Schedule {
  return Object.fromEntries(
    staff.map((person) => [
      person,
      Object.fromEntries(days.map((day) => [day, 'OFF'])) as Record<number, ShiftCode>,
    ]),
  )
}

function mergeScheduleShape(current: Schedule, staff: string[], days: number[]): Schedule {
  const next = blankSchedule(staff, days)
  for (const person of staff) {
    for (const day of days) {
      next[person][day] = current[person]?.[day] ?? 'OFF'
    }
  }
  return next
}

function pruneManualAssignments(current: ManualAssignments, staff: string[], monthValue: string, days: number[]): ManualAssignments {
  const dateSet = new Set(days.map((day) => dateKey(monthValue, day)))
  const next: ManualAssignments = {}
  for (const person of staff) {
    const entries = Object.entries(current[person] ?? {})
      .filter(([day]) => dateSet.has(day))
    if (entries.length > 0) {
      next[person] = Object.fromEntries(entries)
    }
  }
  return next
}

function sanitizeSchedule(
  current: Schedule,
  staff: string[],
  monthValue: string,
  days: number[],
  conditions: ParsedConditions,
  manualAssignments: ManualAssignments = {},
): Schedule {
  const next = mergeScheduleShape(current, staff, days)
  const autoCodes = new Set(conditions.autoShiftCodes)
  for (const person of staff) {
    const fixedDates = conditions.fixedDateShifts[person] ?? {}
    const randomLeaveTypes = new Set(
      conditions.randomLeaveRules
        .filter((rule) => rule.people.includes(person) && rule.days > 0)
        .map((rule) => rule.leaveType),
    )
    for (const day of days) {
      const key = dateKey(monthValue, day)
      const code = next[person]?.[day] ?? 'OFF'
      const manualCode = manualAssignments[person]?.[key]
      if (code === 'PAID' && manualCode !== 'PAID' && fixedDates[key] !== 'PAID' && !randomLeaveTypes.has('PAID')) {
        next[person][day] = 'OFF'
        continue
      }
      if (code === '特休' && manualCode !== '特休' && fixedDates[key] !== '特休' && !randomLeaveTypes.has('特休')) {
        next[person][day] = 'OFF'
        continue
      }
      if (
        code !== 'OFF' &&
        code !== 'PAID' &&
        code !== '特休' &&
        !autoCodes.has(code) &&
        manualCode !== code &&
        fixedDates[key] !== code
      ) {
        next[person][day] = 'OFF'
      }
    }
  }
  return next
}

function buildFixedAssignmentsForSolve(
  current: ManualAssignments,
  staff: string[],
  monthValue: string,
  days: number[],
): ManualAssignments {
  const pruned = pruneManualAssignments(current, staff, monthValue, days)
  const next: ManualAssignments = {}
  for (const person of staff) {
    for (const [day, code] of Object.entries(pruned[person] ?? {})) {
      if (!next[person]) next[person] = {}
      next[person][day] = code
    }
  }
  return next
}

async function postSolveRequest(payload: unknown): Promise<SolveApiResult> {
  const endpoints = ['/api/solve', 'http://127.0.0.1:8001/api/solve', 'http://localhost:8001/api/solve']
  let lastError: unknown = null
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const text = await response.text()
      const data = text ? JSON.parse(text) : {}
      if (!response.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? data)
        throw new Error(detail || `HTTP ${response.status}`)
      }
      return data as SolveApiResult
    } catch (error) {
      lastError = error
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'APIに接続できませんでした。'
  throw new Error(`CP-SATサーバーに接続できませんでした。${message}`)
}

async function fetchStoredRosters(): Promise<Record<string, unknown>> {
  const endpoints = ['/api/storage/rosters', 'http://127.0.0.1:8001/api/storage/rosters', 'http://localhost:8001/api/storage/rosters']
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint)
      if (!response.ok) continue
      const data = await response.json()
      return (data.rosters && typeof data.rosters === 'object' ? data.rosters : data) as Record<string, unknown>
    } catch {
      // Fall back to browser storage when the packaged file storage is not available.
    }
  }
  return {}
}

async function persistStoredRosters(saved: Record<string, SavedRosterV2>) {
  const endpoints = ['/api/storage/rosters', 'http://127.0.0.1:8001/api/storage/rosters', 'http://localhost:8001/api/storage/rosters']
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosters: saved }),
      })
      if (response.ok) return
    } catch {
      // Try the next endpoint.
    }
  }
  throw new Error('保存データファイルに書き込めませんでした。')
}

function compactStructuredForm(value: unknown): StructuredForm {
  const form = (value && typeof value === 'object' ? value : {}) as Partial<StructuredForm>
  const staffing: Record<string, StaffingEntry> = {}
  for (const [code, entry] of Object.entries(form.staffing ?? {})) {
    staffing[code] = {
      weekday: Math.max(0, Number(entry?.weekday) || 0),
      saturday: Math.max(0, Number(entry?.saturday) || 0),
      sunday: Math.max(0, Number(entry?.sunday) || 0),
      holiday: Math.max(0, Number(entry?.holiday) || 0),
      weekdayZones: Array.isArray(entry?.weekdayZones) ? entry.weekdayZones.map(String) : [],
      saturdayZones: Array.isArray(entry?.saturdayZones) ? entry.saturdayZones.map(String) : [],
      sundayZones: Array.isArray(entry?.sundayZones) ? entry.sundayZones.map(String) : [],
      holidayZones: Array.isArray(entry?.holidayZones) ? entry.holidayZones.map(String) : [],
    }
  }

  return {
    ...defaultStructuredForm,
    shifts: (form.shifts ?? []).map((shift) => ({
      code: String(shift.code ?? ''),
      time: String(shift.time ?? ''),
      auto: Boolean(shift.auto),
    })),
    staffing,
    targetWorkDays: form.targetWorkDays && form.targetWorkDays > 0 ? form.targetWorkDays : undefined,
    maxConsecutive: form.maxConsecutive ?? defaultStructuredForm.maxConsecutive,
    minConsecutiveHolidays: form.minConsecutiveHolidays ?? defaultStructuredForm.minConsecutiveHolidays,
    solveTimeLimitSeconds: Math.max(1, Math.floor(Number(form.solveTimeLimitSeconds) || Number((form as { solveTimeLimitMinutes?: number }).solveTimeLimitMinutes) * 60 || defaultStructuredForm.solveTimeLimitSeconds)),
    preferSameShiftStreaks: form.preferSameShiftStreaks ?? defaultStructuredForm.preferSameShiftStreaks,
    preferAttributeMemberBalance: form.preferAttributeMemberBalance ?? defaultStructuredForm.preferAttributeMemberBalance,
    preferShiftOverstaffBalance: form.preferShiftOverstaffBalance ?? defaultStructuredForm.preferShiftOverstaffBalance,
    preferConcentratedHolidays: form.preferConcentratedHolidays ?? defaultStructuredForm.preferConcentratedHolidays,
    fixedRules: (form.fixedRules ?? []).map((rule) => ({
      people: String(rule.people ?? ''),
      shift: String(rule.shift ?? ''),
    })),
    attributes: (form.attributes ?? []).map((attribute) => ({ name: String(attribute.name ?? '') })),
    staffAttributes: form.staffAttributes ?? {},
    coverageRules: (form.coverageRules ?? []).map((rule) => ({
      label: String(rule.label ?? ''),
      conditions: (rule.conditions ?? []).map((condition) => ({
        attribute: String(condition.attribute ?? ''),
        count: Math.max(0, Number(condition.count) || 0),
      })),
    })),
    excludedAttributes: Array.isArray(form.excludedAttributes) ? form.excludedAttributes.map(String) : [],
    randomLeaveRules: (form.randomLeaveRules ?? []).map((rule) => {
      const legacyPeople = (rule as unknown as { people?: unknown }).people
      return {
        person: typeof rule.person === 'string'
          ? rule.person
          : Array.isArray(legacyPeople) && legacyPeople.length > 0
            ? String(legacyPeople[0])
            : '',
        leaveType: rule.leaveType === '特休' ? '特休' : 'PAID',
        days: Math.max(0, Number(rule.days) || 0),
      }
    }),
    forbiddenRules: (form.forbiddenRules ?? []).map((rule) => ({
      person: String(rule.person ?? ''),
      weekday: normalizeOptionalSelectValue(rule.weekday),
      shift: normalizeOptionalSelectValue(rule.shift),
    })),
    specialNeeds: (form.specialNeeds ?? []).map((rule) => ({
      day: Math.max(1, Number(rule.day) || 1),
      shift: String(rule.shift ?? ''),
      count: Math.max(0, Number(rule.count) || 0),
      zoneCodes: Array.isArray(rule.zoneCodes) ? rule.zoneCodes.map(String) : [],
    })),
  }
}

function normalizeManualAssignments(value: unknown, staff: string[], monthValue: string, days: number[]): ManualAssignments {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, Record<string, string>>
  const daySet = new Set(days)
  const dateSet = new Set(days.map((day) => dateKey(monthValue, day)))
  const next: ManualAssignments = {}
  for (const person of staff) {
    for (const [rawDay, code] of Object.entries(raw[person] ?? {})) {
      const key = dateSet.has(rawDay) ? rawDay : dateKey(monthValue, Number(rawDay))
      if (!dateSet.has(key)) continue
      const day = Number(key.slice(-2))
      if (!daySet.has(day)) continue
      if (!next[person]) next[person] = {}
      next[person][key] = String(code)
    }
  }
  return next
}

function normalizeSchedule(value: unknown, staff: string[], days: number[]): Schedule {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, Record<string, string>>
  const next = blankSchedule(staff, days)
  const daySet = new Set(days)
  for (const person of staff) {
    for (const [rawDay, code] of Object.entries(raw[person] ?? {})) {
      const day = Number(rawDay.length === 10 ? rawDay.slice(-2) : rawDay)
      if (daySet.has(day)) next[person][day] = String(code)
    }
  }
  return next
}

function migrateSavedRoster(monthValue: string, value: unknown): SavedRosterV2 | null {
  if (!value || typeof value !== 'object') return null
  const roster = value as Partial<SavedRosterV2>
  if (!Array.isArray(roster.staff)) return null
  const days = getMonthDays(monthValue)
  const structuredForm = compactStructuredForm(roster.structuredForm)
  const manualAssignments = normalizeManualAssignments(roster.manualAssignments, roster.staff, monthValue, days)
  const conditions = buildConditionsFromForm(structuredForm, roster.staff, monthValue)
  const schedule = sanitizeSchedule(
    normalizeSchedule(roster.schedule, roster.staff, days),
    roster.staff,
    monthValue,
    days,
    conditions,
    manualAssignments,
  )
  return {
    version: 2,
    month: monthValue,
    staff: roster.staff,
    structuredForm,
    schedule,
    manualAssignments,
  }
}

function createRecoveryRoster(monthValue: string): SavedRosterV2 {
  const days = getMonthDays(monthValue)
  const structuredForm = compactStructuredForm(recoveryStructuredForm)
  const schedule = blankSchedule(recoveryStaff, days)
  return {
    version: 2,
    month: monthValue,
    staff: recoveryStaff,
    structuredForm,
    schedule,
    manualAssignments: {},
  }
}

const staffingZoneKeys = ['weekdayZones', 'saturdayZones', 'sundayZones', 'holidayZones'] as const

function repairStructuredFormForRecovery(value: unknown): StructuredForm {
  const form = compactStructuredForm(value)
  const recovery = compactStructuredForm(recoveryStructuredForm)
  const nextStaffing: Record<string, StaffingEntry> = { ...form.staffing }
  let changed = false

  for (const [code, entry] of Object.entries(form.staffing)) {
    const source = recovery.staffing[code]
    if (!source) continue
    const nextEntry: StaffingEntry = { ...entry }
    for (const key of staffingZoneKeys) {
      if ((nextEntry[key] ?? []).length === 0 && source[key].length > 0) {
        nextEntry[key] = [...source[key]]
        changed = true
      }
    }
    nextStaffing[code] = nextEntry
  }

  const nextSpecialNeeds = form.specialNeeds.map((rule) => {
    if ((rule.zoneCodes ?? []).length > 0) return rule
    const source = recovery.specialNeeds.find((candidate) => candidate.day === rule.day && candidate.shift === rule.shift)
    if (!source || source.zoneCodes.length === 0) return rule
    changed = true
    return { ...rule, zoneCodes: [...source.zoneCodes] }
  })

  const nextForm: StructuredForm = {
    ...form,
    staffing: nextStaffing,
    specialNeeds: nextSpecialNeeds,
  }

  if (nextForm.attributes.length === 0 && recovery.attributes.length > 0) {
    nextForm.attributes = recovery.attributes.map((attribute) => ({ ...attribute }))
    changed = true
  }
  if (Object.keys(nextForm.staffAttributes).length === 0 && Object.keys(recovery.staffAttributes).length > 0) {
    nextForm.staffAttributes = { ...recovery.staffAttributes }
    changed = true
  }
  if (nextForm.coverageRules.length === 0 && recovery.coverageRules.length > 0) {
    nextForm.coverageRules = recovery.coverageRules.map((rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition) => ({ ...condition })),
    }))
    changed = true
  }
  if (nextForm.excludedAttributes.length === 0 && recovery.excludedAttributes.length > 0) {
    nextForm.excludedAttributes = [...recovery.excludedAttributes]
    changed = true
  }

  return changed ? compactStructuredForm(nextForm) : form
}

function isRecoveryTargetRoster(roster: SavedRosterV2) {
  if (!['2026-05', '2026-06'].includes(roster.month)) return false
  const recoveryStaffSet = new Set(recoveryStaff)
  const matchedStaffCount = roster.staff.filter((person) => recoveryStaffSet.has(person)).length
  return matchedStaffCount >= Math.ceil(recoveryStaff.length * 0.6)
}

function repairSavedRosterForRecovery(roster: SavedRosterV2): SavedRosterV2 {
  if (!isRecoveryTargetRoster(roster)) return roster
  return {
    ...roster,
    structuredForm: repairStructuredFormForRecovery(roster.structuredForm),
  }
}

function isUsableSavedRoster(roster: SavedRosterV2 | undefined) {
  if (!roster || roster.staff.length === 0) return false
  const form = compactStructuredForm(roster.structuredForm)
  const hasAutoShift = form.shifts.some((shift) => shift.code.trim() && shift.auto)
  const hasStaffing = Object.values(form.staffing).some(
    (entry) => entry.weekday > 0 || entry.saturday > 0 || entry.sunday > 0 || entry.holiday > 0,
  )
  const hasConditionData =
    form.attributes.length > 0 ||
    Object.keys(form.staffAttributes).length > 0 ||
    form.fixedRules.length > 0 ||
    form.forbiddenRules.length > 0 ||
    form.coverageRules.length > 0 ||
    form.specialNeeds.length > 0
  return hasAutoShift && hasStaffing && hasConditionData
}

function mergeRecoveryRosters(saved: Record<string, SavedRosterV2>) {
  let changed = false
  for (const monthValue of ['2026-05', '2026-06']) {
    if (!isUsableSavedRoster(saved[monthValue])) {
      saved[monthValue] = createRecoveryRoster(monthValue)
      changed = true
      continue
    }
    const repaired = repairSavedRosterForRecovery(saved[monthValue])
    if (JSON.stringify(repaired.structuredForm) !== JSON.stringify(saved[monthValue].structuredForm)) {
      saved[monthValue] = repaired
      changed = true
    }
  }
  return saved
}

function repairSavedRosters(saved: Record<string, SavedRosterV2>) {
  const repaired: Record<string, SavedRosterV2> = {}
  for (const [monthValue, roster] of Object.entries(saved)) {
    repaired[monthValue] = repairSavedRosterForRecovery(roster)
  }
  return repaired
}

function normalizeSavedRostersRecord(source: Record<string, unknown>) {
  const saved: Record<string, SavedRosterV2> = {}
  for (const [monthValue, roster] of Object.entries(source)) {
    const candidate = roster as Partial<SavedRosterV2>
    if (
      roster &&
      typeof roster === 'object' &&
      candidate.version === 2 &&
      typeof candidate.month === 'string' &&
      Array.isArray(candidate.staff) &&
      candidate.structuredForm &&
      candidate.schedule &&
      candidate.manualAssignments
    ) {
      saved[monthValue] = candidate as SavedRosterV2
      continue
    }
    const migrated = migrateSavedRoster(monthValue, roster)
    if (migrated) saved[monthValue] = migrated
  }
  return saved
}

function readBrowserSavedRosters(): Record<string, SavedRosterV2> {
  const saved: Record<string, SavedRosterV2> = {}
  const legacyRaw = localStorage.getItem(savedRostersKeyLegacy)
  if (legacyRaw) {
    try {
      const parsedLegacy = JSON.parse(legacyRaw) as Record<string, unknown>
      Object.assign(saved, normalizeSavedRostersRecord(parsedLegacy))
    } catch {
      // Ignore legacy data that cannot be parsed.
    }
  }
  const raw = localStorage.getItem(savedRostersKeyV2)
  if (!raw) return repairSavedRosters(saved)
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    Object.assign(saved, normalizeSavedRostersRecord(parsed))
  } catch {
    return repairSavedRosters(saved)
  }
  return repairSavedRosters(saved)
}

function buildPreviousMonthTail(monthValue: string, staff: string[], savedRosters: Record<string, SavedRosterV2>): PreviousMonthTail {
  const previousMonth = previousMonthValue(monthValue)
  const previousRoster = savedRosters[previousMonth]
  if (!previousRoster) return {}

  const previousDays = getMonthDays(previousMonth)
  const lastDay = previousDays[previousDays.length - 1]
  const tails: PreviousMonthTail = {}
  for (const person of staff) {
    const personSchedule = previousRoster.schedule[person]
    if (!personSchedule) continue
    const lastShift = personSchedule[lastDay] ?? 'OFF'
    let consecutiveWorkDays = 0
    let consecutiveOffDays = 0
    for (let index = previousDays.length - 1; index >= 0; index -= 1) {
      const code = personSchedule[previousDays[index]] ?? 'OFF'
      if (isNonWorkCode(code)) break
      consecutiveWorkDays += 1
    }
    for (let index = previousDays.length - 1; index >= 0; index -= 1) {
      const code = personSchedule[previousDays[index]] ?? 'OFF'
      if (!isNonWorkCode(code)) break
      consecutiveOffDays += 1
    }
    tails[person] = { lastShift, consecutiveWorkDays, consecutiveOffDays }
  }
  return tails
}

function hasRequiredStaff(conditions: ParsedConditions) {
  const shiftCodes = Object.values(conditions.shifts)
    .filter((shift) => shift.auto)
    .map((shift) => shift.code)

  return shiftCodes.some(
    (code) =>
      (conditions.weekdayNeed[code] ?? 0) > 0 ||
      (conditions.saturdayNeed[code] ?? 0) > 0 ||
      (conditions.sundayNeed[code] ?? 0) > 0 ||
      (conditions.holidayNeed[code] ?? 0) > 0,
  )
}

function App() {
  const initialMonth = useMemo(() => currentMonthValue(), [])
  const [month, setMonth] = useState(initialMonth)
  const [staff, setStaff] = useState(defaultStaff)
  const [newStaff, setNewStaff] = useState('')
  const [structuredForm, setStructuredForm] = useState<StructuredForm>(defaultStructuredForm)
  const [isPanelOpen, setIsPanelOpen] = useState(true)
  const [isSolving, setIsSolving] = useState(false)
  const [lastSolveMessage, setLastSolveMessage] = useState('まだ自動作成は実行されていません。')
  const [lastReport, setLastReport] = useState<SolveReport | null>(null)
  const [isReportOpen, setIsReportOpen] = useState(false)
  const [resultNotice, setResultNotice] = useState<ResultNotice | null>(null)
  const [savedRosters, setSavedRosters] = useState<Record<string, SavedRosterV2>>({})
  const savedMonths = useMemo(() => Object.keys(savedRosters).sort(), [savedRosters])
  const parsedConditions = useMemo(
    () => buildConditionsFromForm(structuredForm, staff, month),
    [structuredForm, staff, month],
  )
  const [schedule, setSchedule] = useState<Schedule>(() =>
    blankSchedule(defaultStaff, getMonthDays(initialMonth)),
  )
  const [manualAssignments, setManualAssignments] = useState<ManualAssignments>({})

  useEffect(() => {
    let cancelled = false
    const syncStoredRosters = async () => {
      const browserSaved = readBrowserSavedRosters()
      const fileSaved = repairSavedRosters(normalizeSavedRostersRecord(await fetchStoredRosters()))
      const merged = repairSavedRosters({ ...browserSaved, ...fileSaved })
      if (cancelled) return
      setSavedRosters(merged)
      if (Object.keys(fileSaved).length === 0 && Object.keys(browserSaved).length > 0) {
        await persistStoredRosters(merged)
      }
    }
    void syncStoredRosters()
    return () => {
      cancelled = true
    }
  }, [])

  const days = useMemo(() => getMonthDays(month), [month])
  const allShiftOptions = useMemo(
    () => [
      'OFF',
      'PAID',
      '特休',
      ...structuredForm.shifts.filter((s) => s.code.trim()).map((s) => s.code.trim().toUpperCase()).sort(),
    ],
    [structuredForm.shifts],
  )
  const zoneOptions = useMemo(
    () => structuredForm.coverageRules.map((_rule, index) => ({
      code: String(index + 1),
      label: `区分${index + 1}`,
    })),
    [structuredForm.coverageRules],
  )
  const zoneLabel = (zoneCode: string) =>
    zoneOptions.find((option) => option.code === zoneCode)?.label ?? `区分${zoneCode}`
  const visibleSchedule = useMemo(
    () => sanitizeSchedule(schedule, staff, month, days, parsedConditions, manualAssignments),
    [days, manualAssignments, month, parsedConditions, schedule, staff],
  )
  const updateShift = (index: number, patch: Partial<ShiftForm>) => {
    setStructuredForm((current) => ({
      ...current,
      shifts: current.shifts.map((shift, shiftIndex) =>
        shiftIndex === index ? { ...shift, ...patch } : shift,
      ),
    }))
  }

  const updateStaffing = (code: string, kind: 'weekday' | 'saturday' | 'sunday' | 'holiday', value: string) => {
    setStructuredForm((current) => ({
      ...current,
      staffing: {
        ...current.staffing,
        [code]: {
          ...(current.staffing[code] ?? emptyStaffingEntry()),
          [kind]: Math.max(0, Number(value) || 0),
        },
      },
    }))
  }

  const updateZoneCodes = (values: string[], nextValue: string) => {
    if (!nextValue) return values
    return values.includes(nextValue) ? values.filter((value) => value !== nextValue) : [...values, nextValue]
  }

  const updateStaffingZones = (
    code: string,
    kind: 'weekdayZones' | 'saturdayZones' | 'sundayZones' | 'holidayZones',
    value: string,
  ) => {
    setStructuredForm((current) => {
      const entry = current.staffing[code] ?? emptyStaffingEntry()
      return {
        ...current,
        staffing: {
          ...current.staffing,
          [code]: {
            ...entry,
            [kind]: updateZoneCodes(entry[kind] ?? [], value),
          },
        },
      }
    })
  }

  const updateFixedRule = (index: number, patch: Partial<FixedRuleForm>) => {
    setStructuredForm((current) => ({
      ...current,
      fixedRules: current.fixedRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }))
  }

  const updateForbiddenRule = (index: number, patch: Partial<ForbiddenRuleForm>) => {
    setStructuredForm((current) => ({
      ...current,
      forbiddenRules: current.forbiddenRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }))
  }

  const updateSpecialNeed = (index: number, patch: Partial<SpecialNeedForm>) => {
    setStructuredForm((current) => ({
      ...current,
      specialNeeds: current.specialNeeds.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }))
  }

  const addShift = () => {
    setStructuredForm((current) => ({ ...current, shifts: [...current.shifts, { code: '', time: '', auto: true }] }))
  }

  const addFixedRule = () => {
    setStructuredForm((current) => ({ ...current, fixedRules: [...current.fixedRules, { people: '', shift: '' }] }))
  }

  const addAttribute = () => {
    setStructuredForm((current) => ({ ...current, attributes: [...current.attributes, { name: '' }] }))
  }

  const updateAttribute = (index: number, name: string) => {
    setStructuredForm((current) => ({
      ...current,
      attributes: current.attributes.map((attribute, attributeIndex) =>
        attributeIndex === index ? { name } : attribute,
      ),
    }))
  }

  const updateStaffAttribute = (person: string, attribute: string) => {
    setStructuredForm((current) => ({
      ...current,
      staffAttributes: { ...current.staffAttributes, [person]: attribute },
    }))
  }

  const addExcludedAttribute = () => {
    setStructuredForm((current) => ({ ...current, excludedAttributes: [...current.excludedAttributes, ''] }))
  }

  const updateExcludedAttribute = (index: number, value: string) => {
    setStructuredForm((current) => ({
      ...current,
      excludedAttributes: current.excludedAttributes.map((attribute, attributeIndex) =>
        attributeIndex === index ? value : attribute,
      ),
    }))
  }

  const addRandomLeaveRule = () => {
    setStructuredForm((current) => ({
      ...current,
      randomLeaveRules: [...current.randomLeaveRules, { person: '', leaveType: 'PAID', days: 1 }],
    }))
  }

  const updateRandomLeaveRule = (index: number, patch: Partial<RandomLeaveRuleForm>) => {
    setStructuredForm((current) => ({
      ...current,
      randomLeaveRules: current.randomLeaveRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }))
  }

  const addCoverageRule = () => {
    setStructuredForm((current) => ({
      ...current,
      coverageRules: [...current.coverageRules, { label: '', conditions: [] }],
    }))
  }

  const updateCoverageRule = (index: number, patch: Partial<CoverageRuleForm>) => {
    setStructuredForm((current) => ({
      ...current,
      coverageRules: current.coverageRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }))
  }

  const addCoverageCondition = (ruleIndex: number) => {
    setStructuredForm((c) => ({
      ...c,
      coverageRules: c.coverageRules.map((rule, i) =>
        i === ruleIndex
          ? { ...rule, conditions: [...rule.conditions, { attribute: '', count: 1 }] }
          : rule,
      ),
    }))
  }

  const updateCoverageCondition = (ruleIndex: number, condIndex: number, patch: Partial<CoverageCondition>) => {
    setStructuredForm((c) => ({
      ...c,
      coverageRules: c.coverageRules.map((rule, i) =>
        i === ruleIndex
          ? { ...rule, conditions: rule.conditions.map((cond, j) => j === condIndex ? { ...cond, ...patch } : cond) }
          : rule,
      ),
    }))
  }

  const removeCoverageCondition = (ruleIndex: number, condIndex: number) => {
    setStructuredForm((c) => ({
      ...c,
      coverageRules: c.coverageRules.map((rule, i) =>
        i === ruleIndex
          ? { ...rule, conditions: rule.conditions.filter((_, j) => j !== condIndex) }
          : rule,
      ),
    }))
  }

  const insertCoverageCondition = (ruleIndex: number, condIndex: number) => {
    setStructuredForm((c) => ({
      ...c,
      coverageRules: c.coverageRules.map((rule, i) => {
        if (i !== ruleIndex) return rule
        const next = [...rule.conditions]
        next.splice(condIndex + 1, 0, { attribute: '', count: 1 })
        return { ...rule, conditions: next }
      }),
    }))
  }

  const addForbiddenRule = () => {
    setStructuredForm((current) => ({ ...current, forbiddenRules: [...current.forbiddenRules, { person: '', weekday: '日曜', shift: '' }] }))
  }

  const addSpecialNeed = () => {
    setStructuredForm((current) => ({ ...current, specialNeeds: [...current.specialNeeds, { day: 1, shift: '', count: 1, zoneCodes: [] }] }))
  }

  const addStaff = () => {
    const name = newStaff.trim()
    if (!name || staff.includes(name)) return
    const nextStaff = [...staff, name]
    setStaff(nextStaff)
    setSchedule((current) => mergeScheduleShape(current, nextStaff, days))
    setManualAssignments((current) => pruneManualAssignments(current, nextStaff, month, days))
    setNewStaff('')
  }

  const removeStaff = (person: string) => {
    const nextStaff = staff.filter((item) => item !== person)
    setStaff(nextStaff)
    setSchedule((current) => mergeScheduleShape(current, nextStaff, days))
    setManualAssignments((current) => pruneManualAssignments(current, nextStaff, month, days))
  }

  const moveStaff = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= staff.length) return
    const nextStaff = [...staff]
    const [person] = nextStaff.splice(index, 1)
    nextStaff.splice(targetIndex, 0, person)
    setStaff(nextStaff)
  }

  const removeShift = (index: number) => {
    setStructuredForm((c) => ({ ...c, shifts: c.shifts.filter((_, i) => i !== index) }))
  }
  const insertShift = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.shifts]
      next.splice(index + 1, 0, { code: '', time: '', auto: true })
      return { ...c, shifts: next }
    })
  }

  const removeFixedRule = (index: number) => {
    setStructuredForm((c) => ({ ...c, fixedRules: c.fixedRules.filter((_, i) => i !== index) }))
  }
  const insertFixedRule = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.fixedRules]
      next.splice(index + 1, 0, { people: '', shift: '' })
      return { ...c, fixedRules: next }
    })
  }

  const removeAttribute = (index: number) => {
    setStructuredForm((c) => ({ ...c, attributes: c.attributes.filter((_, i) => i !== index) }))
  }
  const insertAttribute = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.attributes]
      next.splice(index + 1, 0, { name: '' })
      return { ...c, attributes: next }
    })
  }

  const removeCoverageRule = (index: number) => {
    setStructuredForm((c) => ({ ...c, coverageRules: c.coverageRules.filter((_, i) => i !== index) }))
  }
  const insertCoverageRule = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.coverageRules]
      next.splice(index + 1, 0, { label: '', conditions: [] })
      return { ...c, coverageRules: next }
    })
  }

  const removeExcludedAttribute = (index: number) => {
    setStructuredForm((c) => ({ ...c, excludedAttributes: c.excludedAttributes.filter((_, i) => i !== index) }))
  }
  const insertExcludedAttribute = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.excludedAttributes]
      next.splice(index + 1, 0, '')
      return { ...c, excludedAttributes: next }
    })
  }

  const removeRandomLeaveRule = (index: number) => {
    setStructuredForm((c) => ({ ...c, randomLeaveRules: c.randomLeaveRules.filter((_, i) => i !== index) }))
  }
  const insertRandomLeaveRule = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.randomLeaveRules]
      next.splice(index + 1, 0, { person: '', leaveType: 'PAID', days: 1 })
      return { ...c, randomLeaveRules: next }
    })
  }

  const removeForbiddenRule = (index: number) => {
    setStructuredForm((c) => ({ ...c, forbiddenRules: c.forbiddenRules.filter((_, i) => i !== index) }))
  }
  const insertForbiddenRule = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.forbiddenRules]
      next.splice(index + 1, 0, { person: '', weekday: '日曜', shift: '' })
      return { ...c, forbiddenRules: next }
    })
  }

  const removeSpecialNeed = (index: number) => {
    setStructuredForm((c) => ({ ...c, specialNeeds: c.specialNeeds.filter((_, i) => i !== index) }))
  }
  const insertSpecialNeed = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.specialNeeds]
      next.splice(index + 1, 0, { day: 1, shift: '', count: 1, zoneCodes: [] })
      return { ...c, specialNeeds: next }
    })
  }

  const changeMonth = (value: string) => {
    const nextDays = getMonthDays(value)
    setMonth(value)
    setSchedule((current) => mergeScheduleShape(current, staff, nextDays))
    setManualAssignments((current) => pruneManualAssignments(current, staff, value, nextDays))
  }

  const applySavedRoster = (roster: SavedRosterV2) => {
    const repairedRoster = repairSavedRosterForRecovery(roster)
    const restoredDays = getMonthDays(repairedRoster.month)
    const restoredStructuredForm = compactStructuredForm(repairedRoster.structuredForm)
    const restoredManualAssignments = pruneManualAssignments(
      repairedRoster.manualAssignments,
      repairedRoster.staff,
      repairedRoster.month,
      restoredDays,
    )
    const restoredConditions = buildConditionsFromForm(restoredStructuredForm, repairedRoster.staff, repairedRoster.month)
    setMonth(repairedRoster.month)
    setStaff(repairedRoster.staff)
    setStructuredForm(restoredStructuredForm)
    setManualAssignments(restoredManualAssignments)
    setSchedule(sanitizeSchedule(repairedRoster.schedule, repairedRoster.staff, repairedRoster.month, restoredDays, restoredConditions, restoredManualAssignments))
    setLastReport(null)
    setLastSolveMessage('')
  }

  const saveCurrentRoster = async () => {
    const saved = { ...savedRosters }
    const cleanManualAssignments = buildFixedAssignmentsForSolve(manualAssignments, staff, month, days)
    const cleanSchedule = sanitizeSchedule(visibleSchedule, staff, month, days, parsedConditions, cleanManualAssignments)
    saved[month] = {
      version: 2,
      month,
      staff,
      structuredForm,
      schedule: cleanSchedule,
      manualAssignments: cleanManualAssignments,
    }
    setSavedRosters(saved)
    try {
      await persistStoredRosters(saved)
      setResultNotice({
        kind: 'success',
        title: '保存しました',
        message: `${month} の勤務表を保存しました。`,
      })
    } catch (error) {
      setSavedRosters(savedRosters)
      setResultNotice({
        kind: 'failure',
        title: '保存できませんでした',
        message: error instanceof Error ? error.message : '保存データファイルに書き込めませんでした。',
      })
    }
  }

  const loadCurrentRoster = async () => {
    const saved = repairSavedRosters(normalizeSavedRostersRecord(await fetchStoredRosters()))
    setSavedRosters(saved)
    const roster = saved[month]
    if (!roster) {
      setResultNotice({
        kind: 'failure',
        title: '呼び出せませんでした',
        message: `${month} の保存データがありません。`,
      })
      return
    }
    applySavedRoster(roster)
    setResultNotice({
      kind: 'success',
      title: '呼び出しました',
      message: `${month} の勤務表を呼び出しました。`,
    })
  }

  const solveWithCpSat = async () => {
    if (!hasRequiredStaff(parsedConditions)) {
      const message = '自由条件から必要人数を読み取れませんでした。例: A勤務 7:00〜16:00 平日3人 土日1人'
      setLastSolveMessage(message)
      setLastReport({
        title: '作成できませんでした',
        summary: message,
        warnings: ['勤務区分は読み取れていても、平日3人・土日1人などの必要人数が0人扱いになっています。'],
        suggestions: ['「A勤務 7:00〜16:00 平日3人 土日1人」の形式で入力してください。'],
        stats: {},
      })
      setResultNotice({
        kind: 'failure',
        title: '作成できませんでした',
        message: 'レポートを確認してください',
      })
      return
    }

    setIsSolving(true)
    try {
      const fixedAssignments = buildFixedAssignmentsForSolve(manualAssignments, staff, month, days)
      setSchedule((current) => sanitizeSchedule(current, staff, month, days, parsedConditions, fixedAssignments))

      const result = await postSolveRequest({
        staff,
        month,
        conditions: parsedConditions,
        fixedAssignments,
        previousMonthTail: buildPreviousMonthTail(month, staff, savedRosters),
      })
      setLastSolveMessage(result.message)
      setLastReport(result.report ?? null)
      if ((result.status === 'optimal' || result.status === 'feasible') && result.schedule) {
        setSchedule(
          Object.fromEntries(
            Object.entries(result.schedule).map(([person, assignments]) => [
              person,
              Object.fromEntries(
                Object.entries(assignments).map(([day, code]) => [Number(day), code]),
              ) as Record<number, string>,
            ]),
          ),
        )
        setResultNotice({
          kind: 'success',
          title: '作成できました',
          message: '勤務表を作成しました。',
        })
        return
      }
      setResultNotice({
        kind: 'failure',
        title: '作成できませんでした',
        message: 'レポートを確認してください',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CP-SATで勤務表を作成できませんでした。'
      setLastSolveMessage(message)
      setLastReport({
        title: '作成できませんでした',
        summary: message,
        warnings: [],
        suggestions: ['Python APIが起動しているか確認してください。'],
        stats: {},
      })
      setResultNotice({
        kind: 'failure',
        title: '作成できませんでした',
        message: 'レポートを確認してください',
      })
    } finally {
      setIsSolving(false)
    }
  }

  const exportExcel = async () => {
    await exportRosterExcel({
      days,
      month,
      schedule: visibleSchedule,
      shifts: structuredForm.shifts,
      staff,
      weekdayLabel,
    })
  }

  return (
    <main className={`app-shell ${isPanelOpen ? '' : 'panel-closed'}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Shift Roster Builder</p>
          <h1>勤務表作成</h1>
        </div>
        <div className="top-actions">
          <button type="button" className="ghost" onClick={() => setIsPanelOpen((open) => !open)} title="自由条件を開閉">
            <Menu size={20} />
          </button>
          <button type="button" className="ghost" onClick={() => setIsReportOpen(true)} disabled={!lastReport} title="作成レポート">
            <FileText size={18} />
            レポート
          </button>
          <button type="button" className="ghost" onClick={() => void exportExcel()}>
            <Download size={18} />
            Excel
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="control-panel">
          <div className="panel-command-row">
            <button type="button" onClick={solveWithCpSat} disabled={isSolving}>
              <Sparkles size={18} />
              {isSolving ? '作成中' : '自動作成'}
            </button>
            <button type="button" className="reset-button compact-reset" onClick={() => {
              setSchedule(blankSchedule(staff, days))
              setManualAssignments({})
            }}>
              <RotateCcw size={18} />
              初期化
            </button>
            <button type="button" onClick={saveCurrentRoster}>
              保存
            </button>
            <button type="button" onClick={loadCurrentRoster}>
              呼び出し
            </button>
          </div>
          <p className="saved-months">
            保存済み: {savedMonths.length > 0 ? savedMonths.join(' / ') : 'なし'}
          </p>

          <label className="month-picker panel-month">
            <CalendarDays size={18} />
            <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} />
          </label>

          <section>
            <h2>自動勤務設定</h2>
            <p className="section-desc">各勤務の平日・土・日・祝の必要人数と区分です。区分は複数設定可でいずれかを満たせばOKです。</p>
            {structuredForm.shifts.filter((s) => s.code.trim() && s.auto).length === 0 && (
              <button type="button" className="inline-add" onClick={addShift}><Plus size={15} />追加</button>
            )}
            {structuredForm.shifts
              .filter((s) => s.code.trim() && s.auto)
              .flatMap((s) => {
                const code = s.code.toUpperCase()
                const entry = structuredForm.staffing[code] ?? emptyStaffingEntry()
                return ([
                  { key: `${code}-weekday`, label: `${code}平日`, dayType: 'weekday' as const, zoneKey: 'weekdayZones' as const, value: entry.weekday, zones: entry.weekdayZones ?? [] },
                  { key: `${code}-saturday`, label: `${code}土曜`, dayType: 'saturday' as const, zoneKey: 'saturdayZones' as const, value: entry.saturday ?? 0, zones: entry.saturdayZones ?? [] },
                  { key: `${code}-sunday`, label: `${code}日曜`, dayType: 'sunday' as const, zoneKey: 'sundayZones' as const, value: entry.sunday ?? 0, zones: entry.sundayZones ?? [] },
                  { key: `${code}-holiday`, label: `${code}祝日`, dayType: 'holiday' as const, zoneKey: 'holidayZones' as const, value: entry.holiday ?? 0, zones: entry.holidayZones ?? [] },
                ] as const).map(({ key, label, dayType, zoneKey, value, zones }) => (
                  <div className="staffing-row-flat" key={key}>
                    <span className="staffing-row-label">{label}</span>
                    <input type="number" min="0" value={value} onChange={(e) => updateStaffing(code, dayType, e.target.value)} />
                    <div className="staffing-zones-row">
                      <span className="staffing-zone-label">区分</span>
                      <select className="zone-select" value="" onChange={(e) => updateStaffingZones(code, zoneKey, e.target.value)}>
                        <option value="">追加</option>
                        {zoneOptions.map((option) => (
                          <option key={option.code} value={option.code}>{option.label}</option>
                        ))}
                      </select>
                      {zones.map((zone) => (
                        <button type="button" className="zone-chip" key={zone} onClick={() => updateStaffingZones(code, zoneKey, zone)}>
                          {zoneLabel(zone)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              })}
          </section>

          <section>
            <h2>特定日</h2>
            <p className="section-desc">指定日の該当勤務のみ必要人数・区分を上書きします。区分は複数設定可でいずれかを満たせばOKです。</p>
            {structuredForm.specialNeeds.length === 0 && (
              <button type="button" className="inline-add" onClick={addSpecialNeed}><Plus size={15} />追加</button>
            )}
            {structuredForm.specialNeeds.map((rule, index) => (
              <div key={`special-${index}`} className="special-need-block">
                <div className="special-need-top">
                  <input type="number" min="1" max="31" value={rule.day} onChange={(e) => updateSpecialNeed(index, { day: Number(e.target.value) || 1 })} aria-label="日" />
                  <select value={rule.shift} onChange={(e) => updateSpecialNeed(index, { shift: e.target.value })} aria-label="勤務帯">
                    {structuredForm.shifts.filter((s) => s.code.trim()).map((s) => (
                      <option key={s.code.toUpperCase()} value={s.code.toUpperCase()}>{s.code.toUpperCase()}</option>
                    ))}
                  </select>
                  <input type="number" min="0" value={rule.count} onChange={(e) => updateSpecialNeed(index, { count: Math.max(0, Number(e.target.value) || 0) })} aria-label="人数" />
                  <div className="row-actions">
                    <button type="button" className="row-btn" onClick={() => insertSpecialNeed(index)} title="下に追加"><Plus size={13} /></button>
                    <button type="button" className="row-btn danger" onClick={() => removeSpecialNeed(index)} title="削除"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="staffing-zones-row">
                  <span className="staffing-zone-label">区分</span>
                  <select className="zone-select" value="" onChange={(e) => updateSpecialNeed(index, { zoneCodes: updateZoneCodes(rule.zoneCodes ?? [], e.target.value) })}>
                    <option value="">追加</option>
                    {zoneOptions.map((option) => (
                      <option key={option.code} value={option.code}>{option.label}</option>
                    ))}
                  </select>
                  {(rule.zoneCodes ?? []).map((zone) => (
                    <button type="button" className="zone-chip" key={zone} onClick={() => updateSpecialNeed(index, { zoneCodes: updateZoneCodes(rule.zoneCodes ?? [], zone) })}>
                      {zoneLabel(zone)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2>固定</h2>
            <p className="section-desc">設定されたメンバーの出勤日はすべて指定の勤務が適用されます。</p>
            {structuredForm.fixedRules.length === 0 && (
              <button type="button" className="inline-add" onClick={addFixedRule}><Plus size={15} />追加</button>
            )}
            {structuredForm.fixedRules.map((rule, index) => (
              <div className="two-col-row" key={`fixed-${index}`}>
                <select value={rule.people} onChange={(event) => updateFixedRule(index, { people: event.target.value })} aria-label="固定対象者">
                  {staff.map((person) => <option key={person} value={person}>{person}</option>)}
                </select>
                <select value={rule.shift} onChange={(event) => updateFixedRule(index, { shift: event.target.value })} aria-label="固定勤務">
                  {structuredForm.shifts.filter((s) => s.code.trim()).map((s) => (
                    <option key={s.code.toUpperCase()} value={s.code.toUpperCase()}>{s.code.toUpperCase()}</option>
                  ))}
                </select>
                <div className="row-actions">
                  <button type="button" className="row-btn" onClick={() => insertFixedRule(index)} title="下に追加"><Plus size={13} /></button>
                  <button type="button" className="row-btn danger" onClick={() => removeFixedRule(index)} title="削除"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2>禁止設定</h2>
            <p className="section-desc">曜日のみ→その曜日を休みに。勤務のみ→その勤務を除いて割当。曜日+勤務→その曜日でその勤務を除く。</p>
            {structuredForm.forbiddenRules.length === 0 && (
              <button type="button" className="inline-add" onClick={addForbiddenRule}><Plus size={15} />追加</button>
            )}
            {structuredForm.forbiddenRules.map((rule, index) => (
              <div className="three-col-row" key={`forbidden-${index}`}>
                <select value={rule.person} onChange={(event) => updateForbiddenRule(index, { person: event.target.value })} aria-label="禁止対象者">
                  {staff.map((person) => <option key={person} value={person}>{person}</option>)}
                </select>
                <select value={rule.weekday} onChange={(event) => updateForbiddenRule(index, { weekday: event.target.value })} aria-label="禁止曜日">
                  <option value="">-</option>
                  <option value="月曜">月</option>
                  <option value="火曜">火</option>
                  <option value="水曜">水</option>
                  <option value="木曜">木</option>
                  <option value="金曜">金</option>
                  <option value="土曜">土</option>
                  <option value="日曜">日</option>
                  <option value="祝">祝</option>
                  <option value="土日">土日</option>
                  <option value="土日祝">土日祝</option>
                </select>
                <select value={rule.shift} onChange={(event) => updateForbiddenRule(index, { shift: event.target.value })} aria-label="禁止勤務">
                  <option value="">-</option>
                  {structuredForm.shifts.filter((s) => s.code.trim()).map((s) => (
                    <option key={s.code.toUpperCase()} value={s.code.toUpperCase()}>{s.code.toUpperCase()}</option>
                  ))}
                </select>
                <div className="row-actions">
                  <button type="button" className="row-btn" onClick={() => insertForbiddenRule(index)} title="下に追加"><Plus size={13} /></button>
                  <button type="button" className="row-btn danger" onClick={() => removeForbiddenRule(index)} title="削除"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </section>


          <section>
            <h2>除外設定</h2>
            <p className="section-desc">ここに指定した属性は、必要人数のカウント対象から外します。</p>
            {structuredForm.excludedAttributes.length === 0 && (
              <button type="button" className="inline-add" onClick={addExcludedAttribute}><Plus size={15} />追加</button>
            )}
            {structuredForm.excludedAttributes.map((attribute, index) => (
              <div className="attr-row" key={`excluded-${index}`}>
                <select value={attribute} onChange={(event) => updateExcludedAttribute(index, event.target.value)}>
                  <option value="">-</option>
                  {structuredForm.attributes.filter((item) => item.name.trim()).map((item) => (
                    <option key={item.name} value={item.name}>{item.name}</option>
                  ))}
                </select>
                <div className="row-actions">
                  <button type="button" className="row-btn" onClick={() => insertExcludedAttribute(index)} title="追加"><Plus size={13} /></button>
                  <button type="button" className="row-btn danger" onClick={() => removeExcludedAttribute(index)} title="削除"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2>有給特休条件(ランダム)</h2>
            <p className="section-desc">指定したスタッフに、有給または特休を指定日数分だけ自動で配置します。</p>
            {structuredForm.randomLeaveRules.length === 0 && (
              <button type="button" className="inline-add" onClick={addRandomLeaveRule}><Plus size={15} />追加</button>
            )}
            {structuredForm.randomLeaveRules.map((rule, index) => (
              <div className="random-leave-row" key={`random-leave-${index}`}>
                <select
                  value={rule.person}
                  onChange={(event) => updateRandomLeaveRule(index, { person: event.target.value })}
                  aria-label="スタッフ"
                >
                  <option value="">スタッフ</option>
                  {staff.map((person) => (
                    <option key={person} value={person}>{person}</option>
                  ))}
                </select>
                <select
                  value={rule.leaveType}
                  onChange={(event) => updateRandomLeaveRule(index, { leaveType: event.target.value === '特休' ? '特休' : 'PAID' })}
                  aria-label="有給or特休リスト"
                >
                  <option value="PAID">有給</option>
                  <option value="特休">特休</option>
                </select>
                <input
                  type="number"
                  min="1"
                  value={rule.days}
                  onChange={(event) => updateRandomLeaveRule(index, { days: Math.max(1, Number(event.target.value) || 1) })}
                  aria-label="日数"
                />
                <div className="row-actions">
                  <button type="button" className="row-btn" onClick={() => insertRandomLeaveRule(index)} title="下に追加"><Plus size={13} /></button>
                  <button type="button" className="row-btn danger" onClick={() => removeRandomLeaveRule(index)} title="削除"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2>区分設定</h2>
            <p className="section-desc">各勤務で必要な属性と人数を定義します。複数ある場合はすべての条件の中から可能なものが選ばれます。</p>
            {structuredForm.coverageRules.length === 0 && (
              <button type="button" className="inline-add" onClick={addCoverageRule}><Plus size={15} />追加</button>
            )}
            {structuredForm.coverageRules.map((rule, ruleIndex) => (
              <div className="coverage-card" key={`coverage-${ruleIndex}`}>
                <div className="coverage-card-header">
                  <span className="coverage-card-number">区分{ruleIndex + 1}</span>
                  <div className="row-actions">
                    <button type="button" className="row-btn" onClick={() => insertCoverageRule(ruleIndex)} title="下に追加"><Plus size={13} /></button>
                    <button type="button" className="row-btn danger" onClick={() => removeCoverageRule(ruleIndex)} title="削除"><Trash2 size={13} /></button>
                  </div>
                </div>
                {rule.conditions.length === 0 && (
                  <button type="button" className="inline-add" onClick={() => addCoverageCondition(ruleIndex)}><Plus size={13} />属性と人数</button>
                )}
                {rule.conditions.map((cond, condIndex) => (
                  <div className="coverage-condition-row" key={`cond-${ruleIndex}-${condIndex}`}>
                    <select
                      value={cond.attribute}
                      onChange={(e) => updateCoverageCondition(ruleIndex, condIndex, { attribute: e.target.value })}
                    >
                      {structuredForm.attributes.filter((a) => a.name.trim()).map((a) => (
                        <option key={a.name} value={a.name}>{a.name}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      value={cond.count}
                      onChange={(e) => updateCoverageCondition(ruleIndex, condIndex, { count: Math.max(0, Number(e.target.value) || 0) })}
                    />
                    <button type="button" className="row-btn" onClick={() => insertCoverageCondition(ruleIndex, condIndex)} title="下に追加"><Plus size={13} /></button>
                    <button type="button" className="row-btn danger" onClick={() => removeCoverageCondition(ruleIndex, condIndex)} title="削除"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ))}
          </section>

          <section>
            <h2>勤務区分</h2>
            <p className="section-desc">勤務時間帯の定義です。時間が重複する連続勤務（例：C→A・E→A）は自動的に休日を挟みます。</p>
            {structuredForm.shifts.length === 0 && (
              <button type="button" className="inline-add" onClick={addShift}><Plus size={15} />追加</button>
            )}
            <div className="structured-grid shift-form-grid">
              {structuredForm.shifts.map((shift, index) => (
                <div className="structured-row" key={`${shift.code}-${index}`}>
                  <input value={shift.code} onChange={(event) => updateShift(index, { code: event.target.value })} aria-label="勤務コード" />
                  <input value={shift.time} onChange={(event) => updateShift(index, { time: event.target.value })} aria-label="勤務時間" />
                  <label className="check-row">
                    <input type="checkbox" checked={shift.auto} onChange={(event) => updateShift(index, { auto: event.target.checked })} />
                    自動
                  </label>
                  <div className="row-actions">
                    <button type="button" className="row-btn" onClick={() => insertShift(index)} title="下に追加"><Plus size={13} /></button>
                    <button type="button" className="row-btn danger" onClick={() => removeShift(index)} title="削除"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>属性</h2>
            <p className="section-desc">メンバーに割り当てる役職の種類です。</p>
            {structuredForm.attributes.length === 0 && (
              <button type="button" className="inline-add" onClick={addAttribute}><Plus size={15} />追加</button>
            )}
            {structuredForm.attributes.map((attribute, index) => (
              <div className="attr-row" key={`attribute-${index}`}>
                <input value={attribute.name} onChange={(event) => updateAttribute(index, event.target.value)} placeholder="例: リーダー" />
                <div className="row-actions">
                  <button type="button" className="row-btn" onClick={() => insertAttribute(index)} title="下に追加"><Plus size={13} /></button>
                  <button type="button" className="row-btn danger" onClick={() => removeAttribute(index)} title="削除"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2>スタッフ</h2>
            <p className="section-desc">メンバーと属性の設定です。</p>
            <div className="add-row">
              <input value={newStaff} onChange={(event) => setNewStaff(event.target.value)} placeholder="氏名" />
              <button type="button" className="icon-button" onClick={addStaff} title="追加">
                <Plus size={17} />
              </button>
            </div>
            <div className="staff-list">
              {staff.map((person, index) => (
                <div className="staff-chip" key={person}>
                  <span>{person}</span>
                  <select
                    value={structuredForm.staffAttributes[person] ?? ''}
                    aria-label={`${person} 属性`}
                    onChange={(event) => updateStaffAttribute(person, event.target.value)}
                  >
                    <option value="">-</option>
                    {structuredForm.attributes.filter((a) => a.name.trim()).map((a) => (
                      <option key={a.name} value={a.name}>{a.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => moveStaff(index, -1)} disabled={index === 0} title="上へ">
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" onClick={() => moveStaff(index, 1)} disabled={index === staff.length - 1} title="下へ">
                    <ArrowDown size={12} />
                  </button>
                  <button type="button" onClick={() => removeStaff(person)} title={`${person}を削除`}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>基本条件</h2>
            <p className="section-desc">最大連勤を超えた連続勤務、最小連休を下回る連続休暇を禁止します。</p>
            <p className="section-desc">勤務日数は祝日分を含みません。有給がある場合は勤務日数から有休日数を引いた数を勤務日とします</p>
            <label className="form-line">
              勤務日数
              <input
                type="number"
                min="0"
                value={structuredForm.targetWorkDays ?? ''}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setStructuredForm((current) => ({
                    ...current,
                    targetWorkDays: event.target.value === '' || value <= 0 ? undefined : value,
                  }))
                }}
              />
            </label>
            <label className="form-line">
              最大連勤
              <input type="number" min="1" value={structuredForm.maxConsecutive} onChange={(event) => setStructuredForm((current) => ({ ...current, maxConsecutive: Math.max(1, Number(event.target.value) || 1) }))} />
            </label>
            <label className="form-line">
              最小連休
              <input type="number" min="0" value={structuredForm.minConsecutiveHolidays} onChange={(event) => setStructuredForm((current) => ({ ...current, minConsecutiveHolidays: Math.max(0, Number(event.target.value) || 0) }))} />
            </label>
            <label className="form-line">
              最大実施時間(秒)
              <input
                type="number"
                min="1"
                step="1"
                value={structuredForm.solveTimeLimitSeconds}
                onChange={(event) => setStructuredForm((current) => ({ ...current, solveTimeLimitSeconds: Math.max(1, Math.floor(Number(event.target.value) || 1)) }))}
              />
            </label>
            <p className="section-desc">自動作成で解を探す最大時間です。長くすると作成品質が上がる可能性がありますが、完了まで時間がかかります。</p>
          </section>

          <section>
            <h2>その他条件</h2>
            <p className="section-desc">チェック時、連勤中の勤務種別切替（例：A→C→A）を極力避けます。</p>
            <div className="condition-check-list">
              <label className="check-row">
                <input type="checkbox" checked={structuredForm.preferSameShiftStreaks} onChange={(event) => setStructuredForm((current) => ({ ...current, preferSameShiftStreaks: event.target.checked }))} />
                連勤中の勤務切替を可能な限り避ける
              </label>
              <label className="check-row">
                <input type="checkbox" checked={structuredForm.preferAttributeMemberBalance} onChange={(event) => setStructuredForm((current) => ({ ...current, preferAttributeMemberBalance: event.target.checked }))} />
                属性メンバー均等配置
              </label>
              <label className="check-row">
                <input type="checkbox" checked={structuredForm.preferShiftOverstaffBalance} onChange={(event) => setStructuredForm((current) => ({ ...current, preferShiftOverstaffBalance: event.target.checked }))} />
                各勤務均等メンバー数配置
              </label>
              <label className="check-row">
                <input type="checkbox" checked={structuredForm.preferConcentratedHolidays} onChange={(event) => setStructuredForm((current) => ({ ...current, preferConcentratedHolidays: event.target.checked }))} />
                休日を集中して長期連休を作る
              </label>
            </div>
          </section>
        </aside>

        {!isPanelOpen && (
          <button type="button" className="floating-menu" onClick={() => setIsPanelOpen(true)} title="自由条件を開く">
            <Menu size={20} />
            条件
          </button>
        )}

        <section className="roster-wrap" aria-label="勤務表">
          <div className="legend">
            <span className="shift-off">休 休み</span>
            <span className="shift-paid">有休 有給休暇</span>
            <span className="shift-tokkyuu">特休 特別休暇</span>
            {structuredForm.shifts.filter((s) => s.code.trim()).map((shift) => (
              <span key={shift.code} className={getShiftClass(shift.code)}>
                {shift.code.toUpperCase()} {shift.time || '時間未指定'}{shift.auto ? '' : ' 手動'}
              </span>
            ))}
          </div>
          <div className="table-scroll">
            <table className="roster-table">
              <thead>
                <tr>
                  <th className="sticky-name">担当</th>
                  {days.map((day) => (
                    <th key={day} className={isDayOff(month, day) ? 'weekend' : ''}>
                      <span>{day}</span>
                      <small>{weekdayLabel(month, day)}</small>
                    </th>
                  ))}
                  <th>勤務</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => {
                  const workDays = days.filter((day) => {
                    const code = visibleSchedule[person]?.[day]
                    return code && code !== 'OFF' && code !== 'PAID' && code !== '特休'
                  }).length
                  return (
                    <tr key={person}>
                      <th className="sticky-name">{person}</th>
                      {days.map((day) => {
                        const value = visibleSchedule[person]?.[day] ?? 'OFF'
                        return (
                          <td key={day} className={`${getShiftClass(value)} ${isDayOff(month, day) ? 'weekend' : ''}`}>
                            <select
                              value={value}
                              aria-label={`${person} ${day}日`}
                              onChange={(event) => {
                                const nextValue = event.target.value
                                setSchedule((current) => ({
                                  ...current,
                                  [person]: {
                                    ...current[person],
                                    [day]: nextValue,
                                  },
                                }))
                                setManualAssignments((current) => ({
                                  ...current,
                                  [person]: {
                                    ...(current[person] ?? {}),
                                    [dateKey(month, day)]: nextValue,
                                  },
                                }))
                              }}
                            >
                              {allShiftOptions.map((code) => (
                                <option key={code} value={code}>
                                  {code === 'OFF' ? '休' : code === 'PAID' ? '有休' : code}
                                </option>
                              ))}
                            </select>
                          </td>
                        )
                      })}
                      <td className="work-count">{workDays}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {isReportOpen && lastReport && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsReportOpen(false)}>
          <section className="report-modal" role="dialog" aria-modal="true" aria-label="作成レポート" onMouseDown={(event) => event.stopPropagation()}>
            <div className="report-header">
              <div>
                <p className="eyebrow">作成レポート</p>
                <h2>{lastReport.title}</h2>
              </div>
              <button type="button" className="icon-button ghost-icon" onClick={() => setIsReportOpen(false)} title="閉じる">
                <X size={18} />
              </button>
            </div>
            <div className="last-message">
              <span>前回結果</span>
              <strong>{lastSolveMessage}</strong>
            </div>
            <p className="report-summary">{lastReport.summary}</p>
            {Object.keys(lastReport.stats).length > 0 && (
              <div className="report-stats">
                {Object.entries(lastReport.stats).map(([key, value]) => (
                  <div key={key}>
                    <span>{reportStatLabel(key)}</span>
                    <strong>{reportStatValue(key, value)}</strong>
                  </div>
                ))}
              </div>
            )}
            <ReportList
              title="重大違反の詳細"
              items={(lastReport.quality?.hardViolations ?? []).map(formatQualityIssue)}
            />
            <ReportList
              title="確認事項の詳細"
              items={(lastReport.quality?.softIssues ?? []).map(formatQualityIssue)}
            />
            <ReportList title="コメント" items={lastReport.warnings} />
            <ReportList title="見直し候補" items={lastReport.suggestions} />
          </section>
        </div>
      )}

      {resultNotice && (
        <div className="notice-backdrop" role="presentation" onMouseDown={() => setResultNotice(null)}>
          <section className={`result-notice ${resultNotice.kind}`} role="dialog" aria-modal="true" aria-label="作成結果" onMouseDown={(event) => event.stopPropagation()}>
            <h2>{resultNotice.title}</h2>
            <p>{resultNotice.message}</p>
            <div className="notice-actions">
              {resultNotice.kind === 'failure' && (
                <button
                  type="button"
                  onClick={() => {
                    setResultNotice(null)
                    setIsReportOpen(true)
                  }}
                >
                  <FileText size={17} />
                  レポート
                </button>
              )}
              <button type="button" className="ghost" onClick={() => setResultNotice(null)}>
                閉じる
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="report-list">
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

export default App




