import { describe, expect, it } from "vitest";

import type { Category } from "../../api/categories";
import { validateCategoryForm } from "./categoryForm";

const food: Category = {
  id: "food", name: "Food", icon: "UtensilsCrossed", color: "#ea580c", kind: "expense", is_system: true, is_archived: false, sort_order: 1,
};
const values = { name: "  Pet   care ", icon: "PawPrint", color: "#0D9488", kind: "expense" as const };

describe("validateCategoryForm", () => {
  it("tidies the name and lower-cases the colour", () => {
    expect(validateCategoryForm(values, [food]).input).toEqual({ name: "Pet care", icon: "PawPrint", color: "#0d9488", kind: "expense" });
  });

  it("rejects a duplicate name in any case, except the one being edited", () => {
    expect(validateCategoryForm({ ...values, name: "FOOD" }, [food]).errors.name).toBe('"FOOD" already exists.');
    expect(validateCategoryForm({ ...values, name: "Food" }, [food], "food").input).not.toBeNull();
  });

  it("points to an archived duplicate", () => {
    expect(validateCategoryForm({ ...values, name: "food" }, [{ ...food, is_archived: true }]).errors.name).toContain("archived");
  });

  it("rejects unknown icons and bad colours", () => {
    const { errors } = validateCategoryForm({ ...values, icon: "NotAnIcon", color: "red" }, []);
    expect(Object.keys(errors).sort()).toEqual(["color", "icon"]);
  });
});
