import type { Fill, Font, Worksheet } from 'exceljs'

type Schedule = Record<string, Record<number, string>>
type ShiftForm = {
  code: string
  time: string
  auto: boolean
}

type ExportRosterExcelArgs = {
  days: number[]
  month: string
  schedule: Schedule
  shifts: ShiftForm[]
  staff: string[]
  weekdayLabel: (month: string, day: number) => string
}

type BorderStyle = 'thin' | 'medium'

const displayCode = (code: string) => (code === 'OFF' ? '休' : code === 'PAID' ? '有休' : code)
const summaryLabel = (code: string) => (code === 'OFF' ? '休' : code === 'PAID' ? '有休' : code)
const highlightLabel = (code: string) => (code === 'OFF' ? '休み' : code === 'PAID' ? '有休' : code)

function isWorkCode(code: string | undefined) {
  return Boolean(code) && code !== 'OFF' && code !== 'PAID' && code !== '特休'
}

function workDayCount(schedule: Schedule, person: string, days: number[]) {
  return days.filter((day) => isWorkCode(schedule[person]?.[day])).length
}

function uniqueWorkShiftCodes(shifts: ShiftForm[], schedule: Schedule, staff: string[], days: number[]) {
  return shifts
    .map((shift) => shift.code.trim().toUpperCase())
    .filter(Boolean)
    .filter((code, index, list) => list.indexOf(code) === index)
    .filter((code) =>
      days.some((day) =>
        staff.some((person) => (schedule[person]?.[day] ?? '').toUpperCase() === code),
      ),
    )
}

function usedSpecialCodes(schedule: Schedule, staff: string[], days: number[]) {
  return (['OFF', 'PAID', '特休'] as const).filter((code) =>
    days.some((day) =>
      staff.some((person) => (schedule[person]?.[day] ?? 'OFF') === code),
    ),
  )
}

function highlightFillHex(code: string) {
  if (code === 'OFF') return 'FCE4D6'
  if (code === 'PAID') return 'FFF2CC'
  if (code === '特休') return 'E2EFDA'
  return 'BDD7EE'
}

