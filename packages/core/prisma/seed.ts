/**
 * Seeds a demo organisation so the app can be explored locally.
 * Idempotent: re-running updates the same records by their natural keys.
 */
import { PrismaClient, Prisma, Role, BuildingType } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

// Demo credentials for local development only. Change on first login in
// any shared environment.
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "ChangeMe123!";

async function main() {
  const org = await prisma.organization.upsert({
    where: { code: "DEMO" },
    update: {},
    create: { code: "DEMO", name: "Demo Organisation" },
  });

  const site = await prisma.site.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "HQ" } },
    update: {
      address: "Industrial Area 3, Street 12",
      contactPhone: "+971 4 000 0000",
      contactEmail: "accommodation@example.com",
      helpNotes: "Reception is open 07:00–22:00. For emergencies call security on 999.",
    },
    create: {
      organizationId: org.id,
      code: "HQ",
      name: "Head Office Camp",
      timezone: "Asia/Dubai",
      address: "Industrial Area 3, Street 12",
      contactPhone: "+971 4 000 0000",
      contactEmail: "accommodation@example.com",
      helpNotes: "Reception is open 07:00–22:00. For emergencies call security on 999.",
    },
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  async function ensureUser(email: string, name: string, role: Role, username?: string) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, status: "ACTIVE", ...(username ? { username } : {}) },
      create: { organizationId: org.id, email, name, passwordHash, status: "ACTIVE", ...(username ? { username } : {}) },
    });
    // Composite unique keys containing NULL cannot be matched by upsert.
    const existing = await prisma.roleAssignment.findFirst({
      where: { userId: user.id, role, siteId: null, buildingId: null },
    });
    if (!existing) {
      await prisma.roleAssignment.create({ data: { userId: user.id, role } });
    }
    return user;
  }

  /** Switches a capability set on for one user (document section 3: reason mandatory, audited). */
  async function ensureSetGrant(userId: string, capabilitySet: string, reason: string, grantedById: string) {
    const existing = await prisma.permissionGrant.findFirst({ where: { userId, capabilitySet, revokedAt: null } });
    if (!existing) {
      await prisma.permissionGrant.create({ data: { organizationId: org.id, userId, capabilitySet, reason, grantedById } });
    }
  }

  /** Switches a single capability on for every holder of a role (document: residents register visitors once the site switches it on). */
  async function ensureRoleCapability(role: Role, capability: string, reason: string, grantedById: string) {
    const existing = await prisma.permissionGrant.findFirst({ where: { role, capability, revokedAt: null } });
    if (!existing) await prisma.permissionGrant.create({ data: { organizationId: org.id, role, capability, reason, grantedById } });
  }

  // (Demo accounts have already accepted the privacy notice; real accounts accept it at first sign-in.)
  // Two Super Admins plus a break-glass account (document section 12).
  const adminUser = await ensureUser("admin@example.com", "Super Admin", Role.SYSTEM_ADMIN);
  await ensureUser("admin2@example.com", "Second Super Admin", Role.SYSTEM_ADMIN);
  await ensureUser("breakglass@example.com", "Break-glass Admin", Role.SYSTEM_ADMIN);
  const accAdmin = await ensureUser("accadmin@example.com", "Accommodation Admin", Role.ACCOMMODATION_ADMIN);
  const officer = await ensureUser("officer@example.com", "Reception Officer", Role.ACCOMMODATION_OFFICER);
  await ensureUser("manager@example.com", "Line Manager", Role.LINE_MANAGER);
  await ensureUser("coordinator@example.com", "Maintenance Coordinator", Role.MAINTENANCE_COORDINATOR);
  const engineer = await ensureUser("engineer@example.com", "Maintenance Technician", Role.TECHNICIAN);
  await ensureUser("security@example.com", "Gate Security", Role.SECURITY);
  await ensureUser("readonly@example.com", "Read-only Manager", Role.READONLY_MANAGER);
  // A senior officer holds the Key supervisor and Inventory supervisor sets; another leads the facilities.
  const custodian = await ensureUser("custodian@example.com", "Senior Officer (keys & stock)", Role.ACCOMMODATION_OFFICER);
  await ensureSetGrant(accAdmin.id, "COMPLIANCE", "Accommodation Admin is the data protection lead", adminUser.id);
  await ensureRoleCapability(Role.STAFF, "sec.preregister", "Residents may register their own visitors at go-live", adminUser.id);
  await ensureSetGrant(custodian.id, "KEY_SUPERVISOR", "Senior officer keeps the key register", adminUser.id);
  await ensureSetGrant(custodian.id, "INVENTORY_SUPERVISOR", "Senior officer keeps the stores", adminUser.id);
  const facilityUser = await ensureUser("facility@example.com", "Facility In-charge", Role.ACCOMMODATION_OFFICER);
  await ensureSetGrant(facilityUser.id, "FACILITY_MANAGER", "Runs the gym and community hall", adminUser.id);
  await ensureUser("auditor@example.com", "Read-only Auditor", Role.AUDITOR);
  const vendor = await prisma.vendor.upsert({
    where: { id: "demo-vendor-coolair" },
    update: {},
    create: { id: "demo-vendor-coolair", organizationId: org.id, name: "CoolAir Services", contactName: "Dispatch", contactPhone: "+971 4 111 1111" },
  });
  const vendorUser = await ensureUser("vendor@example.com", "CoolAir Technician", Role.VENDOR);
  await prisma.user.update({ where: { id: vendorUser.id }, data: { vendorId: vendor.id } });
  const staffUser = await ensureUser("staff@example.com", "Sample Resident", Role.STAFF, "e1001");
  // Demo resident has opted in to WhatsApp so the WhatsApp queue shows something with the log transport.
  await prisma.user.update({ where: { id: staffUser.id }, data: { whatsappNumber: "+971500000001", whatsappNotifications: true, whatsappConsentAt: new Date() } });
  await prisma.staffProfile.upsert({
    where: { organizationId_employeeId: { organizationId: org.id, employeeId: "E1001" } },
    update: { userId: staffUser.id, phone: "+971 50 123 4567" },
    create: {
      organizationId: org.id,
      userId: staffUser.id,
      employeeId: "E1001",
      phone: "+971 50 123 4567",
      firstName: "Sample",
      lastName: "Resident",
      department: "Operations",
    },
  });

  // Two buildings, rooms and beds.
  const buildings = [
    { code: "A", name: "Block A", type: BuildingType.BUILDING, rooms: 4, bedsPerRoom: 2 },
    { code: "V1", name: "Villa 1", type: BuildingType.VILLA, rooms: 3, bedsPerRoom: 1 },
  ];
  for (const b of buildings) {
    const building = await prisma.building.upsert({
      where: { siteId_code: { siteId: site.id, code: b.code } },
      update: {},
      create: { siteId: site.id, code: b.code, name: b.name, type: b.type },
    });
    for (let r = 1; r <= b.rooms; r++) {
      const roomCode = `${b.code}-${String(r).padStart(2, "0")}`;
      const room = await prisma.room.upsert({
        where: { buildingId_code: { buildingId: building.id, code: roomCode } },
        update: {},
        create: { buildingId: building.id, code: roomCode, type: b.bedsPerRoom > 1 ? "SHARED" : "SINGLE" },
      });
      for (let bed = 1; bed <= b.bedsPerRoom; bed++) {
        const bedCode = `${roomCode}-${bed}`;
        await prisma.bed.upsert({
          where: { roomId_code: { roomId: room.id, code: bedCode } },
          update: {},
          create: { roomId: room.id, code: bedCode },
        });
        await prisma.key.upsert({
          where: { siteId_code: { siteId: site.id, code: `K-${roomCode}` } },
          update: {},
          create: { siteId: site.id, code: `K-${roomCode}`, label: `Room ${roomCode}`, roomId: room.id },
        });
      }
    }
  }

  // Standard request types from the Scope of Work (WF-01) with a two-step route.
  const requestTypes: Array<{ code: string; name: string; description: string; fields: Prisma.InputJsonObject[] }> = [
    {
      code: "ROOM_CHANGE",
      name: "Room change request",
      description: "Ask to move to a different room or building.",
      fields: [
        { name: "reason", label: "Reason for change", type: "textarea", required: true, help: "Tell us what is wrong with the current room or why you need to move." },
        { name: "preferredBuilding", label: "Preferred building", type: "select", required: false, optionsSource: "buildings" },
        { name: "effectiveDate", label: "Requested move date", type: "date", required: true },
      ],
    },
    {
      code: "VISITOR_STAY",
      name: "Visitor stay request",
      description: "Permission for a visitor to stay overnight in your accommodation.",
      fields: [
        { name: "visitorName", label: "Visitor full name", type: "text", required: true },
        { name: "relationship", label: "Relationship to you", type: "select", required: true, options: ["Spouse", "Parent", "Sibling", "Child", "Friend", "Other"] },
        { name: "arrivalDate", label: "Arrival date", type: "date", required: true },
        { name: "departureDate", label: "Departure date", type: "date", required: true },
        { name: "idProvided", label: "I will present the visitor's ID at reception on arrival", type: "checkbox", required: true },
      ],
    },
    {
      code: "FAMILY_ACCOMMODATION",
      name: "Family accommodation request",
      description: "Apply for family accommodation instead of shared staff housing.",
      fields: [
        { name: "familyMembers", label: "Number of family members joining you", type: "number", required: true, min: 1, max: 10 },
        { name: "justification", label: "Justification", type: "textarea", required: true },
        { name: "preferredBuilding", label: "Preferred building", type: "select", required: false, optionsSource: "buildings" },
      ],
    },
    {
      code: "EXIT_CLEARANCE",
      name: "Exit clearance",
      description: "Start your departure process: keys, assets and check-out.",
      fields: [
        { name: "lastWorkingDay", label: "Last working day", type: "date", required: true, help: "Your accommodation end date will be set to this day once approved." },
        { name: "forwardingContact", label: "Forwarding phone or email", type: "text", required: false },
        { name: "itemsReturned", label: "I will return all keys and issued items before leaving", type: "checkbox", required: true },
      ],
    },
  ];

  for (const rt of requestTypes) {
    const type = await prisma.requestType.upsert({
      where: { organizationId_code: { organizationId: org.id, code: rt.code } },
      update: { name: rt.name, description: rt.description },
      create: { organizationId: org.id, code: rt.code, name: rt.name, description: rt.description },
    });
    const version = await prisma.workflowVersion.upsert({
      where: { requestTypeId_version: { requestTypeId: type.id, version: 1 } },
      update: { formSchema: { fields: rt.fields } },
      create: { requestTypeId: type.id, version: 1, isCurrent: true, publishedAt: new Date(), publishedById: adminUser.id, formSchema: { fields: rt.fields } },
    });
    const steps = [
      { order: 1, name: "Line manager approval", approverRole: Role.LINE_MANAGER, requireComment: false },
      { order: 2, name: "Accommodation administrator approval", approverRole: Role.ACCOMMODATION_ADMIN, requireComment: true },
    ];
    for (const s of steps) {
      await prisma.approvalStep.upsert({
        where: { workflowVersionId_order: { workflowVersionId: version.id, order: s.order } },
        update: s,
        create: { workflowVersionId: version.id, ...s },
      });
    }
  }

  // Sample residents and allocations so the occupancy views have data.
  async function ensureStaff(employeeId: string, firstName: string, lastName: string) {
    return prisma.staffProfile.upsert({
      where: { organizationId_employeeId: { organizationId: org.id, employeeId } },
      update: {},
      create: { organizationId: org.id, employeeId, firstName, lastName, department: "Operations" },
    });
  }
  async function ensureAllocation(bedCode: string, employeeId: string, status: "CONFIRMED" | "CHECKED_IN", startDate: string, endDate?: string) {
    const bed = await prisma.bed.findFirstOrThrow({ where: { code: bedCode } });
    const staff = await prisma.staffProfile.findUniqueOrThrow({
      where: { organizationId_employeeId: { organizationId: org.id, employeeId } },
    });
    const existing = await prisma.allocation.findFirst({ where: { bedId: bed.id, staffId: staff.id } });
    if (existing) return existing;
    return prisma.allocation.create({
      data: {
        bedId: bed.id,
        staffId: staff.id,
        status,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        checkedInAt: status === "CHECKED_IN" ? new Date() : null,
        reason: "Seed data",
      },
    });
  }
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysFromNow = (n: number) => iso(new Date(today.getTime() + n * 86400000));

  await ensureStaff("E1002", "Amal", "Rahman");
  await ensureStaff("E1003", "Priya", "Nair");
  await ensureStaff("E1004", "Noor", "Haddad");
  await ensureAllocation("A-01-1", "E1001", "CHECKED_IN", daysFromNow(-30));
  await ensureAllocation("A-01-2", "E1002", "CONFIRMED", daysFromNow(0), daysFromNow(180));
  await ensureAllocation("A-02-1", "E1003", "CONFIRMED", daysFromNow(14));
  // Welcome notification for the linked demo resident (idempotent).
  const residentAllocation = await prisma.allocation.findFirst({ where: { staff: { employeeId: "E1001" }, status: "CHECKED_IN" }, include: { bed: { include: { room: { include: { building: true } } } } } });
  if (residentAllocation) {
    await prisma.notification.upsert({
      where: { idempotencyKey: `allocation.confirmed:${residentAllocation.id}` },
      update: {},
      create: {
        recipientId: staffUser.id,
        channel: "IN_APP",
        event: "allocation.confirmed",
        template: "allocation.confirmed",
        idempotencyKey: `allocation.confirmed:${residentAllocation.id}`,
        payload: { allocationId: residentAllocation.id, bed: residentAllocation.bed.code, room: residentAllocation.bed.room.code, building: residentAllocation.bed.room.building.name, startDate: iso(residentAllocation.startDate), endDate: null },
      },
    });
  }

  const blockedBed = await prisma.bed.findFirstOrThrow({ where: { code: "A-02-2" } });
  if (blockedBed.status === "ACTIVE") {
    await prisma.bed.update({ where: { id: blockedBed.id }, data: { status: "BLOCKED", blockReason: "Mattress replacement" } });
  }

  // Key handover for the checked-in demo resident (idempotent: one open issue per key).
  const keyA01 = await prisma.key.findFirstOrThrow({ where: { code: "K-A-01" } });
  const residentProfile = await prisma.staffProfile.findUniqueOrThrow({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: "E1001" } } });
  const openIssue = await prisma.keyTransaction.findFirst({ where: { keyId: keyA01.id, type: "ISSUE", returnedAt: null } });
  if (!openIssue && keyA01.status === "AVAILABLE") {
    await prisma.keyTransaction.create({ data: { keyId: keyA01.id, type: "ISSUE", holderId: residentProfile.id, custodianId: custodian.id, condition: "Good", notes: "Handed over at check-in" } });
    await prisma.key.update({ where: { id: keyA01.id }, data: { status: "ISSUED" } });
  } else if (openIssue && keyA01.status === "AVAILABLE") {
    // Repair inconsistent state: an open issue means the key is out.
    await prisma.key.update({ where: { id: keyA01.id }, data: { status: "ISSUED" } });
  }

  // Sample maintenance tickets (idempotent by description).
  const roomA01 = await prisma.room.findFirstOrThrow({ where: { code: "A-01" } });
  const roomA03 = await prisma.room.findFirstOrThrow({ where: { code: "A-03" } });
  async function ensureTicket(desc: string, data: { requesterId: string; roomId: string; category: string; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; status?: "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED"; assigneeId?: string; vendorId?: string; resolutionNote?: string }) {
    const existing = await prisma.workOrder.findFirst({ where: { description: desc } });
    if (existing) return existing;
    const [{ nextval }] = await prisma.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('"WorkOrder_ticket_seq"')`;
    const now = new Date();
    const hours = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 }[data.priority];
    return prisma.workOrder.create({
      data: {
        ticketNumber: `MR-${now.getUTCFullYear()}-${String(nextval).padStart(6, "0")}`,
        siteId: site.id,
        buildingId: (await prisma.room.findUniqueOrThrow({ where: { id: data.roomId } })).buildingId,
        roomId: data.roomId,
        category: data.category,
        description: desc,
        priority: data.priority,
        status: data.status ?? "NEW",
        requesterId: data.requesterId,
        assigneeId: data.assigneeId,
        vendorId: data.vendorId,
        slaDueAt: new Date(now.getTime() + hours * 3600000),
        acknowledgedAt: data.assigneeId || data.vendorId ? now : null,
        startedAt: data.status === "IN_PROGRESS" || data.status === "RESOLVED" ? now : null,
        resolvedAt: data.status === "RESOLVED" ? now : null,
        resolutionNote: data.resolutionNote,
        notes: data.assigneeId || data.vendorId ? { create: { authorId: adminUser.id, type: "ASSIGNMENT", note: `Assigned to ${data.assigneeId ? "Maintenance Engineer" : "CoolAir Services (vendor)"}` } } : undefined,
      },
    });
  }
  await ensureTicket("Hot water is intermittent in the shared bathroom; takes several minutes to warm up.", { requesterId: staffUser.id, roomId: roomA01.id, category: "Plumbing", priority: "MEDIUM" });
  await ensureTicket("Ceiling light flickers and buzzes when switched on.", { requesterId: staffUser.id, roomId: roomA01.id, category: "Electrical", priority: "HIGH", status: "IN_PROGRESS", assigneeId: engineer.id });
  await ensureTicket("Air conditioning blows warm air even on the lowest setting.", { requesterId: staffUser.id, roomId: roomA03.id, category: "Air conditioning", priority: "HIGH", status: "ASSIGNED", vendorId: vendor.id });
  await ensureTicket("Wardrobe door hinge is broken and the door will not close.", { requesterId: staffUser.id, roomId: roomA01.id, category: "Furniture", priority: "LOW", status: "RESOLVED", assigneeId: engineer.id, resolutionNote: "Hinge replaced and door realigned." });

  const GYM_HOURS = { mon: { open: "06:00", close: "22:00" }, tue: { open: "06:00", close: "22:00" }, wed: { open: "06:00", close: "22:00" }, thu: { open: "06:00", close: "22:00" }, fri: { open: "08:00", close: "20:00" }, sat: { open: "06:00", close: "22:00" }, sun: { open: "06:00", close: "22:00" } };
  const GYM_RULES = { slotMinutes: 30, minDurationMinutes: 30, maxDurationMinutes: 90, advanceDays: 7, bufferMinutes: 0, cancellationCutoffMinutes: 60, maxActivePerUser: 3, maxPerDayPerUser: 1 };
  const HALL_HOURS = { mon: { open: "09:00", close: "21:00" }, tue: { open: "09:00", close: "21:00" }, wed: { open: "09:00", close: "21:00" }, thu: { open: "09:00", close: "21:00" }, fri: null, sat: { open: "09:00", close: "21:00" }, sun: { open: "09:00", close: "21:00" } };
  const HALL_RULES = { slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 240, advanceDays: 30, bufferMinutes: 30, cancellationCutoffMinutes: 1440, maxActivePerUser: 2, maxPerDayPerUser: 1 };
  await prisma.facility.upsert({
    where: { siteId_code: { siteId: site.id, code: "GYM" } },
    update: { location: "Block A, ground floor", openingHours: GYM_HOURS, bookingRules: GYM_RULES },
    create: {
      siteId: site.id,
      code: "GYM",
      name: "Gymnasium",
      capacity: 10,
      location: "Block A, ground floor",
      description: "Cardio machines, free weights and a stretching area.",
      openingHours: GYM_HOURS,
      bookingRules: GYM_RULES,
    },
  });
  await prisma.facility.upsert({
    where: { siteId_code: { siteId: site.id, code: "HALL" } },
    update: { openingHours: HALL_HOURS, bookingRules: HALL_RULES },
    create: {
      siteId: site.id,
      code: "HALL",
      name: "Community hall",
      capacity: 1,
      location: "Next to the canteen",
      description: "One group at a time: events, training and gatherings. Bookings are approved by the facility manager.",
      requiresApproval: true,
      openingHours: HALL_HOURS,
      bookingRules: HALL_RULES,
    },
  });

  // Inventory: stock lines, serialised assets, one asset and some bedding issued to the resident.
  const ensureStock = async (sku: string, name: string, category: string, quantity: number, reorderThreshold: number, unit = "pcs", storageLocation = "Store room A") => {
    const existing = await prisma.inventoryItem.findFirst({ where: { siteId: site.id, sku, serialNumber: null } });
    if (existing) return existing;
    const item = await prisma.inventoryItem.create({ data: { siteId: site.id, sku, name, category, quantity, reorderThreshold, unit, storageLocation, trackingType: "STOCK" } });
    await prisma.inventoryTransaction.create({ data: { itemId: item.id, type: "RECEIPT", quantity, balanceAfter: quantity, actorId: adminUser.id, notes: "Opening balance" } });
    return item;
  };
  const ensureAsset = async (sku: string, name: string, category: string, serialNumber: string, condition: "NEW" | "GOOD" | "FAIR" | "DAMAGED" = "GOOD") => {
    const existing = await prisma.inventoryItem.findUnique({ where: { serialNumber } });
    if (existing) return existing;
    const item = await prisma.inventoryItem.create({ data: { siteId: site.id, sku, name, category, serialNumber, condition, quantity: 1, unit: "unit", trackingType: "SERIALIZED", storageLocation: "Store room B" } });
    await prisma.inventoryTransaction.create({ data: { itemId: item.id, type: "RECEIPT", quantity: 1, balanceAfter: 1, actorId: adminUser.id, notes: "Asset registered" } });
    return item;
  };
  const pillows = await ensureStock("PILLOW-STD", "Pillow", "Bedding", 40, 10);
  await ensureStock("SHEET-SGL", "Bed sheet (single)", "Bedding", 60, 20);
  await ensureStock("BLANKET", "Blanket", "Bedding", 8, 10);
  await ensureStock("TOWEL-BATH", "Bath towel", "Linen", 35, 15);
  await ensureStock("SOAP-100", "Soap bar 100g", "Toiletries", 12, 24, "pcs", "Store room A, shelf 2");
  await ensureStock("BULB-LED9", "LED bulb 9W", "Electrical", 48, 12);
  const fridge = await ensureAsset("FRIDGE-MINI", "Mini fridge", "Appliances", "MF-2024-0001");
  await ensureAsset("FRIDGE-MINI", "Mini fridge", "Appliances", "MF-2024-0002", "NEW");
  await ensureAsset("TV-32", "Television 32\"", "Electronics", "TV-2023-0107");
  await ensureAsset("KETTLE", "Electric kettle", "Appliances", "KT-2022-0031", "FAIR");
  await ensureAsset("HEATER", "Oil heater", "Appliances", "OH-2021-0004", "DAMAGED");
  if (!(await prisma.assetAssignment.findFirst({ where: { itemId: fridge.id, endedAt: null } })) && fridge.quantity === 1) {
    await prisma.$transaction([
      prisma.assetAssignment.create({ data: { itemId: fridge.id, staffId: residentProfile.id, assignedById: adminUser.id, notes: "Issued at check-in" } }),
      prisma.inventoryItem.update({ where: { id: fridge.id }, data: { quantity: 0 } }),
      prisma.inventoryTransaction.create({ data: { itemId: fridge.id, type: "ISSUE", quantity: -1, balanceAfter: 0, actorId: adminUser.id, staffId: residentProfile.id, notes: "Issued at check-in" } }),
    ]);
  }
  if (!(await prisma.inventoryTransaction.findFirst({ where: { itemId: pillows.id, type: "ISSUE", staffId: residentProfile.id } }))) {
    await prisma.$transaction([
      prisma.inventoryItem.update({ where: { id: pillows.id }, data: { quantity: { decrement: 2 } } }),
      prisma.inventoryTransaction.create({ data: { itemId: pillows.id, type: "ISSUE", quantity: -2, balanceAfter: pillows.quantity - 2, actorId: adminUser.id, staffId: residentProfile.id, notes: "Issued at check-in" } }),
    ]);
  }

  // Lost and found: a few found items in different states.
  const ensureFound = async (description: string, data: { category: string; foundLocation: string; daysAgo: number; storageLocation?: string; retentionDays?: number }) => {
    const existing = await prisma.lostFoundItem.findFirst({ where: { siteId: site.id, description } });
    if (existing) return existing;
    const [{ nextval }] = await prisma.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('"LostFoundItem_ref_seq"')`;
    const foundAt = new Date(Date.now() - data.daysAgo * 86400000);
    const item = await prisma.lostFoundItem.create({ data: { siteId: site.id, reference: `LF-${String(nextval).padStart(6, "0")}`, description, category: data.category, foundLocation: data.foundLocation, foundAt, custodianId: officer.id, registeredById: officer.id, storageLocation: data.storageLocation ?? null, status: data.storageLocation ? "STORED" : "REPORTED", retainUntil: new Date(foundAt.getTime() + (data.retentionDays ?? 90) * 86400000) } });
    await prisma.lostFoundEvent.create({ data: { itemId: item.id, type: "REGISTERED", actorId: officer.id, toStatus: item.status, notes: data.storageLocation ? `Stored at ${data.storageLocation}` : null } });
    return item;
  };
  await ensureFound("Black leather wallet, no cash, two bank cards", { category: "Wallet / cards / ID", foundLocation: "Canteen", daysAgo: 2, storageLocation: "Reception safe" });
  await ensureFound("Blue umbrella with wooden handle", { category: "Other", foundLocation: "Block A lobby", daysAgo: 5, storageLocation: "Reception cupboard" });
  await ensureFound("Grey hoodie, size M", { category: "Clothing", foundLocation: "Gym", daysAgo: 1 });
  await ensureFound("Single silver earring", { category: "Jewellery / watch", foundLocation: "Villa 1 bathroom", daysAgo: 120, storageLocation: "Reception safe", retentionDays: 90 });

  const counts = {
    buildings: await prisma.building.count(),
    rooms: await prisma.room.count(),
    beds: await prisma.bed.count(),
    allocations: await prisma.allocation.count(),
    workOrders: await prisma.workOrder.count(),
    keys: await prisma.key.count(),
    requestTypes: await prisma.requestType.count(),
    facilities: await prisma.facility.count(),
    inventoryItems: await prisma.inventoryItem.count(),
    lostFound: await prisma.lostFoundItem.count(),
  };
  // Demo accounts have already accepted the current privacy notice, so sign-in goes straight to the work.
  await prisma.user.updateMany({ where: { organizationId: org.id, consentAcceptedAt: null }, data: { consentAcceptedAt: new Date(), consentVersion: process.env.CONSENT_VERSION ?? "2026-10" } });
  console.log("Seed complete", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
