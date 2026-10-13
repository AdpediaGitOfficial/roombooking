// The permission matrix (document section 5), the single source of truth for
// navigation, buttons, data queries, reports and exports.
//
// Each capability row lists ten cells in the order SA AA OF RS MC TE VC SE RM AU.
//   D        default: on for the role
//   G        grantable: off until the Super Admin enables it (set or capability)
//   -        locked: never available to that role
//   V        view only      O  own records only
//   other    default but limited; the text names the limit (Execute, Request, ...)
// A parenthesised note after D/G/V/O/- is kept as a tag.
import type { Role } from "@prisma/client";
import { MATRIX_ROLES } from "./roles";

export type CellState = "D" | "G" | "L";
export type CellLevel = "full" | "view" | "own" | "limited";
export type Cell = { state: CellState; level: CellLevel; tag?: string };
export type Capability = { key: string; module: string; label: string; cells: Record<Role, Cell> };

export function parseCell(raw: string): Cell {
  const text = raw.trim();
  const m = /^(D|G|V|O|-)(?=$|\s|\()\s*(?:\(([^)]*)\))?\s*(.*)$/.exec(text);
  if (!m) return { state: "D", level: "limited", tag: text };
  const tag = [m[2], m[3]].filter(Boolean).join(" ").trim() || undefined;
  switch (m[1]) {
    case "D": return { state: "D", level: "full", tag };
    case "G": return { state: "G", level: "full", tag };
    case "V": return { state: "D", level: "view", tag };
    case "O": return { state: "D", level: "own", tag };
    default: return { state: "L", level: "full", tag };
  }
}

const LOCKED: Cell = { state: "L", level: "full" };

function row(module: string, key: string, label: string, cells: string): Capability {
  const parts = cells.split("|");
  if (parts.length !== MATRIX_ROLES.length) throw new Error(`Permission row ${key} needs ${MATRIX_ROLES.length} cells, got ${parts.length}`);
  const byRole = Object.fromEntries(MATRIX_ROLES.map((r, i) => [r, parseCell(parts[i])])) as Record<Role, Cell>;
  byRole.LINE_MANAGER = LOCKED; // the route step only acts through approval links
  return { key, module, label, cells: byRole };
}

