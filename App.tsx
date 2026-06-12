import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Bell,
  CalendarDays,
  Check,
  Clock3,
  FileUp,
  Home,
  LogIn,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';

import {
  getDeviceTimezone,
  combineLocalDateAndTime,
  formatDateTime,
  formatTimeRange,
  hoursUntil,
  toLocalDateInput,
  toLocalTimeInput,
} from './src/lib/date';
import { createId } from './src/lib/ids';
import type { CalloffEvent, ParseResult, Profile, Shift, ShiftCandidate, ShiftStatus } from './src/types';
import { exportShiftToCalendar } from './src/services/calendar';
import { ensureNotificationAccess, scheduleShiftReminder, cancelShiftReminder } from './src/services/notifications';
import { clearLocalData, loadCalloffEvents, loadProfile, loadShifts, saveCalloffEvents, saveProfile, saveShifts } from './src/services/storage';
import { signInOrCreateAccount, supabase } from './src/services/supabase';
import { parsePastedScheduleText, parsePickedSchedule } from './src/services/uploads';

const colors = {
  background: '#F7FAFA',
  surface: '#FFFFFF',
  ink: '#15201D',
  muted: '#66736F',
  line: '#DCE5E2',
  primary: '#126E82',
  primaryDark: '#0E5666',
  green: '#1D8A6A',
  amber: '#B76E00',
  red: '#B42318',
  blueSoft: '#E6F4FE',
  greenSoft: '#E6F7EF',
  amberSoft: '#FFF4D6',
  redSoft: '#FDE8E6',
};

const defaultProfile: Profile = {
  displayName: '',
  contactEmail: '',
  mobilePhone: '',
  scheduleAliases: [],
  timezone: getDeviceTimezone(),
  calloffPhone: '',
  reminderOffsetHours: 4,
};

type Tab = 'home' | 'upload' | 'schedule' | 'settings';
type Icon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
type ShiftPreset = {
  label: string;
  title: string;
  startTime: string;
  endTime: string;
};

