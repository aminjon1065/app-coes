export type SeverityLevel = 1 | 2 | 3 | 4;

export type IncidentStatus = "OPEN" | "ESCALATED" | "CONTAINED" | "CLOSED";

export interface Incident {
  id: string;
  code: string;
  title: string;
  location: string;
  severity: SeverityLevel;
  severityLabel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  status: IncidentStatus;
  commander: string;
  startedAt: string;
  elapsed: string;
  coords: { x: number; y: number }; // % positions on map
}

export interface Task {
  id: string;
  name: string;
  incidentCode: string;
  priority: SeverityLevel;
  dueTime: string;
  dueLabel: string;
  overdue: boolean;
  nearDue: boolean;
  completed: boolean;
}

export interface ChatChannel {
  id: string;
  name: string;
  unread: number;
  members: number;
  lastActivity: string;
  lastMessage: string;
}

export interface SlaWarning {
  id: string;
  taskId: string;
  taskName: string;
  incidentCode: string;
  timeRemaining: string;
  overdue: boolean;
  critical: boolean; // < 30m
  warning: boolean;  // < 2h
}

export interface TrendPoint {
  date: string;
  low: number;
  moderate: number;
  high: number;
  critical: number;
}

export interface KpiStat {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  variant: "default" | "danger" | "warning" | "success";
}

// ─── Incidents ────────────────────────────────────────────────
export const incidents: Incident[] = [
  {
    id: "1",
    code: "EQ-2026-04-1234",
    title: "7.1 Magnitude Earthquake — Almaty Region",
    location: "Almaty, Bostandyq District",
    severity: 4,
    severityLabel: "CRITICAL",
    status: "ESCALATED",
    commander: "Col. K. Akhmetov",
    startedAt: "2026-04-12T03:18:00Z",
    elapsed: "9h 14m",
    coords: { x: 68, y: 44 },
  },
  {
    id: "2",
    code: "FL-2026-04-0980",
    title: "Flash Flood — Syr Darya River Basin",
    location: "Kyzylorda Oblast, Lower Basin",
    severity: 3,
    severityLabel: "HIGH",
    status: "OPEN",
    commander: "Maj. D. Seitkali",
    startedAt: "2026-04-12T06:45:00Z",
    elapsed: "5h 47m",
    coords: { x: 38, y: 55 },
  },
  {
    id: "3",
    code: "FR-2026-04-0871",
    title: "Wildfire — Burabay National Park",
    location: "Akmola Oblast, Burabay",
    severity: 3,
    severityLabel: "HIGH",
    status: "OPEN",
    commander: "Cpt. A. Nurlanovna",
    startedAt: "2026-04-12T08:02:00Z",
    elapsed: "4h 30m",
    coords: { x: 52, y: 28 },
  },
  {
    id: "4",
    code: "IN-2026-04-0820",
    title: "Industrial Gas Leak — Tengiz Refinery",
    location: "Atyrau Oblast, Tengiz",
    severity: 2,
    severityLabel: "MODERATE",
    status: "CONTAINED",
    commander: "Lt. B. Dzhaksybekov",
    startedAt: "2026-04-12T09:15:00Z",
    elapsed: "3h 17m",
    coords: { x: 18, y: 49 },
  },
  {
    id: "5",
    code: "MG-2026-04-0790",
    title: "Mass Gathering — Nauryz Festival Security",
    location: "Astana, Expo District",
    severity: 1,
    severityLabel: "LOW",
    status: "OPEN",
    commander: "Cpt. S. Bekova",
    startedAt: "2026-04-12T10:00:00Z",
    elapsed: "2h 32m",
    coords: { x: 55, y: 35 },
  },
  {
    id: "6",
    code: "OB-2026-04-0644",
    title: "Debris Flow — Charyn Canyon Trail",
    location: "Almaty Oblast, Charyn River",
    severity: 1,
    severityLabel: "LOW",
    status: "OPEN",
    commander: "Lt. T. Omarov",
    startedAt: "2026-04-12T11:20:00Z",
    elapsed: "1h 12m",
    coords: { x: 72, y: 50 },
  },
];