//            SA | AA | OF | RS | MC | TE | VC | SE | RM | AU
export const CAPABILITIES: Capability[] = [
  // 5.1 Setup and administration
  row("Setup", "setup.org_masters", "Organization profile, calendar, masters", "D|V|-|-|V|-|-|-|-|V"),
  row("Setup", "setup.property_types", "Property types & levels", "D|V|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.sites", "Create / archive sites", "D|-|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.buildings", "Create / edit buildings (villas, blocks)", "D|G|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.structure", "Create / edit floors, units, rooms, beds", "D|D|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.structure_bulk", "Bulk generate / import structure", "D|G|-|-|-|-|-|-|-|-"),
  row("Setup", "setup.activate", "Activate site or building for allocation", "D|G|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.users", "Users: invite, deactivate, unlock", "D|-|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.roles", "Roles, permission matrix, grants", "D|-|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.workflows", "Forms, approval routes, SLAs, delegation rules", "D|-|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.integrations", "Integrations, API keys, system health", "D|-|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.retention", "Data retention, erasure requests", "D|-|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.hard_delete", "Hard delete any record", "D|-|-|-|-|-|-|-|-|-"),
  row("Setup", "setup.restore", "Restore archived records", "D|G|-|-|-|-|-|-|-|-"),

  // 5.2 People (HR capability set)
  row("People", "people.view", "View staff profiles", "D|D|V (masked)|O|-|-|-|V (name, photo, stay status)|G|-"),
  row("People", "people.add", "Add staff (unverified)", "D|D|G|-|-|-|-|-|-|-"),
  row("People", "people.verify", "Verify / edit staff master data", "D|D|-|-|-|-|-|-|-|-"),
  row("People", "people.edit_own", "Edit own phone, emergency contact, language", "-|-|-|D|-|-|-|-|-|-"),
  row("People", "people.eligibility", "Set eligibility & entitlement", "D|D|-|-|-|-|-|-|-|-"),
  row("People", "people.joiner", "Raise joiner / transferee request", "D|D|-|-|-|-|-|-|-|-"),
  row("People", "people.exit", "Trigger exit / checkout due", "D|D|-|-|-|-|-|-|-|-"),
  row("People", "people.clearance", "View / close clearance", "D|D|V|O|-|-|-|-|-|-"),
  row("People", "people.import", "Bulk import staff", "D|G|-|-|-|-|-|-|-|-"),
  row("People", "people.export", "Export staff personal data", "D|G|-|-|-|-|-|-|G|-"),
  row("People", "people.dependents", "Add dependents to staff profile", "D|D|-|Request|-|-|-|-|-|-"),
  row("People", "people.guest", "Add guest / trainee profile (fixed end date)", "D|D|G|-|-|-|-|-|-|-"),
  row("People", "people.merge", "Duplicate match & merge profiles", "D|D|-|-|-|-|-|-|-|V"),
  row("People", "people.rehire", "Rehire / reactivate archived staff", "D|D|-|-|-|-|-|-|-|-"),

  // 5.3 Accommodation
  row("Accommodation", "accom.view", "View occupancy, rooms, beds", "D|D|D|O|V|-|-|-|V|-"),
  row("Accommodation", "accom.block", "Room / bed status (block, maintenance)", "D|D|- (readiness only)|-|Request|-|-|-|-|-"),
  row("Accommodation", "accom.readiness", "Update room readiness", "D|D|D|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.allocate", "Allocate bed, reservations, waitlist", "D|D|-|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.choose_bed", "Choose bed within approved room type", "D|D|D|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.bulk_allocate", "Bulk allocation", "D|G|-|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.eligibility_override", "Eligibility override (reason mandatory)", "D|G|-|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.checkin", "Check-in / check-out (approved stays)", "D|D|D|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.emergency_checkin", "Emergency check-in without approval", "D|D|G|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.extend", "Extend stay up to X days", "D|D|G|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.transfer", "Transfers (within site)", "D|D|Execute|Request|-|-|-|-|-|-"),
  row("Accommodation", "accom.transfer_inter", "Inter-site transfer", "D|D (both sites)|Execute|Request|-|-|-|-|-|-"),
  row("Accommodation", "accom.own_stay", "View own stay, roommates (first name + photo)", "-|-|-|D|-|-|-|-|-|-"),
  row("Accommodation", "accom.submit_requests", "Submit requests (room change, extension, checkout, family)", "-|-|On behalf|D|-|-|-|-|-|-"),
  row("Accommodation", "accom.approve", "Approve requests", "D|D|-|-|-|-|-|-|-|-"),
  row("Accommodation", "accom.bed_swap", "Bed swap between two residents", "D|D|Execute|Request|-|-|-|-|-|-"),

  // 5.4 Maintenance and vendors
  row("Maintenance", "maint.create", "Create work order", "D|D|D|O|D|Follow-up|-|After hours|-|-"),
  row("Maintenance", "maint.view", "View work orders", "D|D|Raised by them|O + own room status|D|Assigned|Assigned|Raised by them|V|-"),
  row("Maintenance", "maint.triage", "Triage, assign, reassign, cancel", "D|G|-|-|D|-|-|-|-|-"),
  row("Maintenance", "maint.work", "Accept, update status, notes, photos, resolve", "-|-|-|-|-|D|D|-|-|-"),
  row("Maintenance", "maint.record", "Record parts, labour, root cause", "-|-|-|-|-|D|D|-|-|-"),
  row("Maintenance", "maint.verify", "Verify / rate completed job", "-|D|D (vacant rooms)|O|-|-|-|-|-|-"),
  row("Maintenance", "maint.cost_within", "Approve cost within threshold", "D|D|-|-|D|-|-|-|-|-"),
  row("Maintenance", "maint.cost_above", "Approve cost above threshold", "D|D|-|-|G|-|-|-|-|-"),
  row("Maintenance", "maint.preventive", "Preventive maintenance schedules", "D|G|-|-|D|-|-|-|-|-"),
  row("Maintenance", "maint.vendor_create", "Vendors: create", "D|D|-|-|G|-|-|-|-|-"),
  row("Maintenance", "maint.vendor_manage", "Vendors: approve, suspend, terminate", "D|D|-|-|-|-|-|-|-|-"),
  row("Maintenance", "maint.workers", "Add contractor workers", "D|D|-|-|D|-|G (vendor supervisor)|-|-|-"),
  row("Maintenance", "maint.quote", "Submit quote / invoice reference", "-|-|-|-|-|-|G (vendor supervisor)|-|-|-"),
  row("Maintenance", "maint.permit", "Approve work permit (high-risk jobs)", "D|D|-|-|D|-|-|-|-|-"),
  row("Maintenance", "maint.requester_contact", "See resident name and contact on ticket", "D|D|D|-|D|First name|-|-|-|-"),
  row("Maintenance", "maint.rate_card", "Vendor rate card", "D|D|-|-|D|-|G (vendor supervisor)|-|-|V"),

  // 5.5 Keys and inventory
  row("Keys", "keys.standard", "Issue / return standard keys", "D|D|D|O (view held)|-|Job keys|Job keys|G (night)|-|-"),
  row("Keys", "keys.sensitive", "Issue / return sensitive keys", "D|D|G (key supervisor)|-|G (key supervisor)|Job keys|Job keys|-|-|-"),
  row("Keys", "keys.emergency", "Issue emergency keys", "D|D|-|-|-|-|-|-|-|-"),
  row("Keys", "keys.report_lost", "Record lost / damaged key", "D|D|D|Report|D|D|D|D|-|-"),
  row("Keys", "keys.loss_approve", "Approve key loss + lock change", "D|D|G (key supervisor)|-|G (key supervisor)|-|-|-|-|-"),
  row("Keys", "keys.register", "Key register setup", "D|D|-|-|-|-|-|-|-|V"),
  row("Keys", "keys.audit", "Key audit / reconciliation", "D|D|G (key supervisor)|-|G (key supervisor)|-|-|-|-|V"),
  row("Keys", "keys.sensitive_history", "View sensitive key history", "D|D|G (key supervisor)|-|G (key supervisor)|-|-|-|-|V"),
  row("Keys", "keys.room_hub", "Room hub: Keys tab (link, add keys to room)", "D|D|V|-|-|-|-|-|-|V"),
  row("Keys", "keys.bulk_create", "Bulk key creation (copies per room)", "D|D|-|-|-|-|-|-|-|-"),
  row("Keys", "keys.retire_replace", "Retire key / create replacement after lock change", "D|D|-|-|G (key supervisor)|-|-|-|-|V"),
  row("Inventory", "inv.room_handover", "Room asset handover at check-in / out", "D|D|D|Acknowledge|-|-|-|-|-|-"),
  row("Inventory", "inv.parts", "Issue / return parts against work order", "D|D|D|-|G (inventory supervisor)|Request|Request|-|-|-"),
  row("Inventory", "inv.goods_in", "Goods in, transfers between stores", "D|D|G (inventory supervisor)|-|G (inventory supervisor)|-|-|-|-|-"),
  row("Inventory", "inv.adjust", "Stock adjustment (within limit)", "D|D|G (inventory supervisor)|-|G (inventory supervisor)|-|-|-|-|-"),
  row("Inventory", "inv.writeoff", "Write-off / asset disposal", "D|D (above limit → SA)|-|-|-|-|-|-|-|V"),
  row("Inventory", "inv.masters", "Item masters, reorder levels", "D|D|-|-|-|-|-|-|-|-"),
  row("Inventory", "inv.room_assets", "Room hub: Assets tab (assign, move, remove assets)", "D|D|V|O (view)|V|-|-|-|-|V"),

  // 5.6 Facilities
  row("Facilities", "fac.view", "View eligible facilities & availability", "D|D|D|D|D|-|-|-|V|-"),
  row("Facilities", "fac.book_own", "Book / cancel own booking", "-|-|-|D|-|-|-|-|-|-"),
  row("Facilities", "fac.book_behalf", "Book on behalf, check-in, mark no-show", "D|D|D|-|-|-|-|-|-|-"),
  row("Facilities", "fac.approve", "Approve / reject bookings", "D|D|G (facility manager)|-|-|-|-|-|-|-"),
  row("Facilities", "fac.cancel_any", "Cancel any booking (reason)", "D|D|G (facility manager)|-|-|-|-|-|-|-"),
  row("Facilities", "fac.block_slots", "Block slots, events, recurring bookings", "D|D|G (facility manager)|-|-|-|-|-|-|-"),
  row("Facilities", "fac.close", "Close facility for maintenance", "D|D|-|-|D|-|-|-|-|-"),
  row("Facilities", "fac.configure", "Configure facilities, hours, rules, eligibility, fees", "D|D|G (facility manager)|-|-|-|-|-|-|-"),
  row("Facilities", "fac.lift_noshow", "Lift no-show block", "D|D|G (facility manager)|-|-|-|-|-|-|-"),
  row("Facilities", "fac.see_who", "See who booked", "D|D|D|O|-|-|-|-|-|-"),

  // 5.7 Security and visitors
  row("Security", "sec.visitor_policy", "Visitor policy setup per site", "D|D|-|-|-|-|-|-|-|V"),
  row("Security", "sec.preregister", "Pre-register visitor", "-|-|On behalf|G|-|-|-|-|-|-"),
  row("Security", "sec.approve_overnight", "Approve overnight / restricted-area visitor", "D|D|G|-|-|-|-|G|-|-"),
  row("Security", "sec.confirm_walkin", "Confirm walk-in visitor", "-|-|-|D|-|-|-|-|-|-"),
  row("Security", "sec.checkin_visitors", "Check in / out visitors and contractors", "-|-|G|-|-|-|-|D|-|-"),
  row("Security", "sec.verify_resident", "Verify resident at gate (photo, stay status)", "-|-|D|-|-|-|-|D|-|-"),
  row("Security", "sec.incident_report", "Report incident", "D|D|D|D|D|D|-|D|-|-"),
  row("Security", "sec.incident_manage", "Manage / close incidents", "D|D|-|-|-|-|-|-|-|V"),
  row("Security", "sec.sos_raise", "SOS: raise", "-|-|-|D|-|-|-|D|-|-"),
  row("Security", "sec.sos_respond", "SOS: receive, respond", "D|D|D|-|-|-|-|D|-|-"),
  row("Security", "sec.parcels", "Parcels: log, notify, collect", "-|-|D|O|-|-|-|D|-|-"),
  row("Security", "sec.restricted_view", "Restricted entry list: view", "D|D|D|-|-|-|-|D|-|V"),
  row("Security", "sec.restricted_edit", "Restricted entry list: add / remove", "D|D|-|-|-|-|-|-|-|V"),
  row("Security", "sec.patrol", "Patrol rounds", "-|-|-|-|-|-|-|G|-|-"),
  row("Security", "sec.patrol_points", "Patrol checkpoints", "D|D|-|-|-|-|-|V|-|-"),

  // 5.8 Communication, reports and audit
  row("Privacy", "priv.decide", "Decide data-subject requests (Compliance)", "-|G|-|-|-|-|-|-|-|V"),
  row("Privacy", "priv.execute", "Execute approved erasure / correction", "D|-|-|-|-|-|-|-|-|V"),
  row("Communication", "comm.templates", "Notification templates & channels", "D|-|-|-|-|-|-|-|-|-"),
  row("Communication", "comm.broadcast", "Broadcasts (site / building / role)", "D|D|G|Read|G|Read|-|Read|-|-"),
  row("Lost & found", "lf.operate", "Lost & found: log, handover", "D|D|D|Report / claim|-|-|-|D|-|-"),
  row("Reports", "rep.l1", "L1 Executive 360 dashboard", "D (all)|D (own sites)|-|-|-|-|-|-|D|-"),
  row("Reports", "rep.l2", "L2 Operational reports", "D|D|-|-|D (maintenance, vendors)|-|G (vendor supervisor)|-|D|-"),
  row("Reports", "rep.l3", "L3 Desk / shift reports", "D|D|D|-|-|-|-|D (gate)|-|-"),
  row("Reports", "rep.l4", "L4 Audit log & exception reports", "D|D (own sites, excl. SA actions)|-|-|-|-|-|-|-|D"),
  row("Reports", "rep.export", "Export reports", "D|D|G|-|G|-|-|-|G|D"),
  row("Reports", "rep.schedule", "Scheduled reports & alerts", "D|D|-|-|D|-|-|-|D|D"),
  row("Reports", "rep.kpi_targets", "Set KPI targets", "D|D (site targets)|-|-|-|-|-|-|-|-"),
  row("Reports", "audit.edit", "Edit / delete audit records", "-|-|-|-|-|-|-|-|-|-"),

  // 5.9 Data setup, room hub, people records and new modules
  row("Setup", "setup.stores", "Stores / warehouses, gates, key cabinets", "D|G (own sites)|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.checklists", "Checklist templates (check-in, checkout, inspection)", "D|G|-|-|-|-|-|-|-|V"),
  row("Setup", "setup.house_rules", "House rules & agreements (versioned)", "D|D (site rules)|V|Read + acknowledge|-|-|-|-|-|V"),
  row("Setup", "setup.policies", "Incident categories, visitor policies", "D|D (site policies)|-|-|-|-|-|V|-|V"),
  row("Setup", "admin.reassign_pending", "Reassign pending approvals of deactivated user", "D|-|-|-|-|-|-|-|-|V"),
  row("Housekeeping", "house.tasks", "Housekeeping: view and complete cleaning tasks", "-|D|D|-|-|Housekeeping staff|-|-|-|-"),
  row("Housekeeping", "house.schedule", "Schedule periodic room inspections", "D|D|-|-|G|-|-|-|-|-"),
  row("Housekeeping", "house.inspect", "Perform inspection (checklist)", "-|D|D|-|D|-|-|-|-|-"),
  row("Charges", "charges.rates", "Charges: rate setup", "D|G|-|-|-|-|-|-|-|V"),
  row("Charges", "charges.raise", "Charges: raise charge (damage, fee)", "D|D|Record|-|-|-|-|-|-|-"),
  row("Charges", "charges.approve", "Charges: approve, export to payroll", "D|D|-|-|-|-|-|-|-|V"),
  row("Charges", "charges.own", "Charges: view own", "-|-|-|O|-|-|-|-|-|-"),
];

export const CAPABILITY_BY_KEY: Map<string, Capability> = new Map(CAPABILITIES.map((c) => [c.key, c]));

export function capability(key: string): Capability {
  const cap = CAPABILITY_BY_KEY.get(key);
  if (!cap) throw new Error(`Unknown capability ${key}`);
  return cap;
}

/** Roles whose default (non-grant) access to a capability is at least `level`. */
export function rolesWithDefault(key: string, ...levels: CellLevel[]): Role[] {
  const cap = capability(key);
  const accepted = levels.length ? levels : (["full"] as CellLevel[]);
  return MATRIX_ROLES.filter((r) => cap.cells[r].state === "D" && accepted.includes(cap.cells[r].level));
}

/** Roles that can see the capability at all by default (any level). */
export function rolesWithAnyDefault(key: string): Role[] {
  const cap = capability(key);
  return MATRIX_ROLES.filter((r) => cap.cells[r].state === "D");
}

/** Roles for which a grant can switch the capability on. */
export function rolesGrantable(key: string): Role[] {
  const cap = capability(key);
  return MATRIX_ROLES.filter((r) => cap.cells[r].state === "G");
}
