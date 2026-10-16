/**
 * Google Calendar (or any calendar) foundation. NOT connected: there is no provider, no credentials and nothing
 * calls this in Phase 3. Core scheduling never depends on it. A real provider implements CalendarProvider and is
 * registered here together with its environment variables.
 */
export interface CalendarEventInput { title: string; startsAt: Date; endsAt: Date; description?: string }
export interface CalendarProvider {
  readonly key: string;
  isConfigured(): boolean;
  upsertEvent(doctorUserId: string, appointmentId: string, event: CalendarEventInput): Promise<{ externalId: string }>;
  removeEvent(doctorUserId: string, externalId: string): Promise<void>;
}
export const calendarProvider = null as CalendarProvider | null;
export const isCalendarConfigured = () => !!calendarProvider?.isConfigured();
