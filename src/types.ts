export type ShiftStatus = 'scheduled' | 'going' | 'called_off' | 'missed';

export type ShiftSource = 'manual' | 'upload' | 'calendar';

export type Profile = {
  displayName: string;
  contactEmail: string;
  mobilePhone: string;
  scheduleAliases: string[];
  timezone: string;
  calloffPhone: string;
  reminderOffsetHours: number;
};

export type Shift = {
  id: string;
  title: string;
  unit: string;
  role: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: ShiftStatus;
  source: ShiftSource;
  confidence?: number;
  notes?: string;
  notificationId?: string;
  calendarEventId?: string;
};

export type ShiftCandidate = Omit<Shift, 'id' | 'status' | 'notificationId' | 'calendarEventId'> & {
  id?: string;
  sourceText?: string;
  warnings?: string[];
};

export type ParseResult = {
  candidates: ShiftCandidate[];
  blocked: boolean;
  message: string;
  warnings: string[];
};

export type CalloffEvent = {
  id: string;
  shiftId: string;
  phoneNumber: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
};
