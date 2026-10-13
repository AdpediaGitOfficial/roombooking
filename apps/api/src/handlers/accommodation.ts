import type { ApiContract } from "@sam/contract/index";
import { AccommodationError } from "@sam/core/modules/accommodation/errors";
import { getBuildingOccupancy, getRoomOccupancy, getSitesOverview } from "@sam/core/modules/accommodation/occupancy";
import { addBeds, setBedStatus, setRoomStatus } from "@sam/core/modules/accommodation/service";
import type { Handlers } from "../register";

export const accommodationHandlers: Handlers<ApiContract>["accommodation"] = {
  overview: () => getSitesOverview(),
  async building(_ctx, input) {
    const building = await getBuildingOccupancy(input.buildingId);
    if (!building) throw new AccommodationError("NOT_FOUND", "Building not found.");
    return building;
  },
  async room(_ctx, input) {
    const room = await getRoomOccupancy(input.roomId);
    if (!room) throw new AccommodationError("NOT_FOUND", "Room not found.");
    return room;
  },
  addBeds: (ctx, input) => addBeds({ actorId: ctx.user.id, roomId: input.roomId, count: input.count }),
  setBedStatus: (ctx, input) => setBedStatus({ actorId: ctx.user.id, bedId: input.bedId, status: input.status, reason: input.reason }),
  setRoomStatus: (ctx, input) => setRoomStatus({ actorId: ctx.user.id, roomId: input.roomId, status: input.status, reason: input.reason }),
};
