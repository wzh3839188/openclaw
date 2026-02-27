/**
 * Types for habit storage (USER_HABITS.yaml).
 * See user_habit_plan.md §7.1.
 */

export type HabitEntry = {
  intent: string;
  result: string;
  updatedAt: number;
  source?: "realtime" | "nightly";
  alias?: string[];
};

export type HabitEntryRaw = {
  intent: string;
  result: string;
  updatedAt: number | string;
  source?: string;
  alias?: string[];
};
