import { createContext, useContext } from "react";

import type { QuickAddValues } from "./transactionForm";

export type OpenQuickAdd = (prefill?: Partial<QuickAddValues>) => void;

export const QuickAddContext = createContext<OpenQuickAdd>(() => {});

/** Open Quick add from any page, optionally pre-filled (e.g. a card's "Pay bill"). */
export const useQuickAdd = () => useContext(QuickAddContext);
