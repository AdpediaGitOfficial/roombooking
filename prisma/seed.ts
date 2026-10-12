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

  async function ensureUser(email: string, name: string, role: Role) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, status: "ACTIVE" },
      create: { organizationId: org.id, email, name, passwordHash, status: "ACTIVE" },
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

  const adminUser = await ensureUser("admin@example.com", "System Administrator", Role.SYSTEM_ADMIN);
  // The demo admin also acts as the accommodation administrator (final approval step).
  if (!(await prisma.roleAssignment.findFirst({ where: { userId: adminUser.id, role: Role.ACCOMMODATION_ADMIN, siteId: null, buildingId: null } }))) {
    await prisma.roleAssignment.create({ data: { userId: adminUser.id, role: Role.ACCOMMODATION_ADMIN } });
  }
  await ensureUser("officer@example.com", "Reception Officer", Role.ACCOMMODATION_OFFICER);
  await ensureUser("manager@example.com", "Line Manager", Role.APPROVER);
  const engineer = await ensureUser("engineer@example.com", "Maintenance Engineer", Role.MAINTENANCE);
  const vendor = await prisma.vendor.upsert({
    where: { id: "demo-vendor-coolair" },
    update: {},
    create: { id: "demo-vendor-coolair", organizationId: org.id, name: "CoolAir Services", contactName: "Dispatch", contactPhone: "+971 4 111 1111" },
  });
  const vendorUser = await ensureUser("vendor@example.com", "CoolAir Technician", Role.VENDOR);
  await prisma.user.update({ where: { id: vendorUser.id }, data: { vendorId: vendor.id } });
  const staffUser = await ensureUser("staff@example.com", "Sample Resident", Role.STAFF);
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
      create: { requestTypeId: type.id, version: 1, isCurrent: true, formSchema: { fields: rt.fields } },
    });
    const steps = [
      { order: 1, name: "Line manager approval", approverRole: Role.APPROVER, requireComment: false },
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

  await prisma.facility.upsert({
    where: { siteId_code: { siteId: site.id, code: "GYM" } },
    update: {},
    create: {
      siteId: site.id,
      code: "GYM",
      name: "Gymnasium",
      capacity: 10,
      openingHours: { mon_sun: ["06:00", "22:00"] },
      bookingRules: { maxDurationMinutes: 90, advanceDays: 7, bufferMinutes: 15 },
    },
  });

  const counts = {
    buildings: await prisma.building.count(),
    rooms: await prisma.room.count(),
    beds: await prisma.bed.count(),
    allocations: await prisma.allocation.count(),
    workOrders: await prisma.workOrder.count(),
    keys: await prisma.key.count(),
    requestTypes: await prisma.requestType.count(),
    facilities: await prisma.facility.count(),
  };
  console.log("Seed complete", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
