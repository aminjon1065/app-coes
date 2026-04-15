"use client";

import "sonner/dist/styles.css";
import { Toaster } from "sonner";

export function LiveToastProvider() {
  return (
    <Toaster
      position="top-right"
      expand
      richColors
      closeButton
      visibleToasts={5}
      toastOptions={{
        className:
          "!border !border-white/12 !bg-[rgba(10,16,28,0.94)] !text-slate-100 !shadow-[0_24px_80px_rgba(0,0,0,0.3)]",
        descriptionClassName: "!text-slate-400",
      }}
    />
  );
}
