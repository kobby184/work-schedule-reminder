export function getDeviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatTimeRange(startAt: string, endAt: string) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`;
}

export function hoursUntil(value: string) {
  return Math.round(((new Date(value).getTime() - Date.now()) / 36e5) * 10) / 10;
}

export function toLocalDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toLocalTimeInput(date = new Date()) {
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${hour}:${minute}`;
}

export function combineLocalDateAndTime(dateText: string, timeText: string) {
  const [year, month, day] = dateText.split('-').map(Number);
  const [hour = 0, minute = 0] = timeText.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
