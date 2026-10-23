"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { attempt, check, str } from "@/lib/actions";
import type { ActionResult } from "@/components/forms";
import type { Database } from "@/lib/database.types";

type Portion = Database["public"]["Enums"]["day_portion"];

export async function submitTimeOff(_: ActionResult, f: FormData): Promise<ActionResult> {
  const res = await attempt(async () => {
    const supabase = await createClient();
    const kind = str(f, "kind") === "lieu" ? "lieu" : "vacation";
    const portion = (str(f, "portion") || "full") as Portion;
    const start = str(f, "start_date");
    const end = portion === "full" ? str(f, "end_date") || start : start;
    if (!start) throw new Error("Choose a start date");
    check(await supabase.rpc("submit_time_off", {
      kind, start_date: start, end_date: end, portion,
      note: str(f, "note") || undefined,
      lieu_category: kind === "lieu" ? ((str(f, "lieu_category") || "discretionary") as "discretionary" | "statutory") : undefined,
      is_advance: str(f, "is_advance") === "on",
      project_id: str(f, "project_id") || undefined,
    }));
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect("/time-off?submitted=1");
}

export async function cancelRequest(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("cancel_time_off", { request_id: str(f, "id"), reason: str(f, "reason") || undefined }));
    revalidatePath("/", "layout");
    return "Request cancelled";
  });
}

export async function withdrawLieu(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("cancel_lieu_submission", { submission_id: str(f, "id") }));
    revalidatePath("/", "layout");
    return "Submission withdrawn";
  });
}

export async function submitLieu(_: ActionResult, f: FormData): Promise<ActionResult> {
  const res = await attempt(async () => {
    const supabase = await createClient();
    let projectId = str(f, "project_id");
    const newProject = str(f, "new_project");
    if (projectId === "__new" || (!projectId && newProject)) {
      if (!newProject) throw new Error("Name the new project");
      projectId = check(await supabase.rpc("create_project", { name: newProject })) ?? "";
    }
    if (!projectId) throw new Error("Choose a project");
    const dates = f.getAll("work_date").map(String);
    const hours = f.getAll("hours").map(String);
    const entries = dates
      .map((d, i) => ({ work_date: d, hours: Number(hours[i]) }))
      .filter((e) => e.work_date || e.hours);
    if (entries.some((e) => !e.work_date || !(e.hours > 0))) throw new Error("Each row needs a date and the hours you worked");
    check(await supabase.rpc("submit_lieu", {
      project_id: projectId, entries, note: str(f, "note") || undefined, resubmit_id: str(f, "resubmit_id") || undefined,
    }));
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect("/time-off?lieu=1");
}
