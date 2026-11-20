import { expect, it } from "vitest";

import { checkLogoFile, MAX_LOGO_BYTES } from "./LogoUploadField";

it.each([
  [{ type: "image/png", size: 40_000 }, null],
  [{ type: "image/jpeg", size: MAX_LOGO_BYTES }, null],
  [{ type: "image/svg+xml", size: 2_000 }, "Pick a PNG, JPG, WEBP or GIF image."],
  [{ type: "application/pdf", size: 2_000 }, "Pick a PNG, JPG, WEBP or GIF image."],
  [{ type: "image/png", size: MAX_LOGO_BYTES + 1 }, "That image is over 2 MB. Crop or resize it first."],
])("checkLogoFile(%o)", (file, expected) => {
  expect(checkLogoFile(file)).toBe(expected);
});
