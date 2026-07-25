"use client";

import { createContext, useContext } from "react";

const GuestModeContext = createContext(false);

export function GuestModeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <GuestModeContext.Provider value={enabled}>
      {children}
    </GuestModeContext.Provider>
  );
}

export function useGuestMode() {
  return useContext(GuestModeContext);
}
