import { useMemo, useState } from 'react'
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

type ShiftCode = string
type Schedule = Record<string, Record<number, ShiftCode>>

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
  weekendNeed: Record<string, number>
  dailyNeed: Record<string, number>
  maxConsecutive: number
  minConsecutiveHolidays: number
  mustOneGroups: string[][]
  sameShiftGroups: string[][]
  paidLeaves: Record<string, number[]>
  targetWorkDays?: number
  targetWorkDaysByPerson: Record<string, number>
  fixedWeekdayShifts: Record<string, string>
  fixedDateShifts: Record<string, Record<number, string>>
  allowedShifts: Record<string, string[]>
  preferConsecutiveHolidays: boolean
  leaderGroup: string[]
  subLeaderGroup: string[]
  newcomerGroup: string[]
  requireLeadershipCoverage: boolean
  preferLeader: boolean
  coverageRules: CoverageRuleForm[]
  staffAttributes: Record<string, string>
  unavailableWeekdayShifts: Record<string, Record<string, string[]>>
  forbiddenAlwaysShifts: Record<string, string[]>
  forcedOffWeekdays: Record<string, string[]>
  requiredTransitionBreaks: Array<[string, string]>
  autoShiftCodes: string[]
  forcedOffDates: Record<string, number[]>
  holidayDates: number[]
  dateNeed: Record<number, Record<string, number>>
  preferSameShiftStreaks: boolean
}

type ShiftForm = {
  code: string
  time: string
  auto: boolean
}

type FixedRuleForm = {
  people: string
  shift: string
  includeHolidays: boolean
}

type AllowedRuleForm = {
  people: string
  shifts: string
}

type PaidLeaveForm = {
  person: string
  days: string
}

