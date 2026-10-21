"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  calculateAttendanceHours,
  timeToMinute,
  type HoursBreakdown,
  type WorkScheduleInput,
} from "@/lib/attendance/calculation";
import AttendanceReporting from "@/app/attendance-reporting";
import {
  deriveBirthDateFromSouthAfricanId,
  maskIdentifier,
  normalizeStaffPrivateDetails,
} from "@/lib/staff/details";
import { leaveTypeLabel, type LeaveType } from "@/lib/leave/types";

type View =
  | "overview"
  | "clock"
  | "attendance"
  | "leave"
  | "staff"
  | "stores"
  | "reports"
  | "administrators";
type Store = {
  id: string;
  name: string;
  location: string;
  code: string;
  active: boolean;
};
type Person = {
  id: string;
  name: string;
  role: string;
  storeId: string;
  pin: string;
  active: boolean;
  clockedIn: boolean;
  clockIn?: string;
  email?: string | null;
  contactNumber?: string | null;
  maskedIdNumber?: string | null;
  maskedTaxNumber?: string | null;
  startDate?: string | null;
  dateOfBirth?: string | null;
};
type StaffDetailDraft = {
  email: string;
  contactNumber: string;
  idNumber: string;
  taxNumber: string;
  startDate: string;
};
type RecordItem = {
  id: string;
  employeeId: string;
  storeId: string;
  date: string;
  inTime?: string;
  outTime?: string;
  status: "On time" | "Late" | "Complete" | "Incomplete";
  hours?: number;
  recordSource?: "employee_clocking" | "administrator_adjustment" | "system_auto_clock_out";
  adjustmentReason?: string;
};
type AttendanceAdjustmentInput = {
  attendanceId: string;
  clockIn: string;
  clockOut: string;
  reason: string;
};
type LeaveRequest = {
  id: string;
  staffId: string;
  storeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  managerNote?: string;
  createdAt: string;
};
type LeaveUpsertInput = {
  requestId?: string;
  staffId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
};
type PublicHoliday = { date: string; name: string; observed: boolean };
type AdministratorMember = {
  userId: string;
  email: string;
  role: "admin" | "manager";
  active: boolean;
  pending: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  storeIds: string[];
};
type ReportRun = {
  report_date: string;
  period_start: string;
  period_end: string;
  recipient_email: string;
  trigger: "scheduled" | "manual";
  status: "sending" | "sent" | "failed";
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
};
type ReportSetting = {
  recipientEmail: string;
  enabled: boolean;
  updatedAt: string | null;
  deliveryConfigured: boolean;
};
type ReportMinutes = {
  normalMinutes: number;
  overtimeOneHalfMinutes: number;
  overtimeDoubleMinutes: number;
  totalOvertimeMinutes: number;
};
type ReportPreview = {
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  recipient: string;
  branches: Array<{
    branchId: string;
    branchName: string;
    employees: Array<
      ReportMinutes & { employeeId: string; employeeName: string }
    >;
    subtotal: Omit<ReportMinutes, "totalOvertimeMinutes">;
    totalOvertimeMinutes: number;
  }>;
  companyTotal: ReportMinutes;
};
type SyncMode = "demo" | "connecting" | "cloud" | "error";

const TIMEZONE = "Africa/Johannesburg";

const initialStores: Store[] = [
  {
    id: "rosebank",
    name: "Rosebank",
    location: "Johannesburg",
    code: "RBK",
    active: true,
  },
  {
    id: "sandton",
    name: "Sandton City",
    location: "Johannesburg",
    code: "SDT",
    active: true,
  },
  {
    id: "menlyn",
    name: "Menlyn Maine",
    location: "Pretoria",
    code: "MLN",
    active: true,
  },
];

const initialPeople: Person[] = [
  {
    id: "thandi",
    name: "Thandi Mokoena",
    role: "Store manager",
    storeId: "rosebank",
    pin: "1842",
    active: true,
    clockedIn: true,
    clockIn: "07:42",
  },
  {
    id: "liam",
    name: "Liam Naidoo",
    role: "Sales associate",
    storeId: "rosebank",
    pin: "5521",
    active: true,
    clockedIn: true,
    clockIn: "07:55",
  },
  {
    id: "ayanda",
    name: "Ayanda Ndlovu",
    role: "Sales associate",
    storeId: "rosebank",
    pin: "2290",
    active: true,
    clockedIn: true,
    clockIn: "08:04",
  },
  {
    id: "jason",
    name: "Jason Petersen",
    role: "Stock assistant",
    storeId: "rosebank",
    pin: "8031",
    active: true,
    clockedIn: false,
  },
  {
    id: "zanele",
    name: "Zanele Khumalo",
    role: "Cashier",
    storeId: "rosebank",
    pin: "4420",
    active: true,
    clockedIn: true,
    clockIn: "08:01",
  },
  {
    id: "palesa",
    name: "Palesa Molefe",
    role: "Sales associate",
    storeId: "rosebank",
    pin: "3917",
    active: true,
    clockedIn: false,
  },
  {
    id: "sarah",
    name: "Sarah Jacobs",
    role: "Store manager",
    storeId: "sandton",
    pin: "6702",
    active: true,
    clockedIn: true,
    clockIn: "07:38",
  },
  {
    id: "kabelo",
    name: "Kabelo Dube",
    role: "Sales associate",
    storeId: "sandton",
    pin: "1109",
    active: true,
    clockedIn: true,
    clockIn: "07:49",
  },
  {
    id: "maya",
    name: "Maya Adams",
    role: "Cashier",
    storeId: "sandton",
    pin: "7144",
    active: true,
    clockedIn: false,
  },
  {
    id: "sibusiso",
    name: "Sibusiso Zulu",
    role: "Store manager",
    storeId: "menlyn",
    pin: "3058",
    active: true,
    clockedIn: true,
    clockIn: "07:46",
  },
];

const today = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
const initialRecords: RecordItem[] = [
  {
    id: "r1",
    employeeId: "thandi",
    storeId: "rosebank",
    date: today,
    inTime: "07:42",
    status: "On time",
  },
  {
    id: "r2",
    employeeId: "liam",
    storeId: "rosebank",
    date: today,
    inTime: "07:55",
    status: "On time",
  },
  {
    id: "r3",
    employeeId: "ayanda",
    storeId: "rosebank",
    date: today,
    inTime: "08:04",
    status: "Late",
  },
  {
    id: "r4",
    employeeId: "zanele",
    storeId: "rosebank",
    date: today,
    inTime: "08:01",
    status: "Late",
  },
  {
    id: "r5",
    employeeId: "sarah",
    storeId: "sandton",
    date: today,
    inTime: "07:38",
    status: "On time",
  },
  {
    id: "r6",
    employeeId: "kabelo",
    storeId: "sandton",
    date: today,
    inTime: "07:49",
    status: "On time",
  },
  {
    id: "r7",
    employeeId: "sibusiso",
    storeId: "menlyn",
    date: today,
    inTime: "07:46",
    status: "On time",
  },
  {
    id: "r8",
    employeeId: "jason",
    storeId: "rosebank",
    date: "2026-08-23",
    inTime: "07:58",
    outTime: "17:03",
    status: "Complete",
    hours: 9.1,
  },
];

const nav: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "clock", label: "Clock station", icon: "◷" },
  { id: "attendance", label: "Attendance", icon: "▤" },
  { id: "leave", label: "Leave & hours", icon: "◫" },
  { id: "staff", label: "Staff", icon: "♙" },
  { id: "stores", label: "Stores", icon: "◇" },
  { id: "reports", label: "Attendance reports", icon: "▥" },
  { id: "administrators", label: "Administrators", icon: "⚙" },
];

const demoHolidays: PublicHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day", observed: false },
  { date: "2026-03-21", name: "Human Rights Day", observed: false },
  { date: "2026-04-03", name: "Good Friday", observed: false },
  { date: "2026-04-06", name: "Family Day", observed: false },
  { date: "2026-04-27", name: "Freedom Day", observed: false },
  { date: "2026-05-01", name: "Workers' Day", observed: false },
  { date: "2026-06-16", name: "Youth Day", observed: false },
  { date: "2026-08-09", name: "National Women's Day", observed: false },
  { date: "2026-08-10", name: "National Women's Day observed", observed: true },
  { date: "2026-09-24", name: "Heritage Day", observed: false },
  { date: "2026-12-16", name: "Day of Reconciliation", observed: false },
  { date: "2026-12-25", name: "Christmas Day", observed: false },
  { date: "2026-12-26", name: "Day of Goodwill", observed: false },
];

