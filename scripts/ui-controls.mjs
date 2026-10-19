// Keep value assertions on the native form control, and interact with its visible listbox.
export function nativeSelect(scope, label) {
  return scope
    .getByRole("combobox", { name: label, exact: true })
    .locator("..")
    .locator("select.ui-select-native");
}

export async function chooseSelect(control, value) {
  await control.waitFor({ state: "attached" });
  const root = control.locator("..");
  const select = root.locator("select.ui-select-native");
  const label = await select.locator("option").evaluateAll((options, value) => {
    const option = options.find((option) => option.value === String(value));
    if (!option) throw Error("Missing select option: " + value);
    return option.label;
  }, value);
  await root.getByRole("combobox").click();
  await control
    .page()
    .getByRole("listbox")
    .getByRole("option", { name: label, exact: true })
    .click();
}
