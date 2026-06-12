export type ParserProfile = {
  aliases: string[];
  timezone: string;
};

export type ShiftCandidate = {
  title: string;
  unit: string;
  role: string;
  startAt: string;
  endAt: string;
  timezone: string;
  source: 'upload';
  confidence: number;
  notes: string;
  sourceText: string;
};

const phiPatterns = [/\bMRN\b/i, /\bmedical record\b/i, /\bpatient\b/i, /\bDOB[:\s]/i, /\bdiagnosis\b/i, /\broom\s+\d{2,}/i];
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

export function hasProtectedHealthInfo(text: string) {
  return phiPatterns.some((pattern) => pattern.test(text));
}

export function parseScheduleText(text: string, profile: ParserProfile) {
  if (hasProtectedHealthInfo(text)) {
    return {
      blocked: true,
      candidates: [],
      message: 'This upload appears to contain patient information. Crop or redact it before saving.',
      warnings: ['Detected possible PHI such as MRN, patient, DOB, diagnosis, or room details.'],
    };
  }

  const aliases = profile.aliases.map((alias) => alias.toLowerCase()).filter(Boolean);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const matchingLines = aliases.length ? lines.filter((line) => aliases.some((alias) => line.toLowerCase().includes(alias))) : lines;
  const calendarRange = detectCalendarRange(text);
  const parsedCandidates = matchingLines.flatMap((line) => parseLine(line, profile.timezone, aliases));
  const candidates = calendarRange ? parsedCandidates.filter((candidate) => isCandidateInsideRange(candidate, calendarRange)) : parsedCandidates;
  const removedOutsideRange = parsedCandidates.length - candidates.length;
  const warnings = [
    ...(aliases.length && matchingLines.length === 0 ? ['No rows matched the saved schedule aliases.'] : []),
    ...(calendarRange ? [`Calendar range detected: ${formatRange(calendarRange)}.`] : []),
    ...(removedOutsideRange > 0
      ? [`Removed ${removedOutsideRange} detected shift${removedOutsideRange === 1 ? '' : 's'} outside the posted calendar range.`]
      : []),
  ];

  return {
    blocked: false,
    candidates,
    message: candidates.length ? `Found ${candidates.length} possible shift${candidates.length === 1 ? '' : 's'}.` : 'No shifts were confidently detected.',
    warnings,
  };
}

export function demoParse(profile: ParserProfile) {
  void profile;

  return {
    blocked: false,
    candidates: [],
    message: 'Cloud OCR is not configured yet, so this function will not invent schedule dates from an image/PDF.',
    warnings: ['Send rawText or configure Google Document AI before parsing uploaded files.'],
  };
}

function parseLine(line: string, timezone: string, aliases: string[]): ShiftCandidate[] {
  const dateMatch = line.match(datePattern);
  const timeMatch = line.match(timePattern);
  if (!dateMatch || !timeMatch) {
    return [];
  }

  const year = dateMatch[3] ? normalizeYear(dateMatch[3]) : new Date().getFullYear();
  const month = Number(dateMatch[1]) - 1;
  const day = Number(dateMatch[2]);
  const start = new Date(year, month, day, normalizeHour(Number(timeMatch[1]), timeMatch[3] ?? timeMatch[6]), Number(timeMatch[2] ?? 0));
  let end = new Date(year, month, day, normalizeHour(Number(timeMatch[4]), timeMatch[6] ?? timeMatch[3]), Number(timeMatch[5] ?? 0));
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return [{
    title: 'Work shift',
    unit: inferUnit(line),
    role: 'RN',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone,
    source: 'upload',
    confidence: aliases.some((alias) => line.toLowerCase().includes(alias)) ? 0.9 : 0.72,
    notes: 'Detected from uploaded schedule text.',
    sourceText: line,
  }];
}

function normalizeYear(value: string) {
  return value.length === 2 ? 2000 + Number(value) : Number(value);
}

function normalizeHour(hour: number, marker?: string) {
  const normalized = marker?.toLowerCase();
  if (normalized === 'pm' && hour < 12) return hour + 12;
  if (normalized === 'am' && hour === 12) return 0;
  return hour;
}

function inferUnit(line: string) {
  return line.match(/\b(ICU|ER|ED|OR|PACU|L&D|Med[-\s]?Surg|Telemetry|Float|Unit\s+[A-Z0-9]+)\b/i)?.[0] ?? 'My unit';
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
  const endMonth = monthToNumber(match[4] || match[1]);
  if (startMonth === null || endMonth === null) {
    return null;
  }

  return createRange(
    normalizeYear(match[3] ?? match[6]),
    startMonth,
    Number(match[2]),
    normalizeYear(match[6] ?? match[3]),
    endMonth,
    Number(match[5]),
  );
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
  return `${range.start.toLocaleDateString()} - ${range.end.toLocaleDateString()}`;
}
