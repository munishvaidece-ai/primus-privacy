import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The standard shadcn/ui class-merging helper (ARCHITECTURE.md §2: Tailwind
// + shadcn/ui). Not client- or server-only — used from both.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
