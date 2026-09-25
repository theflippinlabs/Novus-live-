import type { Permission } from "../shared/types";
import { api } from "./api";
import { getState, setState, useStore, visible } from "./store";

/** Load who is logged in (founder or team member). */
export async function loadMe(): Promise<void> {
  try {
    setState({ me: await api.me() });
    setState({ rooms: visible(getState().rooms) });
  } catch {
    /* offline: keep the last known */
  }
}

/** Whether the logged-in person may do this (the server checks it too). */
export function useCan(perm: Permission): boolean {
  return useStore((s) => !s.me || s.me.permissions.includes(perm));
}

export function useIsFounder(): boolean {
  return useStore((s) => !s.me || s.me.kind === "founder");
}

/** Streamers this person is limited to (null = all). */
export function useScope(): string[] | null {
  return useStore((s) => s.me?.accounts ?? null);
}
