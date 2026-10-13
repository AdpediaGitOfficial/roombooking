import { describe, expect, it } from "vitest";
import { classifyBed, summarize, todayInTimezone, type BedLike } from "../src/modules/accommodation/occupancy";

const staff = (n: number) => ({ id: `s${n}`, employeeId: `E${n}`, firstName: "Staff", lastName: String(n) });
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const bed = (over: Partial<BedLike> = {}): BedLike => ({
  id: "b1",
  code: "A-01-1",
  status: "ACTIVE",
  blockReason: null,
  allocations: [],
  ...over,
});
const TODAY = "2026-10-12";

describe("classifyBed", () => {
  it("is vacant with no allocations", () => {
    const v = classifyBed(bed(), TODAY);
    expect(v.state).toBe("VACANT");
    expect(v.occupant).toBeNull();
  });

  it("is occupied when someone is checked in", () => {
    const v = classifyBed(
      bed({ allocations: [{ id: "a1", status: "CHECKED_IN", startDate: d("2026-10-01"), endDate: null, staff: staff(1) }] }),
      TODAY,
    );
    expect(v.state).toBe("OCCUPIED");
    expect(v.occupant?.name).toBe("Staff 1");
    expect(v.since).toBe("2026-10-01");
    expect(v.until).toBeNull();
  });

  it("is allocated (awaiting check-in) when a confirmed allocation has started", () => {
    const v = classifyBed(
      bed({ allocations: [{ id: "a1", status: "CONFIRMED", startDate: d(TODAY), endDate: d("2026-12-31"), staff: staff(2) }] }),
      TODAY,
    );
    expect(v.state).toBe("ALLOCATED");
    expect(v.until).toBe("2026-12-31");
  });

  it("stays vacant today when the confirmed allocation is future-dated, but reports the arrival", () => {
    const v = classifyBed(
      bed({ allocations: [{ id: "a1", status: "CONFIRMED", startDate: d("2026-11-01"), endDate: null, staff: staff(3) }] }),
      TODAY,
    );
    expect(v.state).toBe("VACANT");
    expect(v.upcoming?.startDate).toBe("2026-11-01");
    expect(v.upcoming?.occupant.employeeId).toBe("E3");
  });

  it("treats an allocation whose end date is today as finished (end exclusive)", () => {
    const v = classifyBed(
      bed({ allocations: [{ id: "a1", status: "CONFIRMED", startDate: d("2026-09-01"), endDate: d(TODAY), staff: staff(4) }] }),
      TODAY,
    );
    expect(v.state).toBe("VACANT");
  });

  it("ignores cancelled, rejected and checked-out allocations", () => {
    const v = classifyBed(
      bed({
        allocations: [
          { id: "a1", status: "CANCELLED", startDate: d("2026-10-01"), endDate: null, staff: staff(5) },
          { id: "a2", status: "CHECKED_OUT", startDate: d("2026-01-01"), endDate: d("2026-09-01"), staff: staff(6) },
        ],
      }),
      TODAY,
    );
    expect(v.state).toBe("VACANT");
  });

  it("reports blocked and retired configuration when nobody holds the bed", () => {
    expect(classifyBed(bed({ status: "BLOCKED", blockReason: "Repair" }), TODAY).state).toBe("BLOCKED");
    expect(classifyBed(bed({ status: "RETIRED" }), TODAY).state).toBe("RETIRED");
  });

  it("keeps an occupant visible on a blocked bed", () => {
    const v = classifyBed(
      bed({
        status: "BLOCKED",
        blockReason: "Repair",
        allocations: [{ id: "a1", status: "CHECKED_IN", startDate: d("2026-10-01"), endDate: null, staff: staff(7) }],
      }),
      TODAY,
    );
    expect(v.state).toBe("OCCUPIED");
    expect(v.status).toBe("BLOCKED");
  });

  it("marks unoccupied beds blocked when the room is not active", () => {
    const v = classifyBed(bed(), TODAY, "BLOCKED");
    expect(v.state).toBe("BLOCKED");
    expect(v.blockReason).toBe("Room not in service");
  });
});

describe("summarize", () => {
  it("counts capacity, occupied, vacant, blocked and retired per bed", () => {
    const beds: BedLike[] = [
      bed({ id: "1", code: "R-1", allocations: [{ id: "a1", status: "CHECKED_IN", startDate: d("2026-10-01"), endDate: null, staff: staff(1) }] }),
      bed({ id: "2", code: "R-2", allocations: [{ id: "a2", status: "CONFIRMED", startDate: d(TODAY), endDate: null, staff: staff(2) }] }),
      bed({ id: "3", code: "R-3", allocations: [{ id: "a3", status: "CONFIRMED", startDate: d("2026-11-01"), endDate: null, staff: staff(3) }] }),
      bed({ id: "4", code: "R-4", status: "BLOCKED", blockReason: "Repair" }),
      bed({ id: "5", code: "R-5", status: "RETIRED" }),
      bed({ id: "6", code: "R-6" }),
    ];
    const s = summarize(beds.map((b) => classifyBed(b, TODAY)));
    expect(s).toEqual({
      capacity: 5,
      occupied: 2,
      checkedIn: 1,
      awaitingCheckIn: 1,
      vacant: 2,
      blocked: 1,
      retired: 1,
      upcomingArrivals: 1,
    });
  });
});

describe("todayInTimezone", () => {
  it("returns the site-local calendar date", () => {
    const instant = new Date("2026-10-12T22:30:00.000Z");
    expect(todayInTimezone("UTC", instant)).toBe("2026-10-12");
    expect(todayInTimezone("Asia/Dubai", instant)).toBe("2026-10-13");
    expect(todayInTimezone("not/a-zone", instant)).toBe("2026-10-12");
  });
});
