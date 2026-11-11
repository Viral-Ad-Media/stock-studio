"use client";

import { Bell } from "lucide-react";
import { usePwa } from "./PwaProvider";

export default function OpenPushSettingsButton({
  label = "Push alerts & offline",
}: {
  label?: string;
}) {
  const { setSettingsOpen } = usePwa();
  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      className="btn-secondary px-3.5 py-2 text-sm"
    >
      <Bell className="h-4 w-4 text-emerald-400" aria-hidden />
      {label}
    </button>
  );
}
