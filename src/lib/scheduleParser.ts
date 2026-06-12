import { addHours } from './date';
import type { ParseResult, Profile, ShiftCandidate } from '../types';

const patientInfoPatterns = [
  /\bMRN\b/i,
  /\bmedical record\b/i,
  /\bpatient\b/i,
  /\bDOB[:\s]/i,
  /\bdiagnosis\b/i,
  /\broom\s+\d{2,}/i,
];

const datePattern = /(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/;
const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const monthNames: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

type CalendarRange = {
  start: Date;
  end: Date;
};

export type OcrLine = {
  text: string;
  confidence?: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

type DateGrid = {
  dates: Date[];
  firstCenterX: number;
  columnWidth: number;
};

export function hasProtectedHealthInfo(text: string) {
  return patientInfoPatterns.some((pattern) => pattern.test(text));
}

export function parseScheduleText(text: string, profile: Profile): ParseResult {
  if (hasProtectedHealthInfo(text)) {
    return {
      blocked: true,
      candidates: [],
      message: 'This upload appears to contain patient information. Crop or redact it before saving.',
      warnings: ['Detected possible PHI such as MRN, patient, DOB, diagnosis, or room details.'],
    };
  }

  const aliases = getProfileAliases(profile);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matchedProfileLines = aliases.length ? lines.filter((line) => lineMatchesAnyAlias(line, aliases)) : lines;
  const candidateLines = aliases.length ? matchedProfileLines : lines;

  const calendarRange = detectCalendarRange(text);
  const parsedCandidates = candidateLines.flatMap((line) => parseLine(line, profile));
  const gridCandidates =
    parsedCandidates.length === 0 && calendarRange
      ? parseGridRows(candidateLines, calendarRange, profile, aliases)
      : [];
  const allCandidates = [...parsedCandidates, ...gridCandidates];
  const candidates = calendarRange
    ? allCandidates.filter((candidate) => isCandidateInsideRange(candidate, calendarRange))
    : allCandidates;
  const removedOutsideRange = allCandidates.length - candidates.length;
  const warnings = [
    ...(aliases.length && candidateLines.length === 0
      ? [`No rows matched this profile. Checked: ${aliases.slice(0, 8).join(', ')}.`]
      : []),
    ...(aliases.length && candidateLines.length > 0
      ? [`Matched ${candidateLines.length} row${candidateLines.length === 1 ? '' : 's'} for this profile only.`]
      : []),
    ...(calendarRange ? [`Calendar range detected: ${formatRange(calendarRange)}.`] : []),
    ...(gridCandidates.length > 0
      ? ['Detected shifts from a monthly grid row. Review each date and shift type before saving.']
      : []),
    ...(removedOutsideRange > 0
      ? [`Removed ${removedOutsideRange} detected shift${removedOutsideRange === 1 ? '' : 's'} outside the posted calendar range.`]
      : []),
  ];

  return {
    blocked: false,
    candidates,
    message: candidates.length
      ? `Found ${candidates.length} possible shift${candidates.length === 1 ? '' : 's'}. Please confirm before saving.`
      : 'No shifts were confidently detected. You can add this schedule manually.',
    warnings,
  };
}

export function parseScheduleOcrLayout(text: string, lines: OcrLine[], profile: Profile): ParseResult {
  const textResult = parseScheduleText(text, profile);
  if (textResult.blocked || textResult.candidates.length > 0) {
    return textResult;
  }

  const range = detectCalendarRange(text);
  const aliases = getProfileAliases(profile);
  const profileRows = aliases.length ? lines.filter((line) => lineMatchesAnyAlias(line.text, aliases)) : [];
  const grid = range ? estimateDateGrid(lines, range) : null;
  const candidates = grid
    ? dedupeCandidates(profileRows.flatMap((row) => parseLayoutRow(row, lines, grid, profile)))
    : [];

  const warnings = [
    ...textResult.warnings.filter(
      (warning) =>
        !warning.startsWith('No rows matched') &&
        !warning.startsWith('Matched ') &&
        !warning.startsWith('Calendar range detected'),
    ),
    ...(profileRows.length > 0
      ? [`Matched ${profileRows.length} OCR row${profileRows.length === 1 ? '' : 's'} for this profile only.`]
      : [`No OCR row matched this profile. Checked: ${aliases.slice(0, 8).join(', ')}.`]),
    ...(range ? [`Calendar range detected: ${formatRange(range)}.`] : ['Could not detect the posted calendar date range from OCR.']),
    ...(grid ? [] : ['Could not locate the calendar date columns from OCR.']),
    ...(candidates.length > 0
      ? ['Read shifts from the matched profile row using OCR cell positions. Review before saving.']
      : []),
  ];

  return {
    blocked: false,
    candidates,
    message: candidates.length
      ? `Found ${candidates.length} possible shift${candidates.length === 1 ? '' : 's'} for this profile. Please confirm before saving.`
      : 'OCR found the profile row, but no shift cells were confidently detected.',
    warnings,
  };
}

export function getProfileAliases(profile: Profile) {
  const nameParts = profile.displayName.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  const first = nameParts[0] ?? '';
  const last = nameParts[nameParts.length - 1] ?? '';
  const initials = nameParts.map((part) => part[0]).join('');
  const emailName = profile.contactEmail.split('@')[0] ?? '';
  const aliases = [
    profile.displayName,
    first,
    last,
    first && last ? `${last} ${first}` : '',
    first && last ? `${first[0]} ${last}` : '',
    first && last ? `${first} ${last[0]}` : '',
    initials,
    initials.split('').join(' '),
    emailName,
    ...profile.scheduleAliases,
  ];

  return Array.from(new Set(aliases.map(normalizeText).filter((alias) => alias.length >= 2)));
}

export function createDemoParseResult(profile: Profile): ParseResult {
  void profile;
  return {
    blocked: false,
    message: 'Cloud OCR is not configured yet, so this build will not invent schedule dates from an image/PDF.',
    warnings: ['Paste the calendar text below or add shifts manually until Supabase and Document AI are connected.'],
    candidates: [],
  };
}

function parseLine(line: string, profile: Profile): ShiftCandidate[] {
  const dateMatch = line.match(datePattern);
  const timeMatch = line.match(timePattern);
  if (!dateMatch || !timeMatch) {
    return [];
  }

  const year = normalizeYear(dateMatch[3]);
  const month = Number(dateMatch[1]) - 1;
  const day = Number(dateMatch[2]);
  const startHour = normalizeHour(Number(timeMatch[1]), timeMatch[3] ?? timeMatch[6]);
  const startMinute = Number(timeMatch[2] ?? 0);
  const endHour = normalizeHour(Number(timeMatch[4]), timeMatch[6] ?? timeMatch[3]);
  const endMinute = Number(timeMatch[5] ?? 0);
  const start = new Date(year, month, day, startHour, startMinute, 0, 0);
  let end = new Date(year, month, day, endHour, endMinute, 0, 0);
  if (end <= start) {
    end = addHours(end, 24);
  }

  const aliasMatched = lineMatchesAnyAlias(line, getProfileAliases(profile));

  return [
    {
      title: 'Work shift',
      unit: inferUnit(line),
      role: 'RN',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: profile.timezone,
      source: 'upload',
      confidence: aliasMatched ? 0.9 : 0.72,
      notes: 'Detected from uploaded schedule text.',
      sourceText: line,
    },
  ];
}

function normalizeYear(value?: string) {
  const currentYear = new Date().getFullYear();
  if (!value) {
    return currentYear;
  }
  if (value.length === 2) {
    return 2000 + Number(value);
  }
  return Number(value);
}

function normalizeHour(hour: number, marker?: string) {
  const normalizedMarker = marker?.toLowerCase();
  if (normalizedMarker === 'pm' && hour < 12) {
    return hour + 12;
  }
  if (normalizedMarker === 'am' && hour === 12) {
    return 0;
  }
  return hour;
}

function inferUnit(line: string) {
  const unitMatch = line.match(/\b(ICU|ER|ED|OR|PACU|L&D|Med[-\s]?Surg|Telemetry|Float|Unit\s+[A-Z0-9]+)\b/i);
  return unitMatch?.[0] ?? 'My unit';
}

function parseGridRows(lines: string[], range: CalendarRange, profile: Profile, aliases: string[]): ShiftCandidate[] {
  const dates = listDates(range);
  if (dates.length === 0 || dates.length > 62) {
    return [];
  }

  return lines.flatMap((line) => {
    const codes = extractGridCodes(line, aliases);
    if (codes.length === 0) {
      return [];
    }
    return codes
      .slice(0, dates.length)
      .flatMap((code, index) => (code ? createCandidateFromGridCode(code, dates[index], line, profile) : []));
  });
}

function extractGridCodes(line: string, aliases: string[]) {
  const aliasWords = new Set(aliases.flatMap((alias) => alias.split(' ')).filter((word) => word.length > 1));
  const tokens = line.match(/[A-Za-z0-9]+/g) ?? [];
  const codes: string[] = [];

  tokens.forEach((token) => {
    const normalized = normalizeText(token);
    if (!normalized || aliasWords.has(normalized) || isCalendarNoiseToken(normalized)) {
      return;
    }
    codes.push(...extractCodesFromToken(normalized));
  });

  return codes;
}

function extractCodesFromText(text: string, loose = false) {
  const tokens = text.match(/[A-Za-z0-9]+/g) ?? [];
  return tokens.flatMap((token) => extractCodesFromToken(normalizeText(token), loose));
}

function extractCodesFromToken(normalized: string, loose = false) {
  const shiftCode = normalizeShiftCode(normalized);
  if (shiftCode) {
    return [shiftCode === 'off' ? '' : shiftCode];
  }
  if (/^[dneamphxocwrslvuio1l]{2,31}$/i.test(normalized) && !/\d/.test(normalized)) {
    return normalized
      .split('')
      .map((char) => normalizeShiftCode(char))
      .filter(Boolean)
      .map((code) => (code === 'off' ? '' : code)) as string[];
  }
  if (loose && normalized.length <= 8 && !/\d/.test(normalized) && normalized.includes('n')) {
    return normalized.split('').flatMap((char) => (char === 'n' ? ['night'] : []));
  }
  return [];
}

function normalizeShiftCode(token: string) {
  const normalized = normalizeText(token);
  if (['off', 'o', 'x', 'r', 'pto', 'vac', 'vacation', 'leave', 'l', 'u', 'nrp', 'rp'].includes(normalized)) {
    return 'off';
  }
  if (/^[il1]+n$/.test(normalized)) {
    return 'night';
  }
  if (['d', 'day', 'days', 'am', 'm', 'a', '7a3p'].includes(normalized)) {
    return 'day';
  }
  if (['e', 'eve', 'evening', 'pm', 'p', '3p11p'].includes(normalized)) {
    return 'evening';
  }
  if (['n', 'noc', 'night', 'nights', '11p7a', '7p7a'].includes(normalized)) {
    return 'night';
  }
  if (/^7a(?:m)?3p(?:m)?$/.test(normalized)) {
    return 'day';
  }
  if (/^3p(?:m)?11p(?:m)?$/.test(normalized)) {
    return 'evening';
  }
  if (/^(?:11p(?:m)?7a(?:m)?|7p(?:m)?7a(?:m)?)$/.test(normalized)) {
    return 'night';
  }
  return null;
}

function createCandidateFromGridCode(code: string, date: Date, sourceText: string, profile: Profile): ShiftCandidate[] {
  const times = {
    day: { title: 'Day shift', startHour: 7, startMinute: 0, endHour: 15, endMinute: 0 },
    evening: { title: 'Evening shift', startHour: 15, startMinute: 0, endHour: 23, endMinute: 0 },
    night: { title: 'Night shift', startHour: 19, startMinute: 0, endHour: 7, endMinute: 30 },
  }[code];
  if (!times) {
    return [];
  }

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), times.startHour, times.startMinute, 0, 0);
  let end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), times.endHour, times.endMinute, 0, 0);
  if (end <= start) {
    end = addHours(end, 24);
  }

  return [
    {
      title: times.title,
      unit: inferUnit(sourceText),
      role: 'RN',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: profile.timezone,
      source: 'upload',
      confidence: 0.62,
      notes: `Detected from profile row code "${code}". Confirm the shift type before saving.`,
      sourceText,
    },
  ];
}

