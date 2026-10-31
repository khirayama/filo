import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAppData } from "./AppDataContext";
import { Button, useDialogFocus } from "./ui";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel: string;
  // Some names clear back to a default; others must not be empty.
  allowEmpty?: boolean;
}

interface CopyOptions {
  title: string;
  value: string;
}

type DialogRequest =
  | ({ kind: "confirm"; resolve: (confirmed: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions)
  | ({ kind: "copy"; resolve: () => void } & CopyOptions);

interface Dialogs {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  showCopyable: (options: CopyOptions) => Promise<void>;
}

const DialogsContext = createContext<Dialogs | null>(null);

// One modal at a time for the whole app, awaited at the call site so a flow
// reads top to bottom. iOS and Android show the same dialogs natively.
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const nextKey = useRef(0);
  const key = useRef(0);

  const open = useCallback((next: DialogRequest) => {
    key.current = ++nextKey.current;
    setRequest(next);
  }, []);

  const dialogs = useMemo<Dialogs>(() => ({
    confirm: (options) => new Promise((resolve) => open({ kind: "confirm", ...options, resolve })),
    prompt: (options) => new Promise((resolve) => open({ kind: "prompt", ...options, resolve })),
    showCopyable: (options) => new Promise((resolve) => open({ kind: "copy", ...options, resolve })),
  }), [open]);

  return (
    <DialogsContext.Provider value={dialogs}>
      {children}
      {request ? <AppDialog key={key.current} request={request} onDone={() => setRequest(null)} /> : null}
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const value = useContext(DialogsContext);
  if (!value) throw new Error("useDialogs must be used within DialogsProvider");
  return value;
}

const DIALOG_ID = "filo-app-dialog";

function AppDialog({ request, onDone }: { request: DialogRequest; onDone: () => void }) {
  const { t } = useAppData();
  const [value, setValue] = useState(request.kind === "prompt" ? request.initialValue : "");

  const cancel = useCallback(() => {
    if (request.kind === "confirm") request.resolve(false);
    else if (request.kind === "prompt") request.resolve(null);
    else request.resolve();
    onDone();
  }, [onDone, request]);

  useDialogFocus(true, DIALOG_ID, cancel);
  // Enter confirms a harmless action straight away; a destructive one stays on
  // Cancel, the first control, until it is chosen deliberately.
  useEffect(() => {
    const container = document.getElementById(DIALOG_ID);
    if (request.kind === "confirm" && !request.danger) container?.querySelector<HTMLElement>(".fl-btn--primary")?.focus();
    if (request.kind === "prompt" || request.kind === "copy") container?.querySelector<HTMLInputElement>("input")?.select();
  }, [request]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (request.kind === "confirm") request.resolve(true);
    else if (request.kind === "prompt") {
      if (!request.allowEmpty && !value.trim()) return;
      request.resolve(value.trim());
    } else {
      void navigator.clipboard?.writeText(request.value).catch(() => undefined);
      request.resolve();
    }
    onDone();
  };

  const confirmLabel = request.kind === "copy" ? t("コピー") : request.confirmLabel;
  const confirmDisabled = request.kind === "prompt" && !request.allowEmpty && !value.trim();

  return (
    <div
      role="dialog"
      id={DIALOG_ID}
      aria-modal="true"
      aria-labelledby={`${DIALOG_ID}-title`}
      className="fl-dialog-scrim"
      onClick={cancel}
    >
      <form className="fl-dialog" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="fl-dialog-header">
          <h2 id={`${DIALOG_ID}-title`}>{request.title}</h2>
        </div>
        {request.kind === "confirm" && request.message ? <p className="fl-dialog-message">{request.message}</p> : null}
        {request.kind === "prompt" ? (
          <input
            type="text"
            className="fl-input"
            aria-label={request.title}
            placeholder={request.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            style={{ width: "100%" }}
          />
        ) : null}
        {request.kind === "copy" ? (
          <input type="text" className="fl-input" aria-label={request.title} readOnly value={request.value} style={{ width: "100%" }} />
        ) : null}
        <div className="fl-dialog-actions">
          <Button onClick={cancel}>{request.kind === "copy" ? t("閉じる") : t("キャンセル")}</Button>
          <Button type="submit" kind={request.kind === "confirm" && request.danger ? "danger" : "primary"} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