type ForbiddenRuleForm = {
  person: string
  weekday: string
  shift: string
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
type CoverageRuleForm = { label: string; conditions: CoverageCondition[] }

type StructuredForm = {
  shifts: ShiftForm[]
  staffing: Record<string, StaffingEntry>
  maxConsecutive: number
  minConsecutiveHolidays: number
  preferSameShiftStreaks: boolean
  preferConsecutiveHolidays: boolean
  fixedRules: FixedRuleForm[]
  allowedRules: AllowedRuleForm[]
  attributes: AttributeForm[]
  staffAttributes: Record<string, string>
  coverageRules: CoverageRuleForm[]
  paidLeaves: PaidLeaveForm[]
  forbiddenRules: ForbiddenRuleForm[]
  specialNeeds: SpecialNeedForm[]
}

type SolveReport = {
  title: string
  summary: string
  warnings: string[]
  suggestions: string[]
  stats: Record<string, string | number>
}

type SavedRoster = {
  month: string
  staff: string[]
  conditionRows: string[]
  structuredForm?: StructuredForm
  schedule: Schedule
  report: SolveReport | null
  message: string
  savedAt: string
}

type PreviousTail = Record<string, { lastShift: string; consecutiveWorkDays: number }>

type ResultNotice = {
  kind: 'success' | 'failure'
  title: string
  message: string
}

const defaultStaff = [
  '小里',
  '松本',
  '小伏',
  '川田',
  '梅崎',
  '浅山',
  '姫島',
  '田上',
  '竹井',
  '麻生',
  '三輪',
  '高松',
  '芦原',
  '古川',
  '杉山',
  '高田',
  '高橋',
  '田島',
  '岩田',
  '近藤',
  '今里',
  '原口',
  '吉瀬',
]

const defaultConditions = [
  'A勤務 7:00～16:00 平日3人 土日1人',
  'C勤務 15:00～0:00 平日4人 土日1人',
  'E勤務 23:00～8:00 平日4人 土日1人',
  'D勤務 20:00～5:00 手動入力',
  '最大連勤5日',
  '小里 松本 田上 のうち必ず1人',
  '高田 高橋 は常に同一勤務',
  '小伏は10日と19日有給',
  '川田は8日有給',
]

const defaultStructuredForm: StructuredForm = {
  shifts: [
    { code: 'A', time: '7:00-16:00', auto: true },
    { code: 'C', time: '15:00-0:00', auto: true },
    { code: 'E', time: '23:00-8:00', auto: true },
    { code: 'D', time: '20:00-5:00', auto: false },
    { code: '常勤', time: '9:00-18:00', auto: false },
  ],
  staffing: {
    A: { weekday: 4, saturday: 2, sunday: 2, holiday: 2, weekdayZones: [], saturdayZones: [], sundayZones: [], holidayZones: [] },
    C: { weekday: 2, saturday: 2, sunday: 2, holiday: 2, weekdayZones: [], saturdayZones: [], sundayZones: [], holidayZones: [] },
    E: { weekday: 4, saturday: 2, sunday: 2, holiday: 2, weekdayZones: [], saturdayZones: [], sundayZones: [], holidayZones: [] },
  },
  maxConsecutive: 6,
  minConsecutiveHolidays: 2,
  preferSameShiftStreaks: true,
  preferConsecutiveHolidays: true,
  fixedRules: [
    { people: '小里', shift: '常勤', includeHolidays: true },
    { people: '古川 今里', shift: 'A', includeHolidays: true },
  ],
  allowedRules: [{ people: '松本', shifts: 'A C' }],
  attributes: [{ name: 'リーダー' }, { name: 'サブリーダー' }, { name: '新人' }],
  staffAttributes: {
    松本: 'リーダー',
    小代: 'リーダー',
    川田: 'リーダー',
    楢崎: 'リーダー',
    浅山: 'リーダー',
    姫島: 'サブリーダー',
    竹井: 'サブリーダー',
    田上: 'サブリーダー',
    麻生: 'サブリーダー',
    三輪: 'サブリーダー',
    高松: 'サブリーダー',
    古瀬: '新人',
    原口: '新人',
  },
  coverageRules: [
    {
      label: 'リーダー/サブリーダー必須',
      conditions: [
        { attribute: 'リーダー', count: 1 },
        { attribute: 'サブリーダー', count: 1 },
      ],
    },
  ],
  paidLeaves: [],
  forbiddenRules: [
    { person: '小代', weekday: '日曜', shift: 'C' },
    { person: '小里', weekday: '土日祝', shift: '' },
    { person: '古川', weekday: '土日祝', shift: '' },
    { person: '今里', weekday: '土日祝', shift: '' },
  ],
  specialNeeds: [
    { day: 20, shift: 'E', count: 5, zoneCodes: [] },
    { day: 21, shift: 'A', count: 3, zoneCodes: [] },
  ],
}

const baseShiftClasses = ['shift-a', 'shift-c', 'shift-e', 'shift-d', 'shift-x']
const savedRostersKey = 'shift-roster-builder-saved-rosters'
const emptyStaffingEntry = (): StaffingEntry => ({
  weekday: 0, saturday: 0, sunday: 0, holiday: 0,
  weekdayZones: [], saturdayZones: [], sundayZones: [], holidayZones: [],
})

function updateZoneCodes(current: string[], index: number, value: string): string[] {
  const next = [...current]
  if (index < current.length) {
    if (value === '') next.splice(index, 1)
    else next[index] = value
  } else if (value !== '') {
    next.push(value)
  }
  return next
}

function parseShiftTimeMinutes(timeStr: string): { start: number; end: number } | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/)
  if (!match) return null
  const start = parseInt(match[1]) * 60 + parseInt(match[2])
  let end = parseInt(match[3]) * 60 + parseInt(match[4])
  if (end <= start) end += 24 * 60
  return { start, end }
}

function weekdayValueToKey(weekday: string): string | null {
  if (!weekday) return null
  const found = Object.entries(weekdayNameToIndex).find(([label]) => weekday === label)
  if (found) return String(found[1])
  if (['祝', '土日', '土日祝'].includes(weekday)) return weekday
  return null
}

function getMonthDays(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1)
}

