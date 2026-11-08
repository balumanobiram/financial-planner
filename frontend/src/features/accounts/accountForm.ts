/** Account form state + validation. Mirrors the backend's rules so most errors show before saving. */

import type { AccountType, BankAccount, BankAccountInput } from "../../api/accounts";
import { todayIST } from "../../lib/dates";
import { looksLikeDomain } from "../../lib/domain";
import { normalizeMoneyInput } from "../../lib/money";

export type AccountFormValues = {
  bank_name: string;
  nickname: string;
  account_type: AccountType;
  last4: string;
  opening_balance: string;
  opening_date: string;
  notes: string;
  bank_domain: string;
};

export type AccountFormErrors = Partial<Record<keyof AccountFormValues, string>>;

export function initialValues(account?: BankAccount): AccountFormValues {
  return {
    bank_name: account?.bank_name ?? "",
    nickname: account?.nickname ?? "",
    account_type: account?.account_type ?? "savings",
    last4: account?.last4 ?? "",
    opening_balance: account?.opening_balance ?? "",
    opening_date: account?.opening_date ?? todayIST(),
    notes: account?.notes ?? "",
    bank_domain: account?.bank_domain ?? "",
  };
}

/** Returns field errors, or the API payload when everything is valid. */
export function validateAccountForm(
  values: AccountFormValues,
  today: string = todayIST(),
): { errors: AccountFormErrors; input: null } | { errors: Record<string, never>; input: BankAccountInput } {
  const errors: AccountFormErrors = {};
  const bankName = values.bank_name.trim();
  const nickname = values.nickname.trim();
  const last4 = values.last4.trim();
  const opening = values.opening_balance.trim() === "" ? "0.00" : normalizeMoneyInput(values.opening_balance);

  if (!bankName) errors.bank_name = "Enter the bank or wallet name.";
  else if (bankName.length > 100) errors.bank_name = "Keep it under 100 characters.";

  if (!nickname) errors.nickname = "Give it a short name you'll recognise.";
  else if (nickname.length > 100) errors.nickname = "Keep it under 100 characters.";

  if (last4 && !/^\d{4}$/.test(last4)) errors.last4 = "Enter exactly 4 digits, or leave empty.";

  if (opening === null) errors.opening_balance = "Enter an amount like 25000 or 25000.50.";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.opening_date)) errors.opening_date = "Pick a date.";
  else if (values.opening_date > today) errors.opening_date = "Can't be in the future.";

  if (values.notes.length > 2000) errors.notes = "Keep notes under 2000 characters.";

  const domain = values.bank_domain.trim();
  if (domain && !looksLikeDomain(domain)) errors.bank_domain = "Enter a website like hdfcbank.com, or leave empty.";

  if (Object.keys(errors).length > 0 || opening === null) return { errors, input: null };

  return {
    errors: {},
    input: {
      bank_name: bankName,
      nickname,
      account_type: values.account_type,
      last4: last4 || null,
      opening_balance: opening,
      opening_date: values.opening_date,
      notes: values.notes.trim() || null,
      bank_domain: domain || null,
    },
  };
}
