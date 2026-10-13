import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageArgs, toPaged } from "../src/lib/paging";

describe("paging", () => {
  it("defaults to the first page of the default size", () => {
    expect(pageArgs()).toEqual({ skip: 0, take: DEFAULT_PAGE_SIZE, page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });
  it("computes skip from page and size", () => {
    expect(pageArgs({ page: 3, pageSize: 20 })).toMatchObject({ skip: 40, take: 20, page: 3 });
  });
  it("clamps nonsense", () => {
    expect(pageArgs({ page: 0, pageSize: 0 })).toMatchObject({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(pageArgs({ page: -4, pageSize: 100000 })).toMatchObject({ page: 1, pageSize: MAX_PAGE_SIZE });
    expect(pageArgs({ page: Number.NaN, pageSize: Number.NaN })).toMatchObject({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });
  it("reports the page count, with at least one page for an empty list", () => {
    expect(toPaged([], 0, { page: 1, pageSize: 50 }).pages).toBe(1);
    expect(toPaged(new Array(50), 101, { page: 1, pageSize: 50 }).pages).toBe(3);
  });
});
