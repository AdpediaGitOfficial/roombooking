// Generates a realistic data volume (about 650 residents, 800 beds, 3,000 tickets,
// 12,000 notifications, 40,000 audit events) for load testing.
//
// Run it on a COPY of the schema, never on production: create a database whose
// name ends in _load, migrate and seed it, point DATABASE_URL at it, then run
//   npm run loadtest:data
// It refuses to run against any other database.
const dbName = (process.env.DATABASE_URL ?? "").split("?")[0].split("/").pop();
if (!dbName?.endsWith("_load") && process.env.ALLOW_LOAD_DATA !== "1") {
  console.error(`Refusing to generate load data in database "${dbName}". Use a database whose name ends in _load.`);
  process.exit(1);
}
const { PrismaClient } = require("@prisma/client");
const { randomBytes } = require("node:crypto");
const prisma = new PrismaClient();
const cuid = () => "c" + randomBytes(12).toString("hex");
const pick = (a, i) => a[i % a.length];
const chunk = async (rows, fn, n = 1000) => { for (let i = 0; i < rows.length; i += n) await fn(rows.slice(i, i + n)); };

(async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { code: "DEMO" } });
  const site = await prisma.site.findFirstOrThrow({ where: { organizationId: org.id } });
  const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@example.com" } });
  const staffUser = await prisma.user.findFirstOrThrow({ where: { email: "staff@example.com" } });
  const hash = staffUser.passwordHash;

  // Buildings, rooms, beds: 10 x 20 x 4 = 800 beds
  const buildings = [], rooms = [], beds = [];
  for (let b = 0; b < 10; b++) {
    const bid = cuid(); buildings.push({ id: bid, siteId: site.id, code: `LB${b}`, name: `Load Block ${b}` });
    for (let r = 0; r < 20; r++) {
      const rid = cuid(); rooms.push({ id: rid, buildingId: bid, code: `LB${b}-${String(r + 1).padStart(2, "0")}`, floor: String(1 + (r % 4)), genderPolicy: "ANY" });
      for (let k = 0; k < 4; k++) beds.push({ id: cuid(), roomId: rid, code: `LB${b}-${String(r + 1).padStart(2, "0")}-${k + 1}` });
    }
  }
  await prisma.building.createMany({ data: buildings });
  await prisma.room.createMany({ data: rooms });
  await prisma.bed.createMany({ data: beds });

  // 650 residents with accounts, staff profiles and roles
  const users = [], profiles = [], roles = [];
  for (let i = 0; i < 650; i++) {
    const uid = cuid();
    users.push({ id: uid, organizationId: org.id, email: `load${i}@example.com`, name: `Load Resident ${i}`, passwordHash: hash, status: "ACTIVE" });
    profiles.push({ id: cuid(), organizationId: org.id, userId: uid, employeeId: `LD${String(i).padStart(5, "0")}`, firstName: "Load", lastName: `Resident${i}`, department: pick(["Ops", "Finance", "HR", "Engineering"], i), gender: "ANY" });
    roles.push({ id: cuid(), userId: uid, role: "STAFF" });
  }
  await chunk(users, (d) => prisma.user.createMany({ data: d }));
  await chunk(profiles, (d) => prisma.staffProfile.createMany({ data: d }));
  await chunk(roles, (d) => prisma.roleAssignment.createMany({ data: d }));

  // 600 residents checked in
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 60 * 86400000);
  const allocations = profiles.slice(0, 600).map((p, i) => ({ id: cuid(), staffId: p.id, bedId: beds[i].id, startDate: start, status: "CHECKED_IN", checkedInAt: start, createdById: admin.id }));
  await chunk(allocations, (d) => prisma.allocation.createMany({ data: d }));

  // 3,000 maintenance tickets, 4,000 notes
  const statuses = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED", "CLOSED", "CLOSED"];
  const cats = ["Electrical", "Plumbing", "Air conditioning", "Furniture", "Cleaning"];
  const tickets = [];
  for (let i = 0; i < 3000; i++) {
    const st = pick(statuses, i);
    const created = new Date(Date.now() - (i % 120) * 86400000);
    tickets.push({ id: cuid(), ticketNumber: `LD-${String(i).padStart(6, "0")}`, siteId: site.id, buildingId: buildings[i % 10].id, roomId: rooms[i % 200].id, category: pick(cats, i), description: `Load ticket ${i}: something needs attention in the room.`, priority: pick(["LOW", "MEDIUM", "HIGH", "URGENT"], i), status: st, requesterId: users[i % 650].id, slaDueAt: new Date(created.getTime() + 72 * 3600000), createdAt: created, resolvedAt: ["RESOLVED", "CLOSED"].includes(st) ? new Date(created.getTime() + 20 * 3600000) : null });
  }
  await chunk(tickets, (d) => prisma.workOrder.createMany({ data: d }));
  const notes = [];
  for (let i = 0; i < 4000; i++) notes.push({ id: cuid(), workOrderId: tickets[i % 3000].id, authorId: i % 3 === 0 ? admin.id : users[i % 650].id, note: `Update ${i}`, internal: i % 5 === 0 });
  await chunk(notes, (d) => prisma.workOrderNote.createMany({ data: d }));

  // Notifications: 9,000 in-app, 3,000 email
  const notifs = [];
  for (let i = 0; i < 12000; i++) {
    const inApp = i < 9000;
    notifs.push({ id: cuid(), recipientId: users[i % 650].id, channel: inApp ? "IN_APP" : "EMAIL", event: "maintenance.received", template: "maintenance.received", payload: { n: i }, idempotencyKey: `load:${i}`, status: inApp ? "DELIVERED" : "SENT", readAt: inApp && i % 3 ? new Date() : null, createdAt: new Date(Date.now() - (i % 90) * 86400000) });
  }
  await chunk(notifs, (d) => prisma.notification.createMany({ data: d }));

  // 40,000 audit events
  const audit = [];
  for (let i = 0; i < 40000; i++) audit.push({ id: cuid(), actorId: i % 2 ? admin.id : users[i % 650].id, action: pick(["ALLOCATION_CREATED", "WORK_ORDER_CREATED", "LOGIN_SUCCESS", "BED_STATUS_CHANGED"], i), entityType: pick(["Allocation", "WorkOrder", "User", "Bed"], i), entityId: cuid(), createdAt: new Date(Date.now() - (i % 200) * 86400000) });
  await chunk(audit, (d) => prisma.auditEvent.createMany({ data: d }), 2000);

  // 800 keys with transactions
  const keys = rooms.slice(0, 200).map((r, i) => ({ id: cuid(), siteId: site.id, code: `LK-${i}`, roomId: r.id, status: i % 2 ? "ISSUED" : "AVAILABLE" }));
  await prisma.key.createMany({ data: keys });
  const ktx = keys.filter((k) => k.status === "ISSUED").map((k, i) => ({ id: cuid(), keyId: k.id, type: "ISSUE", holderId: profiles[i].id, custodianId: admin.id, expectedReturnAt: new Date(Date.now() + 30 * 86400000) }));
  await prisma.keyTransaction.createMany({ data: ktx });

  const counts = { users: await prisma.user.count(), allocations: await prisma.allocation.count(), workOrders: await prisma.workOrder.count(), notifications: await prisma.notification.count(), audit: await prisma.auditEvent.count() };
  console.log(counts);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