function listDates(range: CalendarRange) {
  const dates: Date[] = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
  const end = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function parseLayoutRow(row: OcrLine, lines: OcrLine[], grid: DateGrid, profile: Profile): ShiftCandidate[] {
  const rowCenterY = centerY(row);
  const rowBand = Math.max(14, (row.bbox.y1 - row.bbox.y0) * 0.85);
  const fragments = lines
    .filter((line) => line !== row)
    .filter((line) => Math.abs(centerY(line) - rowCenterY) <= rowBand)
    .filter((line) => centerX(line) >= grid.firstCenterX - grid.columnWidth)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);

  return fragments.flatMap((fragment) => {
    const codes = extractCodesFromText(fragment.text, true);
    if (codes.length === 0) {
      return [];
    }
    return codes.flatMap((code, index) => {
      if (!code) {
        return [];
      }
      const codeCenterX =
        codes.length === 1
          ? centerX(fragment)
          : fragment.bbox.x0 + ((index + 0.5) / codes.length) * Math.max(1, fragment.bbox.x1 - fragment.bbox.x0);
      const dateIndex = Math.round((codeCenterX - grid.firstCenterX) / grid.columnWidth);
      const date = grid.dates[dateIndex];
      if (!date) {
        return [];
      }
      return createCandidateFromGridCode(code, date, `${row.text} ${fragment.text}`, profile);
    });
  });
}

