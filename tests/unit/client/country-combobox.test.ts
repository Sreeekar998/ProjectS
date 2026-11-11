import { describe, expect, it } from "vitest";
import { comboboxEnterAction } from "@/components/features/country-combobox";
import { DETECT_CHOICE, countryPickerOption, countryPickerOptions } from "@/lib/geo/country-search";

const options = countryPickerOptions();
const france = countryPickerOption("FR", options)!;

describe("country combobox Enter", () => {
  it("submits the form only when the field shows the committed choice", () => {
    expect(comboboxEnterAction({ open: false, query: null, active: undefined, options })).toEqual({ kind: "submit" });
  });

  it("after Escape closed the list over typed text, commits the best match instead of submitting the old market", () => {
    const action = comboboxEnterAction({ open: false, query: "France", active: undefined, options });
    expect(action).toEqual({ kind: "pick", option: france });
  });

  it("restores the committed choice when the closed field's text matches nothing or is blank", () => {
    expect(comboboxEnterAction({ open: false, query: "zzqx", active: undefined, options })).toEqual({ kind: "restore" });
    expect(comboboxEnterAction({ open: false, query: "  ", active: undefined, options })).toEqual({ kind: "restore" });
  });

  it("keeps the open-list behaviour: the highlighted option, else the best match, else restore", () => {
    const detect = countryPickerOption(DETECT_CHOICE, options)!;
    expect(comboboxEnterAction({ open: true, query: "fra", active: detect, options })).toEqual({ kind: "pick", option: detect });
    expect(comboboxEnterAction({ open: true, query: "France", active: undefined, options })).toEqual({ kind: "pick", option: france });
    expect(comboboxEnterAction({ open: true, query: null, active: undefined, options })).toEqual({ kind: "restore" });
  });
});