function previousMonthValue(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  const date = new Date(year, month - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
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

function daysInLine(line: string) {
  return [...line.matchAll(/(\d{1,2})\s*日?/g)]
    .map((match) => Number(match[1]))
    .filter((day) => day > 0 && day <= 31)
}

function parseCount(line: string, label: string) {
  const match = line.match(
    new RegExp(`${label}(?:祝)?\\s*(?:最低|最少|少なくとも|最低でも|以上)?\\s*(\\d+)\\s*(?:人|名)`),
  )
  return match ? Number(match[1]) : undefined
}

function shiftCodesInLine(line: string) {
  return Array.from(line.matchAll(/([A-Z]|常勤|日勤|早番|遅番|夜勤)\s*(?:勤務|勤)?/gi)).map((match) =>
    match[1].toUpperCase(),
  )
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

function weekdayKeyInLine(line: string) {
  const found = Object.entries(weekdayNameToIndex).find(([label]) => line.includes(label))
  return found ? String(found[1]) : undefined
}

function nthWeekdayDay(monthValue: string, weekday: number, nth: number) {
  const [year, month] = monthValue.split('-').map(Number)
  let count = 0
  for (const day of getMonthDays(monthValue)) {
    const jsDay = new Date(year, month - 1, day).getDay()
    const mondayBased = (jsDay + 6) % 7
    if (mondayBased === weekday) {
      count += 1
      if (count === nth) return day
    }
  }
  return undefined
}

function buildConditionsFromForm(form: StructuredForm, staff: string[], monthValue: string): ParsedConditions {
  const paidLeaves: Record<string, number[]> = {}
  for (const paidLeave of form.paidLeaves) {
    const person = paidLeave.person.trim()
    if (!person) continue
    paidLeaves[person] = daysInLine(paidLeave.days)
  }

  const targetWorkDaysByPerson: Record<string, number> = {}

  // 禁止設定を先に処理し forcedOffDates を確定させる（固定シフトの除外日に使用）
  const unavailableWeekdayShifts: Record<string, Record<string, string[]>> = {}
  const forbiddenAlwaysShifts: Record<string, string[]> = {}
  const forcedOffWeekdays: Record<string, string[]> = {}
  for (const rule of form.forbiddenRules) {
    const person = rule.person.trim()
    if (!person) continue
    const weekdayKey = weekdayValueToKey(rule.weekday)
    const shift = rule.shift.trim().toUpperCase()
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
  const forcedOffDates: Record<string, number[]> = {}
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
      forcedOffDates[person] = dates
      forcedOffDateSet[person] = new Set(dates)
    }
  }

  // 固定シフト: 土曜・日曜はスキップ（禁止設定で forcedOffDates が設定された平日も除外）
  // 祝日は includeHolidays フラグで制御
  const fixedWeekdayShifts: Record<string, string> = {}
  const fixedDateShifts: Record<string, Record<number, string>> = {}
  for (const rule of form.fixedRules) {
    const shift = rule.shift.toUpperCase()
    if (!shift) continue
    const [yr, mo] = monthValue.split('-').map(Number)
    for (const person of splitPeople(rule.people, staff)) {
      fixedWeekdayShifts[person] = shift
      fixedDateShifts[person] = {}
      for (const day of getMonthDays(monthValue)) {
        const date = new Date(yr, mo - 1, day)
        const jsDay = date.getDay()
        if (jsDay === 0 || jsDay === 6) continue
        const isHoliday = HolidayJp.isHoliday(date)
        if (isHoliday && !rule.includeHolidays) continue
        if (forcedOffDateSet[person]?.has(day)) continue
        fixedDateShifts[person][day] = shift
      }
    }
  }

  const allowedShifts: Record<string, string[]> = {}
  for (const rule of form.allowedRules) {
    const shifts = splitShiftCodes(rule.shifts)
    for (const person of splitPeople(rule.people, staff)) {
      allowedShifts[person] = shifts
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

  const dateNeed: Record<number, Record<string, number>> = {}
  for (const special of form.specialNeeds) {
    if (!special.day) continue
    dateNeed[special.day] = { ...(dateNeed[special.day] ?? {}), [special.shift.toUpperCase()]: special.count }
  }

  const peopleByAttribute = (attribute: string) =>
    staff.filter((person) => form.staffAttributes[person] === attribute)

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
    weekendNeed: Object.fromEntries(
      Object.entries(form.staffing).map(([code, e]) => [
        code.toUpperCase(),
        Math.max(e.saturday ?? 0, e.sunday ?? 0, e.holiday ?? 0),
      ]),
    ),
    dailyNeed: {},
    maxConsecutive: form.maxConsecutive,
    minConsecutiveHolidays: form.minConsecutiveHolidays ?? 0,
    mustOneGroups: [],
    sameShiftGroups: [],
    paidLeaves,
    targetWorkDays: undefined,
    targetWorkDaysByPerson,
    fixedWeekdayShifts,
    fixedDateShifts,
    allowedShifts,
    preferConsecutiveHolidays: form.preferConsecutiveHolidays,
    leaderGroup: peopleByAttribute('リーダー'),
    subLeaderGroup: peopleByAttribute('サブリーダー'),
    newcomerGroup: peopleByAttribute('新人'),
    requireLeadershipCoverage: false,
    preferLeader: false,
    coverageRules: form.coverageRules,
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
    }),
    dateNeed,
    preferSameShiftStreaks: form.preferSameShiftStreaks,
  }
}

function countForShift(line: string, shift: string) {
  const match = line.match(new RegExp(`${shift}\\s*(?:勤務|勤)?\\s*(\\d+)\\s*(?:人|名)`))
  return match ? Number(match[1]) : undefined
}

function parseConditions(lines: string[], staff: string[], monthValue = '2026-06'): ParsedConditions {
  const parsed: ParsedConditions = {
    shifts: {},
    weekdayNeed: {},
    saturdayNeed: {},
    sundayNeed: {},
    holidayNeed: {},
    weekendNeed: {},
    dailyNeed: {},
    maxConsecutive: 5,
    minConsecutiveHolidays: 0,
    mustOneGroups: [],
    sameShiftGroups: [],
    paidLeaves: {},
    targetWorkDays: undefined,
    targetWorkDaysByPerson: {},
    fixedWeekdayShifts: {},
    fixedDateShifts: {},
    allowedShifts: {},
    preferConsecutiveHolidays: false,
    leaderGroup: [],
    subLeaderGroup: [],
    newcomerGroup: [],
    requireLeadershipCoverage: false,
    preferLeader: false,
    coverageRules: [],
    staffAttributes: {},
    unavailableWeekdayShifts: {},
    forbiddenAlwaysShifts: {},
    forcedOffWeekdays: {},
    requiredTransitionBreaks: [],
    autoShiftCodes: [],
    forcedOffDates: {},
    holidayDates: [],
    dateNeed: {},
    preferSameShiftStreaks: false,
  }
  let holidayCount: number | undefined
  let paidExcludedFromHolidayCount = false

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine)
    if (!line) continue

    const shiftMatch = line.match(/([A-Z]|常勤|日勤|早番|遅番|夜勤)\s*(?:勤務|勤)?/i)
    if (shiftMatch) {
      const code = shiftMatch[1].toUpperCase()
      const time = line.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/)
      const manual = /手動|入力のみ|自動.*しない/.test(line)
      const linePeople = peopleInLine(line, staff)
      parsed.shifts[code] = {
        code,
        time: time ? `${time[1]}-${time[2]}` : parsed.shifts[code]?.time ?? '',
        auto: !manual,
      }

      const weekday = parseCount(line, '平日')
      const weekend = parseCount(line, '土日') ?? parseCount(line, '土日祝') ?? parseCount(line, '休日')
      const daily = parseCount(line, '毎日') ?? parseCount(line, '日勤') ?? parseCount(line, '日')
      if (weekday !== undefined) parsed.weekdayNeed[code] = weekday
      if (weekend !== undefined) parsed.weekendNeed[code] = weekend
      if (daily !== undefined && weekday === undefined && weekend === undefined) {
        parsed.dailyNeed[code] = daily
      }
      if (linePeople.length === 0 || time || manual || weekday !== undefined || weekend !== undefined || daily !== undefined) {
        continue
      }
    }

    const maxMatch = line.match(/最大連勤\s*(\d+)\s*日?/)
    if (maxMatch) {
      parsed.maxConsecutive = Math.max(1, Number(maxMatch[1]))
      continue
    }

    const workDaysMatch = line.match(/(?:勤務日数|出勤日数|出勤)\s*(?:は|を|=|:)?\s*(\d+)\s*日/)
    if (workDaysMatch) {
      parsed.targetWorkDays = Number(workDaysMatch[1])
      continue
    }

    if (/連休|休日.*連続|休み.*連続|休日.*まとめ|休み.*まとめ/.test(line)) {
      parsed.preferConsecutiveHolidays = true
      continue
    }

    if (/勤務.*切り替わる.*避け|勤務.*切替.*避け|同じ勤務.*続/.test(line)) {
      parsed.preferSameShiftStreaks = true
      continue
    }

    const holidayMatch = line.match(/(?:休日|休み)\s*(?:は|を|=|:)?\s*(\d+)\s*日(?!に)/)
    if (holidayMatch) {
      holidayCount = Number(holidayMatch[1])
      paidExcludedFromHolidayCount = /有給除く|有休除く/.test(line)
      parsed.targetWorkDays = Math.max(0, getMonthDays(monthValue).length - holidayCount)
      continue
    }

    const leaderMatch = line.match(/^リーダーは(.+)$/)
    if (leaderMatch) {
      parsed.leaderGroup = peopleInLine(leaderMatch[1], staff)
      continue
    }

    const subLeaderMatch = line.match(/^サブリーダーは(.+)$/)
    if (subLeaderMatch) {
      parsed.subLeaderGroup = peopleInLine(subLeaderMatch[1], staff)
      continue
    }

    if (/リーダー.*サブリーダー.*必須/.test(line)) {
      parsed.requireLeadershipCoverage = true
      continue
    }

    const thirdSunday = nthWeekdayDay(monthValue, 6, 3)
    if (thirdSunday && /第三日曜前の土曜日|第三日曜日前の土曜日/.test(line)) {
      const shift = shiftCodesInLine(line)[0]
      const count = shift ? countForShift(line, shift) : undefined
      if (shift && count) parsed.dateNeed[thirdSunday - 1] = { ...(parsed.dateNeed[thirdSunday - 1] ?? {}), [shift]: count }
      continue
    }

    if (thirdSunday && /第三日曜|第三日曜日/.test(line)) {
      const shift = shiftCodesInLine(line)[0]
      const count = shift ? countForShift(line, shift) : undefined
      if (shift && count) parsed.dateNeed[thirdSunday] = { ...(parsed.dateNeed[thirdSunday] ?? {}), [shift]: count }
      continue
    }

    const people = peopleInLine(line, staff)
    if (/有給|有休|休暇/.test(line) && people.length >= 1) {
      const leaveDays = daysInLine(line)
      for (const person of people) {
        parsed.paidLeaves[person] = Array.from(
          new Set([...(parsed.paidLeaves[person] ?? []), ...leaveDays]),
        ).sort((left, right) => left - right)
      }
      continue
    }

    if (/必ず\s*1\s*人|誰か\s*1\s*人|1\s*人.*必要/.test(line) && people.length >= 2) {
      parsed.mustOneGroups.push(people)
      continue
    }

    if (/同一勤務|同じ勤務|一緒|ペア|セット/.test(line) && people.length >= 2) {
      parsed.sameShiftGroups.push(people)
      continue
    }

    const mentionedShiftCodes = shiftCodesInLine(line)
    for (const code of mentionedShiftCodes) {
      if (!parsed.shifts[code]) parsed.shifts[code] = { code, time: '', auto: true }
    }

    if (people.length >= 1 && mentionedShiftCodes.length >= 2 && /or|OR|または|どちらか/.test(line)) {
      for (const person of people) parsed.allowedShifts[person] = mentionedShiftCodes
      continue
    }

    if (people.length >= 1 && mentionedShiftCodes.length >= 1 && /固定|月\s*-\s*金|月\s*~\s*金|月金|平日/.test(line)) {
      for (const person of people) parsed.fixedWeekdayShifts[person] = mentionedShiftCodes[0]
      continue
    }

    const weekdayKey = weekdayKeyInLine(line)
    if (people.length >= 1 && mentionedShiftCodes.length >= 1 && weekdayKey && /なし|禁止|不可/.test(line)) {
      for (const person of people) {
        parsed.unavailableWeekdayShifts[person] = {
          ...(parsed.unavailableWeekdayShifts[person] ?? {}),
          [weekdayKey]: [...(parsed.unavailableWeekdayShifts[person]?.[weekdayKey] ?? []), ...mentionedShiftCodes],
        }
      }
    }
  }

  const hasPaidExcluded = /有給除く|有休除く/.test(lines.join('\n'))
  if (holidayCount !== undefined && paidExcludedFromHolidayCount) {
    const daysInMonth = getMonthDays(monthValue).length
    parsed.targetWorkDaysByPerson = Object.fromEntries(
      staff.map((person) => [
        person,
        Math.max(0, daysInMonth - holidayCount - (parsed.paidLeaves[person]?.length ?? 0)),
      ]),
    )
  } else if (parsed.targetWorkDays !== undefined && hasPaidExcluded) {
    parsed.targetWorkDaysByPerson = Object.fromEntries(
      staff.map((person) => [
        person,
        Math.max(0, parsed.targetWorkDays! - (parsed.paidLeaves[person]?.length ?? 0)),
      ]),
    )
  }

  return parsed
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

