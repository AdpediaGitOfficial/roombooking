// Capability sets (document section 2, "Capability grants"). A set is granted
// to a role or a user; it switches on the Grantable cells it lists, within the
// holder's scope, optionally until an expiry date. A set never unlocks a Locked cell.
export type CapabilitySet = { id: string; label: string; typicallyGivenTo: string; adds: string; capabilities: string[] };

export const CAPABILITY_SETS: CapabilitySet[] = [
  {
    id: "HR",
    label: "HR capability set",
    typicallyGivenTo: "Accommodation Admin (chosen setup)",
    adds: "Staff master, eligibility, joiners, exits, clearances",
    capabilities: ["people.import", "people.export"],
  },
  {
    id: "MAINTENANCE_COORDINATOR",
    label: "Maintenance coordinator",
    typicallyGivenTo: "Accommodation Admin (if no coordinator)",
    adds: "Triage, assign, cost approval",
    capabilities: ["maint.triage", "maint.preventive", "maint.cost_above", "maint.vendor_create", "house.schedule"],
  },
  {
    id: "KEY_SUPERVISOR",
    label: "Key supervisor",
    typicallyGivenTo: "Senior Officer, Maintenance Coordinator",
    adds: "Sensitive keys, loss approval, key audit",
    capabilities: ["keys.sensitive", "keys.loss_approve", "keys.audit", "keys.sensitive_history", "keys.retire_replace"],
  },
  {
    id: "INVENTORY_SUPERVISOR",
    label: "Inventory supervisor",
    typicallyGivenTo: "Senior Officer, Maintenance Coordinator",
    adds: "Goods in, transfers, small adjustments",
    capabilities: ["inv.goods_in", "inv.adjust", "inv.parts"],
  },
  {
    id: "FACILITY_MANAGER",
    label: "Facility manager",
    typicallyGivenTo: "Officer, dedicated facility in-charge",
    adds: "Configure assigned facilities, approve bookings",
    capabilities: ["fac.approve", "fac.cancel_any", "fac.block_slots", "fac.configure", "fac.lift_noshow"],
  },
  {
    id: "BUILDING_CREATION",
    label: "Building creation",
    typicallyGivenTo: "Accommodation Admin",
    adds: "Create / edit buildings within assigned sites",
    capabilities: ["setup.buildings", "setup.structure_bulk", "setup.activate", "setup.stores", "setup.checklists", "setup.restore"],
  },
  {
    id: "EMERGENCY_CHECKIN",
    label: "Emergency check-in",
    typicallyGivenTo: "Officer",
    adds: "Provisional check-in without approval (approval within 24 h); extensions",
    capabilities: ["accom.emergency_checkin", "accom.extend", "people.add", "people.guest"],
  },
  {
    id: "NIGHT_KEYS",
    label: "Night keys",
    typicallyGivenTo: "Security",
    adds: "Standard key issue / return after hours",
    capabilities: ["keys.standard"],
  },
  {
    id: "VENDOR_SUPERVISOR",
    label: "Vendor supervisor",
    typicallyGivenTo: "Lead contractor at a vendor",
    adds: "Own-vendor jobs, workers, quotes, rate card and reports",
    capabilities: ["maint.workers", "maint.quote", "maint.rate_card", "rep.l2"],
  },
  {
    id: "VISITOR_APPROVAL",
    label: "Visitor approval",
    typicallyGivenTo: "Officer, Security",
    adds: "Approve overnight / restricted-area visitors; check in visitors; patrol rounds",
    capabilities: ["sec.approve_overnight", "sec.checkin_visitors", "sec.patrol", "sec.preregister"],
  },
  {
    id: "REPORT_EXPORT",
    label: "Report export",
    typicallyGivenTo: "Officer, Maintenance Coordinator, Read-only Manager",
    adds: "Download reports (watermarked and logged); staff data export for managers",
    capabilities: ["rep.export", "people.export", "people.view"],
  },
  {
    id: "BROADCAST",
    label: "Broadcasts",
    typicallyGivenTo: "Officer, Maintenance Coordinator",
    adds: "Send announcements to a site, building or role",
    capabilities: ["comm.broadcast"],
  },
  {
    id: "ADMIN_OVERRIDES",
    label: "Admin overrides",
    typicallyGivenTo: "Accommodation Admin (second approver)",
    adds: "Bulk allocation, eligibility override, rate setup",
    capabilities: ["accom.bulk_allocate", "accom.eligibility_override", "charges.rates", "maint.preventive"],
  },
];

export const CAPABILITY_SET_BY_ID: Map<string, CapabilitySet> = new Map(CAPABILITY_SETS.map((s) => [s.id, s]));