function estimateDateGrid(lines: OcrLine[], range: CalendarRange): DateGrid | null {
  const dates = listDates(range);
  if (!dates.length) {
    return null;
  }

  const startDay = dates[0].getDate();
  const earlyLines = lines
    .filter((line) => line.bbox.y0 < 280 && line.bbox.x0 > 300)
    .map((line) => ({
      line,
      days: (line.text.match(/\b\d{1,2}\b/g) ?? []).map(Number).filter((day) => day >= 1 && day <= 31),
    }))
    .filter((item) => item.days.length >= 2);

  const startGroup = earlyLines.find((item) => item.days.includes(startDay) && item.days.includes(nextDayNumber(startDay)));
  if (startGroup) {
    const columnWidth = Math.max(20, (startGroup.line.bbox.x1 - startGroup.line.bbox.x0) / startGroup.days.length);
    return {
      dates,
      firstCenterX: startGroup.line.bbox.x0 + columnWidth / 2,
      columnWidth,
    };
  }

  const xValues = earlyLines.flatMap((item) => [item.line.bbox.x0, item.line.bbox.x1]);
  if (xValues.length < 2) {
    return null;
  }
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const columnWidth = Math.max(20, (maxX - minX) / dates.length);
  return {
    dates,
    firstCenterX: minX + columnWidth / 2,
    columnWidth,
  };
}

