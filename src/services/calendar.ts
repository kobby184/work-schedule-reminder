import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';
import type { Shift } from '../types';

export async function exportShiftToCalendar(shift: Shift) {
  if (Platform.OS === 'web') {
    throw new Error('Calendar export is only available in the iOS and Android app.');
  }

  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Calendar permission was not granted.');
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const calendar = calendars.find((item) => item.allowsModifications) ?? calendars[0];
  if (!calendar?.id) {
    throw new Error('No writable calendar was found on this device.');
  }

  return Calendar.createEventAsync(calendar.id, {
    title: shift.title || 'Work shift',
    location: shift.unit,
    notes: shift.notes,
    startDate: new Date(shift.startAt),
    endDate: new Date(shift.endAt),
    timeZone: shift.timezone,
    alarms: [{ relativeOffset: -240 }],
  });
}
