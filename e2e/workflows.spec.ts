import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "rgxm-demo-2026";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay(); // 0 = Sun
const prev = (d: string, day: number) => { let x = addDays(d, -1); while (dow(x) !== day) x = addDays(x, -1); return x; };
const next = (d: string, day: number) => { let x = addDays(d, 1); while (dow(x) !== day) x = addDays(x, 1); return x; };

async function go(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" }); // wait for hydration before typing into controlled inputs
}

async function signIn(page: Page, who: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=email]", `${who}@demo.rgxm.test`);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/);
}

test("employee logs lieu, manager approves, balance updates", async ({ page }) => {
  const sunday = addDays(prev(today, 6), 1); // most recent weekend (Lena has no entry on it)
  await signIn(page, "lena");
  await go(page, "/lieu/new");
  await page.selectOption("select[name=project_id]", { label: "Taco Bell – Diablo Maple" });
  await page.fill("input[name=work_date]", sunday);
  await page.fill("input[name=hours]", "3");
  await page.getByRole("button", { name: "Add another date" }).click();
  await page.locator("input[name=work_date]").nth(1).fill(addDays(sunday, -1));
  await page.locator("input[name=hours]").nth(1).fill("6");
  await expect(page.getByText("Total proposed lieu:")).toContainText("1.5 days");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.waitForURL(/time-off\?lieu=1/);
  await expect(page.getByText("Lieu time submitted for approval")).toBeVisible();

  await signIn(page, "ava"); // Lena's manager
  await go(page, "/leadership/lieu");
  const card = page.locator("div.rounded-2xl", { hasText: "Lena Novak" }).filter({ hasText: "Approve 1.5 days" }).first();
  await card.getByRole("button", { name: "Approve 1.5 days" }).click();
  // Approved items leave the queue and appear under "Recently reviewed".
  await expect(page.locator("tr", { hasText: "Lena Novak" }).filter({ hasText: "Approved" }).first()).toBeVisible();

  await signIn(page, "lena");
  await go(page, "/dashboard");
  await expect(page.locator("text=Lieu time").locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]")).toContainText("2.5");
});

test("vacation request → approval → booked; colleagues see only 'away'", async ({ page }) => {
  const day = next(addDays(today, 21), 3); // a Wednesday ~3 weeks out
  await signIn(page, "noah");
  await go(page, "/time-off/request");
  await page.fill("input[name=start_date]", day);
  await page.fill("textarea[name=note]", "Dentist — private");
  await expect(page.getByText("You're requesting")).toBeVisible();
  await page.getByRole("button", { name: /Submit request · 1 day/ }).click();
  await page.waitForURL(/time-off\?submitted=1/);

  await signIn(page, "marcus");
  await go(page, "/leadership/requests");
  const card = page.locator("div.rounded-2xl", { hasText: "Noah Williams" }).first();
  await expect(card).toContainText("Dentist");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("tr", { hasText: "Noah Williams" }).filter({ hasText: "Approved" }).first()).toBeVisible();

  await signIn(page, "noah");
  await page.goto("/time-off");
  await expect(page.getByText("Booked (approved, upcoming)").locator("..")).toContainText("1 day");

  // A colleague sees Noah on the calendar without type or note.
  await signIn(page, "lena");
  await page.goto(`/calendar?view=week&date=${day}`);
  await expect(page.getByText("Noah W.").first()).toBeVisible();
  await expect(page.getByText("Dentist")).toHaveCount(0);
});

test("employees cannot open leadership pages", async ({ page }) => {
  await signIn(page, "sam");
  for (const path of ["/leadership/employees", "/leadership/reports", "/leadership/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/dashboard/);
  }
  const res = await page.request.get("/leadership/reports/export?type=vacation");
  expect(res.status()).toBe(403);
});

test("People Admin adds an employee with their own entitlement", async ({ page }) => {
  await signIn(page, "jordan");
  await page.goto("/leadership/employees/new");
  await page.fill("input[name=full_name]", "Riley Test");
  await page.fill("input[name=work_email]", `riley.${Date.now()}@demo.rgxm.test`);
  await page.fill("input[name=job_title]", "Designer");
  await page.fill("input[name=start_date]", "2024-02-05");
  await page.fill("input[name=annual_days]", "8");
  await expect(page.getByText(/Below the Ontario ESA minimum of 10 days/)).toBeVisible();
  await page.fill("input[name=annual_days]", "12");
  await page.fill("input[name=opening_vacation]", "4.5");
  await page.getByRole("button", { name: "Add employee" }).click();
  await page.waitForURL(/leadership\/employees\/.+saved=1/);
  await expect(page.getByText("12 days / year")).toBeVisible();
  await expect(page.getByText("Not invited yet")).toBeVisible();
});

test("CSV export works for People Admins", async ({ page }) => {
  await signIn(page, "jordan");
  const res = await page.request.get("/leadership/reports/export?type=vacation");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("Employee,Status,Annual entitlement");
  expect(body).toContain("Sam Okafor");
});