const shiftPresets: ShiftPreset[] = [
  { label: 'Day', title: 'Day shift', startTime: '07:00', endTime: '15:00' },
  { label: 'Evening', title: 'Evening shift', startTime: '15:00', endTime: '23:00' },
  { label: 'Night', title: 'Night shift', startTime: '23:00', endTime: '07:00' },
  { label: '12h Day', title: 'Day shift', startTime: '07:00', endTime: '19:00' },
  { label: '12h Night', title: 'Night shift', startTime: '19:00', endTime: '07:00' },
];

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileDraft, setProfileDraft] = useState(profileToDraft(defaultProfile));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [calloffs, setCalloffs] = useState<CalloffEvent[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountMessage, setAccountMessage] = useState(supabase ? 'Supabase account ready.' : 'Local demo mode.');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [reviewCandidates, setReviewCandidates] = useState<ShiftCandidate[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [manualDraft, setManualDraft] = useState(createManualDraft());

  useEffect(() => {
    async function hydrate() {
      const [storedProfile, storedShifts, storedCalloffs] = await Promise.all([
        loadProfile(),
        loadShifts(),
        loadCalloffEvents(),
      ]);
      if (storedProfile) {
        setProfile(storedProfile);
        setProfileDraft(profileToDraft(storedProfile));
      }
      setShifts(storedShifts);
      setCalloffs(storedCalloffs);
      setIsReady(true);
    }

    hydrate();
  }, []);

  const upcomingShifts = useMemo(
    () =>
      [...shifts]
        .filter((shift) => new Date(shift.endAt).getTime() >= Date.now())
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [shifts],
  );

  const nextShift = upcomingShifts[0];
  const calledOffCount = shifts.filter((shift) => shift.status === 'called_off').length;
  const reminderCount = shifts.filter((shift) => Boolean(shift.notificationId)).length;

  async function persistProfile(nextProfile: Profile) {
    setProfile(nextProfile);
    setProfileDraft(profileToDraft(nextProfile));
    await saveProfile(nextProfile);
  }

  async function persistShifts(nextShifts: Shift[]) {
    const sorted = [...nextShifts].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    setShifts(sorted);
    await saveShifts(sorted);
  }

  async function persistCalloffs(nextCalloffs: CalloffEvent[]) {
    setCalloffs(nextCalloffs);
    await saveCalloffEvents(nextCalloffs);
  }

  async function handleProfileSave() {
    const nextProfile: Profile = {
      displayName: profileDraft.displayName.trim(),
      contactEmail: profileDraft.contactEmail.trim(),
      mobilePhone: profileDraft.mobilePhone.trim(),
      scheduleAliases: profileDraft.aliases
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean),
      timezone: profileDraft.timezone.trim() || getDeviceTimezone(),
      calloffPhone: profileDraft.calloffPhone.trim(),
      reminderOffsetHours: Number(profileDraft.reminderOffsetHours) || 4,
    };
    await persistProfile(nextProfile);
    setActiveTab('home');
  }

  async function handleAccount() {
    if (!supabase) {
      await resetLocalDemo();
      return;
    }
    if (!accountEmail || !accountPassword) {
      setAccountMessage('Enter an email and password.');
      return;
    }
    try {
      const account = await signInOrCreateAccount(accountEmail, accountPassword);
      setAccountMessage(account.mode === 'remote' ? 'Signed in.' : 'Using local demo mode.');
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : 'Account sign-in failed.');
    }
  }

  async function resetLocalDemo() {
    await Promise.all(shifts.map((shift) => cancelShiftReminder(shift.notificationId)));
    await clearLocalData();
    setProfile(null);
    setProfileDraft(profileToDraft(defaultProfile));
    setShifts([]);
    setCalloffs([]);
    setManualDraft(createManualDraft());
    setPastedText('');
    clearParseResult();
    setAccountEmail('');
    setAccountPassword('');
    setAccountMessage('Local demo reset. Create a fresh profile to continue.');
    setActiveTab('home');
  }

  async function handlePickPhoto() {
    if (!profile) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: false,
    });
    if (!result.canceled) {
      await parseAsset(result.assets[0]);
    }
  }

  async function handlePickDocument() {
    if (!profile) {
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*', 'text/plain'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled) {
      await parseAsset(result.assets[0]);
    }
  }

  async function parseAsset(asset: DocumentPicker.DocumentPickerAsset | ImagePicker.ImagePickerAsset) {
    if (!profile) {
      return;
    }
    setIsParsing(true);
    try {
      const parsed = await parsePickedSchedule(asset, profile);
      applyParseResult(parsed);
    } catch (error) {
      applyParseResult({
        blocked: false,
        candidates: [],
        message: error instanceof Error ? error.message : 'Schedule parsing failed.',
        warnings: ['You can paste text or add shifts manually.'],
      });
    } finally {
      setIsParsing(false);
    }
  }

  async function handlePasteParse() {
    if (!profile) {
      return;
    }
    applyParseResult(parsePastedScheduleText(pastedText, profile));
  }

  function applyParseResult(result: ParseResult) {
    setParseResult(result);
    setReviewCandidates(result.candidates);
  }

  function clearParseResult() {
    setParseResult(null);
    setReviewCandidates([]);
  }

  async function confirmCandidates(candidates: ShiftCandidate[]) {
    if (!profile) {
      return;
    }
    const created: Shift[] = [];
    for (const candidate of candidates) {
      const shift: Shift = {
        id: createId('shift'),
        title: candidate.title,
        unit: candidate.unit,
        role: candidate.role,
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        timezone: candidate.timezone,
        status: 'scheduled',
        source: candidate.source,
        confidence: candidate.confidence,
        notes: candidate.notes,
      };
      shift.notificationId = await scheduleShiftReminder(shift, profile.reminderOffsetHours);
      created.push(shift);
    }
    await persistShifts([...shifts, ...created]);
    clearParseResult();
    setActiveTab('schedule');
  }

  async function addManualShift() {
    if (!profile) {
      return;
    }
    const start = combineLocalDateAndTime(manualDraft.date, manualDraft.startTime);
    let end = combineLocalDateAndTime(manualDraft.date, manualDraft.endTime);
    if (end <= start) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
    const shift: Shift = {
      id: createId('shift'),
      title: manualDraft.title.trim() || 'Work shift',
      unit: manualDraft.unit.trim() || 'My unit',
      role: manualDraft.role.trim() || 'RN',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: profile.timezone,
      status: 'scheduled',
      source: 'manual',
      notes: manualDraft.notes.trim(),
    };
    shift.notificationId = await scheduleShiftReminder(shift, profile.reminderOffsetHours);
    await persistShifts([...shifts, shift]);
    setManualDraft(createManualDraft());
  }

  async function updateShiftStatus(shiftId: string, status: ShiftStatus) {
    await persistShifts(shifts.map((shift) => (shift.id === shiftId ? { ...shift, status } : shift)));
  }

  async function deleteShift(shift: Shift) {
    await cancelShiftReminder(shift.notificationId);
    await persistShifts(shifts.filter((item) => item.id !== shift.id));
  }

  async function resyncReminders() {
    if (!profile) {
      return;
    }
    const access = await ensureNotificationAccess();
    const next: Shift[] = [];
    for (const shift of shifts) {
      await cancelShiftReminder(shift.notificationId);
      const notificationId =
        shift.status === 'scheduled' ? await scheduleShiftReminder(shift, profile.reminderOffsetHours) : undefined;
      next.push({ ...shift, notificationId });
    }
    await persistShifts(next);
    Alert.alert('Reminders', access.reason);
  }

  async function handleCalendarExport(shift: Shift) {
    try {
      const calendarEventId = await exportShiftToCalendar(shift);
      await persistShifts(shifts.map((item) => (item.id === shift.id ? { ...item, calendarEventId } : item)));
      Alert.alert('Calendar', 'Shift exported.');
    } catch (error) {
      Alert.alert('Calendar', error instanceof Error ? error.message : 'Calendar export failed.');
    }
  }

  async function startCallOff(shift: Shift) {
    if (!profile?.calloffPhone) {
      Alert.alert('Call off', 'Add a workplace call-off number in settings.');
      setActiveTab('settings');
      return;
    }
    const event: CalloffEvent = {
      id: createId('calloff'),
      shiftId: shift.id,
      phoneNumber: profile.calloffPhone,
      status: 'started',
      createdAt: new Date().toISOString(),
    };
    await persistCalloffs([event, ...calloffs]);
    await updateShiftStatus(shift.id, 'called_off');
    const phoneUrl = `tel:${profile.calloffPhone.replace(/[^\d+]/g, '')}`;
    const canOpen = await Linking.canOpenURL(phoneUrl);
    if (canOpen) {
      await Linking.openURL(phoneUrl);
    } else {
      Alert.alert('Call off', `Call ${profile.calloffPhone}`);
    }
  }

  async function completeCalloff(eventId: string) {
    await persistCalloffs(
      calloffs.map((event) =>
        event.id === eventId ? { ...event, status: 'completed', completedAt: new Date().toISOString() } : event,
      ),
    );
  }

  if (!isReady) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <CenteredMessage title="ShiftReady" body="Loading schedule data." />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
          <ScrollView contentContainerStyle={styles.onboarding}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <ShieldCheck size={28} color={colors.surface} />
              </View>
              <View>
                <Text style={styles.appName}>ShiftReady</Text>
                <Text style={styles.mutedText}>Private schedule reminders</Text>
              </View>
            </View>

            <View style={styles.panel}>
              <SectionTitle icon={Pencil} title="Profile" />
              <ProfileEditor draft={profileDraft} setDraft={setProfileDraft} />
              <PrimaryButton icon={Check} label="Save Profile" onPress={handleProfileSave} />
            </View>

            <View style={styles.panel}>
              <SectionTitle icon={LogIn} title="Account" />
              <TextField label="Email" value={accountEmail} onChangeText={setAccountEmail} keyboardType="email-address" />
              <TextField label="Password" value={accountPassword} onChangeText={setAccountPassword} secureTextEntry />
              <PrimaryButton icon={LogIn} label={supabase ? 'Sign In Or Create' : 'Reset Local Demo'} onPress={handleAccount} variant="secondary" />
              <Text style={styles.statusText}>{accountMessage}</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.appShell}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.appName}>ShiftReady</Text>
              <Text style={styles.mutedText}>{profile.displayName || 'My schedule'}</Text>
            </View>
            <Pressable style={styles.iconCircle} onPress={() => setActiveTab('settings')}>
              <Pencil size={20} color={colors.primary} />
            </Pressable>
          </View>

          {activeTab === 'home' && (
            <HomeScreen
              nextShift={nextShift}
              upcomingCount={upcomingShifts.length}
              reminderCount={reminderCount}
              calledOffCount={calledOffCount}
              promptContact={profile.mobilePhone || profile.contactEmail || 'Device notification only'}
              onGoSchedule={() => setActiveTab('schedule')}
              onGoUpload={() => setActiveTab('upload')}
              onResyncReminders={resyncReminders}
              onGoing={updateShiftStatus}
              onCallOff={startCallOff}
            />
          )}

          {activeTab === 'upload' && (
            <UploadScreen
              isParsing={isParsing}
              parseResult={parseResult}
              reviewCandidates={reviewCandidates}
              setReviewCandidates={setReviewCandidates}
              pastedText={pastedText}
              setPastedText={setPastedText}
              onPickPhoto={handlePickPhoto}
              onPickDocument={handlePickDocument}
              onParseText={handlePasteParse}
              onConfirm={confirmCandidates}
              onDismissResult={clearParseResult}
            />
          )}

          {activeTab === 'schedule' && (
            <ScheduleScreen
              shifts={shifts}
              manualDraft={manualDraft}
              setManualDraft={setManualDraft}
              calloffs={calloffs}
              onAddManual={addManualShift}
              onStatus={updateShiftStatus}
              onCallOff={startCallOff}
              onDelete={deleteShift}
              onCalendarExport={handleCalendarExport}
              onCompleteCalloff={completeCalloff}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsScreen
              profileDraft={profileDraft}
              setProfileDraft={setProfileDraft}
              accountEmail={accountEmail}
              setAccountEmail={setAccountEmail}
              accountPassword={accountPassword}
              setAccountPassword={setAccountPassword}
              accountMessage={accountMessage}
              onSaveProfile={handleProfileSave}
              onAccount={handleAccount}
              onResyncReminders={resyncReminders}
            />
          )}
        </ScrollView>

        <View style={styles.tabBar}>
          <TabButton active={activeTab === 'home'} icon={Home} label="Home" onPress={() => setActiveTab('home')} />
          <TabButton active={activeTab === 'upload'} icon={Upload} label="Upload" onPress={() => setActiveTab('upload')} />
          <TabButton active={activeTab === 'schedule'} icon={CalendarDays} label="Schedule" onPress={() => setActiveTab('schedule')} />
          <TabButton active={activeTab === 'settings'} icon={Pencil} label="Settings" onPress={() => setActiveTab('settings')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({
  nextShift,
  upcomingCount,
  reminderCount,
  calledOffCount,
  promptContact,
  onGoSchedule,
  onGoUpload,
  onResyncReminders,
  onGoing,
  onCallOff,
}: {
  nextShift?: Shift;
  upcomingCount: number;
  reminderCount: number;
  calledOffCount: number;
  promptContact: string;
  onGoSchedule: () => void;
  onGoUpload: () => void;
  onResyncReminders: () => void;
  onGoing: (shiftId: string, status: ShiftStatus) => void;
  onCallOff: (shift: Shift) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.statsGrid}>
        <StatCard label="Upcoming" value={String(upcomingCount)} icon={CalendarDays} tone="blue" />
        <StatCard label="Reminders" value={String(reminderCount)} icon={Bell} tone="green" />
        <StatCard label="Called Off" value={String(calledOffCount)} icon={Phone} tone="amber" />
      </View>

      <View style={styles.panel}>
        <SectionTitle icon={Clock3} title="Next Shift" />
        {nextShift ? (
          <ShiftCard
            shift={nextShift}
            onStatus={onGoing}
            onCallOff={onCallOff}
            onDelete={() => undefined}
            onCalendarExport={() => undefined}
            compact
          />
        ) : (
          <EmptyState title="No upcoming shifts" body="Add a shift or upload a schedule." />
        )}
        <View style={styles.actionRow}>
          <PrimaryButton icon={Upload} label="Upload" onPress={onGoUpload} />
          <PrimaryButton icon={CalendarDays} label="Schedule" onPress={onGoSchedule} variant="secondary" />
        </View>
      </View>

      <View style={styles.panel}>
        <SectionTitle icon={Bell} title="Reminder Health" />
        <Text style={styles.bodyText}>Scheduled alerts: {reminderCount}</Text>
        <Text style={styles.mutedText}>Prompt contact: {promptContact}</Text>
        <PrimaryButton icon={Bell} label="Sync Reminders" onPress={onResyncReminders} variant="secondary" />
      </View>
    </View>
  );
}

