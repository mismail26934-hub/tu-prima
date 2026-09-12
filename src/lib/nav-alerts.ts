export type NavAlertKind =
  | "handover"
  | "open_job"
  | "urgent"
  | "p1"
  | "p2"
  | "p3";

export type NavAlertItem = {
  kind: NavAlertKind;
  jobId: string;
  title: string;
  unit: string;
  subtitle: string;
};

export type NavAlertsPayload = {
  openHandovers: number;
  openJobs: number;
  urgentJobs: number;
  p1Jobs: number;
  p2Jobs: number;
  p3Jobs: number;
  items: {
    handover: NavAlertItem[];
    openJob: NavAlertItem[];
    urgent: NavAlertItem[];
    p1: NavAlertItem[];
    p2: NavAlertItem[];
    p3: NavAlertItem[];
  };
};

export const EMPTY_NAV_ALERTS: NavAlertsPayload = {
  openHandovers: 0,
  openJobs: 0,
  urgentJobs: 0,
  p1Jobs: 0,
  p2Jobs: 0,
  p3Jobs: 0,
  items: {
    handover: [],
    openJob: [],
    urgent: [],
    p1: [],
    p2: [],
    p3: [],
  },
};

export function navAlertTotal(data: NavAlertsPayload | undefined): number {
  if (!data) return 0;
  return (
    data.openHandovers +
    data.openJobs +
    data.urgentJobs +
    data.p1Jobs +
    data.p2Jobs +
    data.p3Jobs
  );
}
