"use client";
import { createContext, useContext } from "react";
import { formatMoney } from "@/lib/billing/money";

export interface PharmacyPerms { view: boolean; dispense: boolean; receive: boolean; purchase: boolean; medicines: boolean; suppliers: boolean; adjust: boolean; returnRequest: boolean; returnApprove: boolean; reports: boolean; configure: boolean }
const Ctx = createContext<{ currency: string; perms: PharmacyPerms }>({ currency: "INR", perms: { view: false, dispense: false, receive: false, purchase: false, medicines: false, suppliers: false, adjust: false, returnRequest: false, returnApprove: false, reports: false, configure: false } });
export const PharmacyProvider = ({ value, children }: { value: { currency: string; perms: PharmacyPerms }; children: React.ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const usePharmacy = () => useContext(Ctx);
export function useMoney() { const { currency } = usePharmacy(); return (minor: number) => formatMoney(minor, currency); }

export * from "./pharmacy-labels";