function UploadScreen({
  isParsing,
  parseResult,
  reviewCandidates,
  setReviewCandidates,
  pastedText,
  setPastedText,
  onPickPhoto,
  onPickDocument,
  onParseText,
  onConfirm,
  onDismissResult,
}: {
  isParsing: boolean;
  parseResult: ParseResult | null;
  reviewCandidates: ShiftCandidate[];
  setReviewCandidates: React.Dispatch<React.SetStateAction<ShiftCandidate[]>>;
  pastedText: string;
  setPastedText: (value: string) => void;
  onPickPhoto: () => void;
  onPickDocument: () => void;
  onParseText: () => void;
  onConfirm: (candidates: ShiftCandidate[]) => void;
  onDismissResult: () => void;
}) {
  function updateCandidate(index: number, nextCandidate: ShiftCandidate) {
    setReviewCandidates((current) => current.map((candidate, itemIndex) => (itemIndex === index ? nextCandidate : candidate)));
  }

  function removeCandidate(index: number) {
    setReviewCandidates((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <SectionTitle icon={FileUp} title="Upload Schedule" />
        <View style={styles.actionRow}>
          <PrimaryButton icon={Upload} label="Photo" onPress={onPickPhoto} disabled={isParsing} />
          <PrimaryButton icon={FileUp} label="PDF" onPress={onPickDocument} disabled={isParsing} variant="secondary" />
        </View>
        {isParsing ? (
          <View style={[styles.banner, styles.infoBanner]}>
            <Text style={styles.bannerText}>Reading schedule image...</Text>
            <Text style={styles.statusText}>Keep this tab open while OCR checks the posted calendar.</Text>
          </View>
        ) : null}
        <TextInput
          style={[styles.input, styles.textArea]}
          value={pastedText}
          onChangeText={setPastedText}
          placeholder="Paste schedule text"
          multiline
          textAlignVertical="top"
        />
        <PrimaryButton icon={Check} label="Parse Text" onPress={onParseText} variant="secondary" />
      </View>

      {parseResult && (
        <View style={styles.panel}>
          <SectionTitle icon={ShieldCheck} title="Review" />
          <StatusBanner result={parseResult} />
          {reviewCandidates.map((candidate, index) => (
            <EditableCandidateCard
              key={`${candidate.startAt}-${index}`}
              candidate={candidate}
              onChange={(nextCandidate) => updateCandidate(index, nextCandidate)}
              onRemove={() => removeCandidate(index)}
            />
          ))}
          <View style={styles.actionRow}>
            <PrimaryButton
              icon={Check}
              label="Confirm"
              onPress={() => onConfirm(reviewCandidates)}
              disabled={parseResult.blocked || reviewCandidates.length === 0}
            />
            <PrimaryButton icon={Trash2} label="Clear" onPress={onDismissResult} variant="ghost" />
          </View>
        </View>
      )}
    </View>
  );
}

function ScheduleScreen({
  shifts,
  manualDraft,
  setManualDraft,
  calloffs,
  onAddManual,
  onStatus,
  onCallOff,
  onDelete,
  onCalendarExport,
  onCompleteCalloff,
}: {
  shifts: Shift[];
  manualDraft: ReturnType<typeof createManualDraft>;
  setManualDraft: React.Dispatch<React.SetStateAction<ReturnType<typeof createManualDraft>>>;
  calloffs: CalloffEvent[];
  onAddManual: () => void;
  onStatus: (shiftId: string, status: ShiftStatus) => void;
  onCallOff: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  onCalendarExport: (shift: Shift) => void;
  onCompleteCalloff: (eventId: string) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <SectionTitle icon={Plus} title="Add Shift" />
        <View style={styles.twoColumn}>
          <TextField label="Date" value={manualDraft.date} onChangeText={(date) => setManualDraft((draft) => ({ ...draft, date }))} />
          <TextField label="Start" value={manualDraft.startTime} onChangeText={(startTime) => setManualDraft((draft) => ({ ...draft, startTime }))} />
          <TextField label="End" value={manualDraft.endTime} onChangeText={(endTime) => setManualDraft((draft) => ({ ...draft, endTime }))} />
          <TextField label="Role" value={manualDraft.role} onChangeText={(role) => setManualDraft((draft) => ({ ...draft, role }))} />
        </View>
        <TextField label="Unit" value={manualDraft.unit} onChangeText={(unit) => setManualDraft((draft) => ({ ...draft, unit }))} />
        <TextField label="Title" value={manualDraft.title} onChangeText={(title) => setManualDraft((draft) => ({ ...draft, title }))} />
        <TextField label="Notes" value={manualDraft.notes} onChangeText={(notes) => setManualDraft((draft) => ({ ...draft, notes }))} />
        <PrimaryButton icon={Plus} label="Add Shift" onPress={onAddManual} />
      </View>

      <View style={styles.panel}>
        <SectionTitle icon={CalendarDays} title="Schedule" />
        {shifts.length ? (
          shifts.map((shift) => (
            <ShiftCard
              key={shift.id}
              shift={shift}
              onStatus={onStatus}
              onCallOff={onCallOff}
              onDelete={onDelete}
              onCalendarExport={onCalendarExport}
            />
          ))
        ) : (
          <EmptyState title="No saved shifts" body="Confirmed uploads and manual shifts appear here." />
        )}
      </View>

      {calloffs.length > 0 && (
        <View style={styles.panel}>
          <SectionTitle icon={Phone} title="Call-Off Log" />
          {calloffs.map((event) => (
            <View key={event.id} style={styles.calloffRow}>
              <View style={styles.fill}>
                <Text style={styles.cardTitle}>{event.phoneNumber}</Text>
                <Text style={styles.mutedText}>{formatDateTime(event.createdAt)}</Text>
              </View>
              {event.status === 'started' ? (
                <PrimaryButton icon={Check} label="Done" onPress={() => onCompleteCalloff(event.id)} compact />
              ) : (
                <StatusPill status="going" label="Completed" />
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SettingsScreen({
  profileDraft,
  setProfileDraft,
  accountEmail,
  setAccountEmail,
  accountPassword,
  setAccountPassword,
  accountMessage,
  onSaveProfile,
  onAccount,
  onResyncReminders,
}: {
  profileDraft: ReturnType<typeof profileToDraft>;
  setProfileDraft: React.Dispatch<React.SetStateAction<ReturnType<typeof profileToDraft>>>;
  accountEmail: string;
  setAccountEmail: (value: string) => void;
  accountPassword: string;
  setAccountPassword: (value: string) => void;
  accountMessage: string;
  onSaveProfile: () => void;
  onAccount: () => void;
  onResyncReminders: () => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <SectionTitle icon={Pencil} title="Profile" />
        <ProfileEditor draft={profileDraft} setDraft={setProfileDraft} />
        <PrimaryButton icon={Check} label="Save Settings" onPress={onSaveProfile} />
      </View>
      <View style={styles.panel}>
        <SectionTitle icon={LogIn} title="Account" />
        <TextField label="Email" value={accountEmail} onChangeText={setAccountEmail} keyboardType="email-address" />
        <TextField label="Password" value={accountPassword} onChangeText={setAccountPassword} secureTextEntry />
        <PrimaryButton icon={LogIn} label={supabase ? 'Sign In Or Create' : 'Reset Demo'} onPress={onAccount} variant="secondary" />
        <Text style={styles.statusText}>{accountMessage}</Text>
      </View>
      <View style={styles.panel}>
        <SectionTitle icon={Bell} title="Notifications" />
        <PrimaryButton icon={Bell} label="Sync Reminders" onPress={onResyncReminders} variant="secondary" />
      </View>
    </View>
  );
}

function ProfileEditor({
  draft,
  setDraft,
}: {
  draft: ReturnType<typeof profileToDraft>;
  setDraft: React.Dispatch<React.SetStateAction<ReturnType<typeof profileToDraft>>>;
}) {
  return (
    <View style={styles.stackSmall}>
      <TextField label="Display name" value={draft.displayName} onChangeText={(displayName) => setDraft((current) => ({ ...current, displayName }))} />
      <TextField label="Contact email" value={draft.contactEmail} onChangeText={(contactEmail) => setDraft((current) => ({ ...current, contactEmail }))} keyboardType="email-address" />
      <TextField label="Mobile phone" value={draft.mobilePhone} onChangeText={(mobilePhone) => setDraft((current) => ({ ...current, mobilePhone }))} keyboardType="phone-pad" />
      <TextField label="Schedule names/initials" value={draft.aliases} onChangeText={(aliases) => setDraft((current) => ({ ...current, aliases }))} />
      <TextField label="Time zone" value={draft.timezone} onChangeText={(timezone) => setDraft((current) => ({ ...current, timezone }))} />
      <TextField label="Call-off number" value={draft.calloffPhone} onChangeText={(calloffPhone) => setDraft((current) => ({ ...current, calloffPhone }))} keyboardType="phone-pad" />
      <TextField
        label="Reminder hours"
        value={draft.reminderOffsetHours}
        onChangeText={(reminderOffsetHours) => setDraft((current) => ({ ...current, reminderOffsetHours }))}
        keyboardType="numeric"
      />
    </View>
  );
}

function ShiftCard({
  shift,
  onStatus,
  onCallOff,
  onDelete,
  onCalendarExport,
  compact = false,
}: {
  shift: Shift;
  onStatus: (shiftId: string, status: ShiftStatus) => void;
  onCallOff: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  onCalendarExport: (shift: Shift) => void;
  compact?: boolean;
}) {
  const hours = hoursUntil(shift.startAt);
  return (
    <View style={styles.shiftCard}>
      <View style={styles.shiftHeader}>
        <View style={styles.fill}>
          <Text style={styles.cardTitle}>{shift.title}</Text>
          <Text style={styles.bodyText}>{shift.unit} · {shift.role}</Text>
        </View>
        <StatusPill status={shift.status} />
      </View>
      <Text style={styles.dateLine}>{formatDateTime(shift.startAt)}</Text>
      <Text style={styles.mutedText}>{formatTimeRange(shift.startAt, shift.endAt)} · {hours > 0 ? `${hours}h away` : 'In progress or past'}</Text>
      {shift.confidence ? <Text style={styles.statusText}>OCR confidence {Math.round(shift.confidence * 100)}%</Text> : null}
      <View style={styles.buttonWrap}>
        <SmallButton icon={Check} label="Going" onPress={() => onStatus(shift.id, 'going')} />
        <SmallButton icon={Phone} label="Call Off" onPress={() => onCallOff(shift)} danger />
        {!compact && <SmallButton icon={CalendarDays} label={shift.calendarEventId ? 'Exported' : 'Calendar'} onPress={() => onCalendarExport(shift)} />}
        {!compact && <SmallButton icon={Trash2} label="Delete" onPress={() => onDelete(shift)} muted />}
      </View>
    </View>
  );
}

function EditableCandidateCard({
  candidate,
  onChange,
  onRemove,
}: {
  candidate: ShiftCandidate;
  onChange: (candidate: ShiftCandidate) => void;
  onRemove: () => void;
}) {
  const [dateText, setDateText] = useState(toLocalDateInput(new Date(candidate.startAt)));
  const [startTimeText, setStartTimeText] = useState(toLocalTimeInput(new Date(candidate.startAt)));
  const [endTimeText, setEndTimeText] = useState(toLocalTimeInput(new Date(candidate.endAt)));

  function updateField(key: keyof ShiftCandidate, value: string) {
    onChange({ ...candidate, [key]: value });
  }

  function updateDate(value: string) {
    setDateText(value);
    const next = candidateWithTimes(candidate, value, startTimeText, endTimeText);
    if (next) {
      onChange(next);
    }
  }

  function updateStartTime(value: string) {
    setStartTimeText(value);
    const next = candidateWithTimes(candidate, dateText, value, endTimeText);
    if (next) {
      onChange(next);
    }
  }

  function updateEndTime(value: string) {
    setEndTimeText(value);
    const next = candidateWithTimes(candidate, dateText, startTimeText, value);
    if (next) {
      onChange(next);
    }
  }

  function applyPreset(preset: ShiftPreset) {
    setStartTimeText(preset.startTime);
    setEndTimeText(preset.endTime);
    const next = candidateWithTimes({ ...candidate, title: preset.title }, dateText, preset.startTime, preset.endTime);
    if (next) {
      onChange(next);
    }
  }

  return (
    <View style={styles.shiftCard}>
      <View style={styles.shiftHeader}>
        <View style={styles.fill}>
          <Text style={styles.cardTitle}>Edit detected shift</Text>
          <Text style={styles.bodyText}>Confirm the date, shift type, and unit before saving.</Text>
        </View>
        <Text style={styles.confidence}>{Math.round((candidate.confidence ?? 0) * 100)}%</Text>
      </View>

      <View style={styles.presetRow}>
        {shiftPresets.map((preset) => (
          <Pressable key={preset.label} style={({ pressed }) => [styles.presetButton, pressed && styles.pressed]} onPress={() => applyPreset(preset)}>
            <Text style={styles.presetButtonText}>{preset.label}</Text>
          </Pressable>
        ))}
      </View>

      <TextField label="Title" value={candidate.title} onChangeText={(value) => updateField('title', value)} />
      <View style={styles.twoColumn}>
        <TextField label="Date" value={dateText} onChangeText={updateDate} />
        <TextField label="Start" value={startTimeText} onChangeText={updateStartTime} />
        <TextField label="End" value={endTimeText} onChangeText={updateEndTime} />
        <TextField label="Role" value={candidate.role} onChangeText={(value) => updateField('role', value)} />
      </View>
      <TextField label="Unit" value={candidate.unit} onChangeText={(value) => updateField('unit', value)} />
      <TextField label="Notes" value={candidate.notes ?? ''} onChangeText={(value) => updateField('notes', value)} />
      <Text style={styles.dateLine}>{formatDateTime(candidate.startAt)}</Text>
      <Text style={styles.mutedText}>{formatTimeRange(candidate.startAt, candidate.endAt)}</Text>
      {candidate.sourceText ? <Text style={styles.statusText}>{candidate.sourceText}</Text> : null}
      <View style={styles.buttonWrap}>
        <SmallButton icon={Trash2} label="Remove" onPress={onRemove} muted />
      </View>
    </View>
  );
}

function StatusBanner({ result }: { result: ParseResult }) {
  const backgroundColor = result.blocked ? colors.redSoft : result.candidates.length ? colors.greenSoft : colors.amberSoft;
  const foreground = result.blocked ? colors.red : result.candidates.length ? colors.green : colors.amber;
  return (
    <View style={[styles.banner, { backgroundColor }]}>
      <Text style={[styles.bannerText, { color: foreground }]}>{result.message}</Text>
      {result.warnings.map((warning) => (
        <Text key={warning} style={styles.statusText}>{warning}</Text>
      ))}
    </View>
  );
}

function SectionTitle({ icon: IconComponent, title }: { icon: Icon; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <IconComponent size={18} color={colors.primary} strokeWidth={2.4} />
      <Text style={styles.sectionTitleText}>{title}</Text>
    </View>
  );
}

function TextField({
  label,
  value,
  onChangeText,
  keyboardType,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
      />
    </View>
  );
}

function PrimaryButton({
  icon: IconComponent,
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  compact = false,
}: {
  icon: Icon;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  compact?: boolean;
}) {
  const buttonStyle = [
    styles.primaryButton,
    compact && styles.compactButton,
    variant === 'secondary' && styles.secondaryButton,
    variant === 'ghost' && styles.ghostButton,
    disabled && styles.disabledButton,
  ];
  const color = variant === 'primary' ? colors.surface : colors.primary;
  return (
    <Pressable style={({ pressed }) => [buttonStyle, pressed && !disabled && styles.pressed]} onPress={disabled ? undefined : onPress}>
      <IconComponent size={compact ? 15 : 18} color={disabled ? colors.muted : color} strokeWidth={2.4} />
      <Text style={[styles.primaryButtonText, variant !== 'primary' && styles.secondaryButtonText, disabled && styles.disabledText]}>{label}</Text>
    </Pressable>
  );
}

function SmallButton({
  icon: IconComponent,
  label,
  onPress,
  danger,
  muted,
}: {
  icon: Icon;
  label: string;
  onPress: () => void;
  danger?: boolean;
  muted?: boolean;
}) {
  const color = danger ? colors.red : muted ? colors.muted : colors.primary;
  return (
    <Pressable style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]} onPress={onPress}>
      <IconComponent size={15} color={color} strokeWidth={2.4} />
      <Text style={[styles.smallButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function TabButton({ active, icon: IconComponent, label, onPress }: { active: boolean; icon: Icon; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.tabButton} onPress={onPress}>
      <IconComponent size={21} color={active ? colors.primary : colors.muted} strokeWidth={active ? 2.7 : 2.2} />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function StatCard({ label, value, icon: IconComponent, tone }: { label: string; value: string; icon: Icon; tone: 'blue' | 'green' | 'amber' }) {
  const toneStyles = {
    blue: { backgroundColor: colors.blueSoft, color: colors.primary },
    green: { backgroundColor: colors.greenSoft, color: colors.green },
    amber: { backgroundColor: colors.amberSoft, color: colors.amber },
  }[tone];
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: toneStyles.backgroundColor }]}>
        <IconComponent size={18} color={toneStyles.color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatusPill({ status, label }: { status: ShiftStatus; label?: string }) {
  const stylesByStatus = {
    scheduled: { backgroundColor: colors.blueSoft, color: colors.primary, text: 'Scheduled' },
    going: { backgroundColor: colors.greenSoft, color: colors.green, text: 'Going' },
    called_off: { backgroundColor: colors.redSoft, color: colors.red, text: 'Called Off' },
    missed: { backgroundColor: colors.amberSoft, color: colors.amber, text: 'Missed' },
  }[status];
  return (
    <View style={[styles.statusPill, { backgroundColor: stylesByStatus.backgroundColor }]}>
      <Text style={[styles.statusPillText, { color: stylesByStatus.color }]}>{label ?? stylesByStatus.text}</Text>
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.mutedText}>{body}</Text>
    </View>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.appName}>{title}</Text>
      <Text style={styles.mutedText}>{body}</Text>
    </View>
  );
}

function candidateWithTimes(candidate: ShiftCandidate, dateText: string, startTimeText: string, endTimeText: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(startTimeText) || !/^\d{2}:\d{2}$/.test(endTimeText)) {
    return null;
  }

  const start = combineLocalDateAndTime(dateText, startTimeText);
  let end = combineLocalDateAndTime(dateText, endTimeText);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return {
    ...candidate,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

function profileToDraft(profile: Profile) {
  return {
    displayName: profile.displayName ?? '',
    contactEmail: profile.contactEmail ?? '',
    mobilePhone: profile.mobilePhone ?? '',
    aliases: profile.scheduleAliases?.join(', ') ?? '',
    timezone: profile.timezone ?? getDeviceTimezone(),
    calloffPhone: profile.calloffPhone ?? '',
    reminderOffsetHours: String(profile.reminderOffsetHours ?? 4),
  };
}

function createManualDraft() {
  return {
    date: toLocalDateInput(),
    startTime: '07:00',
    endTime: '15:00',
    title: 'Work shift',
    unit: '',
    role: 'RN',
    notes: '',
  };
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  appShell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 18,
    paddingBottom: 104,
    gap: 16,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  onboarding: {
    padding: 22,
    gap: 16,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  appName: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
  },
  mutedText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyText: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  statusText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blueSoft,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 14,
  },
  stack: {
    gap: 16,
  },
  stackSmall: {
    gap: 10,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitleText: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    minHeight: 116,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 12,
    justifyContent: 'space-between',
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  buttonWrap: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 12,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetButton: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blueSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  presetButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    flexGrow: 1,
  },
  compactButton: {
    minHeight: 36,
    flexGrow: 0,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
  },
  disabledButton: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: colors.primary,
  },
  disabledText: {
    color: colors.muted,
  },
  smallButton: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  smallButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
  field: {
    gap: 6,
    flex: 1,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  textArea: {
    minHeight: 118,
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  shiftCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 14,
    gap: 6,
    backgroundColor: colors.surface,
  },
  shiftHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  dateLine: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  confidence: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '900',
  },
  statusPill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '900',
  },
  banner: {
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  infoBanner: {
    backgroundColor: colors.blueSoft,
  },
  bannerText: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  emptyState: {
    minHeight: 100,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    gap: 6,
  },
  calloffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 76,
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  tabButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  tabLabelActive: {
    color: colors.primary,
  },
});
