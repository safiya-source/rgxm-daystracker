# RGXM People: business rules (Phase 1)

This file records every rule the app uses to calculate balances. It covers the
decisions RGXM made during planning and the defaults used where the spec was
silent. Anything marked **configurable** can be changed in **Settings** without
a code change.

> RGXM People tracks entitlements and balances. It is **not** legal advice and does
> not make Employment Standards Act (ESA) compliance determinations. Where a case is
> uncertain, the app flags it for People Admin review.

## Decisions confirmed by RGXM

| Topic | Decision |
|---|---|
| Manager visibility | Managers **see the balances** of the people they approve, on the approval screen and their profile. They do not see contract entitlements or ledgers, and they can't see anyone outside their approval scope. |
| Public holidays | The **9 Ontario ESA holidays** only. There is no December shutdown for now. Admins can add closure days later (Settings → Holidays). |
| "Preceding week" lieu rule | Only an **advance lieu day** reduces a credit: time off given ahead of a project ("long week, take Wednesday off"). **Banked lieu and approved PTO never reduce** the credit owed. |
| Admins | There are three People Admins. A People Admin's own requests go to their **assigned approver** (e.g. the owner). Other admins can't approve them, unless that admin has no approver assigned. The owner's own approver is another admin. |

## Vacation

- **Entitlements are per employee** and effective-dated. A change takes effect from its date, and earlier history is kept.
- **Vacation year:** calendar year (Jan 1–Dec 31) or employment-anniversary year, set per employee.
- **Upfront allocation:** the full year's entitlement is added on the first day of the vacation year.
  - New hires get a prorated first year: entitlement × days remaining ÷ days in the year, **rounded up to the nearest half day**.
  - When the entitlement changes mid-year, the rest of the year is trued up the same way.
- **Progressive accrual:** entitlement ÷ 12 is added at the end of each completed month. A partial first month is prorated by calendar days. Rounding is cumulative, so 12 months always add up to exactly the entitlement.
- **Opening balances:**
  - For people already employed when RGXM People goes live, enter the vacation they have available on the "balances as of" date, plus any carryover.
  - The current year's allocation is assumed to be included in that number. Upfront allocation resumes next year; accrual continues from that date.
  - People hired this year are treated as new hires and prorated automatically.
- **Pending requests** don't reduce the balance. They are shown as "pending" and "available after pending".
- **Approved requests** reduce the available balance immediately, including future dates ("booked").
- **Cancelling** an approved request adds a reversal; nothing is ever deleted.
- **Insufficient balance:** the employee is warned but can still submit. Approval is blocked unless "Allow negative vacation balances" is on (**configurable**).
- **Carryover:** unlimited by default. If a cap is set (**configurable**), anything above it is forfeited when the year closes, and the forfeit is recorded in the ledger.
  - Note: the ESA requires vacation to be taken within 10 months after the year it was earned in.
- **ESA minimum:** 10 days under 5 years of service, 15 days from 5 years. The employee form warns when an entitlement is below this and flags people approaching their 5-year mark. It doesn't block the save.
- **Vacation pay** (4% / 6%) is a payroll matter and is not calculated here.

## Day counting

- Only **working days** count (default Mon–Fri, **configurable**).
- Public holidays and closure days are excluded.
- When a statutory holiday falls on a weekend, an **"(observed)" day off** is added on the next working day (ESA substitute holiday). Admins can remove it.
- **Half days** (morning or afternoon) are allowed on single-day requests only and count as 0.5 (**configurable** on/off).
- **Overlap:** an employee can't have two pending or approved requests on the same day. A morning and an afternoon half-day on the same date is allowed.
- **Holiday changes:** adding or removing a holiday doesn't recalculate requests that are already approved. Adjust those manually if needed.

## Lieu time (RGXM internal guidelines, **configurable** and versioned)

| Day type | Hours that day | Proposed credit |
|---|---|---|
| Weekend / non-working day | under 2 | 0 |
| | 2 to under 4 | 0.5 |
| | 4 or more | 1 |
| Workday (total hours worked) | under 10 | 0 |
| | 10 to 12 (inclusive) | 0.5 |
| | over 12 | 0.5, flagged **Needs review** |
| Public holiday | any | 1, as **statutory** time, flagged for People Admin review |

- Each date is calculated on its own, and the dates are summed.
- Rule changes create a **new version effective from a date**. Each work entry stores the version it was calculated with, so history never changes.
- **One claim per employee per date**, enforced by the database, including bulk entry and simultaneous submissions.
- Days can only be logged once they've happened.
- Approvers can **approve, decline, request changes, or adjust** each day's credit (0–2 days in half-day steps). An adjustment requires a reason. Every action is recorded.
- **Bulk entry** (People Admins) credits eligible days immediately. Flagged days, and an admin's own credits, go to the approval queue instead.
- **Advance lieu days** are deducted when approved and may take the lieu balance below zero. The later project credit is approved in full, and the advance day nets it out. Reviewers see any advance days for the project when they approve.
- **Statutory vs discretionary:** credits for public-holiday work are kept in a separate "statutory" balance and are used separately.
- **Expiry:** off by default. If enabled (**configurable**, months), unused *discretionary* lieu expires oldest-first. Statutory time never expires automatically.
- These rules are **not** an ESA overtime calculation. The simple form doesn't capture enough to determine statutory overtime, and the app never treats salaried staff as exempt.

## Approvals & permissions

- Requests go to the employee's **assigned manager** and **backup approver**. If neither is set, they go to People Admins.
- Nobody can approve their own request, **unless** a People Admin turns on *"Allow them to approve their own requests"* for that person (employee page → Approvals). RGXM uses this for Safiya, alongside her assigned approver (Rich Gaggi). Self-approvals are recorded in the request history like any other approval.
- People Admins can approve anyone, except other People Admins (see above).
- Approvals lock the request row, so two approvers acting at once produce exactly one outcome.
- **Employees** see only their own profile, balances, requests and history.
  - On the team calendar, colleagues appear as **name + "away" + dates** only: no leave type, no notes, no pending requests.
- **Deactivating** an employee:
  - disables their sign-in;
  - withdraws their open requests;
  - keeps all of their history.

## Tenure & anniversaries

- Tenure is shown in completed years and months.
  - A month-end date completes a month (Jan 31 → Feb 28 = 1 month).
- Anniversaries for **Feb 29 start dates fall on Feb 28** in common years.
- Anniversary reminders go to People Admins and the employee's manager at **30, 7 and 0 days** (**configurable**).
