import { z } from "zod";
import { ACCOMMODATION_MANAGE_ROLES, ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import type * as occupancy from "@sam/core/modules/accommodation/occupancy";
import { cuid, int, op, out } from "../define";

export const accommodation = {
  overview: op({
    id: "accommodation.overview",
    method: "GET",
    path: "/v1/accommodation/sites",
    summary: "Every site with its buildings and bed occupancy",
    tag: "Accommodation",
    access: ACCOMMODATION_VIEW_ROLES,
    input: z.object({}),
    output: out<Awaited<ReturnType<typeof occupancy.getSitesOverview>>>(),
  }),
  building: op({
    id: "accommodation.building",
    method: "GET",
    path: "/v1/accommodation/buildings/:buildingId",
    summary: "One building with its rooms, beds and occupants",
    tag: "Accommodation",
    access: ACCOMMODATION_VIEW_ROLES,
    input: z.object({ buildingId: cuid() }),
    output: out<NonNullable<Awaited<ReturnType<typeof occupancy.getBuildingOccupancy>>>>(),
  }),
  room: op({
    id: "accommodation.room",
    method: "GET",
    path: "/v1/accommodation/rooms/:roomId",
    summary: "One room with its beds and occupants",
    tag: "Accommodation",
    access: ACCOMMODATION_VIEW_ROLES,
    input: z.object({ roomId: cuid() }),
    output: out<NonNullable<Awaited<ReturnType<typeof occupancy.getRoomOccupancy>>>>(),
  }),
  addBeds: op({
    id: "accommodation.addBeds",
    method: "POST",
    path: "/v1/accommodation/rooms/:roomId/beds",
    summary: "Add numbered beds to a room",
    tag: "Accommodation",
    access: ACCOMMODATION_MANAGE_ROLES,
    input: z.object({ roomId: cuid(), count: int({ min: 1, max: 20, default: 1 }) }),
    output: out<{ buildingId: string; codes: string[]; message: string }>(),
  }),
  setBedStatus: op({
    id: "accommodation.setBedStatus",
    method: "PUT",
    path: "/v1/accommodation/beds/:bedId/status",
    summary: "Return a bed to service, block it (with a reason) or retire it",
    tag: "Accommodation",
    access: ACCOMMODATION_MANAGE_ROLES,
    input: z.object({ bedId: cuid(), status: z.enum(["ACTIVE", "BLOCKED", "RETIRED"]), reason: z.string().max(500).optional() }),
    output: out<{ roomId: string; buildingId: string; changed: boolean; message: string }>(),
  }),
  setRoomStatus: op({
    id: "accommodation.setRoomStatus",
    method: "PUT",
    path: "/v1/accommodation/rooms/:roomId/status",
    summary: "Return a room to service, block it or deactivate it (with a reason)",
    tag: "Accommodation",
    access: ACCOMMODATION_MANAGE_ROLES,
    input: z.object({ roomId: cuid(), status: z.enum(["ACTIVE", "BLOCKED", "INACTIVE"]), reason: z.string().max(500).optional() }),
    output: out<{ buildingId: string; message: string }>(),
  }),
};
