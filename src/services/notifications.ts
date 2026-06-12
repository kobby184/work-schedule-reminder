import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Shift } from '../types';
import { formatDateTime } from '../lib/date';

const channelId = 'shift-reminders';
const shiftReminderCategoryId = 'shift-reminder-actions';
const reminderGoingActionId = 'shift-reminder-going';
const reminderCallOffActionId = 'shift-reminder-call-off';

export type ShiftReminderAction = 'going' | 'call_off' | 'open';
export type ShiftReminderResponse = {
  shiftId: string;
  action: ShiftReminderAction;
};

let categoryRegistration: Promise<void> | null = null;

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

  await configureShiftReminderActions();

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

export async function configureShiftReminderActions() {
  if (Platform.OS === 'web') {
    return;
  }

  categoryRegistration ??= Notifications.setNotificationCategoryAsync(shiftReminderCategoryId, [
    {
      identifier: reminderGoingActionId,
      buttonTitle: 'Going',
      options: {
        opensAppToForeground: true,
      },
    },
    {
      identifier: reminderCallOffActionId,
      buttonTitle: 'Call Off',
      options: {
        opensAppToForeground: true,
        isDestructive: true,
      },
    },
  ])
    .then(() => undefined)
    .catch((error) => {
      categoryRegistration = null;
      console.warn('Shift reminder actions could not be registered.', error);
    });

  await categoryRegistration;
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
      categoryIdentifier: shiftReminderCategoryId,
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

export function addShiftReminderResponseListener(listener: (response: ShiftReminderResponse) => void) {
  if (Platform.OS === 'web') {
    return { remove() {} };
  }

  const handleResponse = (response: Notifications.NotificationResponse) => {
    const shiftId = response.notification.request.content.data?.shiftId;
    if (typeof shiftId !== 'string' || !shiftId) {
      return;
    }

    let action: ShiftReminderAction = 'open';
    if (response.actionIdentifier === reminderGoingActionId) {
      action = 'going';
    } else if (response.actionIdentifier === reminderCallOffActionId) {
      action = 'call_off';
    } else if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
      return;
    }

    listener({ shiftId, action });
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // Some test/web runtimes do not expose the native clear hook.
    }
  };

  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  try {
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) {
      handleResponse(lastResponse);
    }
  } catch {
    // Unsupported runtimes can still use live notification response events.
  }

  return subscription;
}