function nextDayNumber(day: number) {
  return day === 31 ? 1 : day + 1;
}

function dedupeCandidates(candidates: ShiftCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.startAt}|${candidate.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function centerX(line: OcrLine) {
  return (line.bbox.x0 + line.bbox.x1) / 2;
}

function centerY(line: OcrLine) {
  return (line.bbox.y0 + line.bbox.y1) / 2;
}

function isCalendarNoiseToken(token: string) {
  return (
    monthToNumber(token) !== null ||
    /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|monthly|schedule|calendar|week|name|unit|rn|lpn|cna|staff)$/.test(token) ||
    /^\d{1,4}$/.test(token)
  );
}

function lineMatchesAnyAlias(line: string, aliases: string[]) {
  return aliases.some((alias) => lineMatchesAlias(line, alias));
}

function lineMatchesAlias(line: string, alias: string) {
  const normalizedLine = normalizeText(line);
  const normalizedAlias = normalizeText(alias);
  if (!normalizedLine || !normalizedAlias) {
    return false;
  }
  if (normalizedLine.includes(normalizedAlias)) {
    return true;
  }
  if (normalizedAlias.length <= 3) {
    const spacedInitialsPattern = normalizedAlias.split('').map(escapeRegExp).join('\\s*');
    return new RegExp(`\\b${spacedInitialsPattern}\\b`).test(normalizedLine);
  }

  const lineWords = normalizedLine.split(' ').filter(Boolean);
  const aliasWords = normalizedAlias.split(' ').filter(Boolean);
  if (aliasWords.length > 1 && aliasWords.every((aliasWord) => lineWords.some((word) => fuzzyWordMatch(word, aliasWord)))) {
    return true;
  }

  const compactLine = normalizedLine.replace(/\s+/g, '');
  const compactAlias = normalizedAlias.replace(/\s+/g, '');
  return similarity(compactLine, compactAlias) >= 0.74 || compactLine.includes(compactAlias.slice(0, Math.max(3, compactAlias.length - 2)));
}