function readSavedRosters(): Record<string, SavedRoster> {
  const raw = localStorage.getItem(savedRostersKey)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, SavedRoster>
  } catch {
    return {}
  }
}

function writeSavedRosters(saved: Record<string, SavedRoster>) {
  localStorage.setItem(savedRostersKey, JSON.stringify(saved))
}

function buildPreviousTail(monthValue: string, staff: string[], maxConsecutive: number): PreviousTail {
  const previous = readSavedRosters()[previousMonthValue(monthValue)]
  if (!previous) return {}
  const previousDays = getMonthDays(previous.month)
  const tail: PreviousTail = {}

  for (const person of staff) {
    const assignments = previous.schedule[person]
    if (!assignments) continue

    let consecutiveWorkDays = 0
    for (const day of [...previousDays].reverse()) {
      const code = assignments[day]
      if (!code || code === 'OFF' || code === 'PAID') break
      consecutiveWorkDays += 1
      if (consecutiveWorkDays >= maxConsecutive) break
    }

    const lastDay = previousDays[previousDays.length - 1]
    tail[person] = {
      lastShift: assignments[lastDay] ?? 'OFF',
      consecutiveWorkDays,
    }
  }

  return tail
}

function hasRequiredStaff(conditions: ParsedConditions) {
  const shiftCodes = Object.values(conditions.shifts)
    .filter((shift) => shift.auto)
    .map((shift) => shift.code)

  return shiftCodes.some(
    (code) =>
      (conditions.weekdayNeed[code] ?? 0) > 0 ||
      (conditions.weekendNeed[code] ?? 0) > 0 ||
      (conditions.dailyNeed[code] ?? 0) > 0,
  )
}