function createWorkbookStyles() {
  const border = (style: BorderStyle = 'thin') => ({ style, color: { argb: 'FF000000' } })
  const allBorders = (style: BorderStyle = 'thin') => ({
    top: border(style),
    bottom: border(style),
    left: border(style),
    right: border(style),
  })
  const solidFill = (hex: string): Fill => ({
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${hex}` },
  })
  const baseFont = (bold = false, size = 10): Partial<Font> => ({
    name: 'Yu Gothic',
    size,
    bold,
  })

  return { allBorders, baseFont, border, solidFill }
}

function getStaffByCode(
  code: string,
  day: number,
  isSpecial: boolean,
  schedule: Schedule,
  staff: string[],
) {
  return isSpecial
    ? staff.filter((person) => (schedule[person]?.[day] ?? 'OFF') === code)
    : staff.filter((person) => (schedule[person]?.[day] ?? '').toUpperCase() === code)
}

function renderHighlightBlock(
  ws: Worksheet,
  code: string,
  isSpecial: boolean,
  args: ExportRosterExcelArgs,
  styles: ReturnType<typeof createWorkbookStyles>,
) {
  const { allBorders, baseFont, border, solidFill } = styles
  const shiftDef = !isSpecial
    ? args.shifts.find((shift) => shift.code.trim().toUpperCase() === code)
    : undefined
  const fullLabel = isSpecial
    ? highlightLabel(code)
    : shiftDef?.time
      ? `${code} (${shiftDef.time})`
      : code
  const staffByDay = args.days.map((day) => getStaffByCode(code, day, isSpecial, args.schedule, args.staff))
  const maxCount = Math.max(...staffByDay.map((items) => items.length), 1)

  for (let slot = 0; slot < maxCount; slot += 1) {
    const personRow = ws.addRow([
      slot === 0 ? fullLabel : '',
      ...args.days.map((_, dayIndex) => staffByDay[dayIndex][slot] ?? ''),
      '',
    ])
    personRow.height = 16
    personRow.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col === 1) {
        cell.fill = solidFill(highlightFillHex(code))
        cell.font = baseFont(true)
        cell.border = {
          top: slot === 0 ? border() : undefined,
          bottom: border(),
          left: border('medium'),
          right: border(),
        }
      } else {
        cell.font = baseFont(false, 9)
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = allBorders()
      }
    })
  }

  const counts = args.days.map((_, dayIndex) => staffByDay[dayIndex].length)
  const countRow = ws.addRow([`${highlightLabel(code)} 計`, ...counts, counts.reduce((sum, count) => sum + count, 0)])
  countRow.height = 16
  countRow.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.fill = solidFill('FCE4D6')
    cell.font = baseFont(true)
    cell.border = {
      top: border(),
      bottom: border('medium'),
      left: col === 1 ? border('medium') : border(),
      right: border(),
    }
    if (col > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
}

export async function exportRosterExcel(args: ExportRosterExcelArgs) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Shift Roster Builder'
  const worksheet = workbook.addWorksheet('勤務表')
  const styles = createWorkbookStyles()
  const { allBorders, baseFont, solidFill } = styles
  const totalCols = args.days.length + 2

  worksheet.columns = [
    { width: 14 },
    ...args.days.map(() => ({ width: 6 })),
    { width: 10 },
  ]

  const titleRow = worksheet.addRow([`${args.month} 勤務表`, ...Array(totalCols - 1).fill('')])
  worksheet.mergeCells(titleRow.number, 1, titleRow.number, totalCols)
  const titleCell = titleRow.getCell(1)
  titleCell.fill = solidFill('D9EAF7')
  titleCell.font = baseFont(true, 14)
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  titleRow.height = 24

  const headerRow = worksheet.addRow([
    '担当',
    ...args.days.map((day) => `${day}(${args.weekdayLabel(args.month, day)})`),
    '勤務日数',
  ])
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = solidFill('E2F0D9')
    cell.font = baseFont(true)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allBorders()
  })
  headerRow.height = 28
  worksheet.views = [{ state: 'frozen', ySplit: 2 }]

  for (const person of args.staff) {
    const row = worksheet.addRow([
      person,
      ...args.days.map((day) => displayCode(args.schedule[person]?.[day] ?? 'OFF')),
      workDayCount(args.schedule, person, args.days),
    ])
    row.height = 16
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = allBorders()
      if (col === 1) {
        cell.font = baseFont(true)
        return
      }
      cell.font = baseFont()
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (col > args.days.length + 1) {
        cell.fill = solidFill('F2F2F2')
        return
      }
      const value = String(cell.value ?? '')
      if (value === '休') cell.fill = solidFill('FCE4D6')
      else if (value === '有休' || value === '特休') cell.fill = solidFill('FFF2CC')
    })
  }

  const workShiftCodes = uniqueWorkShiftCodes(args.shifts, args.schedule, args.staff, args.days)
  const specialCodes = usedSpecialCodes(args.schedule, args.staff, args.days)

  worksheet.addRow([])
  const sectionRow = worksheet.addRow(['人員ハイライト', ...Array(totalCols - 1).fill('')])
  worksheet.mergeCells(sectionRow.number, 1, sectionRow.number, totalCols)
  const sectionCell = sectionRow.getCell(1)
  sectionCell.fill = solidFill('FFF2CC')
  sectionCell.font = baseFont(true, 11)
  sectionRow.height = 20

  const highlightHeaderRow = worksheet.addRow([
    '勤務区分',
    ...args.days.map((day) => `${day}(${args.weekdayLabel(args.month, day)})`),
    '合計',
  ])
  highlightHeaderRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = solidFill('E2F0D9')
    cell.font = baseFont(true)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allBorders()
  })
  highlightHeaderRow.height = 28

  for (const code of workShiftCodes) renderHighlightBlock(worksheet, code, false, args, styles)
  for (const code of specialCodes) renderHighlightBlock(worksheet, code, true, args, styles)

  worksheet.addRow([])
  const summaryCodes = [...workShiftCodes, ...specialCodes]
  const summaryTotalCols = summaryCodes.length + 2
  const summarySectionRow = worksheet.addRow(['勤務集計', ...Array(summaryTotalCols - 1).fill('')])
  worksheet.mergeCells(summarySectionRow.number, 1, summarySectionRow.number, summaryTotalCols)
  const summarySectionCell = summarySectionRow.getCell(1)
  summarySectionCell.fill = solidFill('FFF2CC')
  summarySectionCell.font = baseFont(true, 11)
  summarySectionRow.height = 20

  const summaryHeaderRow = worksheet.addRow(['担当', ...summaryCodes.map(summaryLabel), '勤務計'])
  summaryHeaderRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = solidFill('E2F0D9')
    cell.font = baseFont(true)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allBorders()
  })
  summaryHeaderRow.height = 24

  for (const person of args.staff) {
    const codeCounts = summaryCodes.map((code) => {
      const isSpecial = code === 'OFF' || code === 'PAID' || code === '特休'
      return args.days.filter((day) => {
        const codeAtDay = args.schedule[person]?.[day] ?? (isSpecial ? 'OFF' : '')
        return isSpecial ? codeAtDay === code : codeAtDay.toUpperCase() === code
      }).length
    })
    const summaryRow = worksheet.addRow([person, ...codeCounts, workDayCount(args.schedule, person, args.days)])
    summaryRow.height = 16
    summaryRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = allBorders()
      cell.font = baseFont(col === 1)
      if (col > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `shift-roster-${args.month}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}