function fuzzyWordMatch(word: string, aliasWord: string) {
  return word === aliasWord || (aliasWord.length > 3 && similarity(word, aliasWord) >= 0.72);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function similarity(a: string, b: string) {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.length) {
    return 1;
  }
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function levenshtein(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const oldDiagonal = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = oldDiagonal;
    }
  }
  return previous[b.length];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectCalendarRange(text: string): CalendarRange | null {
  return detectNamedMonthRange(text) ?? detectNumericRange(text);
}

function detectNamedMonthRange(text: string): CalendarRange | null {
  const normalized = text.replace(/\s+/g, ' ');
  const month = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const pattern = new RegExp(
    `(${month})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\s*(?:to|through|thru|until|-|–|—)\\s*(?:(${month})\\s+)?(\\d{1,2})(?:,?\\s+(\\d{4}))?`,
    'i',
  );
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const startMonth = monthToNumber(match[1]);
  const startDay = Number(match[2]);
  const startYear = normalizeYear(match[3] ?? match[6]);
  const endMonth = monthToNumber(match[4] || match[1]);
  const endDay = Number(match[5]);
  const endYear = normalizeYear(match[6] ?? match[3]);
  if (startMonth === null || endMonth === null || !startDay || !endDay) {
    return null;
  }

  return createRange(startYear, startMonth, startDay, endYear, endMonth, endDay);
}

function detectNumericRange(text: string): CalendarRange | null {
  const match = text.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\s*(?:to|through|thru|until|-|–|—)\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/i);
  if (!match) {
    return null;
  }

  return createRange(
    normalizeYear(match[3] ?? match[6]),
    Number(match[1]) - 1,
    Number(match[2]),
    normalizeYear(match[6] ?? match[3]),
    Number(match[4]) - 1,
    Number(match[5]),
  );
}

function createRange(startYear: number, startMonth: number, startDay: number, endYear: number, endMonth: number, endDay: number): CalendarRange | null {
  const start = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
  let end = new Date(endYear, endMonth, endDay, 23, 59, 59, 999);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (end < start) {
    end = new Date(end.getFullYear() + 1, end.getMonth(), end.getDate(), 23, 59, 59, 999);
  }
  return { start, end };
}

function monthToNumber(value?: string) {
  if (!value) {
    return null;
  }
  return monthNames[value.toLowerCase()] ?? null;
}

function isCandidateInsideRange(candidate: ShiftCandidate, range: CalendarRange) {
  const start = new Date(candidate.startAt);
  return start >= range.start && start <= range.end;
}

function formatRange(range: CalendarRange) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${formatter.format(range.start)} - ${formatter.format(range.end)}`;
}
