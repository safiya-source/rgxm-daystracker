"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button } from "@/components/ui";

export type ActionResult = { error?: string; message?: string } | null;

export function SubmitButton({ children, pendingText, ...props }: React.ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingText ?? "Saving…" : children}
    </Button>
  );
}

/** A form bound to a server action that returns { error } or { message }. */
export function ActionForm({
  action, children, className, resetOnSuccess, onSuccess,
}: {
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.message) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
  }, [state, resetOnSuccess, onSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {state?.error && <Alert tone="danger" className="mb-4">{state.error}</Alert>}
      {state?.message && <Alert tone="ok" className="mb-4">{state.message}</Alert>}
      {children}
    </form>
  );
}
