import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Shift } from '../types';
import { formatDateTime } from '../lib/date';

const channelId = 'shift-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationAccess() {
  if (Platform.OS === 'web') {
    return { granted: false, reason: 'Local mobile notifications are not available in the web preview.' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(channelId, {
      name: 'Shift reminders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1D8A6A',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const finalStatus =
    existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();

  return {
    granted: finalStatus.status === 'granted',
    reason:
      finalStatus.status === 'granted'
        ? 'Notifications are enabled.'
        : 'Notification permission was not granted.',
  };
}

export async function scheduleShiftReminder(shift: Shift, reminderOffsetHours: number) {
  if (Platform.OS === 'web') {
    return undefined;
  }

  const reminderAt = new Date(new Date(shift.startAt).getTime() - reminderOffsetHours * 60 * 60 * 1000);
  if (reminderAt.getTime() <= Date.now()) {
    return undefined;
  }

  const access = await ensureNotificationAccess();
  if (!access.granted) {
    return undefined;
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Work shift coming up',
      body: `${shift.unit || shift.title} starts ${formatDateTime(shift.startAt)}. Are you going or calling off?`,
      data: { shiftId: shift.id, screen: 'shift-decision' },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderAt,
      channelId,
    },
  });
}

export async function cancelShiftReminder(notificationId?: string) {
  if (!notificationId || Platform.OS === 'web') {
    return;
  }
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
