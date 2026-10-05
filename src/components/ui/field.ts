// Classi dei campi nativi (select, textarea) allineate a <Input>: un solo punto (docs/DESIGN.md).
const base =
  "rounded-md border border-input bg-surface text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:border-disabled disabled:bg-disabled disabled:text-ink-disabled";

export const selectClass = `${base} h-11 px-3 text-sm`;
export const textareaClass = `${base} px-3 py-2 text-base`;