function App() {
  const [month, setMonth] = useState('2026-06')
  const [staff, setStaff] = useState(defaultStaff)
  const [newStaff, setNewStaff] = useState('')
  const [conditionRows, setConditionRows] = useState(defaultConditions)
  const [structuredForm, setStructuredForm] = useState<StructuredForm>(defaultStructuredForm)
  const [isPanelOpen, setIsPanelOpen] = useState(true)
  const [isSolving, setIsSolving] = useState(false)
  const [lastSolveMessage, setLastSolveMessage] = useState('まだ自動作成は実行されていません。')
  const [lastReport, setLastReport] = useState<SolveReport | null>(null)
  const [isReportOpen, setIsReportOpen] = useState(false)
  const [resultNotice, setResultNotice] = useState<ResultNotice | null>(null)
  const [savedMonths, setSavedMonths] = useState(() => Object.keys(readSavedRosters()).sort())
  const parsedConditions = useMemo(
    () => buildConditionsFromForm(structuredForm, staff, month),
    [structuredForm, staff, month],
  )
  const [schedule, setSchedule] = useState<Schedule>(() =>
    blankSchedule(defaultStaff, getMonthDays('2026-06')),
  )

  const days = useMemo(() => getMonthDays(month), [month])
  const allShiftOptions = useMemo(
    () => ['OFF', 'PAID', '特休', ...structuredForm.shifts.filter((s) => s.code.trim()).map((s) => s.code.trim().toUpperCase()).sort()],
    [structuredForm.shifts],
  )
  const zoneOptions = useMemo(
    () => structuredForm.coverageRules.map((_, i) => ({
      value: String(i + 1),
      label: `区分${i + 1}`,
    })),
    [structuredForm.coverageRules],
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

  const updateStaffingZones = (
    code: string,
    dayType: 'weekday' | 'saturday' | 'sunday' | 'holiday',
    zoneCodes: string[],
  ) => {
    const zoneKey = `${dayType}Zones` as 'weekdayZones' | 'saturdayZones' | 'sundayZones' | 'holidayZones'
    setStructuredForm((current) => ({
      ...current,
      staffing: {
        ...current.staffing,
        [code]: { ...(current.staffing[code] ?? emptyStaffingEntry()), [zoneKey]: zoneCodes },
      },
    }))
  }

  const updateFixedRule = (index: number, patch: Partial<FixedRuleForm>) => {
    setStructuredForm((current) => ({
      ...current,
      fixedRules: current.fixedRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }))
  }

  const updateAllowedRule = (index: number, patch: Partial<AllowedRuleForm>) => {
    setStructuredForm((current) => ({
      ...current,
      allowedRules: current.allowedRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    }))
  }

  const updatePaidLeave = (index: number, patch: Partial<PaidLeaveForm>) => {
    setStructuredForm((current) => ({
      ...current,
      paidLeaves: current.paidLeaves.map((rule, ruleIndex) =>
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
    setStructuredForm((current) => ({ ...current, fixedRules: [...current.fixedRules, { people: '', shift: '', includeHolidays: false }] }))
  }

  const addAllowedRule = () => {
    setStructuredForm((current) => ({ ...current, allowedRules: [...current.allowedRules, { people: '', shifts: '' }] }))
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

  const addPaidLeave = () => {
    setStructuredForm((current) => ({ ...current, paidLeaves: [...current.paidLeaves, { person: '', days: '' }] }))
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
    setNewStaff('')
  }

  const removeStaff = (person: string) => {
    const nextStaff = staff.filter((item) => item !== person)
    setStaff(nextStaff)
    setSchedule((current) => mergeScheduleShape(current, nextStaff, days))
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
      next.splice(index + 1, 0, { people: '', shift: '', includeHolidays: false })
      return { ...c, fixedRules: next }
    })
  }

  const removeAllowedRule = (index: number) => {
    setStructuredForm((c) => ({ ...c, allowedRules: c.allowedRules.filter((_, i) => i !== index) }))
  }
  const insertAllowedRule = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.allowedRules]
      next.splice(index + 1, 0, { people: '', shifts: '' })
      return { ...c, allowedRules: next }
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

  const removePaidLeave = (index: number) => {
    setStructuredForm((c) => ({ ...c, paidLeaves: c.paidLeaves.filter((_, i) => i !== index) }))
  }
  const insertPaidLeave = (index: number) => {
    setStructuredForm((c) => {
      const next = [...c.paidLeaves]
      next.splice(index + 1, 0, { person: '', days: '' })
      return { ...c, paidLeaves: next }
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
  }

  const saveCurrentRoster = () => {
    const saved = readSavedRosters()
    saved[month] = {
      month,
      staff,
      conditionRows,
      structuredForm,
      schedule,
      report: lastReport,
      message: lastSolveMessage,
      savedAt: new Date().toISOString(),
    }
    writeSavedRosters(saved)
    setSavedMonths(Object.keys(saved).sort())
    setResultNotice({
      kind: 'success',
      title: '保存しました',
      message: `${month} の勤務表を保存しました。`,
    })
  }

  const loadCurrentRoster = () => {
    const saved = readSavedRosters()[month]
    if (!saved) {
      setResultNotice({
        kind: 'failure',
        title: '呼び出しできませんでした',
        message: `${month} の保存データがありません。`,
      })
      return
    }
    setStaff(saved.staff)
    setConditionRows(saved.conditionRows)
    setStructuredForm(saved.structuredForm ?? defaultStructuredForm)
    setSchedule(saved.schedule)
    setLastReport(saved.report)
    setLastSolveMessage(saved.message)
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
      // 現在のスケジュールから PAID・特休・非autoシフト（手動入力）を fixedAssignments として収集
      const fixedAssignments: Record<string, Record<number, string>> = {}
      for (const person of staff) {
        for (const day of days) {
          const code = schedule[person]?.[day]
          if (!code || code === 'OFF') continue
          // PAID・特休は常に固定
          if (code === 'PAID' || code === '特休') {
            if (!fixedAssignments[person]) fixedAssignments[person] = {}
            fixedAssignments[person][day] = code
            continue
          }
          // 非autoシフトも手動入力として固定
          const isAutoShift = parsedConditions.autoShiftCodes.includes(code)
          if (!isAutoShift) {
            if (!fixedAssignments[person]) fixedAssignments[person] = {}
            fixedAssignments[person][day] = code
          }
        }
      }

      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff,
          month,
          conditions: parsedConditions,
          previousMonthTail: buildPreviousTail(month, staff, parsedConditions.maxConsecutive),
          fixedAssignments,
        }),
      })
      if (!response.ok) throw new Error('CP-SATサーバーに接続できませんでした。')
      const result = (await response.json()) as {
        status: string
        message: string
        report?: SolveReport
        schedule?: Record<string, Record<string, string>>
      }
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

  const exportCsv = () => {
    const rows = [
      ['担当', ...days.map((day) => `${day}(${weekdayLabel(month, day)})`), '勤務日数'].join(','),
      ...staff.map((person) => {
        const workDays = days.filter((day) => {
          const code = schedule[person]?.[day]
          return code && code !== 'OFF' && code !== 'PAID' && code !== '特休'
        }).length
        return [person, ...days.map((day) => schedule[person][day]), workDays].join(',')
      }),
    ]
    const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shift-roster-${month}.csv`
    link.click()
    URL.revokeObjectURL(url)
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
          <button type="button" className="ghost" onClick={exportCsv}>
            <Download size={18} />
            CSV
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
            <button type="button" className="reset-button compact-reset" onClick={() => setSchedule(blankSchedule(staff, days))}>
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
            {structuredForm.shifts
              .filter((s) => s.code.trim() && s.auto)
              .flatMap((s) => {
                const code = s.code.toUpperCase()
                const entry = structuredForm.staffing[code] ?? emptyStaffingEntry()
                return ([
                  { key: `${code}-weekday`, label: `${code}平日`, dayType: 'weekday' as const, value: entry.weekday, zones: entry.weekdayZones ?? [] },
                  { key: `${code}-saturday`, label: `${code}土`, dayType: 'saturday' as const, value: entry.saturday ?? 0, zones: entry.saturdayZones ?? [] },
                  { key: `${code}-sunday`, label: `${code}日`, dayType: 'sunday' as const, value: entry.sunday ?? 0, zones: entry.sundayZones ?? [] },
                  { key: `${code}-holiday`, label: `${code}祝`, dayType: 'holiday' as const, value: entry.holiday ?? 0, zones: entry.holidayZones ?? [] },
                ] as const).map(({ key, label, dayType, value, zones }) => (
                  <div className="staffing-row-flat" key={key}>
                    <span className="staffing-row-label">{label}</span>
                    <input type="number" min="0" value={value} onChange={(e) => updateStaffing(code, dayType, e.target.value)} />
                    <div className="staffing-zones-row">
                      {[...zones, ''].map((zc, zi) => (
                        <select key={zi} className="zone-select" value={zc}
                          onChange={(e) => updateStaffingZones(code, dayType, updateZoneCodes(zones, zi, e.target.value))}>
                          <option value="">-</option>
                          {zoneOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
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
                  {[...(rule.zoneCodes ?? []), ''].map((zc, zi) => (
                    <select key={zi} className="zone-select" value={zc}
                      onChange={(e) => updateSpecialNeed(index, { zoneCodes: updateZoneCodes(rule.zoneCodes ?? [], zi, e.target.value) })}>
                      <option value="">-</option>
                      {zoneOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
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
            <h2>区分設定</h2>
            <p className="section-desc">各勤務で必要な属性と人数を定義します。複数ある場合はすべての条件の中から可能なものが選ばれます。</p>
            {structuredForm.coverageRules.length === 0 && (
              <button type="button" className="inline-add" onClick={addCoverageRule}><Plus size={15} />追加</button>
            )}
            {structuredForm.coverageRules.map((rule, ruleIndex) => (
              <div className="coverage-card" key={`coverage-${ruleIndex}`}>
                <div className="coverage-card-header">
                  <span className="coverage-card-number">区分 {ruleIndex + 1}</span>
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
            <label className="form-line">
              最大連勤
              <input type="number" min="1" value={structuredForm.maxConsecutive} onChange={(event) => setStructuredForm((current) => ({ ...current, maxConsecutive: Math.max(1, Number(event.target.value) || 1) }))} />
            </label>
            <label className="form-line">
              最小連休
              <input type="number" min="0" value={structuredForm.minConsecutiveHolidays} onChange={(event) => setStructuredForm((current) => ({ ...current, minConsecutiveHolidays: Math.max(0, Number(event.target.value) || 0) }))} />
            </label>
          </section>

          <section>
            <h2>その他条件</h2>
            <p className="section-desc">チェック時、連勤中の勤務種別切替（例：A→C→A）を極力避けます。</p>
            <div>
              <label className="check-row">
                <input type="checkbox" checked={structuredForm.preferSameShiftStreaks} onChange={(event) => setStructuredForm((current) => ({ ...current, preferSameShiftStreaks: event.target.checked }))} />
                連勤中の勤務切替を可能な限り避ける
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
                    const code = schedule[person]?.[day]
                    return code && code !== 'OFF' && code !== 'PAID' && code !== '特休'
                  }).length
                  return (
                    <tr key={person}>
                      <th className="sticky-name">{person}</th>
                      {days.map((day) => {
                        const value = schedule[person]?.[day] ?? 'OFF'
                        return (
                          <td key={day} className={`${getShiftClass(value)} ${isDayOff(month, day) ? 'weekend' : ''}`}>
                            <select
                              value={value}
                              aria-label={`${person} ${day}日`}
                              onChange={(event) =>
                                setSchedule((current) => ({
                                  ...current,
                                  [person]: {
                                    ...current[person],
                                    [day]: event.target.value,
                                  },
                                }))
                              }
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
                <p className="eyebrow">Solver Report</p>
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
                    <span>{key}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            )}
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