// ─── Tasks ────────────────────────────────────────────────────
export const tasks: Task[] = [
  {
    id: "t1",
    name: "Deploy search & rescue teams to Bostandyq",
    incidentCode: "EQ-2026-04-1234",
    priority: 4,
    dueTime: "08:00",
    dueLabel: "08:00 — OVERDUE",
    overdue: true,
    nearDue: false,
    completed: false,
  },
  {
    id: "t2",
    name: "Coordinate hospital triage — Almaty City",
    incidentCode: "EQ-2026-04-1234",
    priority: 4,
    dueTime: "12:00",
    dueLabel: "12:00 — OVERDUE",
    overdue: true,
    nearDue: false,
    completed: false,
  },
  {
    id: "t3",
    name: "Issue evacuation order — Zone 3 floodplain",
    incidentCode: "FL-2026-04-0980",
    priority: 3,
    dueTime: "13:00",
    dueLabel: "13:00",
    overdue: false,
    nearDue: true,
    completed: false,
  },
  {
    id: "t4",
    name: "Establish ICP at Burabay ranger station",
    incidentCode: "FR-2026-04-0871",
    priority: 3,
    dueTime: "13:30",
    dueLabel: "13:30",
    overdue: false,
    nearDue: true,
    completed: false,
  },
  {
    id: "t5",
    name: "Confirm gas plume dispersion report",
    incidentCode: "IN-2026-04-0820",
    priority: 2,
    dueTime: "14:00",
    dueLabel: "14:00",
    overdue: false,
    nearDue: false,
    completed: false,
  },
  {
    id: "t6",
    name: "Submit SITREP to ministry — 14:00 deadline",
    incidentCode: "EQ-2026-04-1234",
    priority: 4,
    dueTime: "14:00",
    dueLabel: "14:00",
    overdue: false,
    nearDue: false,
    completed: false,
  },
  {
    id: "t7",
    name: "Review festival security perimeter plan",
    incidentCode: "MG-2026-04-0790",
    priority: 1,
    dueTime: "15:00",
    dueLabel: "15:00",
    overdue: false,
    nearDue: false,
    completed: false,
  },
  {
    id: "t8",
    name: "Close trail access — Charyn Canyon sector B",
    incidentCode: "OB-2026-04-0644",
    priority: 1,
    dueTime: "16:00",
    dueLabel: "16:00",
    overdue: false,
    nearDue: false,
    completed: false,
  },
];

// ─── Chat Channels ────────────────────────────────────────────
export const chatChannels: ChatChannel[] = [
  {
    id: "c1",
    name: "eq-1234-almaty-ops",
    unread: 14,
    members: 28,
    lastActivity: "2m ago",
    lastMessage: "SAR Team 3 requesting additional K9 units at grid 42.8°N",
  },
  {
    id: "c2",
    name: "fl-0980-kyzylorda",
    unread: 6,
    members: 15,
    lastActivity: "8m ago",
    lastMessage: "Levee inspection complete. No breach detected in sector 4.",
  },
  {
    id: "c3",
    name: "fr-0871-burabay-fire",
    unread: 3,
    members: 12,
    lastActivity: "15m ago",
    lastMessage: "Wind shift NE at 18 knots — updating fire perimeter map now",
  },
  {
    id: "c4",
    name: "general-ops-center",
    unread: 0,
    members: 44,
    lastActivity: "1h ago",
    lastMessage: "Shift change briefing slides uploaded to Documents.",
  },
];

// ─── SLA Warnings ─────────────────────────────────────────────
export const slaWarnings: SlaWarning[] = [
  {
    id: "s1",
    taskId: "TSK-4421",
    taskName: "Evacuation order issuance — Zone 3",
    incidentCode: "FL-2026-04-0980",
    timeRemaining: "OVERDUE 47m",
    overdue: true,
    critical: false,
    warning: false,
  },
  {
    id: "s2",
    taskId: "TSK-4398",
    taskName: "SITREP submission to ministry",
    incidentCode: "EQ-2026-04-1234",
    timeRemaining: "18m remaining",
    overdue: false,
    critical: true,
    warning: false,
  },
  {
    id: "s3",
    taskId: "TSK-4415",
    taskName: "ICP establishment confirmation",
    incidentCode: "FR-2026-04-0871",
    timeRemaining: "28m remaining",
    overdue: false,
    critical: true,
    warning: false,
  },
  {
    id: "s4",
    taskId: "TSK-4380",
    taskName: "Gas plume dispersion assessment",
    incidentCode: "IN-2026-04-0820",
    timeRemaining: "1h 12m remaining",
    overdue: false,
    critical: false,
    warning: true,
  },
  {
    id: "s5",
    taskId: "TSK-4362",
    taskName: "Resource requisition — heavy machinery",
    incidentCode: "EQ-2026-04-1234",
    timeRemaining: "1h 55m remaining",
    overdue: false,
    critical: false,
    warning: true,
  },
];

// ─── Incident Trend (7 days) ──────────────────────────────────
export const incidentTrend: TrendPoint[] = [
  { date: "Apr 6", low: 3, moderate: 2, high: 1, critical: 0 },
  { date: "Apr 7", low: 4, moderate: 3, high: 2, critical: 0 },
  { date: "Apr 8", low: 2, moderate: 2, high: 2, critical: 1 },
  { date: "Apr 9", low: 5, moderate: 3, high: 1, critical: 0 },
  { date: "Apr 10", low: 3, moderate: 4, high: 3, critical: 1 },
  { date: "Apr 11", low: 4, moderate: 2, high: 3, critical: 0 },
  { date: "Apr 12", low: 2, moderate: 1, high: 2, critical: 1 },
];

// ─── KPI Stats ────────────────────────────────────────────────
export const kpiStats: KpiStat[] = [
  {
    label: "OPEN INCIDENTS",
    value: 12,
    trend: "up",
    trendLabel: "↑3 today",
    variant: "default",
  },
  {
    label: "CRITICAL",
    value: 2,
    trend: "up",
    trendLabel: "+1 from yesterday",
    variant: "danger",
  },
  {
    label: "SLA AT RISK",
    value: 5,
    trend: "down",
    trendLabel: "−2 improvement",
    variant: "warning",
  },
  {
    label: "ON DUTY",
    value: "18 / 22",
    subValue: "82%",
    trend: "neutral",
    trendLabel: "4 offline",
    variant: "success",
  },
];