const workSchedules: WorkScheduleInput[] = [
  ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    opensAtMinute: 7 * 60 + 30,
    closesAtMinute: 17 * 60,
    unpaidBreakMinutes: 60,
  })),
  {
    dayOfWeek: 6,
    opensAtMinute: 8 * 60,
    closesAtMinute: 13 * 60,
    unpaidBreakMinutes: 30,
  },
  {
    dayOfWeek: 7,
    opensAtMinute: null,
    closesAtMinute: null,
    unpaidBreakMinutes: 0,
  },
];

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const tones = ["plum", "blue", "gold", "green"];
const formatDate = (value: Date) =>
  value.toLocaleDateString("en-ZA", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

function calculateHours(records: RecordItem[], holidays: PublicHoliday[]) {
  return calculateAttendanceHours(
    records
      .filter((record) => record.inTime)
      .map((record) => ({
        id: record.id,
        staffId: record.employeeId,
        date: record.date,
        clockInMinute: timeToMinute(record.inTime ?? null) ?? 0,
        clockOutMinute: timeToMinute(record.outTime ?? null),
      })),
    workSchedules,
    holidays.map((holiday) => holiday.date),
  );
}

function attendanceTime(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString("en-ZA", {
        timeZone: TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : undefined;
}

function attendanceRecord(row: {
  id: string;
  staff_id: string;
  store_id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: RecordItem["status"];
  record_source?: RecordItem["recordSource"] | null;
  adjustment_reason?: string | null;
}): RecordItem {
  return {
    id: row.id,
    employeeId: row.staff_id,
    storeId: row.store_id,
    date: row.work_date,
    inTime: attendanceTime(row.clock_in),
    outTime: attendanceTime(row.clock_out),
    status: row.status,
    hours:
      row.clock_in && row.clock_out
        ? Math.round(((new Date(row.clock_out).getTime() - new Date(row.clock_in).getTime()) / 3600000) * 10) / 10
        : undefined,
    recordSource: row.record_source ?? "employee_clocking",
    adjustmentReason: row.adjustment_reason ?? undefined,
  };
}

export default function Home() {
  const router = useRouter();
  const cloudConfigured = isSupabaseConfigured();
  const [view, setView] = useState<View>("overview");
  const [stores, setStores] = useState<Store[]>(
    cloudConfigured ? [] : initialStores,
  );
  const [people, setPeople] = useState<Person[]>(
    cloudConfigured ? [] : initialPeople,
  );
  const [records, setRecords] = useState<RecordItem[]>(
    cloudConfigured ? [] : initialRecords,
  );
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>(demoHolidays);
  const [selectedStore, setSelectedStore] = useState(
    cloudConfigured ? "" : "rosebank",
  );
  const [selectedEmployee, setSelectedEmployee] = useState(
    cloudConfigured ? "" : "thandi",
  );
  const [recordDate, setRecordDate] = useState(today);
  const [modal, setModal] = useState<
    | "staff"
    | "staff-details"
    | "store"
    | "administrator"
    | "reset-pin"
    | "change-store"
    | null
  >(null);
  const [selectedStaffActionId, setSelectedStaffActionId] = useState("");
  const [staffDetailDraft, setStaffDetailDraft] = useState<StaffDetailDraft>({
    email: "",
    contactNumber: "",
    idNumber: "",
    taxNumber: "",
    startDate: "",
  });
  const [staffDetailsLoading, setStaffDetailsLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(new Date());
  const [hydrated, setHydrated] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>(
    cloudConfigured ? "connecting" : "demo",
  );
  const [organizationId, setOrganizationId] = useState("");
  const [currentRole, setCurrentRole] = useState<"admin" | "manager">("admin");
  const [administrators, setAdministrators] = useState<AdministratorMember[]>(
    [],
  );
  const [currentAdministratorId, setCurrentAdministratorId] = useState("");
  const [administratorsLoading, setAdministratorsLoading] = useState(false);
  const [reportSetting, setReportSetting] = useState<ReportSetting>({
    recipientEmail: "",
    enabled: false,
    updatedAt: null,
    deliveryConfigured: false,
  });
  const [reportRuns, setReportRuns] = useState<ReportRun[]>([]);
  const [reportPreview, setReportPreview] = useState<ReportPreview | null>(
    null,
  );
  const [reportsLoading, setReportsLoading] = useState(false);
  const [adminEmail, setAdminEmail] = useState("Administrator");
  const [supabase] = useState<SupabaseClient | null>(() =>
    createSupabaseClient(),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    async function hydrate() {
      if (!supabase) {
        const saved = window.localStorage.getItem("presently-phase-one");
        if (saved) {
          try {
            const data = JSON.parse(saved);
            setStores(data.stores ?? initialStores);
            setPeople(data.people ?? initialPeople);
            setRecords(data.records ?? initialRecords);
          } catch {
            /* keep demo data */
          }
        }
        setHydrated(true);
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }
      setAdminEmail(userData.user.email ?? "Administrator");
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("organization_id, role")
        .limit(1)
        .maybeSingle();
      if (membershipError) {
        setSyncMode("error");
        setHydrated(true);
        return;
      }
      if (!membership) {
        router.replace("/onboarding");
        return;
      }
      const orgId = String(membership.organization_id);
      setOrganizationId(orgId);
      setCurrentRole(membership.role === "manager" ? "manager" : "admin");

      const [
        storeResult,
        staffResult,
        attendanceResult,
        leaveResult,
        holidayResult,
      ] = await Promise.all([
        supabase
          .from("stores")
          .select("*")
          .eq("organization_id", orgId)
          .order("name"),
        supabase
          .from("staff")
          .select(
            "id, organization_id, store_id, name, role, pin_last_two, active, created_at",
          )
          .eq("organization_id", orgId)
          .is("archived_at", null)
          .order("name"),
        supabase
          .from("attendance")
          .select("*")
          .eq("organization_id", orgId)
          .order("clock_in", { ascending: false })
          .limit(250),
        supabase
          .from("leave_requests")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
        supabase
          .from("public_holidays")
          .select("*")
          .gte("holiday_date", "2026-01-01")
          .lte("holiday_date", "2026-12-31")
          .order("holiday_date"),
      ]);
      if (
        storeResult.error ||
        staffResult.error ||
        attendanceResult.error ||
        leaveResult.error ||
        holidayResult.error
      ) {
        setSyncMode("error");
        setHydrated(true);
        return;
      }

      const cloudRecords: RecordItem[] = (attendanceResult.data ?? []).map(attendanceRecord);
      const openShifts = new Map(
        cloudRecords
          .filter((record) => !record.outTime)
          .map((record) => [record.employeeId, record]),
      );
      const cloudStores: Store[] = (storeResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        location: row.location,
        code: row.code,
        active: row.active,
      }));
      let cloudPeople: Person[] = (staffResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        storeId: row.store_id,
        pin: `00${row.pin_last_two ?? "00"}`,
        active: row.active,
        clockedIn: openShifts.has(row.id),
        clockIn: openShifts.get(row.id)?.inTime,
      }));
      if (membership.role === "admin") {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token) {
          const detailResponse = await fetch("/api/staff", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          if (detailResponse.ok) {
            const detailPayload = await detailResponse.json();
            const detailByStaff = new Map(
              (detailPayload.details ?? []).map(
                (detail: { staffId: string }) => [detail.staffId, detail],
              ),
            );
            cloudPeople = cloudPeople.map((person) => ({
              ...person,
              ...(detailByStaff.get(person.id) ?? {}),
            }));
          }
        }
      }
      const cloudLeave: LeaveRequest[] = (leaveResult.data ?? []).map(
        (row) => ({
          id: row.id,
          staffId: row.staff_id,
          storeId: row.store_id,
          type: row.leave_type,
          startDate: row.start_date,
          endDate: row.end_date,
          reason: row.reason,
          status: row.status,
          managerNote: row.manager_note ?? undefined,
          createdAt: row.created_at,
        }),
      );
      const cloudHolidays: PublicHoliday[] = (holidayResult.data ?? []).map(
        (row) => ({
          date: row.holiday_date,
          name: row.name,
          observed: row.observed,
        }),
      );
      setStores(cloudStores);
      setPeople(cloudPeople);
      setRecords(cloudRecords);
      setLeaveRequests(cloudLeave);
      setHolidays(cloudHolidays);
      setSelectedStore(cloudStores.find((store) => store.active)?.id ?? "");
      setSyncMode("cloud");
      setHydrated(true);
    }
    hydrate();
    return () => window.clearInterval(timer);
  }, [router, supabase]);

  useEffect(() => {
    if (!supabase || syncMode !== "cloud" || !organizationId) return;
    let cancelled = false;
    async function loadAttendanceDate() {
      const { data, error } = await supabase!
        .from("attendance")
        .select("id, staff_id, store_id, work_date, clock_in, clock_out, status, record_source, adjustment_reason")
        .eq("organization_id", organizationId)
        .eq("work_date", recordDate)
        .order("clock_in", { ascending: true });
      if (cancelled) return;
      if (error) {
        setToast(`Attendance could not be loaded: ${error.message}`);
        return;
      }
      const selectedDateRecords = (data ?? []).map(attendanceRecord);
      setRecords((current) => [...current.filter((record) => record.date !== recordDate), ...selectedDateRecords]);
    }
    void loadAttendanceDate();
    return () => { cancelled = true; };
  }, [organizationId, recordDate, supabase, syncMode]);

  useEffect(() => {
    if (hydrated && syncMode === "demo")
      window.localStorage.setItem(
        "presently-phase-one",
        JSON.stringify({ stores, people, records }),
      );
  }, [stores, people, records, hydrated, syncMode]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const storePeople = useMemo(
    () =>
      people.filter(
        (person) => person.storeId === selectedStore && person.active,
      ),
    [people, selectedStore],
  );
  const presentCount = storePeople.filter((person) => person.clockedIn).length;
  const filteredRecords = records.filter(
    (record) =>
      (selectedStore === "all" || record.storeId === selectedStore) &&
      record.date === recordDate,
  );
  const effectiveSelectedEmployee = storePeople.some(
    (person) => person.id === selectedEmployee,
  )
    ? selectedEmployee
    : (storePeople[0]?.id ?? "");
  const activeEmployee = people.find(
    (person) => person.id === effectiveSelectedEmployee,
  );
  const administratorName =
    adminEmail === "Administrator" ? "Administrator" : adminEmail.split("@")[0];
  const hoursByRecord = useMemo(
    () => calculateHours(records, holidays),
    [records, holidays],
  );

  function switchView(next: View) {
    if (next === "administrators" && currentRole !== "admin") return;
    if ((next === "overview" || next === "clock") && selectedStore === "all")
      setSelectedStore(stores.find((store) => store.active)?.id ?? "rosebank");
    setView(next);
    setMenuOpen(false);
    if (next === "administrators") void loadAdministrators();
    if (next === "reports" && currentRole === "admin")
      void loadReportSettings();
  }

  async function saveAttendanceAdjustment(input: AttendanceAdjustmentInput) {
    if (currentRole !== "admin") throw new Error("Administrator access is required to edit attendance.");
    if (!supabase) throw new Error("Cloud access is unavailable.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const clockIn = new Date(`${input.clockIn}:00+02:00`).toISOString();
    const clockOut = new Date(`${input.clockOut}:00+02:00`).toISOString();
    const response = await fetch("/api/attendance-adjustments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ attendanceId: input.attendanceId, clockIn, clockOut, reason: input.reason }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Attendance correction could not be saved.");
    setRecords((current) => current.map((record) => record.id === input.attendanceId ? {
      ...record,
      inTime: input.clockIn.slice(11, 16),
      outTime: input.clockOut.slice(11, 16),
      status: "Complete",
      recordSource: "administrator_adjustment",
      adjustmentReason: input.reason.trim(),
    } : record));
    setToast("Attendance corrected. Payroll and overtime reports will use the updated times.");
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const role = String(form.get("role"));
    const storeId = String(form.get("store"));
    const pin = String(form.get("pin"));
    const privateInput = {
      email: String(form.get("email") ?? ""),
      contactNumber: String(form.get("contactNumber") ?? ""),
      idNumber: String(form.get("idNumber") ?? ""),
      taxNumber: String(form.get("taxNumber") ?? ""),
      startDate: String(form.get("startDate") ?? ""),
    };
    let id = `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}`;
    if (syncMode === "cloud" && supabase) {
      try {
        const payload = await staffFetch("", {
          method: "POST",
          body: JSON.stringify({ name, role, storeId, pin, ...privateInput }),
        });
        id = payload.id;
      } catch (error) {
        setToast(
          error instanceof Error ? error.message : "Could not add staff.",
        );
        return;
      }
    }
    const privateDetails = normalizeStaffPrivateDetails(privateInput);
    const person: Person = {
      id,
      name,
      role,
      storeId,
      pin,
      active: true,
      clockedIn: false,
      email: privateDetails.email,
      contactNumber: privateDetails.contactNumber,
      maskedIdNumber: maskIdentifier(privateDetails.idNumber),
      maskedTaxNumber: maskIdentifier(privateDetails.taxNumber),
      startDate: privateDetails.startDate,
      dateOfBirth: privateDetails.dateOfBirth,
    };
    setPeople((current) => [...current, person]);
    setModal(null);
    setToast(`${name} was added to the team.`);
  }
  async function addStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const location = String(form.get("location"));
    const code = String(form.get("code")).toUpperCase();
    let id = `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}`;
    if (syncMode === "cloud" && supabase) {
      const { data, error } = await supabase
        .from("stores")
        .insert({
          organization_id: organizationId,
          name,
          location,
          code,
          active: true,
        })
        .select("id")
        .single();
      if (error) {
        setToast(`Could not add store: ${error.message}`);
        return;
      }
      id = data.id;
    }
    const store: Store = { id, name, location, code, active: true };
    setStores((current) => [...current, store]);
    setModal(null);
    setToast(`${name} is ready for staff.`);
  }
  async function clockAction() {
    if (!activeEmployee) return;
    const time = now.toLocaleTimeString("en-ZA", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (activeEmployee.clockedIn) {
      const openLocalRecord = records.find(
        (record) => record.employeeId === activeEmployee.id && !record.outTime,
      );
      const [startHour, startMinute] = (openLocalRecord?.inTime ?? time)
        .split(":")
        .map(Number);
      const start = new Date(now);
      start.setHours(startHour, startMinute, 0, 0);
      if (start > now) start.setDate(start.getDate() - 1);
      const hoursWorked = Math.max(
        0,
        Math.round(((now.getTime() - start.getTime()) / 3600000) * 10) / 10,
      );
      if (syncMode === "cloud" && supabase) {
        const openRecord = openLocalRecord;
        if (!openRecord) {
          setToast("No open shift was found.");
          return;
        }
        const { error } = await supabase
          .from("attendance")
          .update({ clock_out: now.toISOString(), status: "Complete" })
          .eq("id", openRecord.id);
        if (error) {
          setToast(`Clock out failed: ${error.message}`);
          return;
        }
      }
      setPeople((current) =>
        current.map((person) =>
          person.id === activeEmployee.id
            ? { ...person, clockedIn: false, clockIn: undefined }
            : person,
        ),
      );
      setRecords((current) =>
        current.map((record) =>
          record.employeeId === activeEmployee.id && !record.outTime
            ? {
                ...record,
                outTime: time,
                status: "Complete",
                hours: hoursWorked,
              }
            : record,
        ),
      );
      setToast(`${activeEmployee.name} clocked out at ${time}.`);
    } else {
      let recordId = `r-${Date.now()}`;
      if (syncMode === "cloud" && supabase) {
        const status = time > "08:00" ? "Late" : "On time";
        const { data, error } = await supabase
          .from("attendance")
          .insert({
            organization_id: organizationId,
            staff_id: activeEmployee.id,
            store_id: activeEmployee.storeId,
            work_date: today,
            clock_in: now.toISOString(),
            status,
          })
          .select("id")
          .single();
        if (error) {
          setToast(`Clock in failed: ${error.message}`);
          return;
        }
        recordId = data.id;
      }
      setPeople((current) =>
        current.map((person) =>
          person.id === activeEmployee.id
            ? { ...person, clockedIn: true, clockIn: time }
            : person,
        ),
      );
      setRecords((current) => [
        {
          id: recordId,
          employeeId: activeEmployee.id,
          storeId: activeEmployee.storeId,
          date: today,
          inTime: time,
          status: time > "08:00" ? "Late" : "On time",
        },
        ...current,
      ]);
      setToast(`${activeEmployee.name} clocked in at ${time}.`);
    }
  }
  async function toggleStaff(id: string) {
    const person = people.find((item) => item.id === id);
    if (!person) return;
    const active = !person.active;
    if (!active && person.clockedIn) {
      setToast("Clock this staff member out before deactivating access.");
      return;
    }
    if (syncMode === "cloud" && supabase) {
      const { error } = await supabase
        .from("staff")
        .update({ active })
        .eq("id", id);
      if (error) {
        setToast(error.message);
        return;
      }
    }
    setPeople((current) =>
      current.map((item) =>
        item.id === id ? { ...item, active, clockedIn: false } : item,
      ),
    );
  }
  async function toggleStore(id: string) {
    const store = stores.find((item) => item.id === id);
    if (!store) return;
    const active = !store.active;
    if (syncMode === "cloud" && supabase) {
      const { error } = await supabase
        .from("stores")
        .update({ active })
        .eq("id", id);
      if (error) {
        setToast(error.message);
        return;
      }
    }
    setStores((current) =>
      current.map((item) => (item.id === id ? { ...item, active } : item)),
    );
  }
  async function signOut() {
    await supabase?.auth.signOut();
    router.replace("/login");
  }
  async function staffFetch(path = "", options: RequestInit = {}) {
    if (!supabase) throw new Error("Cloud access is unavailable.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token)
      throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch(`/api/staff${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Staff request failed.");
    return payload;
  }
  function openResetPin(id: string) {
    setSelectedStaffActionId(id);
    setModal("reset-pin");
  }
  async function openStaffDetails(id: string) {
    const person = people.find((item) => item.id === id);
    if (!person) return;
    setSelectedStaffActionId(id);
    setStaffDetailsLoading(true);
    try {
      if (syncMode === "cloud") {
        const payload = await staffFetch(`?staffId=${encodeURIComponent(id)}`);
        const details = payload.details;
        setStaffDetailDraft({
          email: details?.email ?? "",
          contactNumber: details?.contactNumber ?? "",
          idNumber: details?.idNumber ?? "",
          taxNumber: details?.taxNumber ?? "",
          startDate: details?.startDate ?? "",
        });
      } else {
        setStaffDetailDraft({
          email: person.email ?? "",
          contactNumber: person.contactNumber ?? "",
          idNumber: "",
          taxNumber: "",
          startDate: person.startDate ?? "",
        });
      }
      setModal("staff-details");
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Staff details could not be loaded.",
      );
      setSelectedStaffActionId("");
    } finally {
      setStaffDetailsLoading(false);
    }
  }
  async function updateStaffDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const person = people.find((item) => item.id === selectedStaffActionId);
    if (!person) return;
    const form = new FormData(event.currentTarget);
    const input = {
      email: String(form.get("email") ?? ""),
      contactNumber: String(form.get("contactNumber") ?? ""),
      idNumber: String(form.get("idNumber") ?? ""),
      taxNumber: String(form.get("taxNumber") ?? ""),
      startDate: String(form.get("startDate") ?? ""),
    };
    setStaffDetailsLoading(true);
    try {
      let details = normalizeStaffPrivateDetails(input);
      let message = `${person.name}'s details were updated.`;
      if (syncMode === "cloud") {
        const payload = await staffFetch("", {
          method: "PATCH",
          body: JSON.stringify({
            action: "update_details",
            staffId: person.id,
            ...input,
          }),
        });
        details = { ...details, ...payload.details };
        message = payload.message;
      }
      setPeople((current) =>
        current.map((item) =>
          item.id === person.id
            ? {
                ...item,
                email: details.email,
                contactNumber: details.contactNumber,
                maskedIdNumber:
                  "maskedIdNumber" in details
                    ? (details.maskedIdNumber as string | null)
                    : maskIdentifier(details.idNumber),
                maskedTaxNumber:
                  "maskedTaxNumber" in details
                    ? (details.maskedTaxNumber as string | null)
                    : maskIdentifier(details.taxNumber),
                startDate: details.startDate,
                dateOfBirth: details.dateOfBirth,
              }
            : item,
        ),
      );
      setModal(null);
      setSelectedStaffActionId("");
      setToast(message);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Staff details could not be updated.",
      );
    } finally {
      setStaffDetailsLoading(false);
    }
  }
  async function resetStaffPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const person = people.find((item) => item.id === selectedStaffActionId);
    if (!person) return;
    const pin = String(new FormData(event.currentTarget).get("pin") ?? "");
    try {
      let message = `${person.name}'s PIN was reset.`;
      if (syncMode === "cloud") {
        const payload = await staffFetch("", {
          method: "PATCH",
          body: JSON.stringify({
            action: "reset_pin",
            staffId: person.id,
            pin,
          }),
        });
        message = payload.message;
      }
      setPeople((current) =>
        current.map((item) =>
          item.id === person.id ? { ...item, pin } : item,
        ),
      );
      setModal(null);
      setSelectedStaffActionId("");
      setToast(message);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "The PIN could not be reset.",
      );
    }
  }
  function openChangeStore(id: string) {
    const person = people.find((item) => item.id === id);
    if (person?.clockedIn) {
      setToast("Clock this staff member out before changing their store.");
      return;
    }
    setSelectedStaffActionId(id);
    setModal("change-store");
  }
  async function changeStaffStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const person = people.find((item) => item.id === selectedStaffActionId);
    if (!person) return;
    const storeId = String(
      new FormData(event.currentTarget).get("store") ?? "",
    );
    const store = stores.find((item) => item.id === storeId);
    if (!store) return;
    try {
      let message = `${person.name} was moved to ${store.name}.`;
      if (syncMode === "cloud") {
        const payload = await staffFetch("", {
          method: "PATCH",
          body: JSON.stringify({
            action: "change_store",
            staffId: person.id,
            storeId,
          }),
        });
        message = payload.message;
      }
      setPeople((current) =>
        current.map((item) =>
          item.id === person.id ? { ...item, storeId } : item,
        ),
      );
      setModal(null);
      setSelectedStaffActionId("");
      setToast(message);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "The staff member could not be moved.",
      );
    }
  }
  async function removeStaff(id: string) {
    const person = people.find((item) => item.id === id);
    if (!person) return;
    if (person.clockedIn) {
      setToast("Clock this staff member out before removing them.");
      return;
    }
    if (
      !window.confirm(
        `Remove ${person.name}? Their attendance and leave history will be preserved.`,
      )
    )
      return;
    try {
      let message = `${person.name} was removed. Attendance and leave history were preserved.`;
      if (syncMode === "cloud") {
        const payload = await staffFetch(`?staffId=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        message = payload.message;
      }
      setPeople((current) => current.filter((item) => item.id !== id));
      setToast(message);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "The staff member could not be removed.",
      );
    }
  }
  async function administratorFetch(path = "", options: RequestInit = {}) {
    if (!supabase) throw new Error("Cloud access is unavailable.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token)
      throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch(`/api/administrators${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload.error ?? "Administrator request failed.");
    return payload;
  }
  async function loadAdministrators() {
    if (syncMode !== "cloud" || currentRole !== "admin") return;
    setAdministratorsLoading(true);
    try {
      const payload = await administratorFetch();
      setAdministrators(payload.members ?? []);
      setCurrentAdministratorId(payload.currentUserId ?? "");
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Could not load administrators.",
      );
    } finally {
      setAdministratorsLoading(false);
    }
  }
  async function inviteAdministrator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = String(form.get("role")) as "admin" | "manager";
    const storeIds = form.getAll("stores").map(String);
    try {
      const payload = await administratorFetch("", {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          role,
          storeIds,
        }),
      });
      setModal(null);
      setToast(payload.message);
      await loadAdministrators();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Invitation failed.");
    }
  }
  async function changeAdministrator(
    userId: string,
    action: "suspend" | "restore" | "resend",
  ) {
    try {
      const payload = await administratorFetch("", {
        method: "PATCH",
        body: JSON.stringify({ userId, action }),
      });
      setToast(payload.message);
      await loadAdministrators();
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Access could not be updated.",
      );
    }
  }
  async function removeAdministrator(userId: string) {
    if (!window.confirm("Remove this person’s administrator access?")) return;
    try {
      const payload = await administratorFetch(
        `?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      setToast(payload.message);
      await loadAdministrators();
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Access could not be removed.",
      );
    }
  }
  async function reportFetch(options: RequestInit = {}) {
    if (!supabase) throw new Error("Cloud access is unavailable.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token)
      throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch("/api/report-settings", {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload.error ?? "Report request failed.");
    return payload;
  }
  async function loadReportSettings() {
    if (syncMode !== "cloud" || currentRole !== "admin") return;
    setReportsLoading(true);
    try {
      const payload = await reportFetch();
      setReportSetting({
        ...payload.setting,
        deliveryConfigured: payload.deliveryConfigured,
      });
      setReportRuns(payload.runs ?? []);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Could not load report settings.",
      );
    } finally {
      setReportsLoading(false);
    }
  }
  async function saveReportSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await reportFetch({
        method: "PUT",
        body: JSON.stringify({
          recipientEmail: String(form.get("recipientEmail") ?? ""),
          enabled: form.get("enabled") === "on",
        }),
      });
      setToast(payload.message);
      await loadReportSettings();
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Report settings could not be saved.",
      );
    }
  }
  async function sendTestReport() {
    setReportsLoading(true);
    try {
      const payload = await managementReportFetch({ method: "POST" });
      setToast(payload.message);
      await loadReportSettings();
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Report could not be sent.",
      );
    } finally {
      setReportsLoading(false);
    }
  }
  async function managementReportFetch(options: RequestInit = {}) {
    if (!supabase) throw new Error("Cloud access is unavailable.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token)
      throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch("/api/management-hours-report", {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload.error ?? "Management report request failed.");
    return payload;
  }
  async function generateReportPreview() {
    setReportsLoading(true);
    try {
      setReportPreview(await managementReportFetch());
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Preview could not be generated.",
      );
    } finally {
      setReportsLoading(false);
    }
  }
  async function decideLeave(id: string, status: "approved" | "rejected") {
    if (currentRole !== "admin") {
      setToast("Only authorised administrators may decide leave requests.");
      return;
    }
    if (syncMode === "cloud" && supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setToast("Your session has expired. Please sign in again.");
        return;
      }
      const response = await fetch("/api/leave-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: id, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast(`Could not update request: ${payload.error ?? "Please try again."}`);
        return;
      }
      const delivery = payload.smsSent && payload.emailSent
        ? " Staff notified by SMS and email."
        : payload.smsSent
          ? " SMS sent, but the email could not be delivered."
          : payload.emailSent
            ? " Email sent, but the SMS could not be delivered."
            : " Decision saved, but neither notification could be delivered.";
      setToast(`${payload.message}${delivery}`);
    }
    setLeaveRequests((current) =>
      current.map((request) =>
        request.id === id ? { ...request, status } : request,
      ),
    );
    if (syncMode !== "cloud") setToast(`Leave request ${status}.`);
  }
  async function saveLeave(input: LeaveUpsertInput) {
    if (currentRole !== "admin") {
      setToast("Only authorised administrators may record or edit leave.");
      return false;
    }
    if (syncMode === "cloud" && supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setToast("Your session has expired. Please sign in again.");
        return false;
      }
      const response = await fetch("/api/leave-requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast(`Could not save leave: ${payload.error ?? "Please try again."}`);
        return false;
      }
      const saved = payload.leaveRequest as LeaveRequest;
      setLeaveRequests((current) => {
        const exists = current.some((request) => request.id === saved.id);
        return exists
          ? current.map((request) => (request.id === saved.id ? saved : request))
          : [saved, ...current];
      });
      setToast(`${payload.message} Attendance and reports now use the updated leave.`);
      return true;
    }

    const person = people.find((item) => item.id === input.staffId);
    if (!person) {
      setToast("Select a staff member.");
      return false;
    }
    const saved: LeaveRequest = {
      id: input.requestId ?? `leave-${Date.now()}`,
      staffId: input.staffId,
      storeId: person.storeId,
      type: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason.trim(),
      status: "approved",
      createdAt: new Date().toISOString(),
    };
    setLeaveRequests((current) => {
      const exists = current.some((request) => request.id === saved.id);
      return exists
        ? current.map((request) => (request.id === saved.id ? saved : request))
        : [saved, ...current];
    });
    setToast(input.requestId ? "Leave entry updated." : "Past leave recorded and approved.");
    return true;
  }
  function exportCsv() {
    const lines = [
      [
        "Date",
        "Employee",
        "Store",
        "Clock in",
        "Clock out",
        "Status",
        "Worked hours",
        "Ordinary hours",
        "Overtime hours",
        "Public holiday hours",
      ],
      ...filteredRecords.map((record) => {
        const hours = hoursByRecord.get(record.id);
        return [
          record.date,
          people.find((p) => p.id === record.employeeId)?.name ?? "",
          stores.find((s) => s.id === record.storeId)?.name ?? "",
          record.inTime ?? "",
          record.outTime ?? "",
          record.status,
          String(hours?.worked ?? ""),
          String(hours?.ordinary ?? ""),
          String(hours?.overtime ?? ""),
          String(hours?.publicHoliday ?? ""),
        ];
      }),
    ];
    const blob = new Blob([lines.map((line) => line.join(",")).join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `attendance-${recordDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Attendance CSV downloaded.");
  }

  return (
    <main className="app-shell">
      <button
        className={`mobile-scrim ${menuOpen ? "show" : ""}`}
        aria-label="Close menu"
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">P</span>
          <span>Presently</span>
          <button
            className="close-menu"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            ×
          </button>
        </div>
        <nav>
          {nav
            .filter(
              (item) => currentRole === "admin" || item.id !== "administrators",
            )
            .map((item) => (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                onClick={() => switchView(item.id)}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sync-status ${syncMode}`}>
            {syncMode === "cloud"
              ? "Cloud data connected"
              : syncMode === "connecting"
                ? "Connecting securely…"
                : syncMode === "error"
                  ? "Cloud connection needs attention"
                  : "Local demo data"}
          </div>
          <div className="support-card">
            <span>
              {syncMode === "cloud" ? "Phase 2 workspace" : "Preview workspace"}
            </span>
            <small>
              {syncMode === "cloud"
                ? "Shared securely across devices"
                : "Connect Supabase for shared data"}
            </small>
          </div>
          <div className="profile">
            <span className="avatar plum">NM</span>
            <span>
              <b>{adminEmail.split("@")[0]}</b>
              <small>Administrator</small>
            </span>
            <button
              className="signout-button"
              onClick={syncMode === "cloud" ? signOut : undefined}
            >
              {syncMode === "cloud" ? "Sign out" : "⋮"}
            </button>
          </div>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <button
            className="menu-button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
          <div>
            <p className="eyebrow" suppressHydrationWarning>
              {formatDate(now).toUpperCase()}
            </p>
            <h1>
              {view === "overview"
                ? `Good morning, ${administratorName}`
                : nav.find((item) => item.id === view)?.label}
            </h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications">
              ♢<span />
            </button>
            {currentRole === "admin" &&
              (view === "stores" ? (
                <button
                  className="primary-button"
                  onClick={() => setModal("store")}
                >
                  ＋ Add store
                </button>
              ) : view === "administrators" ? (
                <button
                  className="primary-button"
                  onClick={() => setModal("administrator")}
                >
                  ＋ Invite administrator
                </button>
              ) : (
                <button
                  className="primary-button"
                  onClick={() => {
                    if (stores.some((store) => store.active)) setModal("staff");
                    else {
                      setToast("Add an active store before adding staff.");
                      setView("stores");
                    }
                  }}
                >
                  ＋ Add staff member
                </button>
              ))}
          </div>
        </header>

        <div className={`cloud-banner ${syncMode === "cloud" ? "cloud" : ""}`}>
          <span>
            {syncMode === "cloud"
              ? "✓ Changes are syncing securely across every device."
              : syncMode === "connecting"
                ? "Connecting to your secure workspace…"
                : syncMode === "error"
                  ? "Cloud setup is incomplete. The migration or environment values may need attention."
                  : "You are viewing the device-local demo. Connect Supabase to activate Phase 2 cloud sync and administrator access."}
          </span>
          <Link href="/login">Set up cloud access →</Link>
        </div>
        {view === "overview" &&
          (syncMode === "cloud" && stores.length === 0 ? (
            <section className="empty-workspace">
              <span className="brand-mark">P</span>
              <p className="eyebrow">YOUR WORKSPACE IS READY</p>
              <h2>Add your first store</h2>
              <p>
                Pits Paints &amp; Toolhub is connected securely. Create a store
                location, then add its staff members.
              </p>
              <button
                className="primary-button"
                onClick={() => {
                  setView("stores");
                  setModal("store");
                }}
              >
                ＋ Add first store
              </button>
            </section>
          ) : (
            <Overview
              stores={stores}
              storePeople={storePeople}
              selectedStore={selectedStore}
              setSelectedStore={setSelectedStore}
              presentCount={presentCount}
              now={now}
              onOpenClock={() => setView("clock")}
              onViewStaff={() => setView("staff")}
            />
          ))}
        {view === "clock" && (
          <ClockStation
            stores={stores}
            people={people}
            records={records}
            selectedStore={selectedStore}
            setSelectedStore={setSelectedStore}
            selectedEmployee={effectiveSelectedEmployee}
            setSelectedEmployee={setSelectedEmployee}
            activeEmployee={activeEmployee}
            now={now}
            onAction={clockAction}
          />
        )}
        {view === "attendance" && (
          <Attendance
            records={filteredRecords}
            people={people}
            stores={stores}
            selectedStore={selectedStore}
            setSelectedStore={setSelectedStore}
            recordDate={recordDate}
            setRecordDate={setRecordDate}
            hoursByRecord={hoursByRecord}
            holidays={holidays}
            canEdit={currentRole === "admin" && syncMode === "cloud"}
            onAdjust={saveAttendanceAdjustment}
            onExport={exportCsv}
          />
        )}
        {view === "leave" && (
          <LeaveAndHours
            requests={leaveRequests}
            people={people}
            stores={stores}
            holidays={holidays}
            hoursByRecord={hoursByRecord}
            canDecide={currentRole === "admin"}
            onDecision={decideLeave}
            onSave={saveLeave}
          />
        )}
        {view === "staff" && (
          <Staff
            people={people}
            stores={stores}
            selectedStore={selectedStore}
            setSelectedStore={setSelectedStore}
            canManage={currentRole === "admin"}
            onAdd={() => setModal("staff")}
            onEditDetails={openStaffDetails}
            onToggle={toggleStaff}
            onResetPin={openResetPin}
            onChangeStore={openChangeStore}
            onRemove={removeStaff}
          />
        )}
        {view === "stores" && (
          <Stores
            stores={stores}
            people={people}
            canManage={currentRole === "admin"}
            onAdd={() => setModal("store")}
            onToggle={toggleStore}
            onOpen={(id) => {
              setSelectedStore(id);
              setView("overview");
            }}
          />
        )}
        {view === "reports" && (
          <AttendanceReporting
            role={currentRole}
            schedulePanel={
              currentRole === "admin" ? (
                <WeeklyReports
                  setting={reportSetting}
                  runs={reportRuns}
                  preview={reportPreview}
                  loading={reportsLoading}
                  onSave={saveReportSettings}
                  onPreview={generateReportPreview}
                  onSend={sendTestReport}
                />
              ) : undefined
            }
          />
        )}
        {view === "administrators" && currentRole === "admin" && (
          <Administrators
            members={administrators}
            stores={stores}
            currentUserId={currentAdministratorId}
            loading={administratorsLoading}
            onInvite={() => setModal("administrator")}
            onChange={changeAdministrator}
            onRemove={removeAdministrator}
          />
        )}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav
          .filter(
            (item) => item.id !== "stores" && item.id !== "administrators",
          )
          .map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => switchView(item.id)}
            >
              <span>{item.icon}</span>
              <small>
                {item.id === "clock"
                  ? "Clock"
                  : item.id === "leave"
                    ? "Leave"
                    : item.id === "reports"
                      ? "Reports"
                      : item.label}
              </small>
            </button>
          ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
      {modal === "staff" && (
        <Modal
          title="Add staff member"
          description="Create a staff profile. Date of birth is calculated from a valid South African ID number."
          onClose={() => setModal(null)}
        >
          <form onSubmit={addStaff} className="modal-form staff-details-form">
            <label>
              Full name
              <input name="name" placeholder="e.g. Lerato Nkosi" required />
            </label>
            <label>
              Role
              <select name="role">
                <option>Sales associate</option>
                <option>Store manager</option>
                <option>Cashier</option>
                <option>Stock assistant</option>
              </select>
            </label>
            <label>
              Store
              <select name="store">
                {stores
                  .filter((store) => store.active)
                  .map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              4-digit clock PIN
              <input
                name="pin"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                placeholder="0000"
                required
              />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" />
            </label>
            <label>
              Contact number
              <input name="contactNumber" type="tel" autoComplete="tel" />
            </label>
            <label>
              SA ID number
              <input
                name="idNumber"
                inputMode="numeric"
                pattern="[0-9 ]{13,17}"
                maxLength={17}
              />
            </label>
            <label>
              Tax number
              <input
                name="taxNumber"
                inputMode="numeric"
                pattern="[0-9 ]{10,14}"
                maxLength={14}
              />
            </label>
            <label>
              Start date
              <input name="startDate" type="date" max={today} />
            </label>
            <p className="form-note">
              Private ID and tax details are restricted to administrators and
              excluded from attendance reports.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="primary-button">Add staff member</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "staff-details" && (
        <Modal
          title="Edit staff details"
          description={`Update ${people.find((person) => person.id === selectedStaffActionId)?.name ?? "this staff member"}. Their branch assignment will not change.`}
          onClose={() => {
            setModal(null);
            setSelectedStaffActionId("");
          }}
        >
          <form
            onSubmit={updateStaffDetails}
            className="modal-form staff-details-form"
            key={selectedStaffActionId}
          >
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={staffDetailDraft.email}
                autoComplete="email"
              />
            </label>
            <label>
              Contact number
              <input
                name="contactNumber"
                type="tel"
                defaultValue={staffDetailDraft.contactNumber}
                autoComplete="tel"
              />
            </label>
            <label>
              SA ID number
              <input
                name="idNumber"
                inputMode="numeric"
                pattern="[0-9 ]{13,17}"
                maxLength={17}
                value={staffDetailDraft.idNumber}
                onChange={(event) =>
                  setStaffDetailDraft((current) => ({
                    ...current,
                    idNumber: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Tax number
              <input
                name="taxNumber"
                inputMode="numeric"
                pattern="[0-9 ]{10,14}"
                maxLength={14}
                defaultValue={staffDetailDraft.taxNumber}
              />
            </label>
            <label>
              Start date
              <input
                name="startDate"
                type="date"
                max={today}
                defaultValue={staffDetailDraft.startDate}
              />
            </label>
            <label>
              Date of birth
              <input
                value={
                  staffDetailDraft.idNumber
                    ? (deriveBirthDateFromSouthAfricanId(
                        staffDetailDraft.idNumber.replace(/\D/g, ""),
                      ) ?? "Check ID number")
                    : "Calculated from ID number"
                }
                readOnly
              />
            </label>
            <p className="form-note">
              Only these private staff fields are updated. The employee&apos;s
              branch, role, clock PIN and attendance records remain unchanged.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setModal(null);
                  setSelectedStaffActionId("");
                }}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={staffDetailsLoading}>
                {staffDetailsLoading ? "Saving…" : "Save staff details"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "reset-pin" && (
        <Modal
          title="Reset clock PIN"
          description={`Choose a new four-digit PIN for ${people.find((person) => person.id === selectedStaffActionId)?.name ?? "this staff member"}. The previous PIN cannot be viewed.`}
          onClose={() => {
            setModal(null);
            setSelectedStaffActionId("");
          }}
        >
          <form onSubmit={resetStaffPin} className="modal-form pin-reset-form">
            <label>
              New 4-digit clock PIN
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                placeholder="••••"
                autoComplete="new-password"
                autoFocus
                required
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setModal(null);
                  setSelectedStaffActionId("");
                }}
              >
                Cancel
              </button>
              <button className="primary-button">Save new PIN</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "change-store" && (
        <Modal
          title="Change staff store"
          description={`Move ${people.find((person) => person.id === selectedStaffActionId)?.name ?? "this staff member"} to another active store. Historical records will not change.`}
          onClose={() => {
            setModal(null);
            setSelectedStaffActionId("");
          }}
        >
          <form
            onSubmit={changeStaffStore}
            className="modal-form pin-reset-form"
          >
            <label>
              Assigned store
              <select
                name="store"
                defaultValue={
                  people.find((person) => person.id === selectedStaffActionId)
                    ?.storeId
                }
              >
                {stores
                  .filter((store) => store.active)
                  .map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name} · {store.location}
                    </option>
                  ))}
              </select>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setModal(null);
                  setSelectedStaffActionId("");
                }}
              >
                Cancel
              </button>
              <button className="primary-button">Save store</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "store" && (
        <Modal
          title="Add a store"
          description="Set up a new location before assigning staff."
          onClose={() => setModal(null)}
        >
          <form onSubmit={addStore} className="modal-form">
            <label>
              Store name
              <input name="name" placeholder="e.g. Brooklyn Mall" required />
            </label>
            <label>
              City or area
              <input name="location" placeholder="e.g. Pretoria" required />
            </label>
            <label>
              Store code
              <input
                name="code"
                placeholder="e.g. BKL"
                minLength={2}
                maxLength={5}
                required
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="primary-button">Create store</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "administrator" && (
        <Modal
          title="Invite an administrator"
          description="Send a secure invitation and choose what this person can access."
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={inviteAdministrator}
            className="modal-form admin-invite-form"
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="manager@yourcompany.co.za"
                required
              />
            </label>
            <label>
              Access level
              <select name="role" defaultValue="manager">
                <option value="manager">Store manager</option>
                <option value="admin">Administrator — all stores</option>
              </select>
            </label>
            <fieldset>
              <legend>Store access for managers</legend>
              {stores
                .filter((store) => store.active)
                .map((store) => (
                  <label className="check-option" key={store.id}>
                    <input type="checkbox" name="stores" value={store.id} />
                    <span>
                      {store.name}
                      <small>{store.location}</small>
                    </span>
                  </label>
                ))}
            </fieldset>
            <p className="form-note">
              Store selections are ignored when Administrator access is chosen.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="primary-button">Send invitation</button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

function Overview({
  stores,
  storePeople,
  selectedStore,
  setSelectedStore,
  presentCount,
  now,
  onOpenClock,
  onViewStaff,
}: {
  stores: Store[];
  storePeople: Person[];
  selectedStore: string;
  setSelectedStore: (id: string) => void;
  presentCount: number;
  now: Date;
  onOpenClock: () => void;
  onViewStaff: () => void;
}) {
  const percentage = storePeople.length
    ? Math.round((presentCount / storePeople.length) * 100)
    : 0;
  const store = stores.find((item) => item.id === selectedStore);
  return (
    <div className="content-grid">
      <div className="page-main">
        <section className="hero-card">
          <div>
            <p className="eyebrow light">LIVE ATTENDANCE · {store?.code}</p>
            <h2>
              {presentCount} of {storePeople.length} people are in
            </h2>
            <p>
              Your {store?.name} team is{" "}
              {percentage >= 60
                ? "off to a good start."
                : "still arriving for the day."}
            </p>
          </div>
          <div className="progress-wrap">
            <div
              className="progress-ring"
              style={{ "--progress": `${percentage}%` } as React.CSSProperties}
            >
              <span>
                <b>{percentage}%</b>
                <small>present</small>
              </span>
            </div>
          </div>
        </section>
        <section className="metrics">
          <Metric
            tone="mint"
            icon="↗"
            label="On time today"
            value={String(Math.max(presentCount - 1, 0))}
            note="↑ 8% from last week"
          />
          <Metric
            tone="peach"
            icon="◷"
            label="Late arrivals"
            value={presentCount ? "1" : "0"}
            note="4 min after shift"
          />
          <Metric
            tone="lavender"
            icon="◎"
            label="Hours logged"
            value={(presentCount * 4.6).toFixed(1)}
            note="Across this store"
          />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>{store?.name} team</h3>
              <p>Live status · {storePeople.length} staff members</p>
            </div>
            <button className="text-button" onClick={onViewStaff}>
              View all →
            </button>
          </div>
          <div className="staff-list">
            {storePeople.slice(0, 6).map((person, index) => (
              <div className="staff-row" key={person.id}>
                <span className={`avatar ${tones[index % tones.length]}`}>
                  {initials(person.name)}
                </span>
                <div className="staff-name">
                  <b>{person.name}</b>
                  <small>{person.role}</small>
                </div>
                <div className="clock-time">
                  <small>Clock in</small>
                  <b>{person.clockIn ?? "—"}</b>
                </div>
                <span
                  className={`status ${person.clockedIn ? "present" : "away"}`}
                >
                  {person.clockedIn ? "On shift" : "Not in yet"}
                </span>
                <button
                  className="more"
                  aria-label={`Options for ${person.name}`}
                >
                  •••
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <aside className="right-rail">
        <section className="clock-card">
          <p className="eyebrow">STAFF CLOCK</p>
          <div className="big-time" suppressHydrationWarning>
            {now.toLocaleTimeString("en-ZA", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </div>
          <p suppressHydrationWarning>{formatDate(now)}</p>
          <label>
            Selected store
            <select
              value={selectedStore}
              onChange={(event) => setSelectedStore(event.target.value)}
            >
              {stores
                .filter((item) => item.active)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name} · {item.location}
                  </option>
                ))}
            </select>
          </label>
          <button className="clock-button" onClick={onOpenClock}>
            Open clock station <span>→</span>
          </button>
        </section>
        <section className="activity-card">
          <div className="panel-heading">
            <h3>Recent activity</h3>
            <button className="text-button">See all</button>
          </div>
          {storePeople
            .filter((person) => person.clockedIn)
            .slice(0, 3)
            .map((person, index) => (
              <div className="activity" key={person.id}>
                <span
                  className={`activity-dot ${tones[(index + 3) % tones.length]}`}
                >
                  {index === 1 ? "◷" : "↗"}
                </span>
                <p>
                  <b>{person.name} clocked in</b>
                  <small>
                    {store?.name} · {person.clockIn}
                  </small>
                </p>
              </div>
            ))}
        </section>
      </aside>
    </div>
  );
}

function Metric({
  tone,
  icon,
  label,
  value,
  note,
}: {
  tone: string;
  icon: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article>
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

function ClockStation({
  stores,
  people,
  records,
  selectedStore,
  setSelectedStore,
  selectedEmployee,
  setSelectedEmployee,
  activeEmployee,
  now,
  onAction,
}: {
  stores: Store[];
  people: Person[];
  records: RecordItem[];
  selectedStore: string;
  setSelectedStore: (id: string) => void;
  selectedEmployee: string;
  setSelectedEmployee: (id: string) => void;
  activeEmployee?: Person;
  now: Date;
  onAction: () => void;
}) {
  const storePeople = people.filter(
    (person) => person.storeId === selectedStore && person.active,
  );
  const recent = records
    .filter(
      (record) => record.storeId === selectedStore && record.date === today,
    )
    .slice(0, 5);
  return (
    <div className="single-page clock-page">
      <section className="clock-station-card">
        <div className="station-brand">
          <span className="brand-mark">P</span>
          <span>Staff clock</span>
        </div>
        <p className="station-date" suppressHydrationWarning>
          {formatDate(now)}
        </p>
        <div className="station-time" suppressHydrationWarning>
          {now.toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}
        </div>
        <div className="station-controls">
          <label>
            Store
            <select
              value={selectedStore}
              onChange={(event) => setSelectedStore(event.target.value)}
            >
              {stores
                .filter((store) => store.active)
                .map((store) => (
                  <option value={store.id} key={store.id}>
                    {store.name} · {store.location}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Your name
            <select
              value={selectedEmployee}
              onChange={(event) => setSelectedEmployee(event.target.value)}
            >
              {storePeople.map((person) => (
                <option value={person.id} key={person.id}>
                  {person.name} · {person.role}
                </option>
              ))}
            </select>
          </label>
        </div>
        {activeEmployee && (
          <div className="employee-action">
            <span className="avatar gold large">
              {initials(activeEmployee.name)}
            </span>
            <div>
              <b>{activeEmployee.name}</b>
              <small>
                {activeEmployee.clockedIn
                  ? `On shift since ${activeEmployee.clockIn}`
                  : "Ready to start your shift"}
              </small>
            </div>
          </div>
        )}
        <button
          className={`station-action ${activeEmployee?.clockedIn ? "clock-out" : ""}`}
          onClick={onAction}
        >
          {activeEmployee?.clockedIn ? "Clock out" : "Clock in"} <span>→</span>
        </button>
        <p className="station-hint">
          Choose your name, then tap once. Your time is recorded immediately.
        </p>
      </section>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h3>Today at this store</h3>
            <p>Most recent attendance activity</p>
          </div>
          <span className="live-pill">● LIVE</span>
        </div>
        <div className="record-list">
          {recent.map((record) => {
            const person = people.find((item) => item.id === record.employeeId);
            return (
              <div className="record-compact" key={record.id}>
                <span className="avatar blue">
                  {person ? initials(person.name) : "?"}
                </span>
                <p>
                  <b>{person?.name}</b>
                  <small>
                    {record.outTime
                      ? `Completed at ${record.outTime}`
                      : `Clocked in at ${record.inTime}`}
                  </small>
                </p>
                <span
                  className={`status ${record.outTime ? "away" : "present"}`}
                >
                  {record.outTime ? "Complete" : "On shift"}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Attendance({
  records,
  people,
  stores,
  selectedStore,
  setSelectedStore,
  recordDate,
  setRecordDate,
  hoursByRecord,
  holidays,
  canEdit,
  onAdjust,
  onExport,
}: {
  records: RecordItem[];
  people: Person[];
  stores: Store[];
  selectedStore: string;
  setSelectedStore: (id: string) => void;
  recordDate: string;
  setRecordDate: (date: string) => void;
  hoursByRecord: Map<string, HoursBreakdown>;
  holidays: PublicHoliday[];
  canEdit: boolean;
  onAdjust: (input: AttendanceAdjustmentInput) => Promise<void>;
  onExport: () => void;
}) {
  const holiday = holidays.find((item) => item.date === recordDate);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState("");

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setAdjustmentError("");
    try {
      await onAdjust({
        attendanceId: editing.id,
        clockIn: String(form.get("clockIn") ?? ""),
        clockOut: String(form.get("clockOut") ?? ""),
        reason: String(form.get("reason") ?? ""),
      });
      setEditing(null);
    } catch (error) {
      setAdjustmentError(error instanceof Error ? error.message : "Attendance correction could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="single-page">
      <section className="section-intro">
        <div>
          <p className="eyebrow">DAILY RECORDS</p>
          <h2>Attendance register</h2>
          <p>
            Worked time excludes the configured 60-minute weekday meal break.
          </p>
        </div>
        <button className="secondary-button" onClick={onExport}>
          ↓ Export CSV
        </button>
      </section>
      {holiday && (
        <div className="holiday-banner">
          <span>◆</span>
          <div>
            <b>South African public holiday</b>
            <small>
              {holiday.name}
              {holiday.observed ? " · observed" : ""}
            </small>
          </div>
        </div>
      )}
      <section className="filter-bar">
        <label>
          Store
          <select
            value={selectedStore}
            onChange={(event) => setSelectedStore(event.target.value)}
          >
            <option value="all">All stores</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={recordDate}
            onChange={(event) => setRecordDate(event.target.value)}
          />
        </label>
        <div className="filter-summary">
          <b>{records.length}</b>
          <span>attendance records</span>
        </div>
      </section>
      <section className="panel table-panel">
        <div className={`attendance-table hours-table ${canEdit ? "can-edit" : ""}`}>
          <div className="table-head">
            <span>Employee</span>
            <span>Store</span>
            <span>In / out</span>
            <span>Worked</span>
            <span>Ordinary</span>
            <span>Overtime</span>
            <span>Public holiday</span>
            {canEdit && <span>Action</span>}
          </div>
          {records.length ? (
            records.map((record, index) => {
              const person = people.find(
                (item) => item.id === record.employeeId,
              );
              const store = stores.find((item) => item.id === record.storeId);
              const hours = hoursByRecord.get(record.id);
              return (
                <div className="table-row" key={record.id}>
                  <span className="employee-cell">
                    <i className={`avatar ${tones[index % tones.length]}`}>
                      {person ? initials(person.name) : "?"}
                    </i>
                    <span>
                      <b>{person?.name}</b>
                      <small>{record.status}</small>
                    </span>
                  </span>
                  <span data-label="Store">{store?.name}</span>
                  <span data-label="In / out">
                    {record.inTime ?? "—"} / {record.outTime ?? "—"}
                  </span>
                  <span data-label="Worked">
                    {hours?.worked.toFixed(1) ??
                      (record.inTime && !record.outTime ? "In progress" : "—")}
                  </span>
                  <span data-label="Ordinary">
                    {hours?.ordinary.toFixed(1) ?? "—"}
                  </span>
                  <span data-label="Overtime">
                    <i className={hours?.overtime ? "hours-overtime" : ""}>
                      {hours?.overtime.toFixed(1) ?? "—"}
                    </i>
                  </span>
                  <span data-label="Public holiday">
                    {hours?.publicHoliday.toFixed(1) ?? "—"}
                  </span>
                  {canEdit && (
                    <span data-label="Action">
                      <button className="text-button" onClick={() => { setAdjustmentError(""); setEditing(record); }}>
                        Edit attendance
                      </button>
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <EmptyState
              title="No attendance found"
              note="Try another date or store."
            />
          )}
        </div>
      </section>
      {editing && (
        <Modal
          title="Correct attendance"
          description={`Update ${people.find((person) => person.id === editing.employeeId)?.name ?? "this employee"} for ${editing.date}. The original times remain in the audit history.`}
          onClose={() => { setEditing(null); setAdjustmentError(""); }}
        >
          <form className="modal-form attendance-edit-form" onSubmit={submitAdjustment}>
            <label>
              Clock-in date and time
              <input name="clockIn" type="datetime-local" defaultValue={`${editing.date}T${editing.inTime ?? "07:30"}`} required />
            </label>
            <label>
              Clock-out date and time
              <input name="clockOut" type="datetime-local" defaultValue={`${editing.date}T${editing.outTime ?? "17:00"}`} required />
            </label>
            <label>
              Reason for correction
              <textarea name="reason" minLength={3} maxLength={500} placeholder="Example: Employee forgot to clock out; confirmed finish time with store manager." required />
            </label>
            <p className="form-note">Saving recalculates ordinary time and overtime from the corrected times. Adjusted shifts cannot exceed 24 hours.</p>
            {adjustmentError && <p className="auth-message" role="alert">{adjustmentError}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => { setEditing(null); setAdjustmentError(""); }}>Cancel</button>
              <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save audited correction"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function LeaveAndHours({
  requests,
  people,
  stores,
  holidays,
  hoursByRecord,
  canDecide,
  onDecision,
  onSave,
}: {
  requests: LeaveRequest[];
  people: Person[];
  stores: Store[];
  holidays: PublicHoliday[];
  hoursByRecord: Map<string, HoursBreakdown>;
  canDecide: boolean;
  onDecision: (id: string, status: "approved" | "rejected") => void;
  onSave: (input: LeaveUpsertInput) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<LeaveRequest | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = requests.filter((request) => request.status === "pending");
  const overtime = Array.from(hoursByRecord.values()).reduce(
    (sum, item) => sum + item.overtime,
    0,
  );
  const upcoming = holidays
    .filter((holiday) => holiday.date >= today)
    .slice(0, 4);
  return (
    <div className="single-page">
      <section className="section-intro">
        <div>
          <p className="eyebrow">WORK RULES &amp; LEAVE</p>
          <h2>Hours and staff leave</h2>
          <p>
            Review overtime, leave requests, and South African public holidays.
          </p>
        </div>
        <Link className="secondary-button link-button" href="/leave">
          Open staff leave page ↗
        </Link>
      </section>
      <section className="rules-grid">
        <article className="rule-card">
          <span>MON–FRI</span>
          <b>07:30–17:00</b>
          <small>60-minute unpaid meal break · 17:30 OT threshold</small>
        </article>
        <article className="rule-card">
          <span>SATURDAY</span>
          <b>08:00–13:00</b>
          <small>
            30-minute unpaid break · first two Saturdays worked are ordinary
          </small>
        </article>
        <article className="rule-card highlight">
          <span>WEEKLY OVERTIME</span>
          <b>After scheduled hours</b>
          <small>Daily shortfalls are completed first · overtime pays in 30-minute blocks after 60 minutes</small>
        </article>
        <article className="rule-card">
          <span>OVERTIME RECORDED</span>
          <b>{overtime.toFixed(1)} hours</b>
          <small>Public-holiday hours are shown separately</small>
        </article>
      </section>
      <div className="leave-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Leave requests</h3>
              <p>{pending.length} awaiting a decision{!canDecide ? " · administrator approval required" : ""}</p>
            </div>
            {canDecide && (
              <button className="primary-button" onClick={() => setEditing("new")}>
                + Record leave
              </button>
            )}
          </div>
          <div className="leave-list">
            {requests.length ? (
              requests.map((request) => {
                const person = people.find(
                  (item) => item.id === request.staffId,
                );
                const store = stores.find(
                  (item) => item.id === request.storeId,
                );
                return (
                  <article className="leave-request" key={request.id}>
                    <span className={`leave-type ${request.type}`}>
                      {request.type === "annual" ? "☀" : request.type === "sick" ? "+" : "F"}
                    </span>
                    <div>
                      <b>{person?.name ?? "Staff member"}</b>
                      <small>
                        {leaveTypeLabel(request.type)}{" "}
                        · {store?.name}
                      </small>
                      <p>
                        {request.startDate === request.endDate
                          ? request.startDate
                          : `${request.startDate} → ${request.endDate}`}
                        {request.reason ? ` · ${request.reason}` : ""}
                      </p>
                    </div>
                    <span className={`leave-status ${request.status}`}>
                      {request.status}
                    </span>
                    {request.status === "pending" && canDecide && (
                      <div className="leave-actions">
                        <button onClick={() => setEditing(request)}>Edit</button>
                        <button
                          onClick={() => onDecision(request.id, "rejected")}
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => onDecision(request.id, "approved")}
                        >
                          Approve
                        </button>
                      </div>
                    )}
                    {canDecide && request.status !== "pending" && (
                      <div className="leave-actions">
                        <button onClick={() => setEditing(request)}>Edit</button>
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <EmptyState
                title="No leave requests"
                note="Staff requests submitted from the public leave page will appear here."
              />
            )}
          </div>
        </section>
        <aside className="panel holiday-list">
          <div className="panel-heading">
            <div>
              <h3>Upcoming public holidays</h3>
              <p>Official South African calendar</p>
            </div>
          </div>
          {upcoming.map((holiday) => (
            <div className="holiday-row" key={holiday.date}>
              <time>
                {new Date(`${holiday.date}T12:00:00`).toLocaleDateString(
                  "en-ZA",
                  { timeZone: TIMEZONE, day: "2-digit", month: "short" },
                )}
              </time>
              <span>
                <b>{holiday.name}</b>
                <small>
                  {holiday.observed
                    ? "Observed public holiday"
                    : "Public holiday"}
                </small>
              </span>
            </div>
          ))}
        </aside>
      </div>
      {editing && (
        <Modal
          title={editing === "new" ? "Record leave already taken" : "Update leave entry"}
          description="The saved entry is approved immediately and is used by attendance summaries and exported reports."
          onClose={() => !saving && setEditing(null)}
        >
          <form
            className="modal-form leave-editor-form"
            key={editing === "new" ? "new" : editing.id}
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setSaving(true);
              const saved = await onSave({
                requestId: editing === "new" ? undefined : editing.id,
                staffId: String(form.get("staffId") ?? ""),
                leaveType: String(form.get("leaveType") ?? "annual") as LeaveType,
                startDate: String(form.get("startDate") ?? ""),
                endDate: String(form.get("endDate") ?? ""),
                reason: String(form.get("reason") ?? ""),
              });
              setSaving(false);
              if (saved) setEditing(null);
            }}
          >
            <label>
              Employee
              <select name="staffId" defaultValue={editing === "new" ? "" : editing.staffId} required>
                <option value="" disabled>Select an employee</option>
                {[...people]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {stores.find((store) => store.id === person.storeId)?.name ?? "No branch"}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Leave type
              <select name="leaveType" defaultValue={editing === "new" ? "annual" : editing.type} required>
                <option value="annual">Annual leave</option>
                <option value="sick">Sick leave</option>
                <option value="family_responsibility">Family responsibility leave</option>
              </select>
            </label>
            <label>
              From date
              <input name="startDate" type="date" defaultValue={editing === "new" ? today : editing.startDate} required />
            </label>
            <label>
              To date
              <input name="endDate" type="date" defaultValue={editing === "new" ? today : editing.endDate} required />
            </label>
            <label className="leave-editor-notes">
              Reason or notes
              <textarea name="reason" maxLength={500} rows={4} defaultValue={editing === "new" ? "" : editing.reason} placeholder="Optional supporting details" />
            </label>
            <p className="form-note">Saving approves the entry immediately. Any overlapping pending or approved leave will be rejected.</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save approved leave"}</button>
            </div>
          </form>
        </Modal>
      )}
      <p className="rules-note">
        Time before 07:30 is excluded. If no lunch clock-out is recorded, the
        full one-hour unpaid break is deducted automatically.
      </p>
    </div>
  );
}

function displayReportMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, "0")}m`;
}

function ReportHoursRow({
  label,
  values,
  className = "",
}: {
  label: string;
  values: ReportMinutes;
  className?: string;
}) {
  return (
    <div className={`management-report-row ${className}`}>
      <span>{label}</span>
      <span>{displayReportMinutes(values.normalMinutes)}</span>
      <span>{displayReportMinutes(values.overtimeOneHalfMinutes)}</span>
      <span>{displayReportMinutes(values.overtimeDoubleMinutes)}</span>
      <span>{displayReportMinutes(values.totalOvertimeMinutes)}</span>
    </div>
  );
}

function WeeklyReports({
  setting,
  runs,
  preview,
  loading,
  onSave,
  onPreview,
  onSend,
}: {
  setting: ReportSetting;
  runs: ReportRun[];
  preview: ReportPreview | null;
  loading: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onPreview: () => void;
  onSend: () => void;
}) {
  return (
    <div className="single-page">
      <section className="section-intro">
        <div>
          <p className="eyebrow">WEEKLY MANAGEMENT REPORTING</p>
          <h2>Consolidated month-to-date hours</h2>
          <p>
            Every Monday at 08:05, HR receives totals from the 25th of the
            previous month through the previous completed day.
          </p>
        </div>
        <div className="report-actions">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={onPreview}
          >
            {loading ? "Preparing…" : "Generate preview"}
          </button>
          <button
            className="primary-button"
            disabled={loading || !setting.deliveryConfigured}
            onClick={onSend}
          >
            {loading ? "Preparing…" : "Send report now"}
          </button>
        </div>
      </section>
      {!setting.deliveryConfigured && (
        <div className="holiday-banner report-warning">
          <span>!</span>
          <div>
            <b>Email provider setup required</b>
            <small>
              Add RESEND_API_KEY and REPORT_FROM_EMAIL in Vercel before enabling
              delivery.
            </small>
          </div>
        </div>
      )}
      <div className="report-settings-grid">
        <section className="panel report-config">
          <div className="panel-heading">
            <div>
              <h3>Delivery settings</h3>
              <p>Only administrators can manage this report.</p>
            </div>
          </div>
          <form
            onSubmit={onSave}
            className="modal-form"
            key={`${setting.recipientEmail}-${setting.enabled}`}
          >
            <label>
              HR email address
              <input
                name="recipientEmail"
                type="email"
                value="hr@pits.co.za"
                readOnly
              />
            </label>
            <label className="report-toggle">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={setting.enabled}
              />
              <span>
                <b>Send automatically every Monday</b>
                <small>08:05 Africa/Johannesburg · payroll month to date</small>
              </span>
            </label>
            <button className="primary-button" disabled={loading}>
              {loading ? "Saving…" : "Save report schedule"}
            </button>
          </form>
          <div className="report-includes">
            <b>Report contents</b>
            <span>✓ Employee name only</span>
            <span>✓ Normal working hours</span>
            <span>✓ Overtime at 1.5× and 2×</span>
            <span>✓ Branch subtotals and company total</span>
            <span>✓ Matching Excel-compatible CSV</span>
            <span>✓ Daily 08:00 late/absent email remains unchanged</span>
          </div>
        </section>
        <section className="panel report-history">
          <div className="panel-heading">
            <div>
              <h3>Delivery history</h3>
              <p>Most recent scheduled and manual reports</p>
            </div>
          </div>
          {runs.length ? (
            runs.map((run) => (
              <article
                className="report-run"
                key={`${run.report_date}-${run.created_at}`}
              >
                <span
                  className={`leave-status ${run.status === "sent" ? "approved" : run.status === "failed" ? "rejected" : "pending"}`}
                >
                  {run.status}
                </span>
                <div>
                  <b>
                    {run.period_start} → {run.period_end}
                  </b>
                  <small>
                    {run.recipient_email} · {run.trigger}
                  </small>
                  {run.error_message && <p>{run.error_message}</p>}
                </div>
                <time>
                  {new Date(run.completed_at ?? run.created_at).toLocaleString(
                    "en-ZA",
                    {
                      timeZone: TIMEZONE,
                      dateStyle: "medium",
                      timeStyle: "short",
                    },
                  )}
                </time>
              </article>
            ))
          ) : (
            <EmptyState
              title="No reports sent yet"
              note="Generate a preview, or send the first report when ready."
            />
          )}
        </section>
      </div>
      {preview && (
        <section className="panel management-preview">
          <div className="panel-heading">
            <div>
              <h3>Report preview</h3>
              <p>
                {preview.periodStart} to {preview.periodEnd} ·{" "}
                {preview.recipient}
              </p>
            </div>
          </div>
          <div className="management-report-table">
            <div className="management-report-head">
              <span>Employee name</span>
              <span>Normal MTD</span>
              <span>Overtime 1.5×</span>
              <span>Overtime 2×</span>
              <span>Total overtime</span>
            </div>
            {preview.branches.map((branch) => (
              <div key={branch.branchId}>
                <h4>{branch.branchName}</h4>
                {branch.employees.map((employee) => (
                  <ReportHoursRow
                    key={employee.employeeId}
                    label={employee.employeeName}
                    values={employee}
                  />
                ))}
                <ReportHoursRow
                  className="subtotal"
                  label={`${branch.branchName} subtotal`}
                  values={{
                    ...branch.subtotal,
                    totalOvertimeMinutes: branch.totalOvertimeMinutes,
                  }}
                />
              </div>
            ))}
            <ReportHoursRow
              className="company-total"
              label="Company-wide total"
              values={preview.companyTotal}
            />
          </div>
        </section>
      )}
      <p className="rules-note">
        Calculations use whole minutes. Overlapping records are merged, normal
        scheduled hours are allocated first, and only the first two Saturdays
        worked per employee each month are normal time. Missing weekday lunch
        records deduct 60 minutes; missing Saturday break records deduct 30
        minutes.
      </p>
    </div>
  );
}

function Administrators({
  members,
  stores,
  currentUserId,
  loading,
  onInvite,
  onChange,
  onRemove,
}: {
  members: AdministratorMember[];
  stores: Store[];
  currentUserId: string;
  loading: boolean;
  onInvite: () => void;
  onChange: (
    userId: string,
    action: "suspend" | "restore" | "resend",
  ) => void;
  onRemove: (userId: string) => void;
}) {
  const activeAdmins = members.filter(
    (member) => member.role === "admin" && member.active,
  ).length;
  return (
    <div className="single-page">
      <section className="section-intro">
        <div>
          <p className="eyebrow">ACCESS CONTROL</p>
          <h2>Administrators and managers</h2>
          <p>Invite trusted people and control which stores they can access.</p>
        </div>
        <button className="primary-button" onClick={onInvite}>
          ＋ Invite administrator
        </button>
      </section>
      <section className="admin-summary">
        <article>
          <b>{activeAdmins}</b>
          <span>active administrators</span>
        </article>
        <article>
          <b>
            {
              members.filter(
                (member) => member.role === "manager" && member.active,
              ).length
            }
          </b>
          <span>store managers</span>
        </article>
        <article>
          <b>{members.filter((member) => member.pending).length}</b>
          <span>pending invitations</span>
        </article>
      </section>
      <section className="panel admin-access-panel">
        <div className="panel-heading">
          <div>
            <h3>Workspace access</h3>
            <p>Only active members can open protected organisation data.</p>
          </div>
        </div>
        {loading ? (
          <div className="admin-loading">Loading access…</div>
        ) : members.length ? (
          members.map((member, index) => {
            const assignedStores = stores.filter((store) =>
              member.storeIds.includes(store.id),
            );
            const isCurrent = member.userId === currentUserId;
            return (
              <article
                className={`admin-row ${!member.active ? "inactive-card" : ""}`}
                key={member.userId}
              >
                <span className={`avatar large ${tones[index % tones.length]}`}>
                  {member.email.slice(0, 2).toUpperCase()}
                </span>
                <div className="admin-identity">
                  <b>
                    {member.email}
                    {isCurrent ? " · You" : ""}
                  </b>
                  <small>
                    {member.role === "admin"
                      ? "Administrator · All stores"
                      : `Store manager · ${assignedStores.map((store) => store.name).join(", ") || "No stores assigned"}`}
                  </small>
                </div>
                <div className="admin-state">
                  <span
                    className={`leave-status ${member.pending ? "pending" : member.active ? "approved" : "rejected"}`}
                  >
                    {member.pending
                      ? "Invitation pending"
                      : member.active
                        ? "Active"
                        : "Suspended"}
                  </span>
                  <small>
                    {member.pending
                      ? `Invited ${new Date(member.invitedAt).toLocaleDateString("en-ZA")}`
                      : member.role === "admin"
                        ? "Full workspace access"
                        : `${member.storeIds.length} store${member.storeIds.length === 1 ? "" : "s"}`}
                  </small>
                </div>
                <div className="admin-actions">
                  {member.pending && !isCurrent && (
                    <button onClick={() => onChange(member.userId, "resend")}>
                      Resend invite
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      onClick={() =>
                        onChange(
                          member.userId,
                          member.active ? "suspend" : "restore",
                        )
                      }
                    >
                      {member.active ? "Suspend" : "Restore"}
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      className="danger"
                      onClick={() => onRemove(member.userId)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState
            title="No additional administrators"
            note="Invite an administrator or store manager to share access securely."
          />
        )}
      </section>
      <p className="rules-note">
        The final active administrator cannot be suspended or removed. Every
        administrator must use their own email address and login.
      </p>
    </div>
  );
}

function Staff({
  people,
  stores,
  selectedStore,
  setSelectedStore,
  canManage,
  onAdd,
  onEditDetails,
  onToggle,
  onResetPin,
  onChangeStore,
  onRemove,
}: {
  people: Person[];
  stores: Store[];
  selectedStore: string;
  setSelectedStore: (id: string) => void;
  canManage: boolean;
  onAdd: () => void;
  onEditDetails: (id: string) => void;
  onToggle: (id: string) => void;
  onResetPin: (id: string) => void;
  onChangeStore: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const filtered = people.filter(
    (person) => selectedStore === "all" || person.storeId === selectedStore,
  );
  return (
    <div className="single-page">
      <section className="section-intro">
        <div>
          <p className="eyebrow">TEAM DIRECTORY</p>
          <h2>Staff management</h2>
          <p>
            Maintain staff details without changing branch assignments or
            attendance history.
          </p>
        </div>
        {canManage && (
          <button className="primary-button" onClick={onAdd}>
            ＋ Add staff member
          </button>
        )}
      </section>
      <section className="filter-bar">
        <label>
          Store
          <select
            value={selectedStore}
            onChange={(event) => setSelectedStore(event.target.value)}
          >
            <option value="all">All stores</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-summary">
          <b>{filtered.filter((person) => person.active).length}</b>
          <span>active staff</span>
        </div>
      </section>
      <section className="staff-grid staff-detail-grid">
        {filtered.map((person, index) => {
          const store = stores.find((item) => item.id === person.storeId);
          return (
            <article
              className={`person-card staff-detail-card ${!person.active ? "inactive-card" : ""}`}
              key={person.id}
            >
              <div className="person-top">
                <span className={`avatar large ${tones[index % tones.length]}`}>
                  {initials(person.name)}
                </span>
                <span
                  className={`status ${person.active ? "present" : "away"}`}
                >
                  {person.active ? "Active" : "Inactive"}
                </span>
              </div>
              <h3>{person.name}</h3>
              <p>{person.role}</p>
              <div className="person-meta">
                <span>
                  <small>BRANCH</small>
                  <b>{store?.name}</b>
                </span>
                <span>
                  <small>CLOCK PIN</small>
                  <b>••{person.pin.slice(-2)}</b>
                </span>
              </div>
              {canManage && (
                <div className="staff-private-meta">
                  <span>
                    <small>ID NUMBER</small>
                    <b>{person.maskedIdNumber ?? "Not recorded"}</b>
                  </span>
                  <span>
                    <small>DATE OF BIRTH</small>
                    <b>{person.dateOfBirth ?? "Not recorded"}</b>
                  </span>
                  <span>
                    <small>EMAIL</small>
                    <b>{person.email ?? "Not recorded"}</b>
                  </span>
                  <span>
                    <small>CONTACT NUMBER</small>
                    <b>{person.contactNumber ?? "Not recorded"}</b>
                  </span>
                  <span>
                    <small>TAX NUMBER</small>
                    <b>{person.maskedTaxNumber ?? "Not recorded"}</b>
                  </span>
                  <span>
                    <small>START DATE</small>
                    <b>{person.startDate ?? "Not recorded"}</b>
                  </span>
                </div>
              )}
              {canManage && (
                <div className="staff-card-actions">
                  <button
                    className="card-action solid"
                    onClick={() => onEditDetails(person.id)}
                  >
                    Edit details
                  </button>
                  <button
                    className="card-action"
                    onClick={() => onChangeStore(person.id)}
                  >
                    Change store
                  </button>
                  <button
                    className="card-action"
                    onClick={() => onResetPin(person.id)}
                  >
                    Reset PIN
                  </button>
                  <button
                    className="card-action"
                    onClick={() => onToggle(person.id)}
                  >
                    {person.active ? "Deactivate" : "Restore"}
                  </button>
                  <button
                    className="card-action danger"
                    onClick={() => onRemove(person.id)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function Stores({
  stores,
  people,
  canManage,
  onAdd,
  onToggle,
  onOpen,
}: {
  stores: Store[];
  people: Person[];
  canManage: boolean;
  onAdd: () => void;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="single-page">
      <section className="section-intro">
        <div>
          <p className="eyebrow">LOCATIONS</p>
          <h2>Store management</h2>
          <p>See staffing and live attendance at every location.</p>
        </div>
        {canManage && (
          <button className="primary-button" onClick={onAdd}>
            ＋ Add store
          </button>
        )}
      </section>
      <section className="store-grid">
        {stores.map((store, index) => {
          const team = people.filter(
            (person) => person.storeId === store.id && person.active,
          );
          const present = team.filter((person) => person.clockedIn).length;
          return (
            <article
              className={`store-card ${!store.active ? "inactive-card" : ""}`}
              key={store.id}
            >
              <div className={`store-visual store-${index % 3}`}>
                <span>{store.code}</span>
                <i>{store.active ? "Open today" : "Inactive"}</i>
              </div>
              <div className="store-card-body">
                <div>
                  <p className="eyebrow">{store.location.toUpperCase()}</p>
                  <h3>{store.name}</h3>
                </div>
                <div className="store-stats">
                  <span>
                    <b>{team.length}</b>
                    <small>Staff</small>
                  </span>
                  <span>
                    <b>{present}</b>
                    <small>On shift</small>
                  </span>
                  <span>
                    <b>
                      {team.length
                        ? Math.round((present / team.length) * 100)
                        : 0}
                      %
                    </b>
                    <small>Present</small>
                  </span>
                </div>
                <div
                  className={`store-actions ${canManage ? "" : "single-action"}`}
                >
                  {canManage && (
                    <button
                      className="secondary-button"
                      onClick={() => onToggle(store.id)}
                    >
                      {store.active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                  <button
                    className="card-action solid"
                    onClick={() => onOpen(store.id)}
                    disabled={!store.active}
                  >
                    Open dashboard →
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">PRESENTLY ADMIN</p>
            <h2 id="modal-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function EmptyState({ title, note }: { title: string; note: string }) {
  return (
    <div className="empty-state">
      <span>◇</span>
      <h3>{title}</h3>
      <p>{note}</p>
    </div>
  );
}
