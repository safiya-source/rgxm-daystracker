"use client";

import { useActionState } from "react";
import { cancelRequest, withdrawLieu } from "./actions";

export function CancelButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelRequest, null);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Cancel this request? Any approved days go back to your balance.")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-sm font-medium text-muted hover:text-danger disabled:opacity-50">
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {state?.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

export function WithdrawLieuButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(withdrawLieu, null);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Withdraw this lieu submission?")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-sm font-medium text-muted hover:text-danger">Withdraw</button>
      {state?.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
