/**
 * Seeds a demo organisation so the app can be explored locally.
 * Idempotent: re-running updates the same records by their natural keys.
 */
import { PrismaClient, Prisma, Role, BuildingType } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

// Placeholder until a real auth layer (bcrypt/argon2) is added.
function placeholderHash(password: string) {
  return "sha256$" + createHash("sha256").update(password).digest("hex");
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { code: "DEMO" },
    update: {},
    create: { code: "DEMO", name: "Demo Organisation" },
  });

  const site = await prisma.site.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "HQ" } },
    update: {},
    create: {
      organizationId: org.id,
      code: "HQ",
      name: "Head Office Camp",
      timezone: "Asia/Dubai",
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      organizationId: org.id,
      email: "admin@example.com",
      name: "System Administrator",
      passwordHash: placeholderHash("ChangeMe123!"),
      status: "ACTIVE",
    },
  });
  // Composite unique keys containing NULL cannot be matched by upsert.
  const existingAdminRole = await prisma.roleAssignment.findFirst({
    where: { userId: admin.id, role: Role.SYSTEM_ADMIN, siteId: null, buildingId: null },
  });
  if (!existingAdminRole) {
    await prisma.roleAssignment.create({ data: { userId: admin.id, role: Role.SYSTEM_ADMIN } });
  }

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
        create: { buildingId: building.id, code: roomCode, capacity: b.bedsPerRoom, type: b.bedsPerRoom > 1 ? "SHARED" : "SINGLE" },
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
  const requestTypes: Array<{ code: string; name: string; fields: Prisma.InputJsonObject[] }> = [
    {
      code: "ROOM_CHANGE",
      name: "Room change request",
      fields: [
        { name: "reason", label: "Reason for change", type: "textarea", required: true },
        { name: "preferredBuilding", label: "Preferred building", type: "text", required: false },
        { name: "effectiveDate", label: "Requested effective date", type: "date", required: true },
      ],
    },
    {
      code: "VISITOR_STAY",
      name: "Visitor stay request",
      fields: [
        { name: "visitorName", label: "Visitor name", type: "text", required: true },
        { name: "relationship", label: "Relationship", type: "text", required: true },
        { name: "arrivalDate", label: "Arrival date", type: "date", required: true },
        { name: "departureDate", label: "Departure date", type: "date", required: true },
      ],
    },
    {
      code: "FAMILY_ACCOMMODATION",
      name: "Family accommodation request",
      fields: [
        { name: "familyMembers", label: "Number of family members", type: "number", required: true },
        { name: "justification", label: "Justification", type: "textarea", required: true },
      ],
    },
    {
      code: "EXIT_CLEARANCE",
      name: "Exit clearance",
      fields: [
        { name: "lastWorkingDay", label: "Last working day", type: "date", required: true },
        { name: "forwardingContact", label: "Forwarding contact", type: "text", required: false },
      ],
    },
  ];

  for (const rt of requestTypes) {
    const type = await prisma.requestType.upsert({
      where: { organizationId_code: { organizationId: org.id, code: rt.code } },
      update: { name: rt.name },
      create: { organizationId: org.id, code: rt.code, name: rt.name },
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
